import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    root: __dirname,
    server: {
        port: 5175,
        strictPort: false,
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
    },
    optimizeDeps: {
        exclude: ['@huggingface/transformers', 'mediabunny', 'onnxruntime-web'],
    },
    resolve: {
        alias: [
            {
                find: /^.*\.wasm(\?url)?$/,
                replacement: resolve(__dirname, '../../src/lib/empty-wasm.js'),
            },
        ],
    },
    worker: {
        format: 'es',
    },
});
