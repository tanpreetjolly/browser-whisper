// Public API surface for browser-whisper

// ── Main export ──────────────────────────────────────────────────────────────
export { BrowserWhisper, TranscribeStream, TranscribePCMStream } from './browser-whisper.js';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
    ASRModel,
    WhisperModel, // @deprecated — use ASRModel
    ModelConfig,
    ModelCapabilities,
    EngineId,
    TranscriptSegment,
    TranscribeOptions,
    TranscribeProgress,
    DownloadModelOptions,
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
