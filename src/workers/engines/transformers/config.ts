import type { EngineDescriptor } from '../types.js';

export interface TransformersConfig {
    hfId: string;
    hybridDtype: Record<string, string> | string;
}

export const transformersEngine: EngineDescriptor<TransformersConfig> = {
    devices: ['webgpu', 'wasm'],
    quantizations: ['hybrid', 'fp32', 'fp16', 'q8', 'q4'],
    cacheId: (c) => c.hfId,
    legacyHybridDtype: (c) => c.hybridDtype,
};
