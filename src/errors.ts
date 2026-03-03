/** Base error class for all browserwhisper errors */
export class BrowserWhisperError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BrowserWhisperError';
    }
}

/** Thrown when the browser does not support WebCodecs */
export class WebCodecsNotSupportedError extends BrowserWhisperError {
    constructor() {
        super(
            'WebCodecs AudioDecoder is not supported in this browser. ' +
            'Chrome 94+, Firefox 130+, or Safari 16.4+ is required.',
        );
        this.name = 'WebCodecsNotSupportedError';
    }
}

/** Thrown when the input file's audio codec cannot be decoded */
export class CodecNotSupportedError extends BrowserWhisperError {
    constructor(codec: string) {
        super(`Audio codec "${codec}" is not supported by this browser.`);
        this.name = 'CodecNotSupportedError';
    }
}

/** Thrown when the transformers.js model fails to load */
export class ModelLoadError extends BrowserWhisperError {
    constructor(modelId: string, cause?: unknown) {
        super(
            `Failed to load Whisper model "${modelId}". ` +
            (cause instanceof Error ? cause.message : String(cause ?? '')),
        );
        this.name = 'ModelLoadError';
        if (cause instanceof Error) this.cause = cause;
    }
}

/** Thrown when WebCodecs fails during decoding */
export class DecoderError extends BrowserWhisperError {
    constructor(message: string, cause?: unknown) {
        super(`Decoder error: ${message}`);
        this.name = 'DecoderError';
        if (cause instanceof Error) this.cause = cause;
    }
}

/** Thrown when the input file has no audio track */
export class NoAudioTrackError extends BrowserWhisperError {
    constructor() {
        super('The provided file contains no audio track.');
        this.name = 'NoAudioTrackError';
    }
}
