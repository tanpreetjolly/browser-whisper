/** Parakeet engine helpers. No runtime imports, so tests can load this file. */
import type { QuantizationType } from '../../../types.js';
import type { EngineDescriptor, TimedText } from '../types.js';

export interface ParakeetConfig {
    repo: string;
    hybridEncoder: 'fp16' | 'q8' | 'fp32';
}

// WebGPU only by project policy.
export const parakeetEngine: EngineDescriptor<ParakeetConfig> = {
    devices: ['webgpu'],
    quantizations: ['hybrid', 'fp16', 'q8', 'fp32'],
    cacheId: (c) => c.repo,
    legacyHybridDtype: (c) => c.hybridEncoder,
};

/** Pinned: the CDN import is not covered by the lockfile. */
export const PARAKEET_JS_VERSION = '1.4.4';
export const PARAKEET_JS_URL = `https://cdn.jsdelivr.net/npm/parakeet.js@${PARAKEET_JS_VERSION}/+esm`;

export interface ParakeetFiles {
    encoder: string;
    /** External weights for the fp32 encoder only */
    encoderData?: string;
    decoder: string;
    vocab: string;
}

/**
 * fp16 (the 'hybrid' default) is a single 1.24 GB file, under the ~2 GB ArrayBuffer limit;
 * fp32 adds 2.4 GB of external data and can fail to allocate.
 */
export function parakeetFiles(quantization: QuantizationType, hybridDtype: string): ParakeetFiles {
    const q = quantization === 'hybrid' ? hybridDtype : quantization;
    const base = { decoder: 'decoder_joint-model.int8.onnx', vocab: 'vocab.txt' };
    switch (q) {
        case 'fp16': return { ...base, encoder: 'encoder-model.fp16.onnx' };
        case 'q8': return { ...base, encoder: 'encoder-model.int8.onnx' };
        case 'fp32': return { ...base, encoder: 'encoder-model.onnx', encoderData: 'encoder-model.onnx.data' };
        default: throw new Error(`Quantization "${quantization}" is not available for Parakeet TDT (use hybrid, fp16, q8 or fp32).`);
    }
}

export function hubUrl(repo: string, file: string): string {
    return `https://huggingface.co/${repo}/resolve/main/${file}`;
}

export function toWords(words: { text: string; start_time: number; end_time: number }[] | undefined): TimedText[] {
    return (words ?? []).map((w) => ({ text: w.text, start: w.start_time, end: w.end_time }));
}
