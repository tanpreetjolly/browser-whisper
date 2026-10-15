/**
 * Model definitions. Each model names its engine, declares engine-neutral capabilities, and
 * carries an engine-owned `engineConfig` (typed per engine via the catalog).
 *
 * `ASRModel` is derived from this table. The public `MODELS` map adds the deprecated flat
 * fields (`hfId`, `hybridDtype`, `supports*`) so existing code keeps working.
 */
import type { ModelConfig } from './types.js';
import { ENGINES, type EngineConfigOf, type EngineId } from './workers/engines/catalog.js';
import type { ModelCapabilities } from './workers/engines/types.js';

export type ModelDefinition = {
    [E in EngineId]: { engine: E; capabilities: ModelCapabilities; engineConfig: EngineConfigOf<E> };
}[EngineId];

const WHISPER_HYBRID = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
const SEGMENT_TS = { timestamps: true, wordTimestamps: false };
const WORD_TS = { timestamps: true, wordTimestamps: true };
const NO_TS = { timestamps: false, wordTimestamps: false };
const LANG = true;
const NO_LANG = false;

function tjs(
    hfId: string,
    hybridDtype: Record<string, string> | string,
    ts: Omit<ModelCapabilities, 'language'>,
    language: boolean,
): ModelDefinition {
    return { engine: 'transformers', capabilities: { ...ts, language }, engineConfig: { hfId, hybridDtype } };
}

export const MODEL_DEFINITIONS = {
    'whisper-tiny': tjs('onnx-community/whisper-tiny', WHISPER_HYBRID, SEGMENT_TS, LANG),
    'whisper-base': tjs('onnx-community/whisper-base', WHISPER_HYBRID, SEGMENT_TS, LANG),
    'whisper-small': tjs('onnx-community/whisper-small', WHISPER_HYBRID, SEGMENT_TS, LANG),
    'whisper-tiny_timestamped': tjs('onnx-community/whisper-tiny_timestamped', WHISPER_HYBRID, WORD_TS, LANG),
    'whisper-base_timestamped': tjs('onnx-community/whisper-base_timestamped', WHISPER_HYBRID, WORD_TS, LANG),
    'whisper-small_timestamped': tjs('onnx-community/whisper-small_timestamped', WHISPER_HYBRID, WORD_TS, LANG),
    'whisper-large-v3-turbo': tjs('onnx-community/whisper-large-v3-turbo', WHISPER_HYBRID, SEGMENT_TS, LANG),
    'whisper-large-v3-turbo_timestamped': tjs('onnx-community/whisper-large-v3-turbo_timestamped', WHISPER_HYBRID, WORD_TS, LANG),
    'lite-whisper-large-v3-turbo-fast': tjs('onnx-community/lite-whisper-large-v3-turbo-fast-ONNX', WHISPER_HYBRID, SEGMENT_TS, LANG),
    'lite-whisper-large-v3-turbo': tjs('onnx-community/lite-whisper-large-v3-turbo-ONNX', WHISPER_HYBRID, SEGMENT_TS, LANG),
    'lite-whisper-large-v3-turbo-acc': tjs('onnx-community/lite-whisper-large-v3-turbo-acc-ONNX', WHISPER_HYBRID, SEGMENT_TS, LANG),
    'moonshine-tiny': tjs('onnx-community/moonshine-tiny-ONNX', 'q4', NO_TS, NO_LANG),
    'moonshine-base': tjs('onnx-community/moonshine-base-ONNX', 'q4', NO_TS, NO_LANG),
    // NVIDIA Parakeet CTC 0.6B (FastConformer + CTC head), English only, lowercase output without
    // punctuation. Needs transformers.js >= 4 (`parakeet_ctc`). The CTC pipeline returns text only
    // (no timestamps, ignores chunk_length_s/language), so it relies on our 30 s chunker.
    // Default q8 (model_quantized.onnx + .onnx_data, ~612 MB): q4 and fp16 returned empty text
    // for most inputs under onnxruntime-node CPU; fp32 is 2.4 GB of external data.
    'parakeet-ctc-0.6b': tjs('onnx-community/parakeet-ctc-0.6b-ONNX', 'q8', NO_TS, NO_LANG),
    'distil-whisper-small': tjs('onnx-community/distil-small.en', WHISPER_HYBRID, SEGMENT_TS, NO_LANG),
    // NVIDIA Parakeet TDT 0.6B v3 (25 European languages, auto-detected; punctuation + word
    // timestamps). Runs via parakeet.js (lazy-loaded from a pinned CDN URL, never bundled).
    // WebGPU only. 'hybrid' = fp16 encoder (~1.24 GB) + int8 decoder/joint (~18 MB); the fp32
    // encoder (2.4 GB external data) is avoided because it can hit "Array buffer allocation failed".
    'parakeet-tdt-0.6b-v3': { engine: 'parakeet', capabilities: { ...WORD_TS, language: false }, engineConfig: { repo: 'ysdede/parakeet-tdt-0.6b-v3-onnx', hybridEncoder: 'fp16' } },
} satisfies Record<string, ModelDefinition>;

/** All model ids accepted by the API. */
export type ASRModel = keyof typeof MODEL_DEFINITIONS;

export function toModelConfig(def: ModelDefinition): ModelConfig {
    const engine = ENGINES[def.engine] as unknown as {
        cacheId(c: unknown): string;
        legacyHybridDtype(c: unknown): Record<string, string> | string;
    };
    return {
        engine: def.engine,
        capabilities: def.capabilities,
        engineConfig: def.engineConfig,
        hfId: engine.cacheId(def.engineConfig),
        hybridDtype: engine.legacyHybridDtype(def.engineConfig),
        supportsTimestamps: def.capabilities.timestamps,
        supportsWordTimestamps: def.capabilities.wordTimestamps,
        supportsLanguage: def.capabilities.language,
    };
}

/** Public model table (backward compatible). */
export const MODELS = Object.fromEntries(
    Object.entries(MODEL_DEFINITIONS).map(([id, def]) => [id, toModelConfig(def)]),
) as Record<ASRModel, ModelConfig>;
