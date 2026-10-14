/**
 * Parakeet TDT engine backed by parakeet.js (MIT, ysdede) + onnxruntime-web.
 *
 * No bloat: parakeet.js (and its onnxruntime-web) is NOT bundled. It is imported at runtime
 * from a version-pinned jsDelivr URL only when a parakeet model loads, so Whisper/CTC users
 * download nothing extra. transformers.js already fetches its ORT WASM from jsDelivr the same way.
 *
 * Model files are streamed into the shared OPFS cache (no in-memory copy) and handed to
 * parakeet.js as file-backed blob: URLs.
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

const cache = createOPFSCache({ legacyCacheName: 'transformers-cache' });

/** Returns a blob: URL for `url`, served from OPFS when cached. Reports progress per file. */
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
        // OPFS unavailable/full: fall back to an in-memory copy (one more download).
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
                    // Encoder strictly on WebGPU (no silent CPU fallback); parakeet.js always runs
                    // the small decoder/joint on WASM.
                    backend: 'webgpu-strict',
                    preprocessorBackend: 'js',
                });
            } catch (err) {
                revoke();
                throw err;
            }
            // Session creation has read the model bytes; the blob URLs are no longer needed.
            revoke();
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
