/** Renders model lists for the site from MODELS + MODEL_META (used by the Vite html plugin). */
import { MODELS, type ASRModel } from '../src/types';

// Display order = MODEL_META key order (MODEL_META is typed Record<ASRModel, …>, so it covers MODELS).
import { CREDITS, GROUPS, HOME_MODELS, MODEL_META, type CreditId } from './model-meta';

const ids = () => Object.keys(MODEL_META) as ASRModel[];

export function renderOptions(opts: { selected?: string; sizes?: boolean; indent?: string } = {}): string {
    const ind = opts.indent ?? '';
    const out: string[] = [];
    for (const group of GROUPS) {
        const members = ids().filter((id) => MODEL_META[id].group === group);
        if (!members.length) continue;
        out.push(`${ind}<optgroup label="${group}">`);
        for (const id of members) {
            const m = MODEL_META[id];
            const label = opts.sizes === false ? m.label : `${m.label} (${m.size})`;
            out.push(`${ind}  <option value="${id}"${id === opts.selected ? ' selected' : ''}>${label}</option>`);
        }
        out.push(`${ind}</optgroup>`);
    }
    return out.join('\n');
}

/** Docs table rows: model · size · notes (picker order). */
export function renderDocsRows(indent = ''): string {
    return orderedIds().map((id) => {
        const m = MODEL_META[id];
        return `${indent}<tr><td><code>${id}</code></td><td>${m.size}</td><td>${m.notes}</td></tr>`;
    }).join('\n');
}

/** Home language table rows, in HOME_MODELS order. */
export function renderHomeRows(indent = ''): string {
    return HOME_MODELS.map((id) => {
        if (!MODEL_META[id].languages) throw new Error(`HOME_MODELS entry ${id} has no languages`);
        const m = MODEL_META[id];
        const lang = MODELS[id].supportsLanguage ? '<td class="td-check">✓</td>' : '<td class="td-dash">—</td>';
        const muted = MODELS[id].supportsLanguage ? '<td>' : '<td class="td-muted">';
        return [`${indent}<tr>`, `${indent}  <td><code>${id}</code></td>`, `${indent}  ${muted}${m.languages}</td>`, `${indent}  ${lang}`, `${indent}</tr>`].join('\n');
    }).join('\n');
}

export function renderCredits(): string {
    const used = new Set<CreditId>(ids().map((id) => MODEL_META[id].credit));
    const parts = (Object.keys(CREDITS) as CreditId[]).filter((c) => used.has(c)).map((c) => CREDITS[c]);
    return `<p class="model-credits" style="font-size:12px;opacity:.75;margin-top:12px;line-height:1.5">
  Model credits: ${parts.join(' ')} ONNX exports by <a href="https://huggingface.co/onnx-community" target="_blank" rel="noopener">onnx-community</a>. <a href="https://github.com/tanpreetjolly/browser-whisper/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">All third-party notices</a>.
</p>`;
}

function orderedIds(): ASRModel[] {
    return GROUPS.flatMap((g) => ids().filter((id) => MODEL_META[id].group === g));
}

/**
 * Replaces `<!-- @models:NAME key=value ... -->` markers. NAME is options | docs-rows |
 * home-rows | credits. Options takes `selected=<id>` and `sizes=false`.
 */
export function expandModelMarkers(html: string): string {
    return html.replace(/^([ \t]*)<!-- @models:([a-z-]+)((?: [a-z]+=[^\s>]+)*) -->/gm, (_m, indent: string, name: string, rawArgs: string) => {
        const args = Object.fromEntries(rawArgs.trim().split(/\s+/).filter(Boolean).map((kv) => kv.split('=')));
        switch (name) {
            case 'options': return renderOptions({ selected: args.selected, sizes: args.sizes !== 'false', indent });
            case 'docs-rows': return renderDocsRows(indent);
            case 'home-rows': return renderHomeRows(indent);
            case 'credits': return renderCredits();
            default: throw new Error(`Unknown model marker @models:${name}`);
        }
    });
}

export function modelListsPlugin() {
    return { name: 'browser-whisper-model-lists', transformIndexHtml: (html: string) => expandModelMarkers(html) };
}
