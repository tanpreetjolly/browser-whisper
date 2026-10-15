/**
 * Engine-agnostic ASR worker, kept apart from the `self` wiring so it can be tested with fake
 * engines. Every message carries a runId: a cancelled or superseded run must never leak
 * segments or `done` into the next one on a reused worker (#34).
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
    fatalTarget: EventTarget;
    // Test seams.
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

            // Errors escaping an engine's promise chains would otherwise hang the load at 99%.
            const engine = await fatalErrors.guard((async () => {
                // Probe first: transformers.js 4.x chains all session creates on one promise, so a
                // rejected WebGPU session would poison the WASM fallback.
                const wantsGpu = desc.devices.includes('webgpu');
                const adapter = wantsGpu ? await getAdapter() : null;
                if (wantsGpu && !adapter && desc.devices.includes('wasm')) {
                    warn('[browser-whisper] No WebGPU adapter available. Using WASM execution.');
                }
                const plan = planDevices(desc.devices, !!adapter);
                if (plan.length === 0) {
                    throw new Error(`Model "${model}" requires WebGPU, but no WebGPU adapter is available in this browser.`);
                }
                // Unsupported browsers never download the runtime.
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

            // Compiles WebGPU shaders now, hiding a 1-5 s first-chunk stall.
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

        // Overlapping inits would otherwise race on the shared engine.
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
        // Engines can't always abort mid-inference; drop late results instead.
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
