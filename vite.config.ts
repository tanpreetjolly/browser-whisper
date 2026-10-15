import { defineConfig } from 'vite'
import { resolve } from 'path'
import { modelListsPlugin } from './site/model-html'

export default defineConfig({
    // Generates model pickers/tables/credits from MODELS (site/model-meta.ts)
    plugins: [modelListsPlugin()],
  build: {
    // public/ holds demo-site assets (favicon, og-image, robots, sitemap);
    // keep them out of the library's dist/.
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    target: 'es2022',
    rollupOptions: {
      // Keep heavy deps external in the main bundle — they get bundled into
      // the worker blobs separately via the worker config below.
      external: ['@huggingface/transformers', 'mediabunny', 'onnxruntime-web'],
    },
  },

  // Worker build: intentionally bundles ALL dependencies into the blob.
  // Blob URL workers cannot resolve bare module specifiers at runtime, so
  // everything (@huggingface/transformers, mediabunny, onnxruntime-web) must
  // be inlined. WASM binaries are aliased to an empty stub to keep blob size
  // small — the actual WASM is fetched from CDN via env.backends.onnx.wasm.wasmPaths.
  worker: {
    format: 'es',
    rollupOptions: {
      external: [],
      // Engines are reached via dynamic import (src/workers/engines/registry.ts) so
      // a runtime is only evaluated when a model needs it. A blob: worker cannot
      // fetch sibling chunks, so keep those imports inside the worker blob.
      output: { inlineDynamicImports: true },
    },
  },

  resolve: {
    alias: [
      {
        // Replace all .wasm imports with an empty stub so WASM binaries are
        // never bundled into the worker blob. At runtime, onnxruntime-web
        // loads them via wasmPaths (CDN) instead.
        // NOTE: find is applied as id.replace(find, replacement), so the
        // regex must match the ENTIRE module ID to avoid partial substitution.
        find: /^.*\.wasm(\?url)?$/,
        replacement: resolve(__dirname, 'src/lib/empty-wasm.js'),
      },
    ],
  },

  server: {
    headers: {
      // Required for SharedArrayBuffer (transformers.js threading)
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },

  optimizeDeps: {
    // Exclude from pre-bundling — WASM/ESM packages must stay as-is
    exclude: ['@huggingface/transformers', 'mediabunny', 'onnxruntime-web'],
  },
})
