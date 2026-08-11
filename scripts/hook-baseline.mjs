// Checks only whether hook dependency warnings have grown.
//
// Why not demand zero: most of the remaining warnings are deliberate. This app repaints a
// canvas every frame and holds heavy caches, so adding every dependency the linter asks for
// reruns those effects continuously - which is how the "Maximum update depth exceeded" loop
// that actually happened here came about. The current state is pinned as a baseline instead,
// and the check fails when a change introduces new warnings, meaning new stale-closure risk.
// Run with UPDATE=1 to move the baseline on purpose.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE = 'scripts/hook-baseline.json';
// eslint is run through node directly: spawning the .cmd wrapper on Windows gives EINVAL.
const eslintBin = 'node_modules/eslint/bin/eslint.js';

let out = '';
try {
    out = execFileSync(process.execPath, [eslintBin, 'src', '-f', 'json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
    // eslint exits non-zero when it finds problems, but the result JSON still comes on stdout.
    out = e.stdout || '';
    if (!out) { console.error('Failed to run eslint:', e.message); process.exit(1); }
}

const results = JSON.parse(out);
let errors = 0;
const counts = {};
for (const f of results) {
    const file = f.filePath.split(/[\\/]/).pop();
    for (const m of f.messages) {
        if (m.severity === 2) errors++;
        const key = `${file}:${m.ruleId}`;
        counts[key] = (counts[key] || 0) + 1;
    }
}

if (process.env.UPDATE === '1' || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
    console.log('Recorded the hook-warning baseline:', JSON.stringify(counts));
    process.exit(errors ? 1 : 0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const grown = [];
for (const [k, n] of Object.entries(counts)) {
    const was = base[k] || 0;
    if (n > was) grown.push(`  ${k}: ${was} → ${n}`);
}

if (errors) {
    console.error(`${errors} rules-of-hooks error(s): a hook is being called in the wrong place.`);
    process.exit(1);
}
if (grown.length) {
    console.error('Hook dependency warnings have grown (stale-closure risk):');
    console.error(grown.join('\n'));
    console.error('If this is intended, refresh the baseline with  UPDATE=1 node scripts/hook-baseline.mjs');
    process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Hook check passed - ${total} warning(s), within baseline, 0 violations`);
