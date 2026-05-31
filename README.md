![browser-whisper — in-browser speech-to-text with WebGPU](https://whisper.tanpreet.xyz/og-image.png)

# browser-whisper

**Transcribe audio and video in the browser with Whisper** — fully local, no backend, no API keys.

[Live demo](https://whisper.tanpreet.xyz/demo/) · [Documentation](https://whisper.tanpreet.xyz/docs/) · [Examples](https://whisper.tanpreet.xyz/examples/) · [GitHub](https://github.com/tanpreetjolly/browser-whisper)

[![npm version](https://img.shields.io/npm/v/browser-whisper.svg?style=flat-square)](https://www.npmjs.com/package/browser-whisper)
[![license](https://img.shields.io/npm/l/browser-whisper.svg?style=flat-square)](https://github.com/tanpreetjolly/browser-whisper/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/browser-whisper?style=flat-square)](https://bundlephobia.com/package/browser-whisper)

---

## What is this?

**browser-whisper** is a TypeScript library that turns files (or microphone audio) into text using [Whisper](https://github.com/openai/whisper), entirely in the user’s browser.

- **WebCodecs** decodes audio and video, with an `AudioContext` fallback when needed
- **WebGPU** runs the ONNX model on the GPU, with WASM fallback when WebGPU is unavailable
- **Two Web Workers** decode and transcribe in parallel so model load and file read overlap
- **OPFS caching** keeps model weights after the first download for faster or offline repeat use

Audio never leaves the device. You do not need an OpenAI API key.

---

## Install

```bash
npm install browser-whisper
```

```bash
bun add browser-whisper
```

No peer dependencies — `mediabunny` and `@huggingface/transformers` are used inside the library’s workers.

---

## Quick start

```ts
import { BrowserWhisper } from 'browser-whisper'

const whisper = new BrowserWhisper({ model: 'whisper-base' })
const file = document.querySelector('input[type=file]').files[0]

for await (const { text, start, end } of whisper.transcribe(file)) {
  console.log(`[${start.toFixed(1)}s – ${end.toFixed(1)}s] ${text}`)
}
```

Collect all segments:

```ts
const segments = await whisper.transcribe(file).collect()
```

Mono **16 kHz** `Float32Array` (e.g. from a VAD):

```ts
const segments = await whisper.transcribePCM(samples).collect()
```

---

## Before you ship: COOP / COEP headers

Threaded WASM needs cross-origin isolation on the page that loads the library:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

For **Vite**, set those on `server` and `preview`. For **Next.js**, set them in `next.config` and import the library only on the client.

Full setup (Vite, Next.js, deploy) is in the [documentation](https://whisper.tanpreet.xyz/docs/).

---

## Common patterns

### Model and language

```ts
const whisper = new BrowserWhisper({
  model: 'whisper-small',
  language: 'en', // optional — omit for auto-detect
})
```

Use a `*_timestamped` model (e.g. `whisper-base_timestamped`) for **word-level** timestamps. See the [live demo](https://whisper.tanpreet.xyz/demo/).

### Progress and segments

```ts
whisper.transcribe(file, {
  onSegment: (seg) => renderLine(seg),
  onProgress: ({ stage, progress }) => {
    // stage: 'loading' | 'decoding' | 'transcribing'
    updateBar(progress) // 0 – 1
  },
})
```

### Pre-download a model

```ts
await whisper.downloadModel({
  model: 'whisper-small',
  onProgress: ({ stage, progress }) => updateBar(progress),
})
```

Supports `AbortSignal`. Example: [OPFS cache demo](https://whisper.tanpreet.xyz/examples/mp3/).

### Clear cache

```ts
await BrowserWhisper.clearCache()
await BrowserWhisper.deleteModel('whisper-tiny')
```

---

## Models

Default: **`whisper-base`**. Hybrid quantization (encoder fp32 + decoder q4). Weights from Hugging Face (`onnx-community`), cached in the browser after first use.

| Model | Download (approx.) | Notes |
|-------|-------------------|--------|
| `whisper-tiny` | ~64 MB | Fastest |
| `whisper-base` | ~136 MB | Default |
| `whisper-small` | ~510 MB | Better accuracy |
| `whisper-large-v3-turbo` | ~2.7 GB | Strongest Whisper option |
| `moonshine-tiny` / `moonshine-base` | ~32–61 MB | English only |
| `distil-whisper-small` | ~185 MB | English only |

Timestamped, lite, and large-v3 variants are supported too. Full list: [docs — Models](https://whisper.tanpreet.xyz/docs/#models).

---

## How it works

```
Your file
  → Decoder worker (mediabunny + WebCodecs → 16 kHz mono chunks)
    → Whisper worker (Transformers.js + ONNX on WebGPU)
      → Main thread (async iterator / callbacks)
```

The decoder and model loader start together. Chunks that arrive before the model is ready are queued and processed in order.

---

## Browser support

| | Chrome | Firefox | Safari |
|---|--------|---------|--------|
| WebGPU | 113+ | 141+ | 18+ |
| WebCodecs | 94+ | 130+ | 16.4+ |

Missing features fall back automatically. **First run needs network** for WASM (~1 MB) and model weights; after caching, transcription can work offline.

---

## Links

| | |
|---|---|
| [Documentation](https://whisper.tanpreet.xyz/docs/) | Install, headers, API, all models |
| [Live demo](https://whisper.tanpreet.xyz/demo/) | Upload and transcribe in the browser |
| [Examples](https://whisper.tanpreet.xyz/examples/) | OPFS cache, live mic + VAD |
| [Vite example](https://github.com/tanpreetjolly/browser-whisper-vite-demo) | Minimal Vite app |
| [Next.js example](https://github.com/tanpreetjolly/browser-whisper-nextjs-demo) | App Router, client-only |

API types (`TranscriptSegment`, errors, `QuantizationType`, …): [docs — API](https://whisper.tanpreet.xyz/docs/#api) or [`dist/index.d.ts`](https://github.com/tanpreetjolly/browser-whisper/blob/main/dist/index.d.ts) after install.

---

## Development

```bash
git clone https://github.com/tanpreetjolly/browser-whisper.git
cd browser-whisper
bun install
bun run dev:site
bun run typecheck
bun run build
```

Issues and PRs welcome on [GitHub](https://github.com/tanpreetjolly/browser-whisper/issues).

---

## License

[MIT](https://github.com/tanpreetjolly/browser-whisper/blob/main/LICENSE) © [Tanpreet Singh Jolly](https://github.com/tanpreetjolly)
