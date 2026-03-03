# browserwhisper

> Browser-native audio transcription powered by WebCodecs + Whisper

`browserwhisper` is a zero-dependency\* TypeScript library that transcribes
audio and video files entirely inside the browser — no server required.

It uses:
- **[MediaBunny](https://github.com/nicholasgasior/mediabunny)** — fast WASM demuxer to unpack audio from any container (MP3, MP4, WebM, WAV …)
- **WebCodecs AudioDecoder** — GPU-accelerated decoding
- **[transformers.js](https://huggingface.co/docs/transformers.js)** — Whisper inference in WebGPU or WASM

\*Peer dependencies: `@huggingface/transformers`, `mediabunny`

---

## Install

```bash
npm install browserwhisper @huggingface/transformers mediabunny
# or
bun add browserwhisper @huggingface/transformers mediabunny
```

---

## Quick start

```ts
import { Transcriber } from 'browserwhisper'

const transcriber = new Transcriber()
const file = /* File from <input> or drag-and-drop */

// Stream segments as they arrive
for await (const segment of transcriber.transcribe(file)) {
  console.log(`[${segment.start.toFixed(1)}s] ${segment.text}`)
}
```

### Collect all segments at once

```ts
const segments = await transcriber.transcribe(file).collect()
console.log(segments.map(s => s.text).join(' '))
```

### With callbacks

```ts
transcriber.transcribe(file, {
  model: 'whisper-small',
  language: 'en',
  onSegment: (seg) => appendToUI(seg),
  onProgress: (evt) => setProgress(evt.progress),
})
```

---

## API

### `new Transcriber()`

Creates a transcriber instance. Reusable across multiple files.

### `transcriber.transcribe(file, options?)`

Returns a `TranscribeStream` that is both **async-iterable** and has a
`.collect()` helper.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `WhisperModel` | `'whisper-base'` | Model size |
| `language` | `string` | auto | BCP-47 language code |
| `onSegment` | `(seg) => void` | — | Segment callback |
| `onProgress` | `(evt) => void` | — | Progress callback |

### `WhisperModel`

`'whisper-tiny' | 'whisper-base' | 'whisper-small' | 'whisper-large'`

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
| Safari  | 26+         | 16.4+         |

> **Note:** Your server must send `Cross-Origin-Embedder-Policy: require-corp`
> and `Cross-Origin-Opener-Policy: same-origin` headers for
> `SharedArrayBuffer` to be available (required by transformers.js threads).

---

## Development

```bash
bun install
bun dev        # dev server with demo at http://localhost:5173
bun run build  # type-check + Vite library build → dist/
bun test       # unit tests
```

---

## Architecture

```
main thread
  └─ Transcriber
       └─ Bridge
            ├─ DecoderWorker   (MediaBunny demux → WebCodecs decode → PCM chunks)
            │       │  MessageChannel (zero-copy ArrayBuffer transfers)
            └─ WhisperWorker   (transformers.js Whisper inference → segments)
```

1. **DecoderWorker** demuxes the file with MediaBunny, decodes with WebCodecs,
   downmixes to mono, resamples to 16 kHz, and streams 30-second PCM chunks
   directly to WhisperWorker via a `MessageChannel`.
2. **WhisperWorker** runs the Whisper pipeline on each chunk and posts
   `TranscriptSegment` objects back to the main thread.
3. The `Bridge` wires them together and exposes events; `Transcriber` wraps
   that in a clean async-iterable API.

---

## License

MIT
