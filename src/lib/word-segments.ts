import type { PCMChunk, TranscriptSegment, WordTimestamp } from '../types.js';
import type { EngineResult, TimedText } from '../workers/engines/types.js';

const SENTENCE_END = /[.!?…]["')\]]*$/;
const MAX_WORDS_PER_SEGMENT = 14;
const MAX_GAP_S = 1.2;

/**
 * Clamp a timed span so it never runs past `maxEnd` (the real audio end),
 * keeping `start <= end`. Models can report times inside the zero-padded
 * tail of the final 30 s window, past the end of the actual audio.
 */
export function clampSpan<T extends { start: number; end: number }>(span: T, maxEnd: number): T {
    if (!Number.isFinite(maxEnd)) return span;
    const start = Math.min(span.start, maxEnd);
    const end = Math.max(start, Math.min(span.end, maxEnd));
    return start === span.start && end === span.end ? span : { ...span, start, end };
}

/** Clamp segments (and their words) to the real audio end. */
export function clampSegments(segments: TranscriptSegment[], maxEnd: number): TranscriptSegment[] {
    return segments.map((seg) => {
        const clamped = clampSpan(seg, maxEnd);
        return seg.words
            ? { ...clamped, words: seg.words.map((w) => clampSpan(w, maxEnd)) }
            : clamped;
    });
}

/** Group word-level timestamps into readable segments for display and streaming */
export function groupWordsIntoSegments(words: WordTimestamp[]): TranscriptSegment[] {
    if (words.length === 0) return [];

    const segments: TranscriptSegment[] = [];
    let batch: WordTimestamp[] = [];

    const flush = (): void => {
        if (batch.length === 0) return;
        const text = batch.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!text) {
            batch = [];
            return;
        }
        segments.push({
            text,
            start: batch[0].start,
            end: batch[batch.length - 1].end,
            words: [...batch],
        });
        batch = [];
    };

    for (const word of words) {
        if (!word.text.trim()) continue;

        if (batch.length > 0) {
            const gap = word.start - batch[batch.length - 1].end;
            if (gap > MAX_GAP_S) flush();
        }

        batch.push({ ...word, text: word.text.trim() });

        if (batch.length >= MAX_WORDS_PER_SEGMENT || SENTENCE_END.test(word.text)) {
            flush();
        }
    }

    flush();
    return segments;
}

/**
 * Turn one engine result (chunk-relative times) into file-relative segments for a PCM chunk.
 * Every branch (words, segments, text-only models such as Parakeet CTC) is clamped to the
 * chunk's real audio end, because the final chunk is zero-padded to a 30 s window.
 */
export function buildSegments(
    result: EngineResult,
    chunk: Pick<PCMChunk, 'timestamp' | 'samples' | 'duration'>,
): TranscriptSegment[] {
    const offset = chunk.timestamp;
    const chunkEnd = offset + (chunk.duration ?? chunk.samples.length / 16_000);
    const shift = (t: TimedText) => ({ text: t.text.trim(), start: t.start + offset, end: t.end + offset });
    let segments: TranscriptSegment[];
    if (result.words?.length) {
        const words = result.words.map(shift).filter((w) => w.text.length > 0 && w.end >= w.start);
        segments = groupWordsIntoSegments(words.map((w) => clampSpan(w, chunkEnd)));
    } else if (result.segments?.length) {
        segments = result.segments.map(shift).filter((s) => s.text.length > 0);
    } else if (result.text.trim()) {
        segments = [{ text: result.text.trim(), start: offset, end: chunkEnd }];
    } else {
        segments = [];
    }
    return clampSegments(segments, chunkEnd);
}
