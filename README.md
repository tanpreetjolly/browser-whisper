![browser-whisper — in-browser speech-to-text with WebGPU](https://whisper.tanpreet.xyz/og-image.png)

# browser-whisper

**Speech-to-text in the browser with WebGPU: Whisper, Moonshine and Parakeet.** Fully local: no backend, no API keys, audio never leaves the device.

[Live demo](https://whisper.tanpreet.xyz/demo/) · [Documentation](https://whisper.tanpreet.xyz/docs/) · [Examples](https://whisper.tanpreet.xyz/examples/) · [GitHub](https://github.com/tanpreetjolly/browser-whisper)

[![npm version](https://img.shields.io/npm/v/browser-whisper.svg?style=flat-square)](https://www.npmjs.com/package/browser-whisper)
[![license](https://img.shields.io/npm/l/browser-whisper.svg?style=flat-square)](https://github.com/tanpreetjolly/browser-whisper/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/browser-whisper?style=flat-square)](https://bundlephobia.com/package/browser-whisper)

[Changelog](https://github.com/tanpreetjolly/browser-whisper/blob/main/CHANGELOG.md) · Example apps: [Vite](https://github.com/tanpreetjolly/browser-whisper-vite-demo) · [Next.js](https://github.com/tanpreetjolly/browser-whisper-nextjs-demo)

## How it works

```
Your file → Decoder worker (WebCodecs + mediabunny → 16 kHz mono chunks)
          → ASR worker (Transformers.js or parakeet.js, WebGPU with WASM fallback)
          → Main thread (async iterator / callbacks)
```

Decoding and model loading run in parallel, and chunks queue until the model is ready. `AudioContext` covers browsers without WebCodecs. Model weights are cached in OPFS, so later runs can work offline.

## Install

```bash
npm install browser-whisper   # or: bun add browser-whisper
```

No peer dependencies.

## Quick start

```ts
import { BrowserWhisper } from 'browser-whisper'

const whisper = new BrowserWhisper({ model: 'whisper-base', language: 'en' }) // language optional
const file = document.querySelector('input[type=file]').files[0]

for await (const { text, start, end } of whisper.transcribe(file)) {
  console.log(`[${start.toFixed(1)}s – ${end.toFixed(1)}s] ${text}`)
}

const segments = await whisper.transcribe(file).collect()   // all at once
const fromVad = await whisper.transcribePCM(samples).collect() // mono 16 kHz Float32Array
```

## COOP / COEP headers

Threaded WASM needs cross-origin isolation on the page that loads the library:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

In Vite, set them on `server` and `preview`. In Next.js, set them in `next.config` and import the library on the client only. See the [setup guide](https://whisper.tanpreet.xyz/docs/#headers).

## Common patterns

```ts
whisper.transcribe(file, {
  onSegment: (seg) => renderLine(seg),
  onProgress: ({ stage, progress }) => updateBar(progress), // stage: 'loading' | 'decoding' | 'transcribing'
})

const stream = whisper.transcribe(file)
cancelButton.onclick = () => stream.cancel()
```

`cancel()` ends the stream. You can reuse the instance straight away: the next transcription starts once the in-flight chunk finishes, and the loaded model is reused. Call `whisper.dispose()` when you're done with the instance to terminate its worker.

To pre-download a model, or clear cached weights, see the [API docs](https://whisper.tanpreet.xyz/docs/#api) (`downloadModel`, `clearCache`, `deleteModel`).

## Models

The default is `whisper-tiny`. Weights come from Hugging Face and are cached in the browser after first use.

| Model | Download | Notes |
|-------|----------|-------|
| `whisper-tiny` | ~120 MB | Default, fastest |
| `whisper-base` | ~206 MB | |
| `whisper-small` | ~586 MB | |
| `whisper-large-v3-turbo` | ~2.9 GB | Large download; may exceed browser memory limits |
| `whisper-{tiny,base,small,large-v3-turbo}_timestamped` | as base model | Word-level timestamps |
| `lite-whisper-large-v3-turbo-fast` / `lite-whisper-large-v3-turbo` / `lite-whisper-large-v3-turbo-acc` | ~1.6–2.0 GB | Smaller large-v3-turbo variants |
| `moonshine-tiny` / `moonshine-base` | ~55–98 MB | English only |
| `distil-whisper-small` | ~538 MB | English only |
| `parakeet-ctc-0.6b` | ~612 MB | English only; lowercase text, no timestamps |
| `parakeet-tdt-0.6b-v3` | ~1.26 GB | WebGPU only; 25 languages, punctuation, word timestamps |

**Parakeet TDT v3** requires WebGPU. Its default fp16 encoder needs the `shader-f16` adapter feature; on GPUs without it, pass `quantization: 'q8'`. The language is auto-detected, so `language` is ignored. Its runtime ([parakeet.js](https://github.com/ysdede/parakeet.js)) is fetched only when you pick this model.

Sizes, quantization and per-model details are in the [docs](https://whisper.tanpreet.xyz/docs/#models).

## Browser support

| | Chrome | Firefox | Safari |
|---|--------|---------|--------|
| WebGPU | 113+ | 141+ | 18+ |
| WebCodecs | 94+ | 130+ | 16.4+ |

Missing features fall back automatically (WASM, `AudioContext`). The first run needs network access for WASM (~1 MB) and model weights.

## Development

```bash
git clone https://github.com/tanpreetjolly/browser-whisper.git && cd browser-whisper
bun install
bun run dev:site      # demo + docs
bun run typecheck && bun test && bun run build
```

Issues and PRs are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](https://github.com/tanpreetjolly/browser-whisper/blob/main/LICENSE) © [Tanpreet Singh Jolly](https://github.com/tanpreetjolly)

The MIT License covers the code, not the **browser-whisper** name or logo. Forks and derivatives must keep the copyright notice and use a different name. See [TRADEMARK.md](https://github.com/tanpreetjolly/browser-whisper/blob/main/TRADEMARK.md).

## Credits

Runtimes: [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0), [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), [Mediabunny](https://github.com/vanilagy/mediabunny) (MPL-2.0), [parakeet.js](https://github.com/ysdede/parakeet.js) (MIT).

[Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) and [Parakeet CTC 0.6B](https://huggingface.co/nvidia/parakeet-ctc-0.6b) by **NVIDIA**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). **Changes:** converted to ONNX and quantized by [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) and [ysdede](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx) (TDT, including the fp16 export) and [onnx-community](https://huggingface.co/onnx-community/parakeet-ctc-0.6b-ONNX) (CTC).

Credits for the other models (Whisper, Moonshine, Distil-Whisper, Lite-Whisper), with copyright lines and license texts, are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
