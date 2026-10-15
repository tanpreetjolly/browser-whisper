/** `ASRModel` is derived from MODEL_DEFINITIONS; `engineConfig` is typed per engine. */
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
    // Text only: the CTC pipeline ignores timestamps/chunking, so it relies on our 30 s chunker.
    // q8 because q4 and fp16 returned empty text for most inputs; fp32 is 2.4 GB external data.
    'parakeet-ctc-0.6b': tjs('onnx-community/parakeet-ctc-0.6b-ONNX', 'q8', NO_TS, NO_LANG),
    'distil-whisper-small': tjs('onnx-community/distil-small.en', WHISPER_HYBRID, SEGMENT_TS, NO_LANG),
    // WebGPU only. 'hybrid' uses the fp16 encoder: fp32 needs 2.4 GB of external data, which
    // fails with "Array buffer allocation failed" in browsers.
    'parakeet-tdt-0.6b-v3': { engine: 'parakeet', capabilities: { ...WORD_TS, language: false }, engineConfig: { repo: 'ysdede/parakeet-tdt-0.6b-v3-onnx', hybridEncoder: 'fp16' } },
} satisfies Record<string, ModelDefinition>;

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

/** Public table; keeps the deprecated flat fields for backward compatibility. */
export const MODELS = Object.fromEntries(
    Object.entries(MODEL_DEFINITIONS).map(([id, def]) => [id, toModelConfig(def)]),
) as Record<ASRModel, ModelConfig>;
