/** Pure helpers for the parakeet engine (no runtime imports, unit-tested). */
import type { QuantizationType } from '../../../types.js';
import type { TimestampChunk } from '../../../lib/word-segments.js';

/** parakeet.js version loaded at runtime. Pinned: bump deliberately. */
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
 * Files to fetch for a quantization. 'hybrid' (default) and 'fp16' use the single-file fp16
 * encoder (~1.24 GB), which stays below browsers' ~2 GB ArrayBuffer limit. 'fp32' pulls 2.4 GB
 * of external data and may fail with "Array buffer allocation failed". The decoder/joint is
 * always int8 (~18 MB; parakeet.js runs it on WASM).
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

/** parakeet.js word timings → pipeline-style chunks (chunk-relative seconds). */
export function wordsToChunks(words: { text: string; start_time: number; end_time: number }[] | undefined): TimestampChunk[] {
    return (words ?? []).map((w) => ({ text: w.text, timestamp: [w.start_time, w.end_time] }));
}
