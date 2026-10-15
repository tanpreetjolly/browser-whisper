/**
 * Worker-only runtime registry. Each runtime is reached only through a dynamic import, so it is
 * evaluated only when a model that names it loads. Typed against the catalog, so a new engine
 * id without a runtime fails typecheck.
 */
import type { EngineId } from './catalog.js';
import type { ASREngine } from './types.js';

export type RuntimeFactory = () => Promise<ASREngine<never>>;

export const RUNTIMES: Record<EngineId, RuntimeFactory> = {
    transformers: () => import('./transformers/index.js').then((m) => m.createEngine()),
    parakeet: () => import('./parakeet/index.js').then((m) => m.createEngine()),
};
