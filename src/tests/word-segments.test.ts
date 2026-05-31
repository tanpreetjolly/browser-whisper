import { describe, expect, it } from 'bun:test';
import { chunksToWords, groupWordsIntoSegments } from '../lib/word-segments.js';

describe('chunksToWords', () => {
    it('offsets timestamps by chunk start', () => {
        const words = chunksToWords(
            [{ text: ' hello', timestamp: [1, 2] }],
            30,
        );
        expect(words[0]).toEqual({ text: 'hello', start: 31, end: 32 });
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
