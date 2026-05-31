import type { TranscriptSegment, WordTimestamp } from '../types.js';

const SENTENCE_END = /[.!?…]["')\]]*$/;
const MAX_WORDS_PER_SEGMENT = 14;
const MAX_GAP_S = 1.2;

/** Pipeline chunk shape when `return_timestamps` is enabled */
export interface TimestampChunk {
    text: string;
    timestamp: [number | null, number | null];
}

/** Map ASR pipeline chunks to file-relative words */
export function chunksToWords(
    chunks: TimestampChunk[],
    chunkOffsetSeconds: number,
): WordTimestamp[] {
    return chunks
        .map((c) => ({
            text: c.text.trim(),
            start: (c.timestamp[0] ?? 0) + chunkOffsetSeconds,
            end: (c.timestamp[1] ?? 0) + chunkOffsetSeconds,
        }))
        .filter((w) => w.text.length > 0 && w.end >= w.start);
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
