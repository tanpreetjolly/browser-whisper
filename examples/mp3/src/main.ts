import { BrowserWhisper, type ASRModel, type TranscribeProgress } from '../../../src/index.js';

const modelSelect = document.querySelector<HTMLSelectElement>('#model');
const fileInput = document.querySelector<HTMLInputElement>('#fileInput');
const fileLabel = document.querySelector<HTMLLabelElement>('#fileLabel');
const fileNameElement = document.querySelector<HTMLSpanElement>('#fileName');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');
const transcribeButton = document.querySelector<HTMLButtonElement>('#transcribe');
const repeatButton = document.querySelector<HTMLButtonElement>('#repeat');
const logElement = document.querySelector<HTMLPreElement>('#log');
const segmentsElement = document.querySelector<HTMLDivElement>('#segments');

if (
    !modelSelect || !fileInput || !fileLabel || !fileNameElement ||
    !downloadButton || !transcribeButton || !repeatButton || !logElement || !segmentsElement
) {
    throw new Error('MP3 transcribe UI failed to initialize.');
}

let whisper = createWhisper();
let selectedFile: File | null = null;
let hasDefaultAudio = false;
let isBusy = false;

function selectedModel(): ASRModel {
    return modelSelect.value as ASRModel;
}

function createWhisper(): BrowserWhisper {
    return new BrowserWhisper({
        model: selectedModel(),
        quantization: 'hybrid',
    });
}

function appendLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    logElement.textContent += `[${timestamp}] ${message}\n`;
    logElement.scrollTop = logElement.scrollHeight;
}

function renderProgress(prefix: string, event: TranscribeProgress): void {
    appendLog(`${prefix}: ${event.stage} ${Math.round(event.progress * 100)}%`);
}

function updateFileUi(): void {
    if (selectedFile) {
        fileNameElement.textContent = selectedFile.name;
        fileLabel.classList.add('has-file');
    } else {
        fileNameElement.textContent = hasDefaultAudio ? 'audio.mp3 (default)' : 'Choose audio';
        fileLabel.classList.remove('has-file');
    }
    updateTranscribeButton();
}

function updateTranscribeButton(): void {
    transcribeButton.disabled = isBusy || (!selectedFile && !hasDefaultAudio);
}

function setBusy(busy: boolean): void {
    isBusy = busy;
    downloadButton.disabled = busy;
    repeatButton.disabled = busy;
    modelSelect.disabled = busy;
    fileInput.disabled = busy;
    updateTranscribeButton();
}

async function probeDefaultAudio(): Promise<void> {
    try {
        const response = await fetch('/audio.mp3', { method: 'HEAD' });
        hasDefaultAudio = response.ok;
        if (hasDefaultAudio) {
            appendLog('found default /audio.mp3');
        }
    } catch {
        hasDefaultAudio = false;
    }
    updateFileUi();
}

async function resolveAudioFile(): Promise<File> {
    if (selectedFile) {
        return selectedFile;
    }

    const response = await fetch('/audio.mp3');
    if (!response.ok) {
        throw new Error('No audio selected and /audio.mp3 is not available. Choose a file or add public/audio.mp3.');
    }

    const blob = await response.blob();
    return new File([blob], 'audio.mp3', { type: blob.type || 'audio/mpeg' });
}

async function downloadModel(label: string): Promise<void> {
    setBusy(true);
    const startedAt = performance.now();

    try {
        appendLog(`${label}: starting ${selectedModel()}`);
        await whisper.downloadModel({
            model: selectedModel(),
            quantization: 'hybrid',
            onProgress: (event) => renderProgress(label, event),
        });
        appendLog(`${label}: completed in ${Math.round(performance.now() - startedAt)}ms`);
    } catch (error) {
        appendLog(`${label}: failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        setBusy(false);
    }
}

downloadButton.addEventListener('click', () => {
    void downloadModel('download');
});

repeatButton.addEventListener('click', () => {
    void downloadModel('repeat');
});

transcribeButton.addEventListener('click', async () => {
    setBusy(true);
    segmentsElement.textContent = '';

    try {
        appendLog('transcribe: resolving audio');
        const file = await resolveAudioFile();
        appendLog(`transcribe: starting ${file.name} (${file.size} bytes)`);

        for await (const segment of whisper.transcribe(file, {
            onProgress: (event) => renderProgress('transcribe', event),
        })) {
            const row = document.createElement('div');
            const timestamp = document.createElement('span');
            row.className = 'segment';
            timestamp.className = 'time';
            timestamp.textContent = `${segment.start.toFixed(1)}–${segment.end.toFixed(1)}s`;
            row.append(timestamp, ` ${segment.text}`);
            segmentsElement.append(row);
        }

        appendLog('transcribe: done');
    } catch (error) {
        appendLog(`transcribe: failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        setBusy(false);
    }
});

fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files?.[0] ?? null;
    updateFileUi();
    appendLog(selectedFile ? `file: ${selectedFile.name}` : 'file: cleared');
});

modelSelect.addEventListener('change', () => {
    whisper.dispose();
    whisper = createWhisper();
    appendLog(`model: ${selectedModel()}`);
});

window.addEventListener('beforeunload', () => {
    whisper.dispose();
});

void probeDefaultAudio();
appendLog('ready');
