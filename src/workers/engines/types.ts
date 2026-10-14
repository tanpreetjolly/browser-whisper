/**
 * ASR engine contract.
 *
 * An engine wraps one inference runtime (Transformers.js today; e.g. parakeet.js or
 * onnxruntime-web later). It only turns 16 kHz mono PCM into raw text/timestamps.
 * Everything else — decoding, chunking, OPFS cache, load-progress aggregation,
 * fatal-error surfacing, WebGPU→WASM fallback, segment building/clamping — stays
 * shared in whisper-worker.ts and src/lib.
 */
import type { ModelConfig, QuantizationType } from '../../types.js';
import type { TimestampChunk } from '../../lib/word-segments.js';

export type EngineDevice = 'webgpu' | 'wasm';

/** Raw per-chunk engine output; times are relative to the chunk start. */
export interface EngineOutput {
    text: string;
    chunks?: TimestampChunk[];
}

export interface EngineLoadOptions {
    quantization: QuantizationType;
    /** Per-file download progress, aggregated by the worker (see load-progress.ts). */
    onProgress: (info: { status?: string; file?: string; loaded?: number; total?: number }) => void;
}

export interface TranscribeChunkOptions {
    language?: string;
}

export interface ASREngine {
    /** Load `model` on `device`. Reject on failure so the worker can fall back. */
    load(model: ModelConfig, device: EngineDevice, opts: EngineLoadOptions): Promise<void>;
    /** Transcribe one chunk of 16 kHz mono PCM. */
    transcribe(samples: Float32Array, opts: TranscribeChunkOptions): Promise<EngineOutput>;
    /** Free model / GPU memory. Must not throw. */
    dispose(): Promise<void> | void;
}
