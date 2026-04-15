// ---------------------------------------------------------------------------
// Model type
// ---------------------------------------------------------------------------

export type ASRModel =
    | 'whisper-tiny'
    | 'whisper-base'
    | 'whisper-small'
    | 'moonshine-tiny'
    | 'moonshine-base'
    | 'distil-whisper-small';

export interface ModelConfig {
    /** Hugging Face Hub model ID */
    hfId: string;
    /** dtype passed to transformers.js when quantization is 'hybrid' */
    hybridDtype: Record<string, string> | string;
    /** Whether the model supports return_timestamps / chunk_length_s / stride_length_s */
    supportsTimestamps: boolean;
    /** Whether the model supports the language parameter */
    supportsLanguage: boolean;
}

const WHISPER_HYBRID = { encoder_model: 'fp32', decoder_model_merged: 'q4' };

export const MODELS: Record<ASRModel, ModelConfig> = {
    'whisper-tiny':         { hfId: 'onnx-community/whisper-tiny',              hybridDtype: WHISPER_HYBRID, supportsTimestamps: true,  supportsLanguage: true  },
    'whisper-base':         { hfId: 'onnx-community/whisper-base',              hybridDtype: WHISPER_HYBRID, supportsTimestamps: true,  supportsLanguage: true  },
    'whisper-small':        { hfId: 'onnx-community/whisper-small',             hybridDtype: WHISPER_HYBRID, supportsTimestamps: true,  supportsLanguage: true  },
    'moonshine-tiny':       { hfId: 'onnx-community/moonshine-tiny-ONNX',      hybridDtype: 'q4',           supportsTimestamps: false, supportsLanguage: false },
    'moonshine-base':       { hfId: 'onnx-community/moonshine-base-ONNX',      hybridDtype: 'q4',           supportsTimestamps: false, supportsLanguage: false },
    'distil-whisper-small': { hfId: 'onnx-community/distil-small.en',          hybridDtype: WHISPER_HYBRID, supportsTimestamps: true,  supportsLanguage: false },
};

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

/**
 * A single word with its precise timestamp.
 * @experimental Not currently produced — reserved for future word-level timestamp support.
 */
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
    /**
     * Per-word timestamps (available when using word-level timestamps).
     * @experimental Not currently populated — reserved for future support.
     */
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

// ---------------------------------------------------------------------------
// Internal PCM transfer type (decoder → whisper worker via MessageChannel)
// ---------------------------------------------------------------------------

/** A chunk of mono 16-kHz PCM samples transferred between workers */
export interface PCMChunk {
    /** Mono Float32 samples at 16 kHz */
    samples: Float32Array;
    /** Start time of this chunk in seconds, relative to the file beginning */
    timestamp: number;
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
    | { type: 'init'; model: ASRModel; language?: string; quantization?: QuantizationType }
    | { type: 'port'; port: MessagePort };

// — Messages sent FROM workers TO the main thread —
export type MainThreadMessage =
    | { type: 'segment'; segment: TranscriptSegment }
    | { type: 'progress'; event: TranscribeProgress }
    | { type: 'ready' }
    | { type: 'done' }
    | { type: 'error'; message: string };
