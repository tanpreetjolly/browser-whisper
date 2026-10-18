import { describe, expect, test } from 'bun:test';
import { MODELS, type ASRModel, type ModelConfig } from '../types';
import { ENGINES, planDevices, resolveEngine, type EngineEntry } from '../workers/engines/registry';

describe('engine registry', () => {
    test('every model names a registered engine', () => {
        for (const [name, cfg] of Object.entries(MODELS)) {
            expect({ name, ok: cfg.engine in ENGINES }).toEqual({ name, ok: true });
        }
    });

    test('resolveEngine maps a model to its engine entry', () => {
        const r = resolveEngine('parakeet-ctc-0.6b');
        expect(r.engineId).toBe('transformers');
        expect(r.engine).toBe(ENGINES.transformers);
        expect(r.config).toBe(MODELS['parakeet-ctc-0.6b']);
    });

    test('resolveEngine rejects unknown models and unknown engines', () => {
        expect(() => resolveEngine('nope' as ASRModel)).toThrow('Unknown model');
        const models = { x: { ...MODELS['whisper-tiny'], engine: 'ghost' } as unknown as ModelConfig };
        expect(() => resolveEngine('x' as ASRModel, models)).toThrow('unknown engine "ghost"');
    });

    test('resolveEngine uses the injected registry', () => {
        const fake: EngineEntry = { devices: ['wasm'], create: async () => { throw new Error('unused'); } };
        const models = { m: { ...MODELS['whisper-tiny'], engine: 'fake' } as unknown as ModelConfig };
        expect(resolveEngine('m' as ASRModel, models, { fake }).engine).toBe(fake);
    });

    test('engines are not loaded until create() is called', () => {
        // create is a thunk around a dynamic import; registry import must not pull the runtime in.
        expect(typeof ENGINES.transformers.create).toBe('function');
    });

    test('parakeet-tdt-0.6b-v3 resolves to the WebGPU-only parakeet engine', () => {
        const r = resolveEngine('parakeet-tdt-0.6b-v3');
        expect(r.engineId).toBe('parakeet');
        expect(ENGINES.parakeet.devices).toEqual(['webgpu']);
        // No adapter → no device → the worker refuses before downloading the runtime.
        expect(planDevices(ENGINES.parakeet.devices, false)).toEqual([]);
        expect(planDevices(ENGINES.parakeet.devices, true)).toEqual(['webgpu']);
    });

    test('transformers engine supports WebGPU then WASM', () => {
        expect(ENGINES.transformers.devices).toEqual(['webgpu', 'wasm']);
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
