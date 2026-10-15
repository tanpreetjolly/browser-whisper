/** Transformers.js engine runtime: Whisper, Moonshine, Distil-Whisper, Parakeet CTC. */
import { pipeline, env } from '@huggingface/transformers';
import { createOPFSCache } from '../../../lib/opfs-cache.js';
import type { ASREngine, ModelCapabilities } from '../types.js';
import type { TransformersConfig } from './config.js';
import { toEngineResult } from './output.js';

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

export function createEngine(): ASREngine<TransformersConfig> {
    let asr: ASRPipeline | null = null;
    let caps: ModelCapabilities | null = null;

    return {
        async load({ engineConfig, capabilities }, { device, quantization, onFile }) {
            // transformers.js has no AbortSignal for pipeline() downloads; cancel/abort of a
            // download is handled by terminating the worker (BrowserWhisper.downloadModel).
            setupEnv();
            const dtype = quantization === 'hybrid' ? engineConfig.hybridDtype : quantization;
            asr = (await (pipeline as (...a: unknown[]) => Promise<unknown>)(
                'automatic-speech-recognition',
                engineConfig.hfId,
                {
                    device,
                    dtype,
                    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
                        if (!p.file) return;
                        if (p.status === 'initiate') onFile(p.file, 0, 0);
                        else if (p.status === 'progress') onFile(p.file, p.loaded ?? 0, p.total ?? 0);
                    },
                },
            )) as ASRPipeline;
            caps = capabilities;
        },

        async transcribe(samples, { language }) {
            if (!asr || !caps) throw new Error('Transformers engine not loaded');
            const returnTimestamps = caps.wordTimestamps ? 'word' : caps.timestamps ? true : undefined;
            const out = await asr(samples, {
                sampling_rate: 16_000,
                ...(returnTimestamps !== undefined && {
                    return_timestamps: returnTimestamps,
                    chunk_length_s: 30,
                    stride_length_s: 5,
                }),
                ...(language ? { language } : {}),
            });
            return toEngineResult(out, caps.wordTimestamps);
        },

        async dispose() {
            const p = asr;
            asr = null;
            caps = null;
            try { await p?.dispose?.(); } catch { /* ignore */ }
        },
    };
}
