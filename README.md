# browser-whisper

[![npm version](https://img.shields.io/npm/v/browser-whisper)](https://www.npmjs.com/package/browser-whisper)
[![license](https://img.shields.io/npm/l/browser-whisper)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/browser-whisper)](https://bundlephobia.com/package/browser-whisper)

> Browser-native audio transcription powered by WebCodecs + WebGPU. No server. No API keys.

`browser-whisper` runs OpenAI's Whisper model entirely in the browser. It uses **WebCodecs** to decode audio from any file format with hardware acceleration, and **WebGPU** to run ONNX inference — falling back to WASM automatically when either is unavailable.

**[Live Demo →](https://whisper.tanpreet.xyz)** · **[Vite example →](https://github.com/tanpreetjolly/browser-whisper-vite-demo)** · **[Next.js example →](https://github.com/tanpreetjolly/browser-whisper-nextjs-demo)**

---

## Features

- **WebGPU inference** — runs ONNX Whisper models on the GPU via `@huggingface/transformers`; falls back to WASM automatically
- **WebCodecs audio decoding** — hardware-accelerated decode of any audio/video format via `mediabunny`; falls back to `AudioContext` on older browsers
- **Concurrent pipeline** — model loading and audio decoding run in parallel across two Web Workers
- **Zero-copy PCM transfer** — audio frames move from the decoder worker to the inference worker via `MessageChannel` with `ArrayBuffer` transfer, no copying
- **Streaming API** — results are yielded as an async iterator, segment by segment
- **Model caching** — weights are cached in the browser Cache API after the first download
- **TypeScript-first** — full type definitions included

---

## How it works

```
File
 │
 ▼
[Decoder Worker]
  mediabunny (demux) → WebCodecs AudioDecoder → mono 16 kHz PCM → 30 s chunks
         │                        (fallback: AudioContext.decodeAudioData)
         │  MessageChannel (zero-copy ArrayBuffer transfer)
         ▼
[Whisper Worker]
  @huggingface/transformers → ONNX Runtime → WebGPU  ──► TranscriptSegments
                                                (fallback: WASM)
         │
         ▼
    Main Thread (async iterator / callbacks)
```

Both workers are started concurrently: the Whisper worker begins downloading and compiling the model while the decoder worker demuxes and decodes the audio file. Chunks queued before the model is ready are buffered and processed in order.

---

## Install

```bash
npm install browser-whisper
# or
bun add browser-whisper
```

> **Peer dependencies:** none. `@huggingface/transformers` and `mediabunny` are bundled into the library's worker blobs at build time and resolved automatically at runtime.

---

## Setup

The ONNX inference engine uses `SharedArrayBuffer` for threading, which requires two HTTP headers on every page that loads the library:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

### Vite

```ts
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
```

### Next.js

See [NEXTJS.md](./NEXTJS.md) for the full guide, including SSR-safe dynamic imports and header configuration.

---

## Quick start

```ts
import { BrowserWhisper } from 'browser-whisper'

const whisper = new BrowserWhisper()

// file from <input type="file"> or drag-and-drop
const file = event.target.files[0]

// Stream segments as they arrive
for await (const segment of whisper.transcribe(file)) {
  console.log(`[${segment.start.toFixed(1)}s] ${segment.text}`)
}
```

### Collect all segments at once

```ts
const segments = await whisper.transcribe(file).collect()
console.log(segments.map(s => s.text).join(' '))
```

### With callbacks and options

```ts
const whisper = new BrowserWhisper({
  model: 'whisper-small',
  language: 'en',
})

whisper.transcribe(file, {
  onSegment: (seg) => appendToUI(seg),
  onProgress: (evt) => {
    console.log(evt.stage)    // 'loading' | 'decoding' | 'transcribing'
    console.log(evt.progress) // 0 – 1
  },
})
```

---

## API

### `new BrowserWhisper(options?)`

Creates a reusable transcriber instance. The loaded model is cached in the worker between calls.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `WhisperModel` | `'whisper-base'` | Which Whisper model to use |
| `language` | `string` | auto-detect | BCP-47 language code, e.g. `'en'`, `'fr'`, `'ja'` |
| `quantization` | `QuantizationType` | `'hybrid'` | Model precision |

### `whisper.transcribe(file, options?)`

Returns a `TranscribeStream`. Options passed here override constructor options for this call only.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `WhisperModel` | Override model for this file |
| `language` | `string` | Override language for this file |
| `quantization` | `QuantizationType` | Override quantization for this file |
| `onSegment` | `(seg: TranscriptSegment) => void` | Called for each transcribed segment |
| `onProgress` | `(evt: TranscribeProgress) => void` | Called with stage and 0–1 progress |

### `TranscribeStream`

Returned by `whisper.transcribe()`. Implements the async iterator protocol and has one helper:

```ts
const segments = await stream.collect() // resolves with TranscriptSegment[]
```

### `WhisperModel`

Sizes below are for the default `'hybrid'` quantization (encoder fp32 + decoder q4).

| Value | Download size | Notes |
|-------|--------------|-------|
| `'whisper-tiny'` | ~64 MB | Fastest |
| `'whisper-base'` | ~136 MB | **Default** |
| `'whisper-small'` | ~510 MB | Better accuracy |
| `'whisper-large'` | ~3 GB | `whisper-large-v3-turbo`; best accuracy |

Other quantizations will differ. Models are downloaded from Hugging Face Hub (`onnx-community` namespace) and cached in the browser after the first run.

### `QuantizationType`

| Value | Description |
|-------|-------------|
| `'hybrid'` | Encoder fp32 + decoder q4 — **default**, best speed/accuracy balance |
| `'fp32'` | Full precision |
| `'fp16'` | Half precision |
| `'q8'` | 8-bit quantized |
| `'q4'` | 4-bit quantized |

### `TranscriptSegment`

```ts
interface TranscriptSegment {
  text: string
  start: number  // seconds from start of file
  end: number    // seconds from start of file
}
```

### `TranscribeProgress`

```ts
interface TranscribeProgress {
  stage: 'loading' | 'decoding' | 'transcribing'
  progress: number  // 0 – 1
}
```

### Errors

All errors extend `BrowserWhisperError`.

| Class | When thrown |
|-------|-------------|
| `WebCodecsNotSupportedError` | `AudioDecoder` is unavailable and the AudioContext fallback also fails |
| `CodecNotSupportedError` | The file's audio codec is not decodable in this browser |
| `NoAudioTrackError` | The file has no audio track |
| `ModelLoadError` | The Whisper model failed to download or initialise |
| `DecoderError` | The WebCodecs AudioDecoder emitted a fatal error |

---

## Browser support

WebGPU and WebCodecs are the primary paths. Both have automatic fallbacks so the library works on a broader range of browsers.

| Browser | WebGPU inference | WASM inference fallback |
|---------|-----------------|-------------------------|
| Chrome  | 113+            | 94+ |
| Firefox | 141+            | 130+ |
| Safari  | 18+             | 16.4+ |

| Browser | WebCodecs decoding | AudioContext fallback |
|---------|-------------------|----------------------|
| Chrome  | 94+               | all |
| Firefox | 130+              | all |
| Safari  | 16.4+             | all |

The library detects both features at runtime and falls back silently — no configuration needed.

> **Network required on first run:** WASM binaries (~1 MB) are loaded from jsDelivr CDN, and model weights (64 MB – 3 GB depending on model) are streamed from Hugging Face Hub. Both are cached in the browser after the first run; subsequent calls work offline.

---

## Contributing

Contributions are welcome. Please open an issue before submitting a large PR so we can discuss the approach.

```bash
# Install dependencies
bun install

# Start dev server (runs the demo app)
bun run dev:site

# Type-check
bun run typecheck

# Build the library
bun run build
```

The library is built with Vite. Workers are bundled as self-contained inline blobs using the `?worker&inline` query — see `vite.config.ts` for details.

---

## License

[MIT](./LICENSE) — Tanpreet Singh Jolly
