import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    // Output the compiled site to a distinct folder
    build: {
        outDir: 'dist-site',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                demo: resolve(__dirname, 'demo/index.html'),
                docs: resolve(__dirname, 'docs/index.html'),
                'examples/index': resolve(__dirname, 'examples/index.html'),
                'examples/live-vad/index': resolve(__dirname, 'examples/live-vad/index.html'),
                'examples/mp3/index': resolve(__dirname, 'examples/mp3/index.html'),
            },
        },
    },

    resolve: {
        alias: [
            {
                find: /^.*\.wasm(\?url)?$/,
                replacement: resolve(__dirname, 'src/lib/empty-wasm.js'),
            },
        ],
    },

    // Workers are ES modules
    worker: { format: 'es' },

    server: {
        headers: {
            // Required for SharedArrayBuffer (transformers.js threading)
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
    },

    optimizeDeps: {
        // Exclude WASM dependencies from Vite pre-bundling
        exclude: ['@huggingface/transformers', 'mediabunny'],
    },
});
