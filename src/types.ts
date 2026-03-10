// ---------------------------------------------------------------------------
// Model type
// ---------------------------------------------------------------------------

export type WhisperModel =
    | 'whisper-tiny'
    | 'whisper-base'
    | 'whisper-small'
    | 'whisper-large';

/** Map a friendly model name to its Hugging Face Hub model ID */
export const MODEL_IDS: Record<WhisperModel, string> = {
    'whisper-tiny': 'onnx-community/whisper-tiny',
    'whisper-base': 'onnx-community/whisper-base',
    'whisper-small': 'onnx-community/whisper-small',
    'whisper-large': 'onnx-community/whisper-large-v3-turbo',
};

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
    /** Whisper model to use (default: 'whisper-base') */
    model?: WhisperModel;
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

// — Messages sent TO the whisper worker (via self.postMessage) —
export type WhisperMessage =
    | { type: 'init'; modelId: string; language?: string; quantization?: QuantizationType }
    | { type: 'port'; port: MessagePort };

// — Messages sent FROM workers TO the main thread —
export type MainThreadMessage =
    | { type: 'segment'; segment: TranscriptSegment }
    | { type: 'progress'; event: TranscribeProgress }
    | { type: 'ready' }
    | { type: 'done' }
    | { type: 'error'; message: string };
