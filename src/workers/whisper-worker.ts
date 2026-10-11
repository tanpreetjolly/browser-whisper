/**
 * whisper-worker.ts
 *
 * Runs in a Web Worker. Responsible for:
 *  1. Loading the ASR pipeline from transformers.js
 *  2. Receiving mono 16-kHz PCMChunks from the decoder worker via MessagePort
 *  3. Running inference on each chunk
 *  4. Adjusting timestamps to be file-relative (adding chunk.timestamp)
 *  5. Posting TranscriptSegments back to the main thread
 */

import { pipeline, env } from '@huggingface/transformers';
import type {
    MainThreadMessage,
    PCMChunk,
    ASRWorkerMessage,
    ASRModel,
    QuantizationType,
} from '../types.js';
import { MODELS } from '../types.js';
import { createOPFSCache } from '../lib/opfs-cache.js';
import { hasWebGPUAdapter } from '../lib/webgpu.js';
import { createLoadProgressTracker } from '../lib/load-progress.js';
import { buildSegments, type TimestampChunk } from '../lib/word-segments.js';
import { createFatalErrorTrap } from '../lib/fatal-errors.js';

// Surfaces errors that escape transformers.js' promise chains (see fatal-errors.ts) as load errors.
const fatalErrors = createFatalErrorTrap(self as unknown as EventTarget);

// ---------------------------------------------------------------------------
// transformers.js environment setup
// ---------------------------------------------------------------------------

// Cache model files in OPFS. The custom cache checks OPFS first, migrates
// entries from the old transformers.js Cache API cache on first access, and
// stores new downloads in OPFS.
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = createOPFSCache({ legacyCacheName: env.cacheKey ?? 'transformers-cache' });
// Prevent the library from trying file:// lookups in browser context
env.allowLocalModels = false;

// WASM/JSEP runtime files: transformers.js 4.x sets env.backends.onnx.wasm.wasmPaths
// itself to absolute jsDelivr URLs for the exact onnxruntime-web version it bundles
// (https://cdn.jsdelivr.net/npm/onnxruntime-web@<version>/dist/ort-wasm-simd-threaded.asyncify.{mjs,wasm}).
// 3.x needed a manual override pinned to the transformers version; 4.x no longer ships
// those files in its own dist/, so we must NOT override it. Absolute URLs are still what
// the blob: worker needs. With env.useWasmCache (default true) the .wasm/.mjs are also
// stored through env.customCache, i.e. our OPFS cache.

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

// Simple callable type for the ASR pipeline — avoids TS2590 (union too complex)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASRPipeline = (input: Float32Array, opts: Record<string, unknown>) => Promise<any>;

