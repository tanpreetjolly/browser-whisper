import { describe, expect, test } from 'bun:test';
import { MODELS } from '../types';
import { PARAKEET_JS_URL, hubUrl, parakeetFiles, wordsToChunks } from '../workers/engines/parakeet/config';
import { buildSegments } from '../lib/word-segments';

describe('parakeet engine config', () => {
    const cfg = MODELS['parakeet-tdt-0.6b-v3'];

    test('model entry', () => {
        expect(cfg).toMatchObject({ engine: 'parakeet', hfId: 'ysdede/parakeet-tdt-0.6b-v3-onnx', hybridDtype: 'fp16', supportsWordTimestamps: true, supportsLanguage: false });
    });

    test('hybrid uses the single-file fp16 encoder (avoids 2.4 GB fp32 external data)', () => {
        expect(parakeetFiles('hybrid', String(cfg.hybridDtype))).toEqual({
            encoder: 'encoder-model.fp16.onnx', decoder: 'decoder_joint-model.int8.onnx', vocab: 'vocab.txt',
        });
    });

    test('fp32 adds external data; q8 uses the int8 encoder; q4 is rejected', () => {
        expect(parakeetFiles('fp32', 'fp16').encoderData).toBe('encoder-model.onnx.data');
        expect(parakeetFiles('q8', 'fp16').encoder).toBe('encoder-model.int8.onnx');
        expect(() => parakeetFiles('q4', 'fp16')).toThrow('not available');
    });

    test('runtime URL is version-pinned', () => {
        expect(PARAKEET_JS_URL).toMatch(/parakeet\.js@\d+\.\d+\.\d+\//);
        expect(hubUrl('a/b', 'vocab.txt')).toBe('https://huggingface.co/a/b/resolve/main/vocab.txt');
    });

    test('word timings become file-relative, clamped word segments', () => {
        const chunks = wordsToChunks([
            { text: 'Hello', start_time: 0.1, end_time: 0.4 },
            { text: 'world.', start_time: 0.5, end_time: 31 },
        ]);
        const segs = buildSegments({ text: 'Hello world.', chunks }, { timestamp: 30, samples: new Float32Array(480000), duration: 2 }, cfg);
        expect(segs).toEqual([{ text: 'Hello world.', start: 30.1, end: 32, words: [
            { text: 'Hello', start: 30.1, end: 30.4 }, { text: 'world.', start: 30.5, end: 32 },
        ] }]);
    });
});
