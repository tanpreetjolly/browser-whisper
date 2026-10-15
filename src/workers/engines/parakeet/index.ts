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
import type { ASREngine, EngineLoadContext } from '../types.js';
import { PARAKEET_JS_URL, hubUrl, parakeetFiles, toWords, type ParakeetConfig } from './config.js';

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
async function cachedBlobUrl(url: string, file: string, ctx: EngineLoadContext): Promise<string> {
    ctx.onFile(file, 0, 0);
    let res = await cache.match(url);
    if (!res) {
        const net = await fetch(url, { signal: ctx.signal });
        if (!net.ok || !net.body) throw new Error(`Failed to download ${url}: HTTP ${net.status}`);
        const total = Number(net.headers.get('content-length')) || 0;
        let loaded = 0;
        const counted = net.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
                loaded += chunk.byteLength;
                ctx.onFile(file, loaded, total);
                ctl.enqueue(chunk);
            },
        }));
        const stream = new Response(counted, { headers: net.headers });
        await cache.store(url, stream);
        res = await cache.match(url);
        // OPFS unavailable/full: fall back to an in-memory copy (one more download).
        if (!res) res = await fetch(url, { signal: ctx.signal });
    }
    const blob = await res.blob();
    ctx.onFile(file, blob.size, blob.size);
    return URL.createObjectURL(blob);
}

export function createEngine(): ASREngine<ParakeetConfig> {
    let model: ParakeetModel | null = null;
    let urls: string[] = [];

    const revoke = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };

    return {
        async load({ engineConfig }, ctx) {
            if (ctx.device !== 'webgpu') throw new Error('Parakeet TDT runs on WebGPU only');
            const files = parakeetFiles(ctx.quantization, engineConfig.hybridEncoder);
            // Without shader-f16 the fp16 encoder's shaders fail validation and the model
            // silently returns empty text, so refuse up front.
            if (files.encoder.includes('fp16') && !ctx.adapterFeatures.has('shader-f16')) {
                throw new Error('Parakeet TDT fp16 needs a WebGPU adapter with the "shader-f16" feature, which this GPU/browser lacks. Try quantization: \'q8\'.');
            }
            const mod = (await import(/* @vite-ignore */ PARAKEET_JS_URL)) as ParakeetModule;
            const get = (f: string) => cachedBlobUrl(hubUrl(engineConfig.repo, f), f, ctx);
            try {
                const [encoderUrl, decoderUrl, tokenizerUrl, encoderDataUrl] = await Promise.all([
                    get(files.encoder), get(files.decoder), get(files.vocab),
                    files.encoderData ? get(files.encoderData) : Promise.resolve(undefined),
                ]);
                urls = [encoderUrl, decoderUrl, tokenizerUrl, ...(encoderDataUrl ? [encoderDataUrl] : [])];
                model = await mod.fromUrls({
                    encoderUrl, decoderUrl, tokenizerUrl, encoderDataUrl,
                    filenames: { encoder: files.encoder, decoder: files.decoder },
                    // Encoder on WebGPU; parakeet.js always runs the small decoder/joint on WASM.
                    // 'webgpu-hybrid', not 'webgpu-strict': strict creates both sessions in parallel,
                    // which races ORT's initWasm() ("multiple calls to 'initWasm()' detected").
                    // Hybrid lists wasm as a secondary EP, so ops WebGPU can't run fall back per node.
                    backend: 'webgpu-hybrid',
                    preprocessorBackend: 'js',
                });
            } catch (err) {
                revoke();
                throw err;
            }
            // Session creation has read the model bytes; the blob URLs are no longer needed.
            revoke();
        },

        async transcribe(samples) {
            if (!model) throw new Error('Parakeet engine not loaded');
            const r = await model.transcribe(samples, 16_000, { returnTimestamps: true });
            return { text: r.utterance_text ?? '', words: toWords(r.words) };
        },

        async dispose() {
            const m = model;
            model = null;
            revoke();
            try { await m?.dispose?.(); } catch { /* ignore */ }
        },
    };
}
