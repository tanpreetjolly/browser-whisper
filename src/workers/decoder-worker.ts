/**
 * decoder.worker.ts
 *
 * Runs in a Web Worker. Responsible for:
 *  1. Receiving a File and a MessagePort (pointed at the Whisper worker)
 *  2. Using MediaBunny to demux the file and obtain encoded audio packets
 *  3. Feeding those packets to a WebCodecs AudioDecoder for hardware-accelerated decoding
 *  4. Downmixing + resampling decoded AudioData frames to mono 16-kHz PCM
 *  5. Windowing the PCM into 30-second chunks via Chunker
 *  6. Transferring each chunk to the Whisper worker via the MessagePort
 *  7. Reporting decoding progress back to the main thread
 */

import {
    Input,
    ALL_FORMATS,
    BlobSource,
    EncodedPacketSink,
} from 'mediabunny';

import { downmixToMono, resampleTo16kHz } from '../lib/resampler.js';
import { Chunker } from '../lib/chunker.js';
import {
    CodecNotSupportedError,
    DecoderError,
    NoAudioTrackError,
    WebCodecsNotSupportedError,
} from '../errors.js';
import type { PCMChunk, MainThreadMessage } from '../types.js';

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

/** Port connected to the Whisper worker via MessageChannel */
let port: MessagePort | null = null;

let whisperQueueSize = 0;
let whisperQueueWaiter: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data as { type: string; port?: MessagePort; file?: File };

    if (msg.type === 'port') {
        port = msg.port!;

        // Listen for backpressure queue depth updates from the whisper worker
        port.onmessage = (portEvent: MessageEvent<number>) => {
            whisperQueueSize = portEvent.data;
            if (whisperQueueSize < 3 && whisperQueueWaiter) {
                whisperQueueWaiter();
                whisperQueueWaiter = null;
            }
        };

        return;
    }

    if (msg.type === 'init') {
        try {
            await run(msg.file!);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[decoder.worker] Fatal error:', err);
            postMain({ type: 'error', message });
        }
    }
};

// ---------------------------------------------------------------------------
// Main decode pipeline
// ---------------------------------------------------------------------------

async function run(file: File): Promise<void> {
    // ── 1. Check WebCodecs availability ──────────────────────────────────────
    if (typeof AudioDecoder === 'undefined') {
        throw new WebCodecsNotSupportedError();
    }

    // ── 2. Open file with MediaBunny ─────────────────────────────────────────
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
    });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) throw new NoAudioTrackError();

    const duration = await audioTrack.computeDuration(); // seconds

    // ── 3. Get WebCodecs decoder config from MediaBunny ──────────────────────
    const decoderConfig = await audioTrack.getDecoderConfig();
    if (!decoderConfig) {
        throw new CodecNotSupportedError('unknown — MediaBunny returned no config');
    }

    // ── 4. Verify the browser can decode this codec ───────────────────────────
    const support = await AudioDecoder.isConfigSupported(decoderConfig);
    if (!support.supported) {
        throw new CodecNotSupportedError(decoderConfig.codec);
    }

    // ── 5. Wire up Chunker → sends PCMChunks to Whisper worker ───────────────
    const chunker = new Chunker((chunk: PCMChunk) => {
        if (!port) return;
        // Transfer the ArrayBuffer for zero-copy transfer
        port.postMessage(chunk, [chunk.samples.buffer]);
    });

    // ── 6. Create WebCodecs AudioDecoder ────────────────────────────────────
    const decoder = new AudioDecoder({
        output(audioData: AudioData) {
            try {
                const numChannels = audioData.numberOfChannels;
                const numFrames = audioData.numberOfFrames;

                // WebCodecs AudioDecoder typically outputs interleaved audio
                // (all channels packed into planeIndex 0).  We always read from
                // plane 0 and deinterleave manually — this works for both
                // interleaved AND planar formats.
                const byteLength = audioData.allocationSize({
                    format: 'f32-planar',
                    planeIndex: 0,
                });
                const plane0 = new Float32Array(byteLength / 4);
                audioData.copyTo(plane0, { format: 'f32-planar', planeIndex: 0 });

                // If there are more planes (true planar layout), read each one
                const channels: Float32Array[] = [plane0];
                for (let ch = 1; ch < numChannels; ch++) {
                    try {
                        const chBytes = audioData.allocationSize({
                            format: 'f32-planar',
                            planeIndex: ch,
                        });
                        const chBuf = new Float32Array(chBytes / 4);
                        audioData.copyTo(chBuf, { format: 'f32-planar', planeIndex: ch });
                        channels.push(chBuf);
                    } catch {
                        // If planeIndex > 0 throws, the data is interleaved in plane 0.
                        // Deinterleave it manually below.
                        break;
                    }
                }

                // CRITICAL: close immediately to free GPU/hardware resources
                audioData.close();

                let mono: Float32Array;
                if (channels.length === numChannels) {
                    // We got all channels as separate planes — standard downmix
                    mono = downmixToMono(channels);
                } else {
                    // Data is interleaved in plane0: [L0,R0,L1,R1,...]
                    // Deinterleave then downmix
                    const deinterleaved: Float32Array[] = [];
                    for (let ch = 0; ch < numChannels; ch++) {
                        deinterleaved.push(new Float32Array(numFrames));
                    }
                    for (let i = 0; i < numFrames; i++) {
                        for (let ch = 0; ch < numChannels; ch++) {
                            deinterleaved[ch][i] = plane0[i * numChannels + ch];
                        }
                    }
                    mono = downmixToMono(deinterleaved);
                }

                const resampled = resampleTo16kHz(mono, audioTrack.sampleRate);
                chunker.push(resampled);
            } catch (err) {
                // Errors inside the output callback must be surfaced manually
                const message = err instanceof Error ? err.message : String(err);
                console.error('[decoder.worker] AudioData output error:', err);
                postMain({ type: 'error', message });
            }
        },

        error(err: DOMException) {
            console.error('[decoder.worker] AudioDecoder error:', err);
            postMain({
                type: 'error',
                message: new DecoderError(err.message, err).message,
            });
        },
    });

    decoder.configure(decoderConfig);

    // ── 7. Iterate encoded packets via MediaBunny EncodedPacketSink ──────────
    const sink = new EncodedPacketSink(audioTrack);

    for await (const packet of sink.packets()) {
        // Backpressure: wait for the decoder to drain AND the whisper worker to catch up
        while (decoder.decodeQueueSize > 10 || whisperQueueSize >= 3) {
            await new Promise<void>((resolve) => {
                if (decoder.decodeQueueSize > 10) {
                    decoder.addEventListener(
                        'dequeue',
                        () => resolve(),
                        { once: true },
                    );
                } else {
                    whisperQueueWaiter = resolve;
                }
            });
        }

        // MediaBunny provides a helper to convert its Packet format to
        // the WebCodecs EncodedAudioChunk format
        decoder.decode(packet.toEncodedAudioChunk());

        // Progress: use packet timestamp relative to total duration
        if (duration > 0) {
            const progress = Math.min(packet.timestamp / duration, 1);
            postMain({ type: 'progress', event: { stage: 'decoding', progress } });
        }
    }

    // ── 8. Flush decoder and chunker ─────────────────────────────────────────
    await decoder.flush();
    decoder.close();
    chunker.flush();

    postMain({ type: 'progress', event: { stage: 'decoding', progress: 1 } });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postMain(msg: MainThreadMessage): void {
    (self as unknown as Worker).postMessage(msg);
}
