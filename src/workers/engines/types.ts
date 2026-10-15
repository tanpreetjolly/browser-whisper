/** Engine contracts. Engine-neutral by design: shared code never sees runtime types. See CONTRIBUTING.md. */
import type { QuantizationType } from '../../types.js';

export type EngineDevice = 'webgpu' | 'wasm';

/** What a model can do. */
export interface ModelCapabilities {
    timestamps: boolean;
    wordTimestamps: boolean;
    /** Honours the `language` option */
    language: boolean;
}

/** Seconds relative to the chunk passed to transcribe(). */
export interface TimedText {
    text: string;
    start: number;
    end: number;
}

/** Prefer `words` (grouped into segments), else `segments`; text-only spans the chunk. */
export interface EngineResult {
    text: string;
    words?: TimedText[];
    segments?: TimedText[];
}

export interface EngineLoadContext {
    device: EngineDevice;
    quantization: QuantizationType;
    /** Empty unless device is 'webgpu' */
    adapterFeatures: ReadonlySet<string>;
    /** total = 0 when unknown */
    onFile(file: string, loaded: number, total: number): void;
    signal: AbortSignal;
}

export interface TranscribeContext {
    /** Only set when capabilities.language */
    language?: string;
    /** Results after abort are discarded anyway. */
    signal: AbortSignal;
}

export interface ASREngine<C = unknown> {
    /** Reject on failure so the worker can fall back to the next device. */
    load(model: { id: string; engineConfig: C; capabilities: ModelCapabilities }, ctx: EngineLoadContext): Promise<void>;
    transcribe(samples: Float32Array, ctx: TranscribeContext): Promise<EngineResult>;
    /** Free model / GPU memory. Must not throw. */
    dispose(): void | Promise<void>;
}

/** Must stay free of runtime imports: the main thread loads it. */
export interface EngineDescriptor<C = unknown> {
    devices: readonly EngineDevice[];
    /** Validated before any download */
    quantizations: readonly QuantizationType[];
    /** Cache key; must not change, or existing OPFS caches are orphaned */
    cacheId(config: C): string;
    /** Backs the deprecated `ModelConfig.hybridDtype` */
    legacyHybridDtype(config: C): Record<string, string> | string;
}
