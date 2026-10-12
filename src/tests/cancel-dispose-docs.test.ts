import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const docs = readFileSync(join(root, 'docs/index.html'), 'utf8');

const cancelFromButton = "cancelButton.addEventListener('click', () => stream.cancel())";

function apiSection(html: string): string {
    const start = html.indexOf('<section id="api">');
    if (start < 0) throw new Error('docs are missing the #api section');
    const end = html.indexOf('</section>', start);
    return html.slice(start, end);
}

describe('cancel() and dispose() documentation', () => {
    test('README shows cancelling a transcription from a button and disposing on unmount', () => {
        expect(readme).toContain(cancelFromButton);
        expect(readme).toContain('whisper.dispose()');
        expect(readme).toContain('TranscribePCMStream');
        expect(readme.toLowerCase()).toContain('unmount');
    });

    test('docs API reference shows cancelling a transcription and disposing on unmount', () => {
        const api = apiSection(docs);
        expect(api).toContain('TranscribeStream.cancel()');
        expect(api).toContain('TranscribePCMStream.cancel()');
        expect(api).toContain('BrowserWhisper.dispose()');
        expect(api).toContain(cancelFromButton);
        expect(api).toContain('whisper.dispose()');
        expect(api.toLowerCase()).toContain('unmount');
    });
});
