import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      // Main entry – workers are added via rollupOptions.input below
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    target: 'es2022',
    rollupOptions: {
      // Build the two workers as separate ES chunks
      input: {
        index: resolve(__dirname, 'src/index.ts'),
        'decoder.worker': resolve(__dirname, 'src/workers/decoder.worker.ts'),
        'whisper.worker': resolve(__dirname, 'src/workers/whisper.worker.ts'),
      },
      output: {
        // Keep worker filenames predictable so Bridge can import them
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
      // Peer deps — consumers must install these themselves
      external: ['@huggingface/transformers', 'mediabunny'],
    },
  },

  // Workers are themselves ES modules (required for transferable streams etc.)
  worker: { format: 'es' },

  server: {
    headers: {
      // Required for SharedArrayBuffer (transformers.js threading)
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },

  optimizeDeps: {
    // Exclude from pre-bundling – both are WASM/ESM and must stay as-is
    exclude: ['@huggingface/transformers', 'mediabunny'],
  },
})