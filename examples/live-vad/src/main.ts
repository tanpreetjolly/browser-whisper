import { BrowserWhisper, type ASRModel, type TranscriptSegment, type TranscribeProgress } from '../../../src/index.js';

declare global {
    interface Window {
        vad: {
            MicVAD: {
                new(options: MicVADOptions): Promise<MicVAD>;
            };
        };
    }
}

interface MicVAD {
    start(): void;
    pause(): void;
    destroy?: () => void;
}

interface MicVADOptions {
    onSpeechStart: () => void;
    onSpeechEnd: (audio: Float32Array) => void;
    onnxWASMBasePath: string;
    baseAssetPath: string;
    model?: 'v5' | 'legacy';
    positiveSpeechThreshold?: number;
    negativeSpeechThreshold?: number;
    redemptionMs?: number;
    preSpeechPadMs?: number;
    minSpeechMs?: number;
}

interface QueuedUtterance {
    id: number;
    audio: Float32Array;
    startedAt: number;
}

const SAMPLE_RATE = 16_000;
const VAD_VERSION = '0.0.30';
const ORT_VERSION = '1.22.0';

const modelSelect = getElement<HTMLSelectElement>('model');
const prepareButton = getElement<HTMLButtonElement>('prepare');
const startButton = getElement<HTMLButtonElement>('start');
const stopButton = getElement<HTMLButtonElement>('stop');
const clearButton = getElement<HTMLButtonElement>('clear');
const statusElement = getElement<HTMLDivElement>('status');
const transcriptElement = getElement<HTMLDivElement>('transcript');
const eventsElement = getElement<HTMLPreElement>('events');

let whisper = createWhisper();
let micVAD: MicVAD | null = null;
let isPrepared = false;
let isListening = false;
let isProcessing = false;
let utteranceId = 0;
const queue: QueuedUtterance[] = [];

prepareButton.addEventListener('click', () => {
    void prepare();
});

startButton.addEventListener('click', () => {
    void start();
});

stopButton.addEventListener('click', () => {
    stop();
});

clearButton.addEventListener('click', () => {
    transcriptElement.textContent = '';
    eventsElement.textContent = '';
});

modelSelect.addEventListener('change', () => {
    isPrepared = false;
    whisper.dispose();
    whisper = createWhisper();
    setStatus('idle');
    log(`model: ${selectedModel()}`);
});

window.addEventListener('beforeunload', () => {
    micVAD?.destroy?.();
    whisper.dispose();
});

setStatus('idle');
log('ready');

function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing #${id}`);
    return element as T;
}

function selectedModel(): ASRModel {
    return modelSelect.value as ASRModel;
}

function createWhisper(): BrowserWhisper {
    return new BrowserWhisper({
        model: selectedModel(),
        quantization: 'hybrid',
        language: 'en',
    });
}

async function prepare(): Promise<void> {
    setControlsBusy(true);
    setStatus('preparing');
    log(`prepare: ${selectedModel()}`);

    try {
        await whisper.downloadModel({
            model: selectedModel(),
            quantization: 'hybrid',
            onProgress: (event) => logProgress('prepare', event),
        });
        isPrepared = true;
        setStatus('ready');
        log('prepare: done');
    } catch (error) {
        setStatus('error');
        logError('prepare', error);
    } finally {
        setControlsBusy(false);
    }
}

async function start(): Promise<void> {
    if (!isPrepared) {
        await prepare();
        if (!isPrepared) return;
    }

    setControlsBusy(true);

    try {
        if (!micVAD) {
            micVAD = await window.vad.MicVAD.new({
                onSpeechStart: handleSpeechStart,
                onSpeechEnd: handleSpeechEnd,
                onnxWASMBasePath: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
                baseAssetPath: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/`,
                model: 'v5',
                positiveSpeechThreshold: 0.35,
                negativeSpeechThreshold: 0.2,
                redemptionMs: 300,
                preSpeechPadMs: 160,
                minSpeechMs: 120,
            });
        }

        micVAD.start();
        isListening = true;
        setStatus('listening');
        log('vad: started');
    } catch (error) {
        setStatus('error');
        logError('vad', error);
    } finally {
        setControlsBusy(false);
    }
}

function stop(): void {
    micVAD?.pause();
    isListening = false;
    setStatus(isPrepared ? 'ready' : 'idle');
    updateControls();
    log('vad: stopped');
}

function handleSpeechStart(): void {
    setStatus('speaking');
    log('speech: start');
}

function handleSpeechEnd(audio: Float32Array): void {
    const id = ++utteranceId;
    queue.push({ id, audio, startedAt: performance.now() });
    setStatus(isListening ? 'listening' : 'ready');
    log(`speech: end #${id} ${formatSeconds(audio.length / SAMPLE_RATE)}`);
    void drainQueue();
}

async function drainQueue(): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;

    try {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) continue;
            await transcribeUtterance(item);
        }
    } finally {
        isProcessing = false;
    }
}

async function transcribeUtterance(item: QueuedUtterance): Promise<void> {
    const row = createTranscriptRow(item.id, 'transcribing...');

    try {
        log(`transcribe: start #${item.id}`);
        const segments = await whisper.transcribePCM(item.audio, {
            onProgress: (event) => logProgress(`transcribe #${item.id}`, event),
        }).collect();

        const text = segmentsToText(segments);
        row.text.textContent = text || '[no speech text]';
        row.meta.textContent = `#${item.id} - ${formatSeconds(item.audio.length / SAMPLE_RATE)} - ${Math.round(performance.now() - item.startedAt)}ms`;
        log(`transcribe: done #${item.id}`);
    } catch (error) {
        row.text.textContent = error instanceof Error ? error.message : String(error);
        row.element.classList.add('error');
        logError(`transcribe #${item.id}`, error);
    }
}

function createTranscriptRow(id: number, text: string): {
    element: HTMLDivElement;
    meta: HTMLSpanElement;
    text: HTMLSpanElement;
} {
    const element = document.createElement('div');
    const meta = document.createElement('span');
    const body = document.createElement('span');

    element.className = 'utterance';
    meta.className = 'meta';
    meta.textContent = `#${id}`;
    body.textContent = text;

    element.append(meta, body);
    transcriptElement.append(element);
    transcriptElement.scrollTop = transcriptElement.scrollHeight;

    return { element, meta, text: body };
}

function segmentsToText(segments: TranscriptSegment[]): string {
    return segments
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(' ')
        .trim();
}

function setControlsBusy(isBusy: boolean): void {
    prepareButton.disabled = isBusy || isListening;
    startButton.disabled = isBusy || isListening;
    stopButton.disabled = isBusy || !isListening;
    modelSelect.disabled = isBusy || isListening;
}

function updateControls(): void {
    setControlsBusy(false);
}

function setStatus(value: string): void {
    statusElement.textContent = value;
    statusElement.classList.toggle('speaking', value === 'speaking');
    updateControls();
}

function logProgress(prefix: string, event: TranscribeProgress): void {
    log(`${prefix}: ${event.stage} ${Math.round(event.progress * 100)}%`);
}

function logError(prefix: string, error: unknown): void {
    log(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
}

function log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    eventsElement.textContent += `[${timestamp}] ${message}\n`;
    eventsElement.scrollTop = eventsElement.scrollHeight;
}

function formatSeconds(seconds: number): string {
    return `${seconds.toFixed(1)}s`;
}
