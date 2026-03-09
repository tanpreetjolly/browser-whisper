# browser-whisper

> Browser-native audio transcription powered by WebCodecs + Whisper

`browser-whisper` is a lightweight, hardware-accelerated library that transcribes
audio and video files entirely inside the browser using WebCodecs and WebGPU. 
No backend. No Python. No cloud API keys.

It acts as a clean, unified bridge over two underlying libraries:
- `@huggingface/transformers` for WebGPU neural network inference
- `mediabunny` for native WebCodecs audio extraction and decoding

By automatically orchestrating Web Workers, maintaining inference queues, and 
handling memory-safe decoding, `browser-whisper` lets you drop OpenAI's Whisper 
model into any frontend application in just three lines of code.

**[Try the Live Demo](https://whisper.tanpreet.xyz)**

---

## Install

```bash
npm install browser-whisper
# or
bun add browser-whisper
```

---

## Quick start

```ts
import { BrowserWhisper } from 'browser-whisper'

// 1. Initialize with your desired configuration
const whisper = new BrowserWhisper({
  model: 'whisper-base', // Optional: defaults to whisper-base
  language: 'en'         // Optional: defaults to auto-detect
});

const file = /* File from <input> or drag-and-drop */

// 2. Stream segments as they arrive
for await (const segment of whisper.transcribe(file)) {
  console.log(`[${segment.start.toFixed(1)}s] ${segment.text}`)
}
```

### Collect all segments at once

```ts
const segments = await whisper.transcribe(file).collect()
console.log(segments.map(s => s.text).join(' '))
```

### With callbacks

```ts
whisper.transcribe(file, {
  model: 'whisper-small',
  language: 'en',
  onSegment: (seg) => appendToUI(seg),
  onProgress: (evt) => setProgress(evt.progress),
})
```

---

## API

### `new BrowserWhisper()`

Creates a transcriber instance. Reusable across multiple files.

### `whisper.transcribe(file, options?)`

Returns a `TranscribeStream` that is both **async-iterable** and has a
`.collect()` helper.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `WhisperModel` | `'whisper-base'` | Model size |
| `language` | `string` | auto | BCP-47 language code |
| `onSegment` | `(seg) => void` | — | Segment callback |
| `onProgress` | `(evt) => void` | — | Progress callback |

### Initialization Options

When instantiating `new BrowserWhisper(options)`, you can configure:

*   `model`: The Whisper model to use.
    *   `whisper-tiny` (~30 MB download)
    *   `whisper-base` (~55 MB download) - **Default**
    *   `whisper-small` (~175 MB download)
*   `language`: BCP-47 language code to force (e.g. `en`, `fr`). Defaults to auto-detect.

_Note: You can override these options on a per-file basis by passing them as the second argument to `whisper.transcribe(file, { model: 'whisper-tiny' })`._

### `WhisperModel`

`'whisper-tiny' | 'whisper-base' | 'whisper-small' | 'whisper-large' | 'distil-whisper/distil-small.en' | 'distil-whisper/distil-medium.en'`

### `TranscriptSegment`

```ts
{ text: string; start: number; end: number }
```

---

## Browser support

| Browser | WebGPU path | WASM fallback |
|---------|-------------|---------------|
| Chrome  | 113+        | 94+           |
| Firefox | 141+        | 130+          |
| Safari  | 18+         | 16.4+         |

> **Note:** Your server must send `Cross-Origin-Embedder-Policy: require-corp`
> and `Cross-Origin-Opener-Policy: same-origin` headers for
> `SharedArrayBuffer` to be available (required by transformers.js threads).



---

## License

MIT
