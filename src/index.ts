// Public API surface for browser-whisper

// ── Main export ──────────────────────────────────────────────────────────────
export { BrowserWhisper, TranscribeStream } from './browser-whisper.js';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
    WhisperModel,
    TranscriptSegment,
    TranscribeOptions,
    TranscribeProgress,
    PCMChunk,
} from './types.js';

// ── Error classes ────────────────────────────────────────────────────────────
export {
    BrowserWhisperError,
    WebCodecsNotSupportedError,
    CodecNotSupportedError,
    ModelLoadError,
    DecoderError,
    NoAudioTrackError,
} from './errors.js';
