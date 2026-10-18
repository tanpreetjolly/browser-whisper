/**
 * Contract tests for the engine-agnostic ASR worker core, driven by fake engines (no runtime,
 * no network). Covers device fallback, progress, run ids / cancel (#34), validation, warnings.
 */
import { describe, expect, test } from 'bun:test';
import { createASRWorker } from '../workers/asr-core';
import type { ModelDefinition } from '../models';
import type { ASREngine, EngineDescriptor, EngineLoadContext, TranscribeContext } from '../workers/engines/types';
import type { MainThreadMessage, PCMChunk } from '../types';

type Msg = MainThreadMessage;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

interface FakeOpts {
    devices?: EngineDescriptor['devices'];
    failOn?: string;
    /** transcribe delay (ms) per call */
    delay?: number;
    language?: boolean;
}

function harness(opts: FakeOpts = {}) {
    const msgs: Msg[] = [];
    const warns: string[] = [];
    const loads: EngineLoadContext[] = [];
    const calls: { samples: number; ctx: TranscribeContext }[] = [];
    let created = 0;
    let disposed = 0;
    const engine = (): ASREngine<{ tag: string }> => ({
        async load(_m, ctx) {
            loads.push(ctx);
            ctx.onFile('a.onnx', 0, 0);
            ctx.onFile('a.onnx', 50, 100);
            ctx.onFile('b.onnx', 100, 100);
            if (ctx.device === opts.failOn) throw new Error(`${ctx.device} boom`);
        },
        async transcribe(samples, ctx) {
            calls.push({ samples: samples.length, ctx });
            if (opts.delay && samples.length > 1600) await tick(opts.delay);
            // chunk-relative word at [0, 1]; text carries the chunk's first sample as an id
            const id = String(samples[0]);
            return { text: id, words: [{ text: `w${id}.`, start: 0, end: 1 }] };
        },
        dispose() { disposed++; },
    });
    const caps = { timestamps: true, wordTimestamps: true, language: opts.language ?? true };
    const definitions: Record<string, ModelDefinition> = {
        m1: { engine: 'fake', capabilities: caps, engineConfig: { tag: 'one' } } as unknown as ModelDefinition,
        m2: { engine: 'fake', capabilities: caps, engineConfig: { tag: 'two' } } as unknown as ModelDefinition,
    };
    const fake: EngineDescriptor<{ tag: string }> = {
        devices: opts.devices ?? ['webgpu', 'wasm'],
        quantizations: ['hybrid', 'q8'],
        cacheId: (c) => `org/${c.tag}`,
        legacyHybridDtype: () => 'q8',
    };
    const handle = createASRWorker({
        post: (m) => msgs.push(m),
        fatalTarget: new EventTarget(),
        definitions,
        engines: { fake } as unknown as Record<string, EngineDescriptor<never>>,
        runtimes: { fake: async () => { created++; return engine() as ASREngine<never>; } },
        getAdapter: async () => (opts.devices?.includes('webgpu') === false ? null : { features: new Set(['shader-f16']) }),
        warn: (...a) => warns.push(a.map(String).join(' ')),
    });

    /** Start a run like Bridge.start: port + init; returns the decoder side of the port. */
    async function start(runId: number, model = 'm1', extra: Record<string, unknown> = {}) {
        const { port1, port2 } = new MessageChannel();
        await handle({ type: 'port', runId, port: port2 });
        await handle({ type: 'init', runId, model: model as never, ...extra });
        return port1;
    }
    const chunk = (id: number, timestamp: number, final = false): PCMChunk => {
        const samples = new Float32Array(16_000 * 30); samples[0] = id;
        return { samples, timestamp, final, duration: 30 };
    };
    const of = (runId: number, type?: Msg['type']) => msgs.filter((m) => m.runId === runId && (!type || m.type === type));
    return { handle, msgs, warns, loads, calls, start, chunk, of, get created() { return created; }, get disposed() { return disposed; } };
}

