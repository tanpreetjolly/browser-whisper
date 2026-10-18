import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const docs = readFileSync(join(import.meta.dir, '../../docs/index.html'), 'utf8');

describe('cancel() and dispose() documentation', () => {
    test('docs API section mentions dispose()', () => {
        const start = docs.indexOf('<section id="api">');
        const api = docs.slice(start, docs.indexOf('</section>', start));
        expect(api).toContain('dispose()');
    });
});
