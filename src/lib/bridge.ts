/**
 * bridge.ts
 *
 * Orchestrates the Decoder and Whisper workers via:
 *  - A MessageChannel for direct worker-to-worker PCMChunk flow
 *  - Routing messages from the Whisper worker back to the caller via callbacks
 */

import type {
    MainThreadMessage,
    TranscriptSegment,
    TranscribeProgress,
    WhisperModel,
    PCMChunk,
    QuantizationType,
} from '../types.js';
import { MODEL_IDS } from '../types.js';
import { BrowserWhisperError } from '../errors.js';
import { Chunker } from './chunker.js';
import { downmixToMono, resampleTo16kHz } from './resampler.js';

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

        // Vite inline worker imports to avoid Next.js / Webpack resolution issues
        this.decoderWorker = new DecoderWorker();
        this.whisperWorker = new WhisperWorker();

        // Route messages from the Whisper worker
        this.whisperWorker.onmessage = (e: MessageEvent<MainThreadMessage>) => {
            this.handleWhisperMessage(e.data);
        };

        // ── Route messages from the Decoder worker ────────────────────────────
        // Critical: without this, decoder errors and progress are silently dropped.
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
        model: WhisperModel = 'whisper-base',
        language?: string,
        quantization?: QuantizationType,
    ): Promise<void> {
        const modelId = MODEL_IDS[model];

        // ── Create MessageChannel for direct decoder→whisper PCM transfer ──────
        const { port1, port2 } = new MessageChannel();

        const hasWebCodecs = typeof window !== 'undefined' && 'AudioDecoder' in window;

        // Give port1 to the decoder (it will postMessage PCMChunks through it)
        if (hasWebCodecs) {
            this.decoderWorker.postMessage({ type: 'port', port: port1 }, [port1]);
        }

        // Give port2 to whisper (it will receive PCMChunks through it)
        this.whisperWorker.postMessage({ type: 'port', port: port2 }, [port2]);

        // ── Start Whisper model loading first (runs concurrently with decode) ──
        this.whisperWorker.postMessage({ type: 'init', modelId, language, quantization });

        // Wait for the model to finish loading before feeding chunks into it
        await this.waitForReady();

        if (this.terminated) return;

        // ── Start decoding — chunks will flow directly to the whisper worker ───
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

            // 1. Read file into memory
            const arrayBuffer = await file.arrayBuffer();

            // 2. Decode using Web Audio API (supported almost everywhere)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            this.callbacks.onProgress({ stage: 'decoding', progress: 0.5 }); // Halfway done (decoding finished)

            // 3. Extract channels and downmix to mono
            const numChannels = audioBuffer.numberOfChannels;
            const channels: Float32Array[] = [];
            for (let i = 0; i < numChannels; i++) {
                channels.push(audioBuffer.getChannelData(i));
            }
            const mono = downmixToMono(channels);

            // 4. Resample to exactly 16kHz
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

            // 5. Send into the existing chunking pipeline perfectly mimicking the web worker
            const chunker = new Chunker((chunk: PCMChunk) => {
                if (this.terminated) return; // Prevent memory leak / runaway process
                port.postMessage(chunk, [chunk.samples.buffer]);
            });

            // Feed audio to the chunker slowly to respect backpressure (30s at a time)
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

    /** Route messages from the decoder worker (progress + errors) */
    private handleDecoderMessage(msg: MainThreadMessage): void {
        if (this.terminated) return;

        switch (msg.type) {
            case 'progress':
                // Forward decoding progress alongside whisper progress
                this.callbacks.onProgress(msg.event);
                break;

            case 'error':
                // Decoder errors are fatal — surface them and stop
                this.callbacks.onError(`Decoder: ${msg.message}`);
                this.terminate();
                break;

            default:
                // ignore 'ready', 'done', 'segment' (not emitted by decoder)
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
                    // Restore the main message handler and resolve
                    this.whisperWorker.onmessage = original;
                    resolve();
                } else if (e.data.type === 'error') {
                    this.whisperWorker.onmessage = original;
                    reject(new BrowserWhisperError(e.data.message));
                } else {
                    // Forward progress events (model download progress) during loading
                    this.handleWhisperMessage(e.data);
                }
            };
        });
    }
}
