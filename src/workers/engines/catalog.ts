/**
 * Engine catalog: pure descriptors, safe on the main thread. `EngineId` is derived from it.
 * Runtimes are registered separately in runtimes.ts (worker-only, dynamic imports).
 */
import { parakeetEngine } from './parakeet/config.js';
import { transformersEngine } from './transformers/config.js';
import type { EngineDescriptor, EngineDevice } from './types.js';

export const ENGINES = {
    transformers: transformersEngine,
    parakeet: parakeetEngine,
} satisfies Record<string, EngineDescriptor<never>>;

export type EngineId = keyof typeof ENGINES;

/** The config type an engine expects, e.g. EngineConfigOf<'parakeet'>. */
export type EngineConfigOf<E extends EngineId> = (typeof ENGINES)[E] extends EngineDescriptor<infer C> ? C : never;

/**
 * WebGPU-first device order: WebGPU only when the engine supports it AND an adapter exists,
 * then WASM as fallback when supported.
 */
export function planDevices(devices: readonly EngineDevice[], hasWebGPU: boolean): EngineDevice[] {
    const plan: EngineDevice[] = [];
    if (hasWebGPU && devices.includes('webgpu')) plan.push('webgpu');
    if (devices.includes('wasm')) plan.push('wasm');
    return plan;
}
