/**
 * asr-core.ts
 *
 * Engine-agnostic ASR worker logic, separated from the `self` wiring (asr-worker.ts) so it can
 * be contract-tested with fake engines:
 *  1. Validate the request (model, quantization) and resolve the model's engine
 *  2. Load the engine lazily, WebGPU first with WASM fallback, aggregating download progress
 *  3. Receive mono 16 kHz PCMChunks from the decoder via MessagePort and transcribe them in order
 *  4. Build file-relative, clamped TranscriptSegments and post them back
 *
 * Runs: every request carries a `runId`. Starting a run or `cancel` drops queued chunks of other
 * runs and aborts their AbortSignal, and every outgoing message is tagged with the run it belongs
 * to, so a cancelled run can never leak segments or `done` into the next one (#34).
 */
import type { ASRWorkerMessage, MainThreadMessage, PCMChunk, QuantizationType } from '../types.js';
import { MODEL_DEFINITIONS, type ModelDefinition } from '../models.js';
import { createLoadProgressTracker } from '../lib/load-progress.js';
import { buildSegments } from '../lib/word-segments.js';
import { createFatalErrorTrap } from '../lib/fatal-errors.js';
import { requestWebGPUAdapter } from '../lib/webgpu.js';
import { ENGINES, planDevices, type EngineId } from './engines/catalog.js';
import { RUNTIMES, type RuntimeFactory } from './engines/runtimes.js';
import type { ASREngine, EngineDescriptor } from './engines/types.js';

export interface ASRWorkerHost {
    post(msg: MainThreadMessage): void;
    /** Where escaped errors / unhandled rejections are observed (the worker global). */
    fatalTarget: EventTarget;
    // Injection points (tests); default to the real tables.
    definitions?: Record<string, ModelDefinition>;
    engines?: Record<string, EngineDescriptor<never>>;
    runtimes?: Record<string, RuntimeFactory>;
    getAdapter?: () => Promise<{ features: ReadonlySet<string> } | null>;
    warn?: (...args: unknown[]) => void;
}

interface Loaded {
    engine: ASREngine<never>;
    model: string;
    quantization: QuantizationType;
    def: ModelDefinition;
}

