/**
 * whisper-worker.ts
 *
 * Runs in a Web Worker. Engine-agnostic orchestration:
 *  1. Resolving the model's ASR engine (src/workers/engines) and loading it lazily,
 *     WebGPU first with WASM fallback
 *  2. Receiving mono 16-kHz PCMChunks from the decoder worker via MessagePort
 *  3. Running inference on each chunk through the engine
 *  4. Building file-relative, clamped TranscriptSegments
 *  5. Posting them back to the main thread
 */

import type {
    MainThreadMessage,
    PCMChunk,
    ASRWorkerMessage,
    ASRModel,
    ModelConfig,
    QuantizationType,
} from '../types.js';
import { hasWebGPUAdapter } from '../lib/webgpu.js';
import { createLoadProgressTracker } from '../lib/load-progress.js';
import { buildSegments } from '../lib/word-segments.js';
import { createFatalErrorTrap } from '../lib/fatal-errors.js';
import { planDevices, resolveEngine } from './engines/registry.js';
import type { ASREngine } from './engines/types.js';

// Surfaces errors that escape engine promise chains (see fatal-errors.ts) as load errors.
const fatalErrors = createFatalErrorTrap(self as unknown as EventTarget);

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let engine: ASREngine | null = null;
let currentModel: ASRModel | null = null;
let currentQuantization: QuantizationType | null = null;
let currentConfig: ModelConfig | null = null;

let port: MessagePort | null = null;
let language: string | undefined;

/** Chunk queue — we process one chunk at a time, in order */
const queue: PCMChunk[] = [];
let processing = false;

// ---------------------------------------------------------------------------
// Message handler (from main thread)
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data as ASRWorkerMessage;

    if (msg.type === 'port') {
        port = msg.port!;
        port.onmessage = (portEvent: MessageEvent<PCMChunk>) => {
            enqueue(portEvent.data);
        };
        return;
    }

    if (msg.type === 'init') {
        language = msg.language;
        const model = msg.model;
        const quantization: QuantizationType = msg.quantization || 'hybrid';
        let hfId: string | undefined;

        postMain({ type: 'progress', event: { stage: 'loading', progress: 0 } });

        try {
            const { config, engine: entry } = resolveEngine(model);
            hfId = config.hfId;

            if (engine === null || currentModel !== model || currentQuantization !== quantization) {
                const previous = engine;
                engine = null;
                currentModel = null;
                currentConfig = null;
                await previous?.dispose();

                // Engines may download several files concurrently; aggregate into one bar.
                const onProgress = createLoadProgressTracker((progress) => {
                    postMain({ type: 'progress', event: { stage: 'loading', progress } });
                });

                // Guard the whole load: an error that escapes an engine's internal promises
                // would otherwise leave this await pending forever (UI stuck at 99%).
                const loaded = await fatalErrors.guard((async () => {
                    const next = await entry.create();
                    // Check for a usable GPU adapter *before* asking the engine for WebGPU.
                    // transformers.js 4.x chains every InferenceSession.create() on one module-level
                    // promise; a rejected WebGPU session poisons it so the WASM fallback in this
                    // worker would re-throw the same error.
                    const gpu = entry.devices.includes('webgpu') && await hasWebGPUAdapter();
                    if (entry.devices.includes('webgpu') && !gpu) {
                        console.warn('[browser-whisper] No WebGPU adapter available. Using WASM execution.');
                    }
                    const plan = planDevices(entry.devices, gpu);
                    if (plan.length === 0) throw new Error(`No supported device for engine "${config.engine}"`);
                    for (let i = 0; i < plan.length; i++) {
                        try {
                            await next.load(config, plan[i], { quantization, onProgress });
                            return next;
                        } catch (err) {
                            if (i === plan.length - 1) throw err;
                            const m = err instanceof Error ? err.message : String(err);
                            console.warn(`[browser-whisper] WebGPU initialization failed (${m}). Falling back to WASM execution.`);
                        }
                    }
                    throw new Error('unreachable');
                })());

                engine = loaded;
                currentModel = model;
                currentQuantization = quantization;
                currentConfig = config;

                // Pre-warm (compiles WebGPU shaders; hides a 1-5 s cold start).
                postMain({ type: 'progress', event: { stage: 'loading', progress: 0.99 } });
                try {
                    await fatalErrors.guard(engine.transcribe(new Float32Array(16000 * 0.1), {}));
                } catch (e) {
                    console.warn('[whisper.worker] pre-warm failed:', e);
                }
            }

            postMain({ type: 'progress', event: { stage: 'loading', progress: 1 } });
            postMain({ type: 'ready' });
        } catch (err) {
            currentModel = null;
            currentQuantization = null;
            currentConfig = null;
            engine = null;
            console.error('[browser-whisper] Model load failed:', err);
            postMain({ type: 'error', message: err instanceof Error ? err.message : String(err), loadModelId: hfId });
        }
    }
};

// ---------------------------------------------------------------------------
// Chunk queuing & processing
// ---------------------------------------------------------------------------

function enqueue(chunk: PCMChunk): void {
    queue.push(chunk);
    // Notify decoder of our new queue depth for backpressure
    port?.postMessage(queue.length);
    if (!processing) processNext();
}

async function processNext(): Promise<void> {
    if (queue.length === 0) {
        processing = false;
        return;
    }

    processing = true;
    const chunk = queue.shift()!;
    port?.postMessage(queue.length);

    try {
        await transcribeChunk(chunk);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postMain({ type: 'error', message });
    }

    void processNext();
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

async function transcribeChunk(chunk: PCMChunk): Promise<void> {
    if (!engine || !currentConfig) return;

    postMain({ type: 'progress', event: { stage: 'transcribing', progress: 0 } });

    const output = await engine.transcribe(chunk.samples, { language });
    for (const segment of buildSegments(output, chunk, currentConfig)) {
        postMain({ type: 'segment', segment });
    }

    postMain({ type: 'progress', event: { stage: 'transcribing', progress: 1 } });

    if (chunk.final) {
        postMain({ type: 'done' });
    }
}

function postMain(msg: MainThreadMessage): void {
    (self as unknown as Worker).postMessage(msg);
}
