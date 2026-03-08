/**
 * Downmix multi-channel planar PCM to mono by averaging all channels.
 *
 * @param channels - One Float32Array per audio channel (planar layout,
 *   as returned by AudioData.copyTo with a planeIndex per channel).
 * @returns A new mono Float32Array.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
    if (channels.length === 0) return new Float32Array(0);
    if (channels.length === 1) return channels[0];

    const length = channels[0].length;
    const mono = new Float32Array(length);
    const invCount = 1 / channels.length;

    for (let i = 0; i < length; i++) {
        let sum = 0;
        for (const ch of channels) sum += ch[i];
        mono[i] = sum * invCount;
    }
    return mono;
}

/**
 * Resample a mono 16-bit PCM buffer to exactly 16 000 Hz using linear
 * interpolation. This is sufficient quality for Whisper — which was trained
 * on 16 kHz audio — without requiring a polyphase filter.
 *
 * @param input - Mono PCM samples at `sourceSampleRate`.
 * @param sourceSampleRate - Source sample rate in Hz.
 * @returns A new Float32Array at 16 000 Hz.
 */
export function resampleTo16kHz(
    input: Float32Array,
    sourceSampleRate: number,
): Float32Array {
    const TARGET_RATE = 16_000;

    if (sourceSampleRate === TARGET_RATE) return input;

    const ratio = sourceSampleRate / TARGET_RATE;
    const outputLength = Math.round(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
        const srcPos = i * ratio;
        const lo = Math.floor(srcPos);
        const hi = Math.min(lo + 1, input.length - 1);
        const t = srcPos - lo;
        // Linear interpolation between two nearest input samples
        output[i] = input[lo] * (1 - t) + input[hi] * t;
    }

    return output;
}