describe('ASR worker core contract (fake engine)', () => {
    test('loads, aggregates per-file progress, passes adapter features, posts ready tagged with the run', async () => {
        const h = harness();
        await h.start(1);
        expect(h.of(1, 'ready')).toHaveLength(1);
        expect(h.loads[0].device).toBe('webgpu');
        expect([...h.loads[0].adapterFeatures]).toEqual(['shader-f16']);
        const fractions = h.of(1, 'progress').map((m) => (m as { event: { progress: number } }).event.progress);
        expect(fractions).toContain(0.75); // (50 + 100) / 200 across two files
        expect(fractions.at(-1)).toBe(1);
        expect(h.msgs.every((m) => m.runId === 1)).toBe(true);
    });

    test('WebGPU load failure falls back to WASM with empty adapter features', async () => {
        const h = harness({ failOn: 'webgpu' });
        await h.start(1);
        expect(h.loads.map((l) => l.device)).toEqual(['webgpu', 'wasm']);
        expect(h.loads[1].adapterFeatures.size).toBe(0);
        expect(h.warns.some((w) => w.includes('Falling back to WASM'))).toBe(true);
        expect(h.of(1, 'ready')).toHaveLength(1);
    });

    test('unsupported quantization is rejected per engine with the cache id, no download', async () => {
        const h = harness();
        await h.start(1, 'm1', { quantization: 'q4' });
        const err = h.of(1, 'error')[0] as { message: string; loadModelId?: string };
        expect(err.message).toContain('does not support quantization "q4"');
        expect(err.loadModelId).toBe('org/one');
        expect(h.created).toBe(0);
    });

    test('words become file-relative segments; final chunk ends the run', async () => {
        const h = harness();
        const port = await h.start(1);
        port.postMessage(h.chunk(7, 30, true));
        await tick(20);
        const segs = h.of(1, 'segment').map((m) => (m as { segment: unknown }).segment);
        expect(segs).toEqual([{ text: 'w7.', start: 30, end: 31, words: [{ text: 'w7.', start: 30, end: 31 }] }]);
        expect(h.of(1, 'done')).toHaveLength(1);
    });

    test('#34 regression: cancel drops queued + in-flight chunks; the next run sees only its own output', async () => {
        const h = harness({ delay: 30 });
        const p1 = await h.start(1);
        for (let i = 0; i < 5; i++) p1.postMessage(h.chunk(100 + i, i * 30, i === 4));
        await tick(10); // chunk 100 is in flight, 101-104 queued
        await h.handle({ type: 'cancel', runId: 1 });
        expect(h.calls.at(-1)!.ctx.signal.aborted).toBe(true);

        const p2 = await h.start(2);
        p2.postMessage(h.chunk(200, 0, true));
        await tick(150);

        expect(h.of(1, 'segment')).toHaveLength(0); // in-flight result discarded
        expect(h.of(1, 'done')).toHaveLength(0);
        const run2 = h.of(2, 'segment').map((m) => (m as { segment: { text: string } }).segment.text);
        expect(run2).toEqual(['w200.']);
        expect(h.of(2, 'done')).toHaveLength(1);
        // Queued chunks of run 1 never reached the engine (prewarm + 100 + 200 only).
        expect(h.calls.filter((c) => c.samples > 1600)).toHaveLength(2);
        expect(h.created).toBe(1); // same model reused, no reload
    });

    test('a new run supersedes an un-cancelled one (no leakage even without cancel)', async () => {
        const h = harness({ delay: 30 });
        const p1 = await h.start(1);
        p1.postMessage(h.chunk(1, 0)); p1.postMessage(h.chunk(2, 30, true));
        await tick(5);
        const p2 = await h.start(2);
        p1.postMessage(h.chunk(3, 60, true)); // late chunk on the old port is ignored
        p2.postMessage(h.chunk(9, 0, true));
        await tick(150);
        expect(h.of(1, 'segment')).toHaveLength(0);
        expect(h.of(2, 'segment')).toHaveLength(1);
    });

    test('switching models disposes the previous engine', async () => {
        const h = harness();
        await h.start(1, 'm1');
        await h.start(2, 'm2');
        expect(h.created).toBe(2);
        expect(h.disposed).toBe(1);
        expect(h.of(2, 'ready')).toHaveLength(1);
    });

    test('warns once and does not pass language when the model ignores it', async () => {
        const h = harness({ language: false });
        const port = await h.start(1, 'm1', { language: 'de' });
        port.postMessage(h.chunk(1, 0, true));
        await tick(20);
        await h.start(2, 'm1', { language: 'de' });
        expect(h.warns.filter((w) => w.includes('language option'))).toHaveLength(1);
        expect(h.calls.every((c) => c.ctx.language === undefined)).toBe(true);
    });

    test('passes language when supported', async () => {
        const h = harness();
        const port = await h.start(1, 'm1', { language: 'de' });
        port.postMessage(h.chunk(1, 0, true));
        await tick(20);
        expect(h.calls.at(-1)!.ctx.language).toBe('de');
    });
});

describe('WebGPU-only engine with no adapter', () => {
    test('errors with a clear message and never fetches the runtime', async () => {
        let created = 0;
        const msgs: Msg[] = [];
        const handle = createASRWorker({
            post: (m) => msgs.push(m),
            fatalTarget: new EventTarget(),
            definitions: { g: { engine: 'gpu', capabilities: { timestamps: false, wordTimestamps: false, language: false }, engineConfig: {} } as unknown as ModelDefinition },
            engines: { gpu: { devices: ['webgpu'], quantizations: ['hybrid'], cacheId: () => 'org/g', legacyHybridDtype: () => 'q8' } } as unknown as Record<string, EngineDescriptor<never>>,
            runtimes: { gpu: async () => { created++; throw new Error('should not load'); } },
            getAdapter: async () => null,
            warn: () => {},
        });
        await handle({ type: 'init', runId: 1, model: 'g' as never });
        expect((msgs.find((m) => m.type === 'error') as { message: string }).message).toContain('requires WebGPU');
        expect(created).toBe(0);
    });
});
