import { describe, expect, test } from 'bun:test';
import { MODELS } from '../types';

describe('MODELS', () => {
    test('word timestamps imply segment timestamps', () => {
        for (const [name, cfg] of Object.entries(MODELS)) {
            if (cfg.supportsWordTimestamps) expect({ name, ts: cfg.supportsTimestamps }).toEqual({ name, ts: true });
        }
    });

    test('Hugging Face IDs are unique', () => {
        const ids = Object.values(MODELS).map((m) => m.hfId);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('every transformers.js model uses an onnx-community Hugging Face ID', () => {
        for (const config of Object.values(MODELS).filter((m) => m.engine === 'transformers')) {
            expect(config.hfId).toStartWith('onnx-community/');
            expect(config.hfId.length).toBeGreaterThan('onnx-community/'.length);
        }
    });

    test('timestamped model variants support word timestamps', () => {
        for (const [name, config] of Object.entries(MODELS)) {
            if (name.endsWith('_timestamped')) expect(config.supportsWordTimestamps).toBe(true);
        }
    });

    test('English-only models reject language selection', () => {
        for (const [name, config] of Object.entries(MODELS)) {
            if (name.startsWith('moonshine-') || name.startsWith('distil-whisper')) {
                expect(config.supportsLanguage).toBe(false);
            }
        }
    });

    test('Moonshine models do not support timestamps', () => {
        for (const [name, config] of Object.entries(MODELS)) {
            if (name.startsWith('moonshine-')) expect(config.supportsTimestamps).toBe(false);
        }
    });

    test('parakeet-ctc-0.6b is English-only CTC with no timestamps and an explicit q8 dtype', () => {
        // The transformers.js 4.x CTC pipeline (_call_wav2vec2) returns { text } only and
        // ignores language / return_timestamps / chunk_length_s.
        expect(MODELS['parakeet-ctc-0.6b']).toMatchObject({
            engine: 'transformers',
            hfId: 'onnx-community/parakeet-ctc-0.6b-ONNX',
            hybridDtype: 'q8',
            supportsTimestamps: false,
            supportsWordTimestamps: false,
            supportsLanguage: false,
            capabilities: { timestamps: false, wordTimestamps: false, language: false },
            engineConfig: { hfId: 'onnx-community/parakeet-ctc-0.6b-ONNX', hybridDtype: 'q8' },
        });
    });

    test('deprecated flat fields mirror capabilities (backward compatible)', () => {
        for (const c of Object.values(MODELS)) {
            expect([c.supportsTimestamps, c.supportsWordTimestamps, c.supportsLanguage])
                .toEqual([c.capabilities.timestamps, c.capabilities.wordTimestamps, c.capabilities.language]);
        }
    });

    test('whisper-large-v3 is not offered (its 2.55 GB fp32 encoder cannot be allocated in browsers)', () => {
        expect(Object.keys(MODELS)).not.toContain('whisper-large-v3');
        expect(MODELS['whisper-large-v3-turbo']).toBeDefined();
        expect(MODELS['whisper-large-v3-turbo_timestamped']).toBeDefined();
    });
});
