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
      // Externalize dependencies so they aren't bundled (NPM handles installing them)
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