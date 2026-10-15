import { describe, expect, it } from 'bun:test';
import { buildSegments, clampSegments, clampSpan, groupWordsIntoSegments } from '../lib/word-segments.js';
import { toEngineResult } from '../workers/engines/transformers/output.js';

const at = (timestamp: number, duration = Infinity) => ({ timestamp, duration, samples: new Float32Array(0) });

describe('buildSegments (neutral engine result)', () => {
    it('offsets word timestamps by chunk start', () => {
        const [seg] = buildSegments({ text: 'hello', words: [{ text: ' hello', start: 1, end: 2 }] }, at(30));
        expect(seg.words![0]).toEqual({ text: 'hello', start: 31, end: 32 });
    });
    it('offsets segment timestamps and drops empty ones', () => {
        expect(buildSegments({ text: '', segments: [{ text: ' a ', start: 0, end: 1 }, { text: ' ', start: 1, end: 2 }] }, at(5)))
            .toEqual([{ text: 'a', start: 5, end: 6 }]);
    });
});

describe('transformers output adapter', () => {
    it('maps pipeline chunks to words or segments by capability', () => {
        const out = { text: 'hi', chunks: [{ text: 'hi', timestamp: [0, null] as [number, null] }] };
        expect(toEngineResult(out, true)).toEqual({ text: 'hi', words: [{ text: 'hi', start: 0, end: 0 }] });
        expect(toEngineResult(out, false)).toEqual({ text: 'hi', segments: [{ text: 'hi', start: 0, end: 0 }] });
        expect(toEngineResult({ text: 'x' }, true)).toEqual({ text: 'x' });
    });
});

describe('groupWordsIntoSegments', () => {
    it('splits on sentence-ending punctuation', () => {
        const segments = groupWordsIntoSegments([
            { text: 'Hello', start: 0, end: 0.5 },
            { text: 'world.', start: 0.5, end: 1.2 },
            { text: 'Again', start: 1.5, end: 2 },
        ]);
        expect(segments).toHaveLength(2);
        expect(segments[0].words).toHaveLength(2);
        expect(segments[0].text).toBe('Hello world.');
    });

    it('splits on long pauses between words', () => {
        const segments = groupWordsIntoSegments([
            { text: 'A', start: 0, end: 0.2 },
            { text: 'B', start: 2, end: 2.2 },
        ]);
        expect(segments).toHaveLength(2);
    });
});

describe('timing clamps', () => {
    it('clamps word end past audio end (whisper word overrun)', () => {
        const [seg] = buildSegments({ text: '', words: [{ text: ' country', start: 10.56, end: 15.9 }] }, at(0, 11));
        expect(seg.words![0]).toEqual({ text: 'country', start: 10.56, end: 11 });
    });
    it('keeps start <= end when start is also past audio end', () => {
        expect(clampSpan({ start: 12, end: 14 }, 11)).toEqual({ start: 11, end: 11 });
    });
    it('clamps a 30 s window segment to an 11 s file (parakeet ctc)', () => {
        const [seg] = clampSegments([{ text: 'x', start: 0, end: 30 }], 11);
        expect(seg).toEqual({ text: 'x', start: 0, end: 11 });
    });
    it('clamps segment words and leaves in-range spans untouched', () => {
        const [seg] = clampSegments([{ text: 'a b', start: 1, end: 12, words: [
            { text: 'a', start: 1, end: 2 }, { text: 'b', start: 10, end: 12 },
        ] }], 11);
        expect(seg.end).toBe(11);
        expect(seg.words).toEqual([{ text: 'a', start: 1, end: 2 }, { text: 'b', start: 10, end: 11 }]);
    });
    it('is a no-op with Infinity', () => {
        expect(buildSegments({ text: '', words: [{ text: 'a', start: 1, end: 99 }] }, at(0))[0].end).toBe(99);
    });
});
