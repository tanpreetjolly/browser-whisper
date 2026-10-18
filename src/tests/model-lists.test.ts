import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS } from '../types';
import { CREDITS, GROUPS, MODEL_META } from '../../site/model-meta';
import { expandModelMarkers, renderCredits, renderDocsRows, renderHomeRows, renderOptions } from '../../site/model-html';

const root = join(import.meta.dir, '../..');
const ids = Object.keys(MODELS);
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('generated model lists', () => {
    test('every model has metadata in a known group, and nothing extra', () => {
        expect(Object.keys(MODEL_META).sort()).toEqual([...ids].sort());
        for (const m of Object.values(MODEL_META)) expect(GROUPS as readonly string[]).toContain(m.group);
    });

    test('pickers list every model exactly once and honour selected / sizes', () => {
        const html = renderOptions({ selected: 'whisper-base' });
        const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
        expect(values.sort()).toEqual([...ids].sort());
        expect(html).toContain('<option value="whisper-base" selected>');
        expect(html.match(/ selected/g)?.length).toBe(1);
        expect(renderOptions({ sizes: false })).not.toContain('(~');
    });

    test('docs rows cover every model; home rows reflect supportsLanguage', () => {
        for (const id of ids) expect(renderDocsRows()).toContain(`<code>${id}</code>`);
        const home = renderHomeRows();
        expect(home).toContain('<code>parakeet-tdt-0.6b-v3</code>');
        expect(home).toMatch(/<code>whisper-tiny<\/code>[\s\S]*?td-check/);
        expect(home).toMatch(/<code>moonshine-tiny<\/code>[\s\S]*?td-dash/);
    });

    test('credits include CC BY attribution for every NVIDIA model', () => {
        const c = renderCredits();
        expect(c).toContain('creativecommons.org/licenses/by/4.0');
        expect(c).toContain(CREDITS['nvidia-tdt']);
        expect(c).toContain(CREDITS['nvidia-ctc']);
        expect(c).toContain('THIRD_PARTY_NOTICES.md');
    });

    test('site pages use markers (no hand-written model lists left) and expand fully', () => {
        const pages = ['demo/index.html', 'examples/live-vad/index.html', 'examples/mp3/index.html', 'docs/index.html', 'index.html'];
        for (const p of pages) {
            const src = read(p);
            expect({ p, credits: src.includes('<!-- @models:credits -->') }).toEqual({ p, credits: true });
            expect({ p, handWritten: /<option value="whisper-|<tr>\s*<td><code>(whisper|moonshine|parakeet)-/.test(src) }).toEqual({ p, handWritten: false });
            const out = expandModelMarkers(src);
            expect({ p, left: out.includes('@models:') }).toEqual({ p, left: false });
        }
        expect(() => expandModelMarkers('<!-- @models:nope -->')).toThrow('Unknown model marker');
    });
});

describe('README model table drift', () => {
    test('README Models table names every model and no unknown ones', () => {
        const readme = read('README.md');
        const start = readme.indexOf('## Models');
        const table = readme.slice(start, readme.indexOf('\n\n', readme.indexOf('|', start)));
        const names = new Set<string>();
        for (const row of table.split('\n').filter((l) => l.startsWith('| `'))) {
            for (const [, cell] of row.split('|')[1].matchAll(/`([^`]+)`/g)) {
                const brace = cell.match(/^(.*)\{([^}]+)\}(.*)$/);
                for (const n of brace ? brace[2].split(',').map((x) => brace[1] + x + brace[3]) : [cell]) names.add(n);
            }
        }
        expect([...ids].filter((id) => !names.has(id))).toEqual([]);
        expect([...names].filter((n) => !(n in MODELS))).toEqual([]);
    });
});
