import { describe, it, expect } from 'bun:test';
import {
    BrowserWhisperError,
    WebCodecsNotSupportedError,
    CodecNotSupportedError,
    ModelLoadError,
    DecoderError,
    NoAudioTrackError,
} from '../errors.js';

describe('BrowserWhisperError', () => {
    it('is an instance of Error', () => {
        const err = new BrowserWhisperError('test');
        expect(err).toBeInstanceOf(Error);
    });

    it('sets message correctly', () => {
        const err = new BrowserWhisperError('hello');
        expect(err.message).toBe('hello');
    });

    it('has correct name', () => {
        const err = new BrowserWhisperError('x');
        expect(err.name).toBe('BrowserWhisperError');
    });
});

describe('WebCodecsNotSupportedError', () => {
    it('extends BrowserWhisperError', () => {
        const err = new WebCodecsNotSupportedError();
        expect(err).toBeInstanceOf(BrowserWhisperError);
    });

    it('has correct name', () => {
        expect(new WebCodecsNotSupportedError().name).toBe('WebCodecsNotSupportedError');
    });

    it('message mentions WebCodecs', () => {
        expect(new WebCodecsNotSupportedError().message).toContain('WebCodecs');
    });
});

describe('CodecNotSupportedError', () => {
    it('includes codec name in message', () => {
        const err = new CodecNotSupportedError('mp4a.40.2');
        expect(err.message).toContain('mp4a.40.2');
    });

    it('has correct name', () => {
        expect(new CodecNotSupportedError('x').name).toBe('CodecNotSupportedError');
    });
});

describe('ModelLoadError', () => {
    it('includes model ID in message', () => {
        const err = new ModelLoadError('onnx-community/whisper-base');
        expect(err.message).toContain('onnx-community/whisper-base');
    });

    it('includes cause message when cause is an Error', () => {
        const cause = new Error('network timeout');
        const err = new ModelLoadError('model-id', cause);
        expect(err.message).toContain('network timeout');
    });

    it('sets .cause when cause is an Error', () => {
        const cause = new Error('oops');
        const err = new ModelLoadError('m', cause);
        expect(err.cause).toBe(cause);
    });
});

describe('DecoderError', () => {
    it('prefixes message with "Decoder error"', () => {
        const err = new DecoderError('decode failed');
        expect(err.message).toContain('Decoder error');
        expect(err.message).toContain('decode failed');
    });
});

describe('NoAudioTrackError', () => {
    it('has correct name', () => {
        expect(new NoAudioTrackError().name).toBe('NoAudioTrackError');
    });

    it('message mentions audio track', () => {
        expect(new NoAudioTrackError().message.toLowerCase()).toContain('audio track');
    });
});