let asrPipeline: ASRPipeline | null = null;
let currentModel: ASRModel | null = null;
let currentQuantization: QuantizationType | null = null;

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
        // Receive the MessagePort connected to the decoder worker
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
        const config = MODELS[model];

        postMain({ type: 'progress', event: { stage: 'loading', progress: 0 } });

        try {
            if (
                asrPipeline === null ||
                currentModel !== model ||
                currentQuantization !== quantization
            ) {
                if (asrPipeline) {
                    try {
                        // Attempt to free GPU memory of previous model
                        (asrPipeline as unknown as { dispose?(): Promise<void> }).dispose?.();
                    } catch (e) {
                        // ignore
                    }
                }
                currentModel = model;
                currentQuantization = quantization;

                // transformers.js downloads multiple files concurrently. To prevent the loading bar
                // from jumping wildly as different files report progress, we aggregate them here.
                const trackProgress = createLoadProgressTracker((progress) => {
                    postMain({ type: 'progress', event: { stage: 'loading', progress } });
                });

                const dtype = quantization === 'hybrid' ? config.hybridDtype : quantization;

                const loadPipeline = async (device: 'webgpu' | 'wasm') => {
                    return (await (pipeline as (...a: unknown[]) => Promise<unknown>)(
                        'automatic-speech-recognition',
                        config.hfId,
                        {
                            device,
                            dtype,
                            progress_callback: trackProgress,
                        },
                    )) as ASRPipeline;
                };

                const loadWithFallback = async (): Promise<ASRPipeline> => {
                    // Check for a usable GPU adapter *before* asking transformers.js for WebGPU.
                    // transformers.js 4.x serialises every InferenceSession.create() on a module-level
                    // promise chain (`webInitChain = webInitChain.then(load)` in backends/onnx.js).
                    // A rejected WebGPU session leaves that chain rejected, so every later session
                    // in this worker (including the WASM fallback) re-throws the same error.
                    // (3.x had the same failure mode via the memoized `wasmInitPromise`.)
                    if (await hasWebGPUAdapter()) {
                        try {
                            return await loadPipeline('webgpu');
                        } catch (gpuErr) {
                            const msg = gpuErr instanceof Error ? gpuErr.message : String(gpuErr);
                            console.warn(`[browser-whisper] WebGPU initialization failed (${msg}). Falling back to WASM execution.`);
                            return await loadPipeline('wasm');
                        }
                    } else {
                        console.warn('[browser-whisper] No WebGPU adapter available. Using WASM execution.');
                        return await loadPipeline('wasm');
                    }
                };
                // Guard the whole load: an error that escapes transformers.js' internal promises
                // would otherwise leave this await pending forever (UI stuck at 99%).
                asrPipeline = await fatalErrors.guard(loadWithFallback());

                // Compile WebGPU shaders by running a dummy inference
                // WebGPU has a cold-start delay of 1-5s for shader compilation on the first run.
                // Doing this here (before the user uploads a file) hides that delay.
                postMain({ type: 'progress', event: { stage: 'loading', progress: 0.99 } });
                try {
                    const dummyAudio = new Float32Array(16000 * 0.1); // 0.1s of silence
                    await fatalErrors.guard(asrPipeline(dummyAudio, { sampling_rate: 16_000 }));
                } catch (e) {
                    // Ignore dummy inference errors
                    console.warn('[whisper.worker] pre-warm failed:', e);
                }
            }

            postMain({ type: 'progress', event: { stage: 'loading', progress: 1 } });
            postMain({ type: 'ready' });
        } catch (err) {
            currentModel = null;
            currentQuantization = null;
            asrPipeline = null;
            console.error('[browser-whisper] Model load failed:', err);
            postMain({ type: 'error', message: err instanceof Error ? err.message : String(err), loadModelId: config.hfId });
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
    // Notify decoder we pulled a chunk, freeing up space
    port?.postMessage(queue.length);

    try {
        await transcribeChunk(chunk);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postMain({ type: 'error', message });
    }

    // Process next chunk (tail-recursive via Promise chain)
    void processNext();
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

async function transcribeChunk(chunk: PCMChunk): Promise<void> {
    if (!asrPipeline || !currentModel) return;

    const config = MODELS[currentModel];

    postMain({ type: 'progress', event: { stage: 'transcribing', progress: 0 } });

    const returnTimestamps = config.supportsWordTimestamps
        ? 'word'
        : config.supportsTimestamps
            ? true
            : undefined;

    const result = await asrPipeline(chunk.samples, {
        sampling_rate: 16_000,
        ...(returnTimestamps !== undefined && {
            return_timestamps: returnTimestamps,
            chunk_length_s: 30,
            stride_length_s: 5,
        }),
        ...(config.supportsLanguage && language ? { language } : {}),
    });

    const output = result as {
        text: string;
        chunks?: TimestampChunk[];
    };

    const segments = buildSegments(output, chunk, config);

    for (const segment of segments) {
        postMain({ type: 'segment', segment });
    }

    postMain({ type: 'progress', event: { stage: 'transcribing', progress: 1 } });

    if (chunk.final) {
        postMain({ type: 'done' });
    }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function postMain(msg: MainThreadMessage): void {
    (self as unknown as Worker).postMessage(msg);
}
