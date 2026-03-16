/**
 * bridge.ts
 *
 * Orchestrates the Decoder and Whisper workers via:
 *  - A MessageChannel for direct worker-to-worker PCMChunk flow
 *  - Routing messages from the Whisper worker back to the caller via callbacks
 *
 * ── Bundler compatibility ─────────────────────────────────────────────────────
 * Workers use `?worker&inline` so Vite bundles each into a self-contained blob
 * URL at build time. The published dist/index.js contains plain
 * `URL.createObjectURL(new Blob([...]))` calls, so it works in any JS runtime.
 *
 * All dependencies (@huggingface/transformers, mediabunny, onnxruntime-web)
 * are bundled into the blobs — bare specifiers cannot be resolved from a
 * blob: URL at runtime. WASM binaries are excluded via the .wasm alias and
 * loaded from CDN at runtime via env.backends.onnx.wasm.wasmPaths instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
    MainThreadMessage,
    TranscriptSegment,
    TranscribeProgress,
    ASRModel,
    PCMChunk,
    QuantizationType,
} from '../types.js';
import { BrowserWhisperError } from '../errors.js';
import { Chunker } from './chunker.js';
import { downmixToMono, resampleTo16kHz } from './resampler.js';

// `?worker&inline` bundles each worker as a self-contained blob URL so that
// bare module specifiers (e.g. @huggingface/transformers) are resolved at
// build time rather than at runtime — blob: URLs cannot resolve bare specifiers.
import DecoderWorker from '../workers/decoder-worker.ts?worker&inline';
import WhisperWorker from '../workers/whisper-worker.ts?worker&inline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BridgeCallbacks {
    onSegment: (segment: TranscriptSegment) => void;
    onProgress: (event: TranscribeProgress) => void;
    onDone: () => void;
    onError: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class Bridge {
    private readonly decoderWorker: Worker;
    private readonly whisperWorker: Worker;
    private readonly callbacks: BridgeCallbacks;
    private terminated = false;

    constructor(callbacks: BridgeCallbacks) {
        this.callbacks = callbacks;

        this.decoderWorker = new DecoderWorker();
        this.whisperWorker = new WhisperWorker();

        // Route messages from the Whisper worker
        this.whisperWorker.onmessage = (e: MessageEvent<MainThreadMessage>) => {
            this.handleWhisperMessage(e.data);
        };

        // Route messages from the Decoder worker (progress + errors)
        this.decoderWorker.onmessage = (e: MessageEvent<MainThreadMessage>) => {
            this.handleDecoderMessage(e.data);
        };

        this.whisperWorker.onerror = (e) => {
            console.error('[browser-whisper] Whisper worker thread crashed:', e);
            callbacks.onError(`Whisper worker: ${e.message ?? 'unknown error'}`);
        };

        this.decoderWorker.onerror = (e) => {
            console.error('[browser-whisper] Decoder worker thread crashed:', e);
            callbacks.onError(`Decoder worker: ${e.message ?? 'unknown error'}`);
        };
    }

    /**
     * Start transcription.
     *
     * Model loading and decoding run concurrently — the Whisper worker starts
     * loading the model at the same time MediaBunny begins demuxing/decoding.
     * Chunks queued before the model is ready are processed in order once ready.
     */
    async start(
        file: File,
        model: ASRModel = 'whisper-tiny',
        language?: string,
        quantization?: QuantizationType,
    ): Promise<void> {
        // Create MessageChannel for direct decoder→whisper PCM transfer (zero-copy)
        const { port1, port2 } = new MessageChannel();

        const hasWebCodecs = typeof window !== 'undefined' && 'AudioDecoder' in window;

        // Give port1 to the decoder (it will postMessage PCMChunks through it)
        if (hasWebCodecs) {
            this.decoderWorker.postMessage({ type: 'port', port: port1 }, [port1]);
        }

        // Give port2 to whisper (it will receive PCMChunks through it)
        this.whisperWorker.postMessage({ type: 'port', port: port2 }, [port2]);

        // Start model loading (runs concurrently with decode)
        this.whisperWorker.postMessage({ type: 'init', model, language, quantization });

        // Wait for the model to finish loading before feeding chunks into it
        await this.waitForReady();

        if (this.terminated) return;

        // Start decoding — chunks will flow directly to the whisper worker
        if (hasWebCodecs) {
            this.decoderWorker.postMessage({ type: 'init', file });
        } else {
            console.warn('[browser-whisper] WebCodecs not supported. Falling back to AudioContext for decoding.');
            this.decodeWithAudioContext(file, port1);
        }
    }

    /** Terminate both workers and clean up resources */
    terminate(): void {
        this.terminated = true;
        this.decoderWorker.terminate();
        this.whisperWorker.terminate();
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    /** Fallback for older browsers (e.g. Safari < 16.4) that lack WebCodecs AudioDecoder */
    private async decodeWithAudioContext(file: File, port: MessagePort): Promise<void> {
        try {
            this.callbacks.onProgress({ stage: 'decoding', progress: 0 });

            const arrayBuffer = await file.arrayBuffer();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            this.callbacks.onProgress({ stage: 'decoding', progress: 0.5 });

            const numChannels = audioBuffer.numberOfChannels;
            const channels: Float32Array[] = [];
            for (let i = 0; i < numChannels; i++) {
                channels.push(audioBuffer.getChannelData(i));
            }
            const mono = downmixToMono(channels);
            const resampled = resampleTo16kHz(mono, audioBuffer.sampleRate);

            // Listen for backpressure queue depth updates from the whisper worker
            let whisperQueueSize = 0;
            let whisperQueueWaiter: (() => void) | null = null;
            port.onmessage = (e: MessageEvent<number>) => {
                whisperQueueSize = e.data;
                if (whisperQueueSize < 3 && whisperQueueWaiter) {
                    whisperQueueWaiter();
                    whisperQueueWaiter = null;
                }
            };

            const chunker = new Chunker((chunk: PCMChunk) => {
                if (this.terminated) return;
                port.postMessage(chunk, [chunk.samples.buffer]);
            });

            const SAMPLES_PER_CHUNK = 16000 * 30;
            for (let i = 0; i < resampled.length; i += SAMPLES_PER_CHUNK) {
                if (this.terminated) break;

                while (whisperQueueSize >= 3) {
                    await new Promise<void>((resolve) => { whisperQueueWaiter = resolve; });
                }

                if (this.terminated) break;
                const slice = resampled.subarray(i, i + SAMPLES_PER_CHUNK);
                chunker.push(slice);
            }

            if (!this.terminated) {
                chunker.flush();
                this.callbacks.onProgress({ stage: 'decoding', progress: 1 });
            }
            await audioCtx.close();
        } catch (err) {
            console.error('[browser-whisper] AudioContext fallback failed:', err);
            this.callbacks.onError(`Decoder fallback error: ${err instanceof Error ? err.message : String(err)}`);
            this.terminate();
        }
    }

    private handleWhisperMessage(msg: MainThreadMessage): void {
        if (this.terminated) return;

        switch (msg.type) {
            case 'segment':
                this.callbacks.onSegment(msg.segment);
                break;

            case 'progress':
                this.callbacks.onProgress(msg.event);
                break;

            case 'done':
                this.callbacks.onDone();
                this.terminate();
                break;

            case 'error':
                this.callbacks.onError(msg.message);
                this.terminate();
                break;

            // 'ready' is consumed inside waitForReady()
        }
    }

    private handleDecoderMessage(msg: MainThreadMessage): void {
        if (this.terminated) return;

        switch (msg.type) {
            case 'progress':
                this.callbacks.onProgress(msg.event);
                break;

            case 'error':
                this.callbacks.onError(`Decoder: ${msg.message}`);
                this.terminate();
                break;

            default:
                break;
        }
    }

    /**
     * Returns a Promise that resolves when the Whisper worker posts 'ready',
     * or rejects if it posts 'error' first.
     */
    private waitForReady(): Promise<void> {
        return new Promise((resolve, reject) => {
            const original = this.whisperWorker.onmessage;

            this.whisperWorker.onmessage = (e: MessageEvent<MainThreadMessage>) => {
                if (e.data.type === 'ready') {
                    this.whisperWorker.onmessage = original;
                    resolve();
                } else if (e.data.type === 'error') {
                    this.whisperWorker.onmessage = original;
                    reject(new BrowserWhisperError(e.data.message));
                } else {
                    // Forward progress events (model download) during loading
                    this.handleWhisperMessage(e.data);
                }
            };
        });
    }
}
