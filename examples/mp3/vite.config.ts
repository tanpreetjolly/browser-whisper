import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const AUDIO_PATH = resolve('/Users/soham/audio.mp3');

function localAudioPlugin(): Plugin {
    return {
        name: 'local-audio',
        configureServer(server) {
            server.middlewares.use('/audio.mp3', async (_request, response) => {
                try {
                    const audioStat = await stat(AUDIO_PATH);
                    response.statusCode = 200;
                    response.setHeader('Content-Type', 'audio/mpeg');
                    response.setHeader('Content-Length', String(audioStat.size));
                    createReadStream(AUDIO_PATH).pipe(response);
                } catch (error) {
                    response.statusCode = 404;
                    response.end(error instanceof Error ? error.message : String(error));
                }
            });
        },
    };
}

export default defineConfig({
    root: __dirname,
    plugins: [localAudioPlugin()],
    server: {
        port: 5174,
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
