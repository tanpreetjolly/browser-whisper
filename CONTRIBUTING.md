# Contributing to browser-whisper

Thanks for helping out! Bug reports, docs fixes, examples, and code are all welcome.

## Setup

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/tanpreetjolly/browser-whisper.git
cd browser-whisper
bun install
bun run dev:site   # landing page, docs, demo and examples at http://localhost:5173
```

## Checks

Run these before opening a PR:

```bash
bun run typecheck   # tsc --noEmit
bun test            # unit tests (src/tests)
bun run build       # library build + type declarations
bun run build:site  # site build (landing, docs, demo, examples)
```

## COOP/COEP

The library needs `SharedArrayBuffer`, so every page that loads it must be served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The Vite configs and `vercel.json` already set these. If you add a new page or example, make sure it does too.


## Adding an ASR engine

Engines live under `src/workers/engines/<id>/`. The shared worker (`src/workers/asr-core.ts`) validates the request, picks devices WebGPU-first, lazy-loads the runtime, and turns the engine's neutral result into clamped, file-relative segments. Decoding, chunking, the OPFS cache, progress, cancel/run ids, and fatal errors stay shared above the engine. The contracts are in `src/workers/engines/types.ts`.

A new engine touches these files:

1. `src/workers/engines/<id>/config.ts`: your config type plus a pure `EngineDescriptor` (`devices`, `quantizations`, `cacheId`, `legacyHybridDtype`). No runtime imports here; the main thread imports it.
2. `src/workers/engines/<id>/index.ts`: `export function createEngine(): ASREngine<YourConfig>`. `load` gets `{ device, quantization, adapterFeatures, onFile, signal }`; `transcribe` returns `{ text, words? | segments? }` in chunk-relative seconds. Only this file may import the runtime package.
3. `src/workers/engines/catalog.ts`: add the descriptor to `ENGINES` (this is what defines `EngineId`).
4. `src/workers/engines/runtimes.ts`: add `<id>: () => import('./<id>/index.js').then((m) => m.createEngine())`. Typecheck fails until this exists.
5. `src/models.ts`: add model entries `{ engine: '<id>', capabilities, engineConfig }`. `engineConfig` is type-checked against your config type, and the model id becomes part of `ASRModel` automatically.
6. Model docs: `site/model-meta.ts` (label, size, group, notes, credit; the demo/example pickers, docs/home tables, and credits are generated from it), the README Models table (`src/tests/model-lists.test.ts` catches drift), and `THIRD_PARTY_NOTICES.md` for the runtime and weights licenses.
7. Tests: `src/tests/<id>-engine.test.ts` for your pure helpers. The worker contract (`asr-worker-contract.test.ts`), the import-isolation check (`engine-isolation.test.ts`), and the bundle budget (`bun run size`) already cover the integration.

Do **not** add a runtime to `package.json` until a model needs it, and prefer a lazy CDN import or a separate chunk for large runtimes. `vite.config.ts` and `vite.demo.config.ts` inline worker dynamic imports so the blob: worker stays self-contained, which means anything you statically bundle counts against the size budget.

## Pull requests

- Keep PRs small and focused; one change per PR.
- Describe what changed and how you tested it (browser, OS, GPU / WebAssembly fallback, model).
- Add or update tests in `src/tests` for logic changes.
- Update `README.md`, `docs/index.html`, and `CHANGELOG.md` when behaviour or the public API changes.
- Make sure all checks above pass.
