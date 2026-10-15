/** Worker-only. Dynamic imports keep unused runtimes from being evaluated. */
import type { EngineId } from './catalog.js';
import type { ASREngine } from './types.js';

export type RuntimeFactory = () => Promise<ASREngine<never>>;

export const RUNTIMES: Record<EngineId, RuntimeFactory> = {
    transformers: () => import('./transformers/index.js').then((m) => m.createEngine()),
    parakeet: () => import('./parakeet/index.js').then((m) => m.createEngine()),
};
