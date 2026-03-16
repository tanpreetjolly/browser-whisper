// Public API surface for browser-whisper

// ── Main export ──────────────────────────────────────────────────────────────
export { BrowserWhisper, TranscribeStream } from './browser-whisper.js';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
    ASRModel,
    WhisperModel, // @deprecated — use ASRModel
    ModelConfig,
    TranscriptSegment,
    TranscribeOptions,
    TranscribeProgress,
} from './types.js';
export { MODELS } from './types.js';

// ── Error classes ────────────────────────────────────────────────────────────
export {
    BrowserWhisperError,
    WebCodecsNotSupportedError,
    CodecNotSupportedError,
    ModelLoadError,
    DecoderError,
    NoAudioTrackError,
} from './errors.js';
