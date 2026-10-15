/**
 * Display metadata for every model in MODELS. The site build generates the demo/example
 * pickers, the docs/home model tables and the credits blocks from this map (see
 * site/model-html.ts), so a model added to MODELS fails typecheck until it has an entry here.
 * HTML is allowed in `notes`, `languages` and credit `html`.
 */
import type { ASRModel } from '../src/types';

export type CreditId = 'openai' | 'lite' | 'moonshine' | 'distil' | 'nvidia-ctc' | 'nvidia-tdt';

export interface ModelMeta {
    /** <optgroup> label (picker order follows GROUPS) */
    group: string;
    label: string;
    size: string;
    /** Docs table "Notes" column */
    notes: string;
    /** Home-page languages column (required for models in HOME_MODELS) */
    languages?: string;
    credit: CreditId;
}

export const GROUPS = [
    'Moonshine (English only)',
    'Parakeet (English only)',
    'Parakeet TDT · WebGPU only, needs shader-f16 (else quantization q8 via API) · 25 languages',
    'Whisper',
    'Whisper (timestamped)',
    'Whisper Large',
    'Distil-Whisper (English only)',
] as const;

const EN = 'English only';
const MULTI = 'Multilingual · 99 languages';

export const MODEL_META: Record<ASRModel, ModelMeta> = {
    'moonshine-tiny':        { group: GROUPS[0], label: 'Moonshine Tiny', size: '~55 MB', notes: 'English only · fastest', languages: EN, credit: 'moonshine' },
    'moonshine-base':        { group: GROUPS[0], label: 'Moonshine Base', size: '~98 MB', notes: 'English only', languages: EN, credit: 'moonshine' },
    'parakeet-ctc-0.6b':     { group: GROUPS[1], label: 'Parakeet CTC 0.6B', size: '~612 MB', notes: 'English only · NVIDIA Parakeet CTC · lowercase, no punctuation, no timestamps', languages: EN, credit: 'nvidia-ctc' },
    'parakeet-tdt-0.6b-v3':  { group: GROUPS[2], label: 'Parakeet TDT 0.6B v3', size: '~1.26 GB', notes: "<strong>WebGPU only</strong> · NVIDIA Parakeet TDT v3 (CC-BY-4.0) · 25 European languages · punctuation + word timestamps · fp16 needs <code>shader-f16</code>, otherwise use <code>quantization: 'q8'</code>", languages: '25 European languages, auto-detected (WebGPU only)', credit: 'nvidia-tdt' },
    'whisper-tiny':          { group: GROUPS[3], label: 'Whisper Tiny', size: '~120 MB', notes: 'Multilingual · fastest Whisper · default', languages: MULTI, credit: 'openai' },
    'whisper-base':          { group: GROUPS[3], label: 'Whisper Base', size: '~206 MB', notes: 'Multilingual', languages: MULTI, credit: 'openai' },
    'whisper-small':         { group: GROUPS[3], label: 'Whisper Small', size: '~586 MB', notes: 'Multilingual · better accuracy', languages: MULTI, credit: 'openai' },
    'whisper-tiny_timestamped':  { group: GROUPS[4], label: 'Whisper Tiny Timestamped', size: '~120 MB', notes: 'Word-level timestamps', credit: 'openai' },
    'whisper-base_timestamped':  { group: GROUPS[4], label: 'Whisper Base Timestamped', size: '~206 MB', notes: 'Word-level timestamps', credit: 'openai' },
    'whisper-small_timestamped': { group: GROUPS[4], label: 'Whisper Small Timestamped', size: '~586 MB', notes: 'Word-level timestamps', credit: 'openai' },
    'lite-whisper-large-v3-turbo-fast': { group: GROUPS[5], label: 'Lite Large V3 Turbo Fast', size: '~1.59 GB', notes: 'Large · speed-optimized', credit: 'lite' },
    'lite-whisper-large-v3-turbo':      { group: GROUPS[5], label: 'Lite Large V3 Turbo', size: '~1.84 GB', notes: 'Large · balanced', credit: 'lite' },
    'lite-whisper-large-v3-turbo-acc':  { group: GROUPS[5], label: 'Lite Large V3 Turbo Acc', size: '~2.02 GB', notes: 'Large · accuracy-optimized', credit: 'lite' },
    'whisper-large-v3-turbo':             { group: GROUPS[5], label: 'Whisper Large V3 Turbo', size: '~2.88 GB', notes: 'Best turbo accuracy', credit: 'openai' },
    'whisper-large-v3-turbo_timestamped': { group: GROUPS[5], label: 'Whisper Large V3 Turbo Timestamped', size: '~2.88 GB', notes: 'Turbo + word timestamps', credit: 'openai' },
    'distil-whisper-small':  { group: GROUPS[6], label: 'Distil Whisper Small', size: '~538 MB', notes: 'English only · Distil', languages: EN, credit: 'distil' },
};

/** Home-page language table: the models listed and their order (each needs `languages`). */
export const HOME_MODELS: ASRModel[] = [
    'whisper-tiny', 'whisper-base', 'whisper-small', 'moonshine-tiny', 'moonshine-base',
    'distil-whisper-small', 'parakeet-ctc-0.6b', 'parakeet-tdt-0.6b-v3',
];

const a = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const CC_BY = a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0');

/** Credit sentences, in display order. Only credits used by some model are rendered. */
export const CREDITS: Record<CreditId, string> = {
    'nvidia-tdt': `${a('https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3', 'Parakeet TDT 0.6B v3')} by NVIDIA, licensed under ${CC_BY}. Changes: converted to ONNX and quantized by ${a('https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx', 'istupakov')}/${a('https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx', 'ysdede')}; runs with ${a('https://github.com/ysdede/parakeet.js', 'parakeet.js')} (MIT).`,
    'nvidia-ctc': `${a('https://huggingface.co/nvidia/parakeet-ctc-0.6b', 'Parakeet CTC 0.6B')} by NVIDIA, licensed under ${CC_BY}. Changes: converted to ONNX and quantized by ${a('https://huggingface.co/onnx-community', 'onnx-community')}.`,
    openai: 'Whisper by OpenAI (MIT).',
    moonshine: 'Moonshine by Useful Sensors (MIT).',
    distil: 'Distil-Whisper by Hugging Face (MIT).',
    lite: 'Lite-Whisper by efficient-speech (Apache-2.0).',
};
