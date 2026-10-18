# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates are npm publish dates in **IST (UTC+5:30)**, taken from the npm registry. Each entry lists only changes traced to commits, pull requests, or published npm tarballs. Commit SHAs are in parentheses. Several 0.x versions were published from working trees that were never committed with that version number. For those, the entry lists the commits made before the publish time, or the differences seen between the published tarballs, and says so.

## [Unreleased]

## [2.0.0] - 2026-10-18

### Breaking changes
- **`whisper-large-v3` removed** from `ASRModel` (#29, 5640636). Its fp32 encoder is a single 2.55 GB `encoder_model.onnx_data` file that browsers can't allocate in one ArrayBuffer (`RangeError: Array buffer allocation failed`), so it never loaded. Code passing `model: 'whisper-large-v3'` no longer type-checks, and plain JS callers get a load error. Use `whisper-large-v3-turbo`, ideally with `quantization: 'q4'` or `'fp16'`. The internal `ModelConfig.externalData` override it used (#27) is gone too.
- **`ModelConfig` has new required fields** (#32 6f4528f, #36 via #37 6e3d989):
  - `engine` (`EngineId`), `capabilities` (`ModelCapabilities`) and `engineConfig` are now required.
  - This only breaks code that **constructs** `ModelConfig` objects itself. Reading `MODELS` is unaffected.
- **Deprecated, still present:** `ModelConfig.hfId`, `hybridDtype`, `supportsTimestamps`, `supportsWordTimestamps` and `supportsLanguage`. Use `capabilities.*` and `engineConfig` instead. They will be removed in a future major release. Cache ids are unchanged, so existing OPFS caches stay valid.

### Added
- **`parakeet-tdt-0.6b-v3`** (NVIDIA Parakeet TDT 0.6B v3, CC-BY-4.0), **WebGPU only** (#33, f5d5169).
  - 25 European languages (auto-detected), punctuation and word timestamps.
  - Runs on a new `parakeet` engine that loads [parakeet.js](https://github.com/ysdede/parakeet.js) from a pinned CDN URL on demand, so it is never bundled.
  - Defaults to the fp16 encoder, which needs the `shader-f16` adapter feature. Use `quantization: 'q8'` on GPUs without it.
- **Pluggable ASR engine layer** (#32, #36).
  - Each model names an engine, and engines load lazily via dynamic `import()`, WebGPU first with WASM fallback.
  - Engines get an engine-neutral contract: words/segments output, per-file progress, an AbortSignal, and WebGPU adapter features passed in.
  - See CONTRIBUTING.md for adding an engine.
- New exported types `ModelCapabilities` and `EngineId`.
- An unsupported `quantization` for a model's engine (e.g. `q4` on Parakeet TDT) is rejected with a clear `ModelLoadError` before anything downloads.
- A console warning when `language` is passed to a model that ignores it.
- **Generated model lists** (#35 via #37): the demo/example pickers, the docs/home model tables and the credits blocks are generated from `MODELS` plus `site/model-meta.ts` at site-build time. A drift test keeps the README table in sync.
- **`THIRD_PARTY_NOTICES.md`**, shipped in the npm package: licenses, copyright lines and full texts for bundled code, CDN-loaded runtimes and every model's weights. Visible model credits with the CC BY 4.0 attribution appear on the demo, examples, docs and home pages, and the README has a Credits section.
- **CI:** a GitHub Actions workflow runs typecheck, test, build, a bundle-size budget (`bun run size`) and build:site on PRs and on pushes to main. There are also worker contract tests with fake engines and engine import-isolation tests.

### Fixed
- **`cancel()` on a reused instance.** A `transcribe()` started after `cancel()` on the same `BrowserWhisper` instance no longer receives leftover segments, or an early `done`, from the cancelled run ([#34](https://github.com/tanpreetjolly/browser-whisper/issues/34)). Runs now carry ids, and cancelling drops the worker's queued chunks and discards in-flight results.
- **Load stuck at 99%.** Model-load failures that escaped transformers.js' internal promises (e.g. `Array buffer allocation failed`) no longer leave loading stuck at 99%. They now reject with a `ModelLoadError` (#28, 034799e).
- **OPFS cache writes are best-effort.** A failed write logs a warning, removes the partial file, and loading continues from the network (#28).

### Changed
- The worker file is renamed from `whisper-worker.ts` to `asr-worker.ts`, with its logic in a testable `asr-core.ts`. Worker error messages say "ASR worker".
- More tests for model families and configuration invariants (#24, #30).
- New trademark policy for the browser-whisper name (#26).

### Changed
- README and the docs API reference now document `TranscribeStream.cancel()`, `TranscribePCMStream.cancel()`, and `BrowserWhisper.dispose()` (#19).

## [1.2.0] - 2026-10-11

### Added
- `parakeet-ctc-0.6b` model (#22, `onnx-community/parakeet-ctc-0.6b-ONNX`, q8 by default, ~612 MB): NVIDIA Parakeet CTC, English only, text without timestamps. Requires the transformers.js 4.x upgrade.

### Changed
- Upgraded transformers.js to 4.3.1 (#21). `dist/index.js` shrinks from ~1.96 MB to ~1.32 MB; the ONNX Runtime WASM files are now loaded from jsDelivr and cached in OPFS.

### Fixed
- Segment and word end times no longer run past the end of the audio. The final chunk is zero-padded to 30 s, so Parakeet CTC reported an 11 s file as one 0–30 s segment and Whisper word timestamps could land in the padded tail (e.g. 10.56–15.9 s on an 11 s clip). Chunks now carry their real duration and all segment/word ends are clamped to `min(chunkEnd, audio end)`, keeping `start <= end` (#22, #23).

## [1.1.1] - 2026-10-11

### Fixed
- Without a WebGPU adapter, the worker now goes straight to WASM instead of failing: it checks `navigator.gpu.requestAdapter()` before creating a WebGPU session, because a failed WebGPU session made the WASM fallback in the same worker fail too (#9).
- `@vercel/analytics` moved from dependencies to devDependencies, so installs no longer pull it in; only the demo site uses it (#7).
- Demo-site files (favicon, OG image, robots.txt, sitemap.xml) are no longer shipped in the npm package (#8).

### Changed
- Demo shows "Initializing model" after the download instead of sitting at "Downloading model… 99%" (#10).
- README: default model corrected to `whisper-tiny`, whisper-tiny size corrected to ~120 MB, broken types link fixed (#6). Full changelog history added (#5).

### Added
- GitHub Actions workflow that publishes to npm with provenance when a GitHub release is published.

## [1.1.0] - 2026-05-31

### Added
- Word-level timestamps for `*_timestamped` models (`whisper-tiny_timestamped`, `whisper-base_timestamped`, `whisper-small_timestamped`, `whisper-large-v3-turbo_timestamped`). `TranscriptSegment.words` is filled with `{ text, start, end }`, with times in seconds from the start of the file. Words are grouped into segments that break at sentence ends, at gaps longer than 1.2 s, or after 14 words (17a60c6).
- `supportsWordTimestamps` field on `ModelConfig` / `MODELS` entries (17a60c6).
- Unit tests for word segmentation (17a60c6).
- Site: documentation at `/docs/`, examples hub at `/examples/` with live VAD and MP3/OPFS-cache demos, a full model selector in the demo, and per-word highlighting during playback (4b1b4b9, 0c7cef9, 2ac9cc5, 08f9b1f, 9ce1c33, 997228d).

### Changed
- `WordTimestamp` and `TranscriptSegment.words` are no longer marked `@experimental` (17a60c6).
- The exported `ModelConfig` type now requires `supportsWordTimestamps: boolean` (17a60c6).
- README rewritten (758b117).
- Site: robots meta tag and sitemap update, notice styling, pinned Vercel site build (5cca0aa, 6909cf1, 96d4613).

## [1.0.2] - 2026-05-16

### Added
- OPFS-backed model cache. Legacy Cache API entries are moved into OPFS on first access. Contributed by @sohzm in #4 (4a1db26).
- `BrowserWhisper#transcribePCM(samples)` for mono 16 kHz `Float32Array` input, and the `TranscribePCMStream` export (#4, 4a1db26).
- `BrowserWhisper#downloadModel()` with progress and `AbortSignal` cancellation, plus the `DownloadModelOptions` type (#4, 4a1db26, cc392e0).
- `BrowserWhisper.clearCache()` and `BrowserWhisper.deleteModel(model)` (#4, cc392e0).
- Models: `whisper-tiny_timestamped`, `whisper-base_timestamped`, `whisper-small_timestamped`, `whisper-large-v3-turbo`, `whisper-large-v3-turbo_timestamped`, `whisper-large-v3`, `lite-whisper-large-v3-turbo-fast`, `lite-whisper-large-v3-turbo`, `lite-whisper-large-v3-turbo-acc` (#4, 4a1db26). In this version, word-level output for the `_timestamped` models was not produced yet; it arrived in 1.1.0.
- Examples: live microphone + VAD, and MP3 transcription with the OPFS cache (#4).

## [1.0.1] - 2026-04-15

### Added
- Runtime dependency `@vercel/analytics@^2.0.1`, via #3 (Vercel bot) (6df10fb). It is used only by the demo site; the published `dist/` does not reference it.

### Changed
- `ModelLoadError` message changed from "Failed to load Whisper model …" to "Failed to load model …" (cacba7e).
- Docs: Next.js and Vite integration guides; models and language table on the site (cacba7e, 14d8678, d0b6c3c).

### Fixed
- Model download progress now tracks the Transformers.js `initiate` and `progress` events, where it used to look only for `download` (cacba7e).
- Site: SEO headers (2f69f89).

## [1.0.0] - 2026-03-17

### Added
- Moonshine models (`moonshine-tiny`, `moonshine-base`) and Distil-Whisper (`distil-whisper-small`), from #2 (fbd34db).
- `MODELS` and `ModelConfig` exported from the package entry (#2, 14fad77).

### Changed
- Model type renamed from `WhisperModel` to `ASRModel`. `WhisperModel` is kept as a deprecated alias (#2, 14fad77).
- `MODEL_IDS` replaced by the `MODELS` config record (#2).
- Default model changed from `whisper-base` to `whisper-tiny` (#2).

### Removed
- `whisper-large` model key (#2).

### Fixed
- `token_ids must be a non-empty array of integers` error during transcription. Models without timestamp support (Moonshine) no longer get timestamp/chunking options (#2). Fixes #1, reported by @isha-sharad.

## [0.8.1] - 2026-03-14

### Changed
- README: expanded feature descriptions, setup instructions, and `BrowserWhisper` API usage (2c6ec02, d962972).
- Package keywords refined (02eb6f8).

## [0.8.0] - 2026-03-14

### Changed
- Workers are bundled again as self-contained inline blobs (`?worker&inline`), with dependencies inlined and WASM binaries excluded (25baebc). Unpacked package size went from about 84 KB in 0.7.0 back to about 2.0 MB (npm registry).

## [0.7.0] - 2026-03-14

### Changed
- Workers are created with the standard `new Worker(new URL(...))` pattern and built as separate ES modules; the onnxruntime-web CDN path was updated (b080a43, 98bcf32). Unpacked package size dropped to about 84 KB (npm registry). The repository never had a commit with version 0.7.0 before this publish, so these are the commits made before the publish time.

## [0.6.0] - 2026-03-12

### Changed
- No code changes found. The published tarball is identical to 0.5.0 except for the version number (compared npm tarballs). There is no matching commit.

## [0.5.0] - 2026-03-12

### Changed
- The MIME type of the inline worker Blob changed from `text/javascript;charset=utf-8` to `application/javascript` (seen by comparing the 0.4.0 and 0.5.0 tarballs; there is no matching commit).

## [0.4.0] - 2026-03-12

### Fixed
- WASM assets are no longer inlined by Vite. `.wasm` imports are aliased and CDN paths for `onnxruntime-web` are set explicitly (9a3d57d, 374b781).

## [0.3.0] - 2026-03-12

### Changed
- Worker imports switched from local packages to CDN URLs (c878479).

## [0.2.0] - 2026-03-12

### Changed
- Web workers are imported with Vite's `?worker&inline` syntax, and the worker bundle is smaller (7f4e88d, f5fdf38). Unpacked package size went from about 59.6 MB in 0.1.0 to about 77 KB (npm registry).

## [0.1.0] - 2026-03-11

### Added
- First npm release: in-browser transcription of audio and video files with a decoder worker (mediabunny + WebCodecs → 16 kHz mono chunks) and a Whisper worker (Transformers.js), using the models `whisper-tiny`, `whisper-base`, `whisper-small`, and `whisper-large` (mapped to `whisper-large-v3-turbo`).
- Falls back from WebGPU to WASM when loading the pipeline; progress reporting for model download (94d25cd).
- `AudioContext` decoding fallback, quantization options, and out-of-memory fixes (b586956).
- Progress stages for loading, decoding, and transcribing (8a2bb8c).
- Type declarations emitted in the build (6ae913b).

[Unreleased]: https://github.com/tanpreetjolly/browser-whisper/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/tanpreetjolly/browser-whisper/releases/tag/v2.0.0
[1.2.0]: https://github.com/tanpreetjolly/browser-whisper/releases/tag/v1.2.0
[1.1.1]: https://github.com/tanpreetjolly/browser-whisper/releases/tag/v1.1.1
[1.1.0]: https://www.npmjs.com/package/browser-whisper/v/1.1.0
[1.0.2]: https://www.npmjs.com/package/browser-whisper/v/1.0.2
[1.0.1]: https://www.npmjs.com/package/browser-whisper/v/1.0.1
[1.0.0]: https://www.npmjs.com/package/browser-whisper/v/1.0.0
[0.8.1]: https://www.npmjs.com/package/browser-whisper/v/0.8.1
[0.8.0]: https://www.npmjs.com/package/browser-whisper/v/0.8.0
[0.7.0]: https://www.npmjs.com/package/browser-whisper/v/0.7.0
[0.6.0]: https://www.npmjs.com/package/browser-whisper/v/0.6.0
[0.5.0]: https://www.npmjs.com/package/browser-whisper/v/0.5.0
[0.4.0]: https://www.npmjs.com/package/browser-whisper/v/0.4.0
[0.3.0]: https://www.npmjs.com/package/browser-whisper/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/browser-whisper/v/0.2.0
[0.1.0]: https://www.npmjs.com/package/browser-whisper/v/0.1.0
