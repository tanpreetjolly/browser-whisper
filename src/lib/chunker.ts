import type { PCMChunk } from '../types.js';

/** 30 seconds of 16-kHz mono audio */
const CHUNK_SIZE = 480_000;

/** Callback invoked each time a full (or final) chunk is ready */
export type ChunkCallback = (chunk: PCMChunk) => void;

/**
 * Accumulates decoded mono 16-kHz PCM samples and emits them in 30-second
 * windows (CHUNK_SIZE = 480 000 samples) suitable for Whisper inference.
 *
 * Usage:
 *   const chunker = new Chunker(onChunk)
 *   chunker.push(samples)   // call as decoded audio arrives
 *   chunker.flush()         // call once decoding is complete
 */
export class Chunker {
    /** Buffer of pending samples across multiple push() calls */
    private readonly buffer: Float32Array[] = [];
    /** Total samples accumulated in buffer */
    private bufferedSamples = 0;
    /** Total samples emitted so far — used to compute chunk timestamps */
    private consumedSamples = 0;

    constructor(private readonly onChunk: ChunkCallback) { }

    /**
     * Add decoded samples to the internal buffer.
     * Emits complete 30-second chunks as soon as they are available.
     */
    push(samples: Float32Array): void {
        this.buffer.push(samples);
        this.bufferedSamples += samples.length;

        while (this.bufferedSamples >= CHUNK_SIZE) {
            const chunk = this.extractChunk();
            const timestamp = this.consumedSamples / 16_000;
            this.consumedSamples += chunk.length;
            this.bufferedSamples -= chunk.length;
            this.onChunk({ samples: chunk, timestamp, final: false });
        }
    }

    /**
     * Flush remaining buffered samples as a final chunk.
     * Zero-pads to CHUNK_SIZE so Whisper always receives a full 30-second window.
     * Must be called exactly once, after all push() calls are done.
     */
    flush(): void {
        const remaining = this.extractAll();
        const timestamp = this.consumedSamples / 16_000;

        if (remaining.length === 0) {
            // Nothing buffered — emit a silent final chunk so the whisper worker
            // knows we are done.
            const silence = new Float32Array(CHUNK_SIZE);
            this.onChunk({ samples: silence, timestamp, final: true });
            return;
        }

        // Zero-pad to a full CHUNK_SIZE window
        const padded = new Float32Array(CHUNK_SIZE);
        padded.set(remaining);
        this.onChunk({ samples: padded, timestamp, final: true });
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /** Pull exactly CHUNK_SIZE samples from the head of the buffer */
    private extractChunk(): Float32Array {
        return this.extractN(CHUNK_SIZE);
    }

    /** Pull all remaining samples from the buffer */
    private extractAll(): Float32Array {
        return this.extractN(this.bufferedSamples);
    }

    /** Pull exactly `n` samples, concatenating across buffer slices */
    private extractN(n: number): Float32Array {
        const out = new Float32Array(n);
        let written = 0;

        while (written < n && this.buffer.length > 0) {
            const head = this.buffer[0];
            const need = n - written;

            if (head.length <= need) {
                // Consume entire slice
                out.set(head, written);
                written += head.length;
                this.buffer.shift();
            } else {
                // Consume partial slice, leave remainder in buffer
                out.set(head.subarray(0, need), written);
                this.buffer[0] = head.subarray(need);
                written += need;
            }
        }

        return out;
    }
}
