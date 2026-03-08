import { describe, it, expect, mock } from 'bun:test';
import { Chunker } from '../lib/chunker.js';
import type { PCMChunk } from '../types.js';

const CHUNK_SIZE = 480_000;

function makeChunker() {
    const received: PCMChunk[] = [];
    const cb = mock((chunk: PCMChunk) => { received.push(chunk); });
    const chunker = new Chunker(cb);
    return { chunker, received, cb };
}

// ─── push ────────────────────────────────────────────────────────────────────

describe('Chunker.push', () => {
    it('does not emit a chunk when fewer than CHUNK_SIZE samples pushed', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(100));
        expect(received).toHaveLength(0);
    });

    it('emits exactly one chunk when exactly CHUNK_SIZE samples are pushed', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(CHUNK_SIZE));
        expect(received).toHaveLength(1);
        expect(received[0].samples).toHaveLength(CHUNK_SIZE);
        expect(received[0].final).toBe(false);
    });

    it('emits two chunks when 2×CHUNK_SIZE samples are pushed at once', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(CHUNK_SIZE * 2));
        expect(received).toHaveLength(2);
    });

    it('emits one chunk when multiple small pushes add up to CHUNK_SIZE', () => {
        const { chunker, received } = makeChunker();
        for (let i = 0; i < 10; i++) {
            chunker.push(new Float32Array(CHUNK_SIZE / 10));
        }
        expect(received).toHaveLength(1);
    });

    it('chunk timestamp is 0 for the first chunk', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(CHUNK_SIZE));
        expect(received[0].timestamp).toBe(0);
    });

    it('second chunk timestamp is 30s', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(CHUNK_SIZE * 2));
        // second chunk starts at 30 seconds (480_000 / 16_000)
        expect(received[1].timestamp).toBeCloseTo(30, 5);
    });

    it('preserves sample values in emitted chunks', () => {
        const { chunker, received } = makeChunker();
        const data = new Float32Array(CHUNK_SIZE).fill(0.42);
        chunker.push(data);
        expect(received[0].samples[0]).toBeCloseTo(0.42, 6);
        expect(received[0].samples[CHUNK_SIZE - 1]).toBeCloseTo(0.42, 6);
    });
});

// ─── flush ───────────────────────────────────────────────────────────────────

describe('Chunker.flush', () => {
    it('emits a final=true chunk', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(100));
        chunker.flush();
        const last = received[received.length - 1];
        expect(last.final).toBe(true);
    });

    it('pads remaining samples to CHUNK_SIZE with zeros', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(100).fill(1));
        chunker.flush();
        const last = received[received.length - 1];
        expect(last.samples).toHaveLength(CHUNK_SIZE);
        // First 100 samples should be 1; rest should be 0
        expect(last.samples[0]).toBe(1);
        expect(last.samples[100]).toBe(0);
    });

    it('emits a silent chunk when buffer is empty', () => {
        const { chunker, received } = makeChunker();
        chunker.flush();
        expect(received).toHaveLength(1);
        expect(received[0].final).toBe(true);
        expect(received[0].samples).toHaveLength(CHUNK_SIZE);
    });

    it('flush timestamp is correct after one full chunk', () => {
        const { chunker, received } = makeChunker();
        chunker.push(new Float32Array(CHUNK_SIZE)); // emits chunk at t=0
        chunker.push(new Float32Array(1_000));       // partial
        chunker.flush();
        // flush chunk should start at 30s (after the first full chunk)
        const flushChunk = received[received.length - 1];
        expect(flushChunk.timestamp).toBeCloseTo(30, 5);
    });
});
