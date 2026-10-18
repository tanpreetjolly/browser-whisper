/**
 * Static import-isolation checks: engines never import each other, runtime packages stay inside
 * their engine, and shared code reaches engine runtimes only through runtimes.ts dynamic imports.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dir, '..');
const ENGINES_DIR = join(SRC, 'workers/engines');

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? (n === 'tests' ? [] : walk(p)) : /\.ts$/.test(n) ? [p] : [];
    });
}

interface Imp { file: string; spec: string; dynamic: boolean; target?: string }
const imports: Imp[] = walk(SRC).flatMap((file) => {
    const code = readFileSync(file, 'utf8');
    const out: Imp[] = [];
    for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) out.push({ file, spec: m[1], dynamic: false });
    for (const m of code.matchAll(/import\(\s*(?:\/\*[^*]*\*\/\s*)?['"]([^'"]+)['"]\s*\)/g)) out.push({ file, spec: m[1], dynamic: true });
    return out.map((i) => ({ ...i, target: i.spec.startsWith('.') ? resolve(dirname(file), i.spec).replace(/\.js$/, '.ts').replace(/\?.*$/, '') : undefined }));
});
const engineOf = (p: string) => {
    const r = relative(ENGINES_DIR, p);
    return r.startsWith('..') || !r.includes('/') ? null : r.split('/')[0];
};
const rel = (p: string) => relative(SRC, p);

describe('engine import isolation', () => {
    test('scanner sees the codebase', () => {
        expect(imports.length).toBeGreaterThan(30);
    });

    test('an engine never imports another engine', () => {
        const bad = imports.filter((i) => i.target && engineOf(i.file) && engineOf(i.target) && engineOf(i.file) !== engineOf(i.target));
        expect(bad.map((i) => `${rel(i.file)} -> ${i.spec}`)).toEqual([]);
    });

    test('@huggingface/transformers is imported only by the transformers engine runtime', () => {
        const bad = imports.filter((i) => i.spec.startsWith('@huggingface/transformers') && rel(i.file) !== 'workers/engines/transformers/index.ts');
        expect(bad.map((i) => rel(i.file))).toEqual([]);
    });

    test('shared code only touches engine config.ts files, never runtimes (except runtimes.ts, dynamically)', () => {
        const bad = imports.filter((i) => {
            if (!i.target || engineOf(i.file)) return false;
            const eng = engineOf(i.target);
            if (!eng) return false;
            if (i.target.endsWith('/config.ts')) return false;
            return !(rel(i.file) === 'workers/engines/runtimes.ts' && i.dynamic);
        });
        expect(bad.map((i) => `${rel(i.file)} -> ${i.spec}`)).toEqual([]);
    });

    test('engine config.ts files are pure (no runtime-package or runtime-module imports)', () => {
        const bad = imports.filter((i) => i.file.endsWith('/config.ts') && engineOf(i.file) && (!i.spec.startsWith('.') || i.dynamic));
        expect(bad.map((i) => `${rel(i.file)} -> ${i.spec}`)).toEqual([]);
    });

    test('shared worker/lib code has no model-name or engine-id checks', () => {
        const shared = walk(SRC).filter((f) => !engineOf(f) && !f.includes('/tests/') && !f.endsWith('models.ts') && !f.endsWith('catalog.ts') && !f.endsWith('runtimes.ts'));
        const bad = shared.filter((f) => /['"](whisper-|moonshine-|parakeet-|transformers['"]|parakeet['"])/.test(readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')));
        // whisper-tiny is the documented default model in the public API layer only.
        expect(bad.map(rel).filter((f) => !['browser-whisper.ts', 'lib/bridge.ts', 'types.ts'].includes(f))).toEqual([]);
    });
});
