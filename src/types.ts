// ---------------------------------------------------------------------------
// Model type
// ---------------------------------------------------------------------------

export type WhisperModel =
    | 'whisper-tiny'
    | 'whisper-base'
    | 'whisper-small'
    | 'whisper-large';

/** Map a friendly model name to the Hugging Face model ID */
export const MODEL_IDS: Record<WhisperModel, string> = {
    'whisper-tiny': 'onnx-community/whisper-tiny',
    'whisper-base': 'onnx-community/whisper-base',
    'whisper-small': 'onnx-community/whisper-small',
    'whisper-large': 'onnx-community/whisper-large-v3-turbo',
};

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/** A single transcribed segment with text and file-relative timestamps */
export interface TranscriptSegment {
    text: string;
    /** Start time in seconds, relative to the beginning of the file */
    start: number;
    /** End time in seconds, relative to the beginning of the file */
    end: number;
}

/** Options passed to `Transcriber.transcribe()` */
export interface TranscribeOptions {
    /** Whisper model to use (default: 'whisper-base') */
    model?: WhisperModel;
    /** BCP-47 language code, e.g. 'en' or 'fr' (default: auto-detect) */
    language?: string;
    /** Called for each segment as it is transcribed */
    onSegment?: (segment: TranscriptSegment) => void;
    /** Called with progress updates */
    onProgress?: (event: ProgressEvent) => void;
}

/** A progress event from any pipeline stage */
export interface ProgressEvent {
    stage: 'loading' | 'decoding' | 'transcribing' | 'done';
    /** 0–1 fraction */
    progress: number;
}

// ---------------------------------------------------------------------------
// Internal PCM transfer type
// ---------------------------------------------------------------------------

/** A chunk of mono 16-kHz PCM samples passed from decoder to whisper worker */
export interface PCMChunk {
    /** Mono Float32 samples at 16 kHz */
    samples: Float32Array;
    /** Start time of this chunk in seconds, relative to the file beginning */
    timestamp: number;
    /** True when this is the last chunk */
    final: boolean;
}

// ---------------------------------------------------------------------------
// Worker message types
// ---------------------------------------------------------------------------

// — Messages sent TO the decoder worker —
export type DecoderMessage =
    | { type: 'init'; file: File }
    | { type: 'port'; port: MessagePort };

// — Messages sent TO the whisper worker —
export type WhisperMessage =
    | { type: 'init'; modelId: string; language?: string }
    | { type: 'port'; port: MessagePort };

// — Messages sent FROM workers back TO the main thread —
export type MainThreadMessage =
    | { type: 'segment'; segment: TranscriptSegment }
    | { type: 'progress'; event: ProgressEvent }
    | { type: 'ready' }
    | { type: 'done' }
    | { type: 'error'; message: string };