export function createASRWorker(host: ASRWorkerHost): (msg: ASRWorkerMessage) => Promise<void> {
    const definitions = host.definitions ?? (MODEL_DEFINITIONS as Record<string, ModelDefinition>);
    const engines = host.engines ?? (ENGINES as Record<EngineId, EngineDescriptor<never>>);
    const runtimes = host.runtimes ?? RUNTIMES;
    const getAdapter = host.getAdapter ?? (() => requestWebGPUAdapter());
    const warn = host.warn ?? ((...a: unknown[]) => console.warn(...a));
    const fatalErrors = createFatalErrorTrap(host.fatalTarget);
    const warnedLanguage = new Set<string>();

    let loaded: Loaded | null = null;
    let loadChain: Promise<unknown> = Promise.resolve();

    let activeRun: number | null = null;
    let controller = new AbortController();
    let port: MessagePort | null = null;
    let language: string | undefined;
    const queue: { runId: number; chunk: PCMChunk }[] = [];
    let processing = false;

    const post = (runId: number, msg: MainThreadMessage) => host.post({ ...msg, runId });

    /** Make `runId` the active run, discarding everything from previous runs. */
    function activate(runId: number): void {
        if (activeRun === runId) return;
        controller.abort(new DOMException('Superseded by a new run', 'AbortError'));
        controller = new AbortController();
        activeRun = runId;
        queue.length = 0;
    }

    function cancel(runId: number): void {
        if (activeRun !== runId) return;
        controller.abort(new DOMException('Transcription cancelled', 'AbortError'));
        controller = new AbortController();
        activeRun = null;
        queue.length = 0;
        if (port) { port.onmessage = null; port.close(); port = null; }
    }

    async function load(runId: number, model: string, quantization: QuantizationType, signal: AbortSignal): Promise<void> {
        const def = definitions[model];
        if (!def) throw new Error(`Unknown model "${model}"`);
        const desc = engines[def.engine];
        const runtime = runtimes[def.engine];
        if (!desc || !runtime) throw new Error(`Model "${model}" names unknown engine "${def.engine}"`);
        const cacheId = desc.cacheId(def.engineConfig as never);
        try {
            if (!desc.quantizations.includes(quantization)) {
                throw new Error(`Model "${model}" does not support quantization "${quantization}" (supported: ${desc.quantizations.join(', ')}).`);
            }
            if (loaded && loaded.model === model && loaded.quantization === quantization) return;

            const previous = loaded;
            loaded = null;
            await previous?.engine.dispose();

            const tracker = createLoadProgressTracker((progress) => {
                post(runId, { type: 'progress', event: { stage: 'loading', progress } });
            });
            const seen = new Set<string>();
            const onFile = (file: string, bytes: number, total: number) => {
                if (!seen.has(file)) { seen.add(file); tracker({ status: 'initiate', file }); }
                tracker({ status: 'progress', file, loaded: bytes, total });
            };

            // Guard the whole load: an error escaping an engine's internal promises would
            // otherwise leave this await pending forever (UI stuck at 99%).
            const engine = await fatalErrors.guard((async () => {
                // Probe the adapter *before* asking any engine for WebGPU: transformers.js 4.x
                // chains every InferenceSession.create() on one promise, so a rejected WebGPU
                // session would poison the WASM fallback.
                const wantsGpu = desc.devices.includes('webgpu');
                const adapter = wantsGpu ? await getAdapter() : null;
                if (wantsGpu && !adapter && desc.devices.includes('wasm')) {
                    warn('[browser-whisper] No WebGPU adapter available. Using WASM execution.');
                }
                const plan = planDevices(desc.devices, !!adapter);
                if (plan.length === 0) {
                    throw new Error(`Model "${model}" requires WebGPU, but no WebGPU adapter is available in this browser.`);
                }
                // Only now fetch/evaluate the runtime, so an unsupported browser never downloads it.
                const next = await runtime();
                for (let i = 0; i < plan.length; i++) {
                    try {
                        await next.load(
                            { id: model, engineConfig: def.engineConfig as never, capabilities: def.capabilities },
                            {
                                device: plan[i],
                                quantization,
                                adapterFeatures: plan[i] === 'webgpu' && adapter ? adapter.features : new Set(),
                                onFile,
                                signal,
                            },
                        );
                        return next;
                    } catch (err) {
                        if (i === plan.length - 1 || signal.aborted) throw err;
                        const m = err instanceof Error ? err.message : String(err);
                        warn(`[browser-whisper] WebGPU initialization failed (${m}). Falling back to WASM execution.`);
                    }
                }
                throw new Error('unreachable');
            })());

            loaded = { engine, model, quantization, def };

            // Pre-warm (compiles WebGPU shaders; hides a 1-5 s cold start).
            post(runId, { type: 'progress', event: { stage: 'loading', progress: 0.99 } });
            try {
                await fatalErrors.guard(engine.transcribe(new Float32Array(1600), { signal }));
            } catch (e) {
                warn('[browser-whisper] pre-warm failed:', e);
            }
        } catch (err) {
            loaded = null;
            throw Object.assign(err instanceof Error ? err : new Error(String(err)), { loadModelId: cacheId });
        }
    }

    async function init(msg: Extract<ASRWorkerMessage, { type: 'init' }>): Promise<void> {
        const { runId, model } = msg;
        activate(runId);
        language = msg.language;
        const quantization: QuantizationType = msg.quantization || 'hybrid';
        const signal = controller.signal;
        post(runId, { type: 'progress', event: { stage: 'loading', progress: 0 } });

        const def = definitions[model];
        if (def && language && !def.capabilities.language && !warnedLanguage.has(model)) {
            warnedLanguage.add(model);
            warn(`[browser-whisper] Model "${model}" does not support the language option; "${language}" is ignored.`);
        }

        // Serialize loads so overlapping inits never race on the shared engine.
        const job = loadChain.then(() => load(runId, model, quantization, signal));
        loadChain = job.catch(() => {});
        try {
            await job;
            post(runId, { type: 'progress', event: { stage: 'loading', progress: 1 } });
            post(runId, { type: 'ready' });
        } catch (err) {
            if (!signal.aborted) console.error('[browser-whisper] Model load failed:', err);
            post(runId, {
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
                loadModelId: (err as { loadModelId?: string }).loadModelId,
            });
        }
    }

    function enqueue(runId: number, chunk: PCMChunk): void {
        if (runId !== activeRun) return;
        queue.push({ runId, chunk });
        port?.postMessage(queue.length); // backpressure for the decoder
        if (!processing) void processNext();
    }

    async function processNext(): Promise<void> {
        const item = queue.shift();
        if (!item) { processing = false; return; }
        processing = true;
        port?.postMessage(queue.length);
        try {
            await transcribeChunk(item.runId, item.chunk);
        } catch (err) {
            if (item.runId === activeRun) post(item.runId, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        void processNext();
    }

    async function transcribeChunk(runId: number, chunk: PCMChunk): Promise<void> {
        if (!loaded || runId !== activeRun) return;
        const { engine, def } = loaded;
        const signal = controller.signal;
        post(runId, { type: 'progress', event: { stage: 'transcribing', progress: 0 } });
        const result = await engine.transcribe(chunk.samples, {
            signal,
            ...(def.capabilities.language && language ? { language } : {}),
        });
        // Cancelled (or superseded) while the engine was busy: drop the result.
        if (signal.aborted || runId !== activeRun) return;
        for (const segment of buildSegments(result, chunk)) post(runId, { type: 'segment', segment });
        post(runId, { type: 'progress', event: { stage: 'transcribing', progress: 1 } });
        if (chunk.final) {
            post(runId, { type: 'done' });
            activeRun = null;
        }
    }

    return async (msg) => {
        switch (msg.type) {
            case 'port': {
                activate(msg.runId);
                if (port) { port.onmessage = null; port.close(); }
                port = msg.port;
                const runId = msg.runId;
                port.onmessage = (e: MessageEvent<PCMChunk>) => enqueue(runId, e.data);
                return;
            }
            case 'init':
                return init(msg);
            case 'cancel':
                return cancel(msg.runId);
        }
    };
}
