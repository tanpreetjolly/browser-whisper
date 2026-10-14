/** Transformers.js engine: Whisper, Moonshine, Distil-Whisper, Parakeet CTC. */
import { pipeline, env } from '@huggingface/transformers';
import { createOPFSCache } from '../../../lib/opfs-cache.js';
import type { ModelConfig } from '../../../types.js';
import type { ASREngine, EngineOutput } from '../types.js';

let envReady = false;
function setupEnv(): void {
    if (envReady) return;
    envReady = true;
    // Cache model files in OPFS (migrating from the legacy Cache API cache on first access).
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createOPFSCache({ legacyCacheName: env.cacheKey ?? 'transformers-cache' });
    env.allowLocalModels = false;
    // wasmPaths: transformers.js 4.x sets absolute jsDelivr URLs for its bundled
    // onnxruntime-web itself; do NOT override (the blob: worker needs absolute URLs).
}

// Callable type for the pipeline — avoids TS2590 (union too complex)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASRPipeline = ((input: Float32Array, opts: Record<string, unknown>) => Promise<any>) & { dispose?(): Promise<void> };

export function createTransformersEngine(): ASREngine {
    let asr: ASRPipeline | null = null;
    let config: ModelConfig | null = null;

    return {
        async load(model, device, { quantization, onProgress }) {
            setupEnv();
            const dtype = quantization === 'hybrid' ? model.hybridDtype : quantization;
            asr = (await (pipeline as (...a: unknown[]) => Promise<unknown>)(
                'automatic-speech-recognition',
                model.hfId,
                { device, dtype, progress_callback: onProgress },
            )) as ASRPipeline;
            config = model;
        },

        async transcribe(samples, { language }): Promise<EngineOutput> {
            if (!asr || !config) throw new Error('Transformers engine not loaded');
            const returnTimestamps = config.supportsWordTimestamps
                ? 'word'
                : config.supportsTimestamps ? true : undefined;
            return await asr(samples, {
                sampling_rate: 16_000,
                ...(returnTimestamps !== undefined && {
                    return_timestamps: returnTimestamps,
                    chunk_length_s: 30,
                    stride_length_s: 5,
                }),
                ...(config.supportsLanguage && language ? { language } : {}),
            });
        },

        async dispose() {
            const p = asr;
            asr = null;
            config = null;
            try { await p?.dispose?.(); } catch { /* ignore */ }
        },
    };
}
