/**
 * Pure descriptors, imported by the main thread. Runtimes live in runtimes.ts: a dynamic
 * import here would make the library build split the worker runtimes into main-thread chunks.
 */
import { parakeetEngine } from './parakeet/config.js';
import { transformersEngine } from './transformers/config.js';
import type { EngineDescriptor, EngineDevice } from './types.js';

export const ENGINES = {
    transformers: transformersEngine,
    parakeet: parakeetEngine,
} satisfies Record<string, EngineDescriptor<never>>;

export type EngineId = keyof typeof ENGINES;

export type EngineConfigOf<E extends EngineId> = (typeof ENGINES)[E] extends EngineDescriptor<infer C> ? C : never;

/** WebGPU first (when supported and an adapter exists), then WASM. */
export function planDevices(devices: readonly EngineDevice[], hasWebGPU: boolean): EngineDevice[] {
    const plan: EngineDevice[] = [];
    if (hasWebGPU && devices.includes('webgpu')) plan.push('webgpu');
    if (devices.includes('wasm')) plan.push('wasm');
    return plan;
}
