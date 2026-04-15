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
import { ModelLoadError } from '../errors.js';

// ---------------------------------------------------------------------------
// transformers.js environment setup
// ---------------------------------------------------------------------------

// Cache models in the browser Cache API so second load is instant
env.useBrowserCache = true;
// Prevent the library from trying file:// lookups in browser context
env.allowLocalModels = false;

// Point onnxruntime-web to CDN for its WASM/JSEP files. This is required because
// onnxruntime-web creates an internal blob URL proxy worker for threading, and that
// blob worker needs absolute URLs to load its assets (relative paths fail from blob: context).
// The version here must match the installed @huggingface/transformers version.
// @ts-expect-error - wasmPaths exists on env.backends.onnx.wasm
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

// Simple callable type for the ASR pipeline — avoids TS2590 (union too complex)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASRPipeline = (input: Float32Array, opts: Record<string, unknown>) => Promise<any>;

let asrPipeline: ASRPipeline | null = null;
let currentModel: ASRModel | null = null;

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
            if (asrPipeline === null || currentModel !== model) {
                if (asrPipeline) {
                    try {
                        // Attempt to free GPU memory of previous model
                        (asrPipeline as unknown as { dispose?(): Promise<void> }).dispose?.();
                    } catch (e) {
                        // ignore
                    }
                }
                currentModel = model;

                // transformers.js downloads multiple files concurrently. To prevent the loading bar
                // from jumping wildly as different files report progress, we track them here.
                const downloadCache = new Map<string, { loaded: number; total: number }>();

                const dtype = quantization === 'hybrid' ? config.hybridDtype : quantization;

                const loadPipeline = async (device: 'webgpu' | 'wasm') => {
                    return (await (pipeline as (...a: unknown[]) => Promise<unknown>)(
                        'automatic-speech-recognition',
                        config.hfId,
                        {
                            device,
                            dtype,
                            progress_callback: (progressInfo: any) => {
                                const { status, file, loaded, total } = progressInfo;

                                // 'initiate' fires first with the file's total size
                                if (status === 'initiate' && file && total) {
                                    downloadCache.set(file, { loaded: 0, total });
                                    return;
                                }

                                // 'progress' fires repeatedly with updated loaded bytes
                                if (status === 'progress' && file) {
                                    const prev = downloadCache.get(file);
                                    downloadCache.set(file, {
                                        loaded: loaded || 0,
                                        total: total || prev?.total || 0,
                                    });
                                }

                                // Skip all other statuses ('done', 'ready', etc.)
                                if (status !== 'progress' && status !== 'initiate') return;

                                let totalLoaded = 0;
                                let totalExpected = 0;
                                for (const state of downloadCache.values()) {
                                    totalLoaded += state.loaded;
                                    totalExpected += state.total;
                                }

                                if (totalExpected > 0) {
                                    const rawProgress = totalLoaded / totalExpected;
                                    postMain({
                                        type: 'progress',
                                        // Cap at 0.99 until shader compilation completes
                                        event: { stage: 'loading', progress: Math.min(rawProgress, 0.99) },
                                    });
                                }
                            },
                        },
                    )) as ASRPipeline;
                };

                try {
                    asrPipeline = await loadPipeline('webgpu');
                } catch (gpuErr) {
                    const msg = gpuErr instanceof Error ? gpuErr.message : String(gpuErr);
                    console.warn(`[browser-whisper] WebGPU initialization failed (${msg}). Falling back to WASM execution.`);
                    asrPipeline = await loadPipeline('wasm');
                }

                // Compile WebGPU shaders by running a dummy inference
                // WebGPU has a cold-start delay of 1-5s for shader compilation on the first run.
                // Doing this here (before the user uploads a file) hides that delay.
                postMain({ type: 'progress', event: { stage: 'loading', progress: 0.99 } });
                try {
                    const dummyAudio = new Float32Array(16000 * 0.1); // 0.1s of silence
                    await asrPipeline(dummyAudio, { sampling_rate: 16_000 });
                } catch (e) {
                    // Ignore dummy inference errors
                    console.warn('[whisper.worker] pre-warm failed:', e);
                }
            }

            postMain({ type: 'progress', event: { stage: 'loading', progress: 1 } });
            postMain({ type: 'ready' });
        } catch (err) {
            currentModel = null;
            asrPipeline = null;
            const loadErr = new ModelLoadError(config.hfId, err);
            postMain({ type: 'error', message: loadErr.message });
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

    const result = await asrPipeline(chunk.samples, {
        sampling_rate: 16_000,
        ...(config.supportsTimestamps && {
            // Segment-level timestamps (word-level requires models exported with
            // output_attentions=True, which onnx-community models don't have)
            return_timestamps: true,
            chunk_length_s: 30,
            stride_length_s: 5,
        }),
        ...(config.supportsLanguage && language ? { language } : {}),
    });

    // The pipeline returns { text, chunks?: Array<{text, timestamp: [start, end]}> }
    const output = result as {
        text: string;
        chunks?: Array<{ text: string; timestamp: [number | null, number | null] }>;
    };

    // Models without timestamp support return no chunks — emit a single segment spanning the whole chunk
    const segments = output.chunks
        ? output.chunks.map((c) => ({
            text: c.text,
            start: (c.timestamp[0] ?? 0) + chunk.timestamp,
            end: (c.timestamp[1] ?? 0) + chunk.timestamp,
        }))
        : output.text.trim()
            ? [{ text: output.text, start: chunk.timestamp, end: chunk.timestamp + chunk.samples.length / 16_000 }]
            : [];

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
