// ---------------------------------------------------------------------------
// Model type
// ---------------------------------------------------------------------------

import type { EngineId } from './workers/engines/catalog.js';
import type { ModelCapabilities } from './workers/engines/types.js';
import type { ASRModel } from './models.js';

export type { ASRModel } from './models.js';
export type { EngineId } from './workers/engines/catalog.js';
export type { ModelCapabilities } from './workers/engines/types.js';
export { MODELS } from './models.js';

export interface ModelConfig {
    /** ASR engine (runtime) that loads and runs this model */
    engine: EngineId;
    /** What the model can do (engine-neutral) */
    capabilities: ModelCapabilities;
    /** Engine-owned configuration (shape depends on `engine`) */
    engineConfig: unknown;
    /** @deprecated Use the engine's config. Hub id used for caching (same as before for every model). */
    hfId: string;
    /** @deprecated Engine-specific; dtype used when quantization is 'hybrid'. */
    hybridDtype: Record<string, string> | string;
    /** @deprecated Use `capabilities.timestamps`. */
    supportsTimestamps: boolean;
    /** @deprecated Use `capabilities.wordTimestamps`. */
    supportsWordTimestamps: boolean;
    /** @deprecated Use `capabilities.language`. */
    supportsLanguage: boolean;
}

/**
 * @deprecated Renamed to {@link ASRModel} to reflect support for non-Whisper models (Moonshine, Distil-Whisper).
 * `WhisperModel` will be removed in a future major version. Update your imports:
 * ```ts
 * // before
 * import type { WhisperModel } from 'browser-whisper';
 * // after
 * import type { ASRModel } from 'browser-whisper';
 * ```
 */
export type WhisperModel = ASRModel;

export type QuantizationType = 'fp32' | 'fp16' | 'q8' | 'q4' | 'hybrid';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/** A single word with start/end times relative to the file */
export interface WordTimestamp {
    text: string;
    /** Start time in seconds, relative to the beginning of the file */
    start: number;
    /** End time in seconds, relative to the beginning of the file */
    end: number;
}

/** A single transcribed segment with text and file-relative timestamps */
export interface TranscriptSegment {
    text: string;
    /** Start time in seconds, relative to the beginning of the file */
    start: number;
    /** End time in seconds, relative to the beginning of the file */
    end: number;
    /** Per-word timestamps when using a `*_timestamped` model */
    words?: WordTimestamp[];
}

/**
 * Progress event emitted during transcription.
 * Named `TranscribeProgress` to avoid collision with the browser's ProgressEvent.
 */
export interface TranscribeProgress {
    stage: 'loading' | 'decoding' | 'transcribing' | 'done';
    /** 0–1 completion fraction */
    progress: number;
}

/** Options passed to `Transcriber.transcribe()` */
export interface TranscribeOptions {
    /** Model to use for transcription (default: 'whisper-tiny') */
    model?: ASRModel;
    /** Model precision format affecting speed vs accuracy (default: 'hybrid') */
    quantization?: QuantizationType;
    /** BCP-47 language code, e.g. 'en' or 'fr' (default: auto-detect) */
    language?: string;
    /** Called for each segment as it is transcribed */
    onSegment?: (segment: TranscriptSegment) => void;
    /** Called with progress updates during decoding and transcription */
    onProgress?: (event: TranscribeProgress) => void;
}

/** Options passed to `BrowserWhisper.downloadModel()` */
export interface DownloadModelOptions {
    /** Model to download and load (default: 'whisper-tiny') */
    model?: ASRModel;
    /** Model precision format affecting speed vs accuracy (default: 'hybrid') */
    quantization?: QuantizationType;
    /** Called with progress updates during model download/load */
    onProgress?: (event: TranscribeProgress) => void;
    /** Cancels an in-flight model download/load when aborted */
    signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Internal PCM transfer type (decoder → whisper worker via MessageChannel)
// ---------------------------------------------------------------------------

/** A chunk of mono 16-kHz PCM samples transferred between workers */
export interface PCMChunk {
    /** Mono Float32 samples at 16 kHz */
    samples: Float32Array;
    /** Start time of this chunk in seconds, relative to the file beginning */
    timestamp: number;
    /**
     * Seconds of real (non-padding) audio in this chunk. The final chunk is
     * zero-padded to 30 s, so `samples.length` overstates its length.
     */
    duration?: number;
    /** True when this is the last chunk in the stream */
    final: boolean;
}

// ---------------------------------------------------------------------------
// Worker message types
// ---------------------------------------------------------------------------

// — Messages sent TO the decoder worker —
export type DecoderMessage =
    | { type: 'init'; file: File }
    | { type: 'port'; port: MessagePort };

// — Messages sent TO the ASR worker (via self.postMessage) —
export type ASRWorkerMessage =
    | { type: 'init'; runId: number; model: ASRModel; language?: string; quantization?: QuantizationType }
    | { type: 'port'; runId: number; port: MessagePort }
    /** Stop a run: drop its queued chunks, abort its signal, and suppress any further output */
    | { type: 'cancel'; runId: number };

// — Messages sent FROM workers TO the main thread —
export type MainThreadMessage = (
    | { type: 'segment'; segment: TranscriptSegment }
    | { type: 'progress'; event: TranscribeProgress }
    | { type: 'ready' }
    | { type: 'done' }
    | { type: 'error'; message: string; /** Set when the error happened while loading this model (Hub ID). */ loadModelId?: string }
) & {
    /** ASR worker messages carry the run they belong to; the main thread ignores other runs. */
    runId?: number;
};
