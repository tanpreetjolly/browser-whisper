import { describe, it, expect } from 'bun:test';
import { downmixToMono, resampleTo16kHz } from '../lib/resampler.js';

// ─── downmixToMono ───────────────────────────────────────────────────────────

describe('downmixToMono', () => {
    it('returns the input unchanged for a single channel', () => {
        const ch = new Float32Array([1, 2, 3]);
        expect(downmixToMono([ch])).toBe(ch); // same reference
    });

    it('returns empty array for no channels', () => {
        expect(downmixToMono([])).toHaveLength(0);
    });

    it('averages two equal channels to produce the same values', () => {
        const a = new Float32Array([1, 2, 3]);
        const b = new Float32Array([1, 2, 3]);
        const mono = downmixToMono([a, b]);
        expect([...mono]).toEqual([1, 2, 3]);
    });

    it('averages two different channels correctly', () => {
        const left = new Float32Array([0.0, 1.0]);
        const right = new Float32Array([1.0, 0.0]);
        const mono = downmixToMono([left, right]);
        expect(mono[0]).toBeCloseTo(0.5, 6);
        expect(mono[1]).toBeCloseTo(0.5, 6);
    });

    it('averages four channels', () => {
        const channels = [
            new Float32Array([4]),
            new Float32Array([8]),
            new Float32Array([0]),
            new Float32Array([0]),
        ];
        expect(downmixToMono(channels)[0]).toBeCloseTo(3, 6);
    });

    it('output length equals input channel length', () => {
        const ch1 = new Float32Array(100).fill(0.5);
        const ch2 = new Float32Array(100).fill(0.5);
        expect(downmixToMono([ch1, ch2])).toHaveLength(100);
    });
});

// ─── resampleTo16kHz ─────────────────────────────────────────────────────────

describe('resampleTo16kHz', () => {
    it('returns the same reference when already at 16 kHz', () => {
        const buf = new Float32Array(100);
        expect(resampleTo16kHz(buf, 16_000)).toBe(buf);
    });

    it('produces the correct output length when downsampling from 48 kHz', () => {
        const input = new Float32Array(48_000); // 1 second at 48 kHz
        const output = resampleTo16kHz(input, 48_000);
        // 1 second at 16 kHz = 16 000 samples
        expect(output.length).toBe(16_000);
    });

    it('produces the correct output length when upsampling from 8 kHz', () => {
        const input = new Float32Array(8_000); // 1 second at 8 kHz
        const output = resampleTo16kHz(input, 8_000);
        expect(output.length).toBe(16_000);
    });

    it('preserves a DC signal through resampling', () => {
        const input = new Float32Array(44_100).fill(0.7);
        const output = resampleTo16kHz(input, 44_100);
        // All samples should be ~0.7 (DC is invariant to resampling)
        for (const s of output) {
            expect(s).toBeCloseTo(0.7, 4);
        }
    });

    it('first sample of output matches first sample of input', () => {
        const input = new Float32Array([1, 0.5, 0, -0.5, -1]);
        // Downsample 32 kHz → 16 kHz (ratio = 2)
        const output = resampleTo16kHz(input, 32_000);
        expect(output[0]).toBeCloseTo(1, 5);
    });
});
