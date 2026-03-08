# browser-whisper

> Browser-native audio transcription powered by WebCodecs + Whisper

`browser-whisper` is a zero-dependency\* TypeScript library that transcribes
audio and video files entirely inside the browser — no server required.

It uses:
- **[MediaBunny](https://github.com/nicholasgasior/mediabunny)** — fast WASM demuxer to unpack audio from any container (MP3, MP4, WebM, WAV …)
- **WebCodecs AudioDecoder** — GPU-accelerated decoding
- **[transformers.js](https://huggingface.co/docs/transformers.js)** — Whisper inference in WebGPU or WASM
- **Hybrid Quantization** — 4-bit decoder makes models 60% smaller with negligible accuracy loss

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

## 🚢 Publishing to NPM

When you are ready to publish your library for others to use:

1.  **Update Version:** Ensure the `version` field in `package.json` is correct (e.g. `1.0.0`).
2.  **Build:** Run the production build command:
    ```bash
    bun run build
    ```
    This generates the `dist/` folder containing the compiled `index.js`, worker chunks, and type definitions.
3.  **Login to NPM:** If you haven't already, log into your NPM account:
    ```bash
    npm login
    ```
4.  **Publish:** Publish the package to the public NPM registry:
    ```bash
    npm publish --access public
    ```
    _(Note: `bun publish` works as well if you are using Bun's package manager)._

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
