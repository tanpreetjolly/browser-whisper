// ---------------------------------------------------------------------------
// Model type
// ---------------------------------------------------------------------------

export type ASRModel =
    | 'whisper-tiny'
    | 'whisper-base'
    | 'whisper-small'
    | 'whisper-tiny_timestamped'
    | 'whisper-base_timestamped'
    | 'whisper-small_timestamped'
    | 'whisper-large-v3-turbo'
    | 'whisper-large-v3-turbo_timestamped'
    | 'lite-whisper-large-v3-turbo-fast'
    | 'lite-whisper-large-v3-turbo'
    | 'lite-whisper-large-v3-turbo-acc'
    | 'moonshine-tiny'
    | 'moonshine-base'
    | 'parakeet-ctc-0.6b'
    | 'distil-whisper-small'
    | 'parakeet-tdt-0.6b-v3';

/** ASR runtime that runs a model (see src/workers/engines). */
export type EngineId = 'transformers' | 'parakeet';

export interface ModelConfig {
    /** ASR engine (runtime) that loads and runs this model */
    engine: EngineId;
    /** Hugging Face Hub model ID */
    hfId: string;
    /** dtype used when quantization is 'hybrid' (transformers.js dtype, or the parakeet encoder dtype) */
    hybridDtype: Record<string, string> | string;
    /** Whether the model supports return_timestamps / chunk_length_s / stride_length_s */
    supportsTimestamps: boolean;
    /** Whether the model supports `return_timestamps: 'word'` (DTW word alignment) */
    supportsWordTimestamps: boolean;
    /** Whether the model supports the language parameter */
    supportsLanguage: boolean;
}

const WHISPER_HYBRID = { encoder_model: 'fp32', decoder_model_merged: 'q4' };

const SEGMENT_TS = { supportsTimestamps: true, supportsWordTimestamps: false };
const WORD_TS = { supportsTimestamps: true, supportsWordTimestamps: true };
const NO_TS = { supportsTimestamps: false, supportsWordTimestamps: false };

export const MODELS: Record<ASRModel, ModelConfig> = {
    'whisper-tiny':                         { engine: 'transformers', hfId: 'onnx-community/whisper-tiny',                              hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: true  },
    'whisper-base':                         { engine: 'transformers', hfId: 'onnx-community/whisper-base',                              hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: true  },
    'whisper-small':                        { engine: 'transformers', hfId: 'onnx-community/whisper-small',                             hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: true  },
    'whisper-tiny_timestamped':             { engine: 'transformers', hfId: 'onnx-community/whisper-tiny_timestamped',                  hybridDtype: WHISPER_HYBRID, ...WORD_TS,   supportsLanguage: true  },
    'whisper-base_timestamped':             { engine: 'transformers', hfId: 'onnx-community/whisper-base_timestamped',                  hybridDtype: WHISPER_HYBRID, ...WORD_TS,   supportsLanguage: true  },
    'whisper-small_timestamped':            { engine: 'transformers', hfId: 'onnx-community/whisper-small_timestamped',                 hybridDtype: WHISPER_HYBRID, ...WORD_TS,   supportsLanguage: true  },
    'whisper-large-v3-turbo':               { engine: 'transformers', hfId: 'onnx-community/whisper-large-v3-turbo',                    hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: true  },
    'whisper-large-v3-turbo_timestamped':   { engine: 'transformers', hfId: 'onnx-community/whisper-large-v3-turbo_timestamped',        hybridDtype: WHISPER_HYBRID, ...WORD_TS,   supportsLanguage: true  },
    'lite-whisper-large-v3-turbo-fast':     { engine: 'transformers', hfId: 'onnx-community/lite-whisper-large-v3-turbo-fast-ONNX',     hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: true  },
    'lite-whisper-large-v3-turbo':          { engine: 'transformers', hfId: 'onnx-community/lite-whisper-large-v3-turbo-ONNX',          hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: true  },
    'lite-whisper-large-v3-turbo-acc':      { engine: 'transformers', hfId: 'onnx-community/lite-whisper-large-v3-turbo-acc-ONNX',      hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: true  },
    'moonshine-tiny':                       { engine: 'transformers', hfId: 'onnx-community/moonshine-tiny-ONNX',                       hybridDtype: 'q4',           ...NO_TS,     supportsLanguage: false },
    'moonshine-base':                       { engine: 'transformers', hfId: 'onnx-community/moonshine-base-ONNX',                       hybridDtype: 'q4',           ...NO_TS,     supportsLanguage: false },
    // NVIDIA Parakeet CTC 0.6B (FastConformer + CTC head), English only, lowercase output without
    // punctuation. Needs transformers.js >= 4 (`parakeet_ctc`). The CTC pipeline returns text only
    // (no timestamps, ignores chunk_length_s/language), so it relies on our 30 s chunker.
    // Default q8 (model_quantized.onnx + .onnx_data, ~612 MB): q4 and fp16 returned empty text
    // for most inputs under onnxruntime-node CPU; fp32 is 2.4 GB of external data.
    'parakeet-ctc-0.6b':                    { engine: 'transformers', hfId: 'onnx-community/parakeet-ctc-0.6b-ONNX',                    hybridDtype: 'q8',           ...NO_TS,     supportsLanguage: false },
    'distil-whisper-small':                 { engine: 'transformers', hfId: 'onnx-community/distil-small.en',                           hybridDtype: WHISPER_HYBRID, ...SEGMENT_TS, supportsLanguage: false },
    // WebGPU only. 'hybrid' uses the fp16 encoder: fp32 needs 2.4 GB of external data, which
    // fails with "Array buffer allocation failed" in browsers.
    'parakeet-tdt-0.6b-v3':                 { engine: 'parakeet',     hfId: 'ysdede/parakeet-tdt-0.6b-v3-onnx',                         hybridDtype: 'fp16',         ...WORD_TS,   supportsLanguage: false },
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
    | { type: 'init'; model: ASRModel; language?: string; quantization?: QuantizationType }
    | { type: 'port'; port: MessagePort };

// — Messages sent FROM workers TO the main thread —
export type MainThreadMessage =
    | { type: 'segment'; segment: TranscriptSegment }
    | { type: 'progress'; event: TranscribeProgress }
    | { type: 'ready' }
    | { type: 'done' }
    | { type: 'error'; message: string; /** Set when the error happened while loading this model (Hub ID). */ loadModelId?: string };
