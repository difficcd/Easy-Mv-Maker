// Keeps HELPERS.md honest.
//
// This exists because of a specific, repeated mistake: writing a helper that already existed.
// `clearLiveOverlay` was reimplemented by hand in four places while the real one sat two hundred
// lines below them, and the timeline gutter width had seven copies. Neither was carelessness so
// much as not knowing - a four-thousand-line component does not announce what it already has.
//
// A document alone would not have helped, because a document nobody updates is worse than none:
// it teaches you to distrust it, and then you stop looking. So the index is checked. Export
// something shared and forget to list it, and this fails - the same way the hook baseline fails
// when stale-closure risk grows.
//
// It checks presence, not prose. Whether the description is any good is a review question; that
// the entry exists at all is not.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const INDEX = 'HELPERS.md';
// Directories whose exports are shared vocabulary. Found on disk rather than listed, because a
// hand-kept list is a guard with a hole in it: src/engine went unindexed when it was created,
// and src/export did the same the next time - each time the check passed while missing things.
// Only ui/ is excluded, since those export React components, which are found by reading the
// screen rather than an index. App.jsx is a file, not a directory, so it never enters.
const EXCLUDE = new Set(['ui']);
const DIRS = [
    ...readdirSync('src', { withFileTypes: true })
        .filter(d => d.isDirectory() && !EXCLUDE.has(d.name))
        .map(d => `src/${d.name}`),
    'server',
];

/** Exported function and const names in one module. */
function exportsOf(source) {
    const names = new Set();
    for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) names.add(m[1]);
    for (const m of source.matchAll(/^export\s+const\s+(\w+)\s*=/gm)) names.add(m[1]);
    return [...names];
}

const found = [];
for (const dir of DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
        if (!/\.jsx?$/.test(file)) continue;
        const path = `${dir}/${file}`;
        for (const name of exportsOf(readFileSync(join(dir, file), 'utf8'))) {
            found.push({ name, path });
        }
    }
}

if (!existsSync(INDEX)) {
    console.error(`${INDEX} is missing. It is the index of what already exists; see scripts/helper-index.mjs.`);
    process.exit(1);
}
const index = readFileSync(INDEX, 'utf8');

// A name counts as indexed when it appears as `name` in a table row. Backticks rather than a bare
// word so that a symbol mentioned in passing in a paragraph does not count as documenting it.
const missing = found.filter(({ name }) => !index.includes(`\`${name}\``));

// The other direction: an entry left behind after the thing it describes was renamed or removed,
// which is how an index quietly becomes fiction.
const names = new Set(found.map(f => f.name));
const stale = [...index.matchAll(/^\| `(\w+)`/gm)].map(m => m[1]).filter(n => !names.has(n));

// What a row actually says. Checking only that the name appears left this index 70% wrong
// without a word of complaint: 32 rows had no description at all, 62 ended mid-comment in `*/`,
// and 17 groups of rows shared one description - every export of layerOps.js claimed to be
// isDescendantOf, because the rows had been filled from the first comment in each file rather
// than from each export's own. An index that answers "does this already exist" wrongly is worse
// than no index, because it is trusted.
const described = [...index.matchAll(/^\| `(\w+)` \| (.*?) \|$/gm)].map(m => ({ name: m[1], text: m[2].trim() }));
const blank = described.filter(r => !r.text);
// A row that starts mid-sentence. The rows were once regenerated in bulk by taking a fixed number
// of characters from each export's comment, which sometimes started at the tail of a sentence -
// "frame would be N times slower.", "so callers can skip the save/transform fast-path." Those are
// not blank and not duplicated, so nothing caught them, and a row that reads as nonsense is
// almost as bad as no row: it is the answer somebody gets when they ask what a helper is for.
const startsLower = described.filter(r => {
    // A row that opens with a code span is naming something, not continuing a sentence.
    if (r.text.startsWith('`')) return false;
    const first = r.text.split(/\s/)[0] || '';
    return /^[a-z]/.test(first) && !['a', 'an', 'the'].includes(first.toLowerCase());
});
const fragment = described.filter(r => r.text.endsWith('*/'));
const byText = new Map();
for (const r of described) byText.set(r.text, [...(byText.get(r.text) || []), r.name]);
const shared = [...byText.entries()].filter(([, names]) => names.length > 1);

if (missing.length || stale.length || blank.length || fragment.length || shared.length || startsLower.length) {
    if (missing.length) {
        console.error(`${missing.length} shared export(s) not in ${INDEX}:`);
        for (const { name, path } of missing) console.error(`  ${name}  (${path})`);
    }
    if (stale.length) {
        console.error(`${stale.length} entr(y/ies) in ${INDEX} name something that no longer exists:`);
        for (const n of stale) console.error(`  ${n}`);
    }
    if (blank.length) {
        console.error(`${blank.length} row(s) with no description:`);
        for (const r of blank) console.error(`  ${r.name}`);
    }
    if (fragment.length) {
        console.error(`${fragment.length} row(s) ending in \`*/\`, so a comment was copied in by mistake:`);
        for (const r of fragment) console.error(`  ${r.name}`);
    }
    if (startsLower.length) {
        console.error(`${startsLower.length} row(s) starting mid-sentence, so a comment was clipped rather than written:`);
        for (const r of startsLower) console.error(`  ${r.name}
    ${r.text.slice(0, 80)}`);
    }
    if (shared.length) {
        console.error(`${shared.length} description(s) used by more than one row - at most one of them is true:`);
        for (const [text, names] of shared) console.error(`  ${names.join(', ')}\n    ${text.slice(0, 90)}`);
    }
    console.error(`\n${INDEX} is what stops the next person reimplementing one of these. It only works if the rows are true.`);
    process.exit(1);
}

console.log(`Helper index passed - ${found.length} shared exports, all listed in ${INDEX}`);
