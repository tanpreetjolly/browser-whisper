/**
 * Parakeet TDT via parakeet.js. The runtime is imported from a pinned CDN URL only when a
 * Parakeet model loads, so it never ships in the bundle. Model files are streamed into OPFS
 * and passed as file-backed blob: URLs to avoid holding a second copy in memory.
 */
import { createOPFSCache } from '../../../lib/opfs-cache.js';
import type { ModelConfig } from '../../../types.js';
import type { ASREngine, EngineLoadOptions, EngineOutput } from '../types.js';
import { PARAKEET_JS_URL, hubUrl, parakeetFiles, wordsToChunks } from './config.js';

interface ParakeetModel {
    transcribe(audio: Float32Array, sampleRate: number, opts: Record<string, unknown>): Promise<{
        utterance_text: string;
        words?: { text: string; start_time: number; end_time: number }[];
    }>;
    dispose?(): Promise<void> | void;
}
interface ParakeetModule {
    fromUrls(cfg: Record<string, unknown>): Promise<ParakeetModel>;
}

async function hasShaderF16(): Promise<boolean> {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<{ features: Set<string> } | null> } }).gpu;
    try {
        return !!(await gpu?.requestAdapter({ powerPreference: 'high-performance' }))?.features.has('shader-f16');
    } catch {
        return false;
    }
}

const cache = createOPFSCache({ legacyCacheName: 'transformers-cache' });

async function cachedBlobUrl(url: string, file: string, onProgress: EngineLoadOptions['onProgress']): Promise<string> {
    onProgress({ status: 'initiate', file });
    let res = await cache.match(url);
    if (!res) {
        const net = await fetch(url);
        if (!net.ok || !net.body) throw new Error(`Failed to download ${url}: HTTP ${net.status}`);
        const total = Number(net.headers.get('content-length')) || 0;
        let loaded = 0;
        const counted = net.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
                loaded += chunk.byteLength;
                onProgress({ status: 'progress', file, loaded, total });
                ctl.enqueue(chunk);
            },
        }));
        const stream = new Response(counted, { headers: net.headers });
        await cache.store(url, stream);
        res = await cache.match(url);
        // OPFS unavailable or full: fall back to a second, in-memory download.
        if (!res) res = await fetch(url);
    }
    const blob = await res.blob();
    onProgress({ status: 'progress', file, loaded: blob.size, total: blob.size });
    return URL.createObjectURL(blob);
}

export function createParakeetEngine(): ASREngine {
    let model: ParakeetModel | null = null;
    let urls: string[] = [];

    const revoke = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };

    return {
        async load(config: ModelConfig, device, { quantization, onProgress }) {
            if (device !== 'webgpu') throw new Error('Parakeet TDT runs on WebGPU only');
            const files = parakeetFiles(quantization, String(config.hybridDtype));
            // Without shader-f16 the fp16 encoder silently returns empty text; fail loudly instead.
            if (files.encoder.includes('fp16') && !(await hasShaderF16())) {
                throw new Error('Parakeet TDT fp16 needs a WebGPU adapter with the "shader-f16" feature, which this GPU/browser lacks. Try quantization: \'q8\'.');
            }
            const mod = (await import(/* @vite-ignore */ PARAKEET_JS_URL)) as ParakeetModule;
            const get = (f: string) => cachedBlobUrl(hubUrl(config.hfId, f), f, onProgress);
            try {
                const [encoderUrl, decoderUrl, tokenizerUrl, encoderDataUrl] = await Promise.all([
                    get(files.encoder), get(files.decoder), get(files.vocab),
                    files.encoderData ? get(files.encoderData) : Promise.resolve(undefined),
                ]);
                urls = [encoderUrl, decoderUrl, tokenizerUrl, ...(encoderDataUrl ? [encoderDataUrl] : [])];
                model = await mod.fromUrls({
                    encoderUrl, decoderUrl, tokenizerUrl, encoderDataUrl,
                    filenames: { encoder: files.encoder, decoder: files.decoder },
                    // Not 'webgpu-strict': it creates both sessions in parallel and races ORT's
                    // initWasm() ("multiple calls to 'initWasm()' detected").
                    backend: 'webgpu-hybrid',
                    preprocessorBackend: 'js',
                });
            } catch (err) {
                revoke();
                throw err;
            }
            revoke(); // sessions have read the bytes
        },

        async transcribe(samples): Promise<EngineOutput> {
            if (!model) throw new Error('Parakeet engine not loaded');
            const r = await model.transcribe(samples, 16_000, { returnTimestamps: true });
            return { text: r.utterance_text ?? '', chunks: wordsToChunks(r.words) };
        },

        async dispose() {
            const m = model;
            model = null;
            revoke();
            try { await m?.dispose?.(); } catch { /* ignore */ }
        },
    };
}
