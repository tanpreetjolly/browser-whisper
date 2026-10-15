/**
 * Bundle-size budget for the published library (run after `bun run build`).
 * Budgets are ~5% above the size when they were set. Raise them deliberately, in the PR that
 * needs it, with a note on why (a new engine must lazy-load, not grow the default worker).
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGETS: Record<string, { raw: number; gzip: number }> = {
    // 2026-10: 1,334,266 B raw / 312,476 B gzip (inlined worker blobs incl. transformers.js)
    'dist/index.js': { raw: 1_400_000, gzip: 330_000 },
};

let failed = false;
for (const [file, budget] of Object.entries(BUDGETS)) {
    const buf = readFileSync(file);
    const gzip = gzipSync(buf, { level: 9 }).length;
    const ok = buf.length <= budget.raw && gzip <= budget.gzip;
    failed ||= !ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}: ${buf.length.toLocaleString()} B raw (budget ${budget.raw.toLocaleString()}), ${gzip.toLocaleString()} B gzip (budget ${budget.gzip.toLocaleString()})`);
}
if (failed) {
    console.error('Bundle size budget exceeded. Lazy-load the new code or raise the budget with a justification.');
    process.exit(1);
}
