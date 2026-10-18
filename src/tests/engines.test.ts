import { describe, expect, test } from 'bun:test';
import { MODELS } from '../types';
import { MODEL_DEFINITIONS } from '../models';
import { ENGINES, planDevices } from '../workers/engines/catalog';
import { RUNTIMES } from '../workers/engines/runtimes';

describe('engine catalog', () => {
    test('every model names a cataloged engine with a runtime', () => {
        for (const [name, def] of Object.entries(MODEL_DEFINITIONS)) {
            expect({ name, ok: def.engine in ENGINES && def.engine in RUNTIMES }).toEqual({ name, ok: true });
        }
        expect(Object.keys(RUNTIMES).sort()).toEqual(Object.keys(ENGINES).sort());
    });

    test('public MODELS derives hfId from the engine (unchanged cache ids)', () => {
        expect(MODELS['parakeet-ctc-0.6b'].hfId).toBe('onnx-community/parakeet-ctc-0.6b-ONNX');
        expect(MODELS['parakeet-tdt-0.6b-v3'].hfId).toBe('ysdede/parakeet-tdt-0.6b-v3-onnx');
        expect(MODELS['parakeet-tdt-0.6b-v3'].hybridDtype).toBe('fp16');
        expect(MODELS['whisper-tiny'].engine).toBe('transformers');
    });

    test('runtimes are thunks (catalog/runtimes import does not load a runtime)', () => {
        for (const f of Object.values(RUNTIMES)) expect(typeof f).toBe('function');
    });

    test('device + quantization declarations', () => {
        expect(ENGINES.transformers.devices).toEqual(['webgpu', 'wasm']);
        expect(ENGINES.parakeet.devices).toEqual(['webgpu']);
        expect(ENGINES.transformers.quantizations).toContain('q4');
    });
});

describe('planDevices (WebGPU-first)', () => {
    test('WebGPU then WASM fallback when an adapter exists', () => {
        expect(planDevices(['webgpu', 'wasm'], true)).toEqual(['webgpu', 'wasm']);
    });
    test('WASM only without an adapter', () => {
        expect(planDevices(['webgpu', 'wasm'], false)).toEqual(['wasm']);
    });
    test('respects engine device support', () => {
        expect(planDevices(['wasm'], true)).toEqual(['wasm']);
        expect(planDevices(['webgpu'], true)).toEqual(['webgpu']);
        expect(planDevices(['webgpu'], false)).toEqual([]);
    });
    test('declared order does not override WebGPU-first', () => {
        expect(planDevices(['wasm', 'webgpu'], true)).toEqual(['webgpu', 'wasm']);
    });
});
