/**
 * Engine registry. Each engine is reached only through a dynamic import, so a
 * runtime is fetched/evaluated only when a model that names it is loaded.
 */
import type { ASRModel, EngineId, ModelConfig } from '../../types.js';
import { MODELS } from '../../types.js';
import type { ASREngine, EngineDevice } from './types.js';

export interface EngineEntry {
    /** Supported devices in preference order (WebGPU first). */
    devices: readonly EngineDevice[];
    create(): Promise<ASREngine>;
}

export const ENGINES: Record<EngineId, EngineEntry> = {
    transformers: {
        devices: ['webgpu', 'wasm'],
        create: () => import('./transformers/index.js').then((m) => m.createTransformersEngine()),
    },
    // WebGPU only: the owner does not ship models that can't run on WebGPU.
    parakeet: {
        devices: ['webgpu'],
        create: () => import('./parakeet/index.js').then((m) => m.createParakeetEngine()),
    },
};

export function resolveEngine(
    model: ASRModel,
    models: Record<string, ModelConfig> = MODELS,
    engines: Record<string, EngineEntry> = ENGINES,
): { config: ModelConfig; engineId: EngineId; engine: EngineEntry } {
    const config = models[model];
    if (!config) throw new Error(`Unknown model "${model}"`);
    const engine = engines[config.engine];
    if (!engine) throw new Error(`Model "${model}" names unknown engine "${config.engine}"`);
    return { config, engineId: config.engine, engine };
}

/**
 * WebGPU-first device order: WebGPU only when the engine supports it AND an
 * adapter exists, followed by WASM as fallback when supported.
 */
export function planDevices(devices: readonly EngineDevice[], hasWebGPU: boolean): EngineDevice[] {
    const plan: EngineDevice[] = [];
    if (hasWebGPU && devices.includes('webgpu')) plan.push('webgpu');
    if (devices.includes('wasm')) plan.push('wasm');
    return plan;
}
