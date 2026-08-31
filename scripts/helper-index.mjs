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
// Directories whose exports are shared vocabulary. App.jsx and the ui/ components are excluded:
// those export React components, which are found by reading the screen rather than an index.
const DIRS = ['src/core', 'src/canvas', 'src/hooks', 'server'];

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

if (missing.length || stale.length) {
    if (missing.length) {
        console.error(`${missing.length} shared export(s) not in ${INDEX}:`);
        for (const { name, path } of missing) console.error(`  ${name}  (${path})`);
    }
    if (stale.length) {
        console.error(`${stale.length} entr(y/ies) in ${INDEX} name something that no longer exists:`);
        for (const n of stale) console.error(`  ${n}`);
    }
    console.error(`\n${INDEX} is what stops the next person reimplementing one of these. Add the row.`);
    process.exit(1);
}

console.log(`Helper index passed - ${found.length} shared exports, all listed in ${INDEX}`);
