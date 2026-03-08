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
} from '../types.js';
import { MODEL_IDS } from '../types.js';
import { BrowserWhisperError } from '../errors.js';

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

        // Vite bundles worker files as separate ES module chunks; the new URL()
        // pattern tells Vite to treat the path as a worker entry point.
        this.decoderWorker = new Worker(
            new URL('../workers/decoder-worker.ts', import.meta.url),
            { type: 'module' },
        );
        this.whisperWorker = new Worker(
            new URL('../workers/whisper-worker.ts', import.meta.url),
            { type: 'module' },
        );

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
            callbacks.onError(`Whisper worker: ${e.message ?? 'unknown error'}`);
        };

        this.decoderWorker.onerror = (e) => {
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
    ): Promise<void> {
        const modelId = MODEL_IDS[model];

        // ── Create MessageChannel for direct decoder→whisper PCM transfer ──────
        const { port1, port2 } = new MessageChannel();

        // Give port1 to the decoder (it will postMessage PCMChunks through it)
        this.decoderWorker.postMessage({ type: 'port', port: port1 }, [port1]);

        // Give port2 to whisper (it will receive PCMChunks through it)
        this.whisperWorker.postMessage({ type: 'port', port: port2 }, [port2]);

        // ── Start Whisper model loading first (runs concurrently with decode) ──
        this.whisperWorker.postMessage({ type: 'init', modelId, language });

        // Wait for the model to finish loading before feeding chunks into it
        await this.waitForReady();

        if (this.terminated) return;

        // ── Start decoding — chunks will flow directly to the whisper worker ───
        this.decoderWorker.postMessage({ type: 'init', file });
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
