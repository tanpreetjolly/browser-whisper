/** transformers.js ASR pipeline output → neutral EngineResult (pure). */
import type { EngineResult, TimedText } from '../types.js';

/** Pipeline chunk shape when `return_timestamps` is enabled */
export interface TimestampChunk {
    text: string;
    timestamp: [number | null, number | null];
}

export function chunkToTimed(c: TimestampChunk): TimedText {
    return { text: c.text, start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? 0 };
}

/** Word-timestamped models yield words; segment-timestamped models yield segments. */
export function toEngineResult(out: { text?: string; chunks?: TimestampChunk[] }, wordTimestamps: boolean): EngineResult {
    const timed = out.chunks?.map(chunkToTimed);
    return { text: out.text ?? '', ...(timed?.length ? (wordTimestamps ? { words: timed } : { segments: timed }) : {}) };
}
