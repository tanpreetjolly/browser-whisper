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

Engines live under `src/workers/engines/`. The worker resolves a model's `engine` field, dynamically imports that runtime, and runs WebGPU→WASM fallback; decoding, chunking, OPFS, progress, fatal errors, and segment clamping stay shared above the engine.

1. Add an id to `EngineId` in `src/types.ts` and set `engine: '<id>'` on the models that use it.
2. Implement `ASREngine` (`load` / `transcribe` / `dispose`) in e.g. `src/workers/engines/my-engine/index.ts`. Keep the dependency out of the static import graph — only the registry's `create` thunk may `import()`.
3. Register it in `ENGINES` in `src/workers/engines/registry.ts` with its preferred `devices` (WebGPU first).
4. Do **not** add unused runtimes to `package.json` until a model needs them. `vite.config.ts` / `vite.demo.config.ts` already inline worker dynamic imports so the blob: worker stays self-contained.
5. Cover registry / model→engine resolution in `src/tests/engines.test.ts`, then run the checks above.

## Pull requests

- Keep PRs small and focused; one change per PR.
- Describe what changed and how you tested it (browser, OS, GPU / WebAssembly fallback, model).
- Add or update tests in `src/tests` for logic changes.
- Update `README.md`, `docs/index.html`, and `CHANGELOG.md` when behaviour or the public API changes.
- Make sure all checks above pass.
