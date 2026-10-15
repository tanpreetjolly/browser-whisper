/**
 * Engine contracts. Everything here is engine-neutral: the shared worker (asr-worker.ts /
 * asr-core.ts) and src/lib never see a runtime's own types or data shapes.
 *
 * Each engine lives in src/workers/engines/<id>/ with:
 *  - config.ts: a pure EngineDescriptor (safe to import on the main thread, no runtime deps)
 *  - index.ts:  the runtime, exporting `createEngine()`; reached only via runtimes.ts (dynamic import)
 */
import type { QuantizationType } from '../../types.js';

export type EngineDevice = 'webgpu' | 'wasm';

/** What a model can do. Shared code (segment building, warnings) relies only on this. */
export interface ModelCapabilities {
    /** Returns segment-level timestamps */
    timestamps: boolean;
    /** Returns word-level timestamps */
    wordTimestamps: boolean;
    /** Honours the `language` option */
    language: boolean;
}

/** A timed span relative to the start of the chunk passed to transcribe(). */
export interface TimedText {
    text: string;
    start: number;
    end: number;
}

/**
 * Engine-neutral transcription result, chunk-relative seconds. Provide `words` when the
 * model has word timings (they get grouped into segments), else `segments`, else just `text`
 * (one segment spanning the chunk's real audio).
 */
export interface EngineResult {
    text: string;
    words?: TimedText[];
    segments?: TimedText[];
}

export interface EngineLoadContext {
    device: EngineDevice;
    quantization: QuantizationType;
    /** WebGPU adapter features (e.g. 'shader-f16'); empty when not on WebGPU */
    adapterFeatures: ReadonlySet<string>;
    /** Report bytes for one file; the worker aggregates all files into one bar. total=0 when unknown. */
    onFile(file: string, loaded: number, total: number): void;
    /** Aborted when the load is cancelled (engines should stop downloading if they can). */
    signal: AbortSignal;
}

export interface TranscribeContext {
    /** Only set when the model's capabilities.language is true */
    language?: string;
    /** Aborted when the run is cancelled; results after abort are discarded anyway. */
    signal: AbortSignal;
}

/** A loaded runtime for one model. `C` is the engine's own config type. */
export interface ASREngine<C = unknown> {
    /** Load `model` on ctx.device. Reject on failure so the worker can try the next device. */
    load(model: { id: string; engineConfig: C; capabilities: ModelCapabilities }, ctx: EngineLoadContext): Promise<void>;
    transcribe(samples: Float32Array, ctx: TranscribeContext): Promise<EngineResult>;
    /** Free model / GPU memory. Must not throw. */
    dispose(): void | Promise<void>;
}

/** Pure, main-thread-safe description of an engine (lives in engines/<id>/config.ts). */
export interface EngineDescriptor<C = unknown> {
    /** Supported devices; the worker tries WebGPU first, then WASM, among these. */
    devices: readonly EngineDevice[];
    /** Quantizations this engine accepts (validated before anything is downloaded). */
    quantizations: readonly QuantizationType[];
    /** Hugging Face-style id used for cache lookup/deletion and error messages. */
    cacheId(config: C): string;
    /** Legacy flat `ModelConfig.hybridDtype` value, kept for backward compatibility. */
    legacyHybridDtype(config: C): Record<string, string> | string;
}
