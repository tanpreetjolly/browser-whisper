import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    target: 'es2022',
    rollupOptions: {
      // Build the two workers as separate ES chunks alongside the main entry
      input: {
        index: resolve(__dirname, 'src/index.ts'),
        'decoder-worker': resolve(__dirname, 'src/workers/decoder-worker.ts'),
        'whisper-worker': resolve(__dirname, 'src/workers/whisper-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
      // Keep heavy deps external — consumers' bundler resolves them from
      // node_modules, letting it handle onnxruntime-web's internal dynamic
      // imports (ort-webgpu.mjs etc.) correctly.
      external: ['@huggingface/transformers', 'mediabunny', 'onnxruntime-web'],
    },
  },

  // Workers are ES modules (required for transferable streams etc.)
  worker: {
    format: 'es',
    rollupOptions: {
      external: ['@huggingface/transformers', 'mediabunny', 'onnxruntime-web'],
    },
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
    exclude: ['@huggingface/transformers', 'mediabunny'],
  },
})
