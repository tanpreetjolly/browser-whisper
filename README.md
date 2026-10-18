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

### Cancel and dispose

```ts
const stream = whisper.transcribe(file)

cancelButton.addEventListener('click', () => stream.cancel())

for await (const { text } of stream) {
  console.log(text)
}

whisper.dispose()
```

`stream.cancel()` is on both `TranscribeStream` and `TranscribePCMStream`. It stops the in-progress transcription and ends the iterator. After `cancel()`, you can start another transcription on the same instance. It begins once the chunk currently being transcribed finishes (that result is discarded), and the loaded model is reused. `whisper.dispose()` terminates the ASR worker; call it when the instance will not be used again, such as when a component unmounts.

---

## Models

Default: **`whisper-tiny`**. Hybrid quantization (encoder fp32 + decoder q4). Weights from Hugging Face (`onnx-community`), cached in the browser after first use.

| Model | Download (approx.) | Notes |
|-------|-------------------|--------|
| `whisper-tiny` | ~120 MB | Fastest, default |
| `whisper-base` | ~206 MB | |
| `whisper-small` | ~586 MB | Better accuracy |
| `whisper-large-v3-turbo` | ~2.9 GB | Strongest Whisper option |
| `whisper-{tiny,base,small,large-v3-turbo}_timestamped` | same as base model | Word-level timestamps |
| `lite-whisper-large-v3-turbo-fast` / `lite-whisper-large-v3-turbo` / `lite-whisper-large-v3-turbo-acc` | ~1.6–2.0 GB | Smaller Large V3 Turbo variants |
| `moonshine-tiny` / `moonshine-base` | ~55–98 MB | English only |
| `distil-whisper-small` | ~538 MB | English only |
| `parakeet-ctc-0.6b` | ~612 MB | English only · NVIDIA Parakeet CTC · lowercase, no punctuation, no timestamps |
| `parakeet-tdt-0.6b-v3` | ~1.26 GB | **WebGPU only** · NVIDIA Parakeet TDT v3 (CC-BY-4.0) · 25 European languages (auto-detected) · punctuation + word timestamps · fp16 needs `shader-f16`, otherwise pass `quantization: 'q8'` |

### Parakeet TDT v3

`parakeet-tdt-0.6b-v3` runs on a separate engine built on [parakeet.js](https://github.com/ysdede/parakeet.js) (MIT). It needs **WebGPU**: without a WebGPU adapter the model fails to load with a clear error and nothing is downloaded. parakeet.js and its ONNX Runtime are fetched from a pinned jsDelivr URL only when you pick this model, so other models' bundles are unchanged. By default it downloads an fp16 encoder (~1.24 GB) plus an int8 decoder (~18 MB). `quantization: 'fp32'` downloads 2.4 GB of external weights and may fail with `Array buffer allocation failed`. `language` is ignored because the model auto-detects it.

Model: [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) by NVIDIA, licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). ONNX conversion: [istupakov/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx), with the fp16 export from [ysdede/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx).


Timestamped, lite, and large-v3-turbo variants are supported too. Full list: [docs — Models](https://whisper.tanpreet.xyz/docs/#models).

---

## How it works

```
Your file
  → Decoder worker (mediabunny + WebCodecs → 16 kHz mono chunks)
    → ASR worker (engine: Transformers.js or parakeet.js, WebGPU first)
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
| [Changelog](https://github.com/tanpreetjolly/browser-whisper/blob/main/CHANGELOG.md) | Release history |

API types (`TranscriptSegment`, errors, `QuantizationType`, …): [docs — API](https://whisper.tanpreet.xyz/docs/#api) or [`dist/index.d.ts`](https://unpkg.com/browser-whisper/dist/index.d.ts) after install.

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

The MIT License covers the code, not the **browser-whisper** name or logo. Forks and derivatives must keep the copyright notice and use a different name. See [TRADEMARK.md](https://github.com/tanpreetjolly/browser-whisper/blob/main/TRADEMARK.md).

## Credits

- Runtimes: [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0), [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), [Mediabunny](https://github.com/vanilagy/mediabunny) (MPL-2.0, bundled unmodified), [parakeet.js](https://github.com/ysdede/parakeet.js) (MIT, loaded on demand).
- Models (downloaded from Hugging Face, not redistributed):
  - [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) and [Parakeet CTC 0.6B](https://huggingface.co/nvidia/parakeet-ctc-0.6b) by **NVIDIA**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). **Changes:** converted to ONNX and quantized by [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) and [ysdede](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx) (TDT, including the fp16 export), and by [onnx-community](https://huggingface.co/onnx-community/parakeet-ctc-0.6b-ONNX) (CTC).
  - [Whisper](https://github.com/openai/whisper) by OpenAI (MIT), [Moonshine](https://github.com/moonshine-ai/moonshine) by Useful Sensors (MIT, English models), [Distil-Whisper](https://huggingface.co/distil-whisper/distil-small.en) by Hugging Face (MIT), [Lite-Whisper](https://huggingface.co/efficient-speech/lite-whisper-large-v3-turbo) by efficient-speech (Apache-2.0). ONNX conversions by [onnx-community](https://huggingface.co/onnx-community) / Xenova.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for copyright lines, license texts, and the terms we flagged as unclear.
