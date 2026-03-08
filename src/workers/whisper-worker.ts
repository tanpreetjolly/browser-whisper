/**
 * whisper.worker.ts
 *
 * Runs in a Web Worker. Responsible for:
 *  1. Loading the Whisper ASR pipeline from transformers.js
 *  2. Receiving mono 16-kHz PCMChunks from the decoder worker via MessagePort
 *  3. Running Whisper inference on each chunk
 *  4. Adjusting timestamps to be file-relative (adding chunk.timestamp)
 *  5. Posting TranscriptSegments back to the main thread
 */

import { pipeline, env } from '@huggingface/transformers';
import type {
    MainThreadMessage,
    PCMChunk,
} from '../types.js';
import { ModelLoadError } from '../errors.js';

// ---------------------------------------------------------------------------
// transformers.js environment setup
// ---------------------------------------------------------------------------

// Cache models in the browser Cache API so second load is instant
env.useBrowserCache = true;
// Prevent the library from trying file:// lookups in browser context
env.allowLocalModels = false;

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

// Simple callable type for the ASR pipeline — avoids TS2590 (union too complex)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASRPipeline = (input: Float32Array, opts: Record<string, unknown>) => Promise<any>;

let asrPipeline: ASRPipeline | null = null;
let currentModelId: string | null = null;

let port: MessagePort | null = null;
let language: string | undefined;

/** Chunk queue — we process one chunk at a time, in order */
const queue: PCMChunk[] = [];
let processing = false;

// ---------------------------------------------------------------------------
// Message handler (from main thread)
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data as { type: string; port?: MessagePort; modelId?: string; language?: string };

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
        const modelId = msg.modelId!;

        postMain({ type: 'progress', event: { stage: 'loading', progress: 0 } });

        try {
            if (asrPipeline === null || currentModelId !== modelId) {
                if (asrPipeline) {
                    try {
                        // Attempt to free GPU memory of previous model
                        (asrPipeline as unknown as { dispose?(): Promise<void> }).dispose?.();
                    } catch (e) {
                        // ignore
                    }
                }
                currentModelId = modelId;

                // Cast via unknown to avoid TS2590 (pipeline has many overloads → complex union)
                asrPipeline = (await (pipeline as (...a: unknown[]) => Promise<unknown>)(
                    'automatic-speech-recognition',
                    modelId,
                    {
                        device: 'webgpu', // gracefully falls back to 'wasm' if WebGPU unavailable
                        // Hybrid quantization: full precision encoder (sensitive to quantization)
                        // + 4-bit quantized decoder (tolerates q4 with negligible accuracy loss).
                        // Cuts model size by ~60% and halves memory usage.
                        dtype: {
                            encoder_model: 'fp32',
                            decoder_model_merged: 'q4',
                        },
                        progress_callback: (progressInfo: unknown) => {
                            const info = progressInfo as { progress?: number };
                            const progress = (info.progress ?? 0) / 100;
                            postMain({
                                type: 'progress',
                                event: { stage: 'loading', progress: Math.min(progress, 0.99) },
                            });
                        },
                    },
                )) as ASRPipeline;


                // Compile WebGPU shaders by running a dummy inference
                // WebGPU has a cold-start delay of 1-5s for shader compilation on the first run.
                // Doing this here (before the user uploads a file) hides that delay.
                postMain({ type: 'progress', event: { stage: 'loading', progress: 0.99 } });
                try {
                    const dummyAudio = new Float32Array(16000 * 0.1); // 0.1s of silence
                    await asrPipeline(dummyAudio, {
                        sampling_rate: 16_000,
                        language: 'en',
                    });
                } catch (e) {
                    // Ignore dummy inference errors
                    console.warn('[whisper.worker] pre-warm failed:', e);
                }
            }

            postMain({ type: 'progress', event: { stage: 'loading', progress: 1 } });
            postMain({ type: 'ready' });
        } catch (err) {
            currentModelId = null;
            asrPipeline = null;
            const loadErr = new ModelLoadError(modelId, err);
            postMain({ type: 'error', message: loadErr.message });
        }
    }
};

// ---------------------------------------------------------------------------
// Chunk queuing & processing
// ---------------------------------------------------------------------------

function enqueue(chunk: PCMChunk): void {
    queue.push(chunk);
    if (!processing) processNext();
}

async function processNext(): Promise<void> {
    if (queue.length === 0) {
        processing = false;
        return;
    }

    processing = true;
    const chunk = queue.shift()!;

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
    if (!asrPipeline) return;

    postMain({ type: 'progress', event: { stage: 'transcribing', progress: 0 } });

    const result = await asrPipeline(chunk.samples, {
        sampling_rate: 16_000,
        // Segment-level timestamps (word-level requires models exported with
        // output_attentions=True, which onnx-community models don't have)
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        ...(language ? { language } : {}),
    });

    // The pipeline returns { text, chunks?: Array<{text, timestamp: [start, end]}> }
    const output = result as {
        text: string;
        chunks?: Array<{ text: string; timestamp: [number | null, number | null] }>;
    };

    const segments = (output.chunks ?? []).map((c) => ({
        text: c.text,
        start: (c.timestamp[0] ?? 0) + chunk.timestamp,
        end: (c.timestamp[1] ?? 0) + chunk.timestamp,
    }));

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
