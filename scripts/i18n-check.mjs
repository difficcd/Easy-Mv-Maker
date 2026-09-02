// Every tr() literal must have a translation.
//
// The dictionary uses the Korean source text as its key, so a missing entry is not an error - it
// simply shows Korean. That is a good failure mode for a user and a bad one for a reviewer: the
// English UI grows Korean labels one feature at a time and nothing breaks, so nobody notices.
//
// It happened. The camera panel and the clipping controls shipped untranslated, and it took
// driving the built app in a browser to see it - 36 strings, including error messages, which is
// the worst place to fall back to another language because they are read by somebody who is
// already confused.
//
// Presence only. Whether a translation is any good is a review question.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DICT = 'src/i18n.js';
const HANGUL = /[가-힣]/;
// A single-quoted JS string: anything but a quote or a backslash, or an escape pair.
const STRING = "((?:[^'\\\\]|\\\\.)*)";

const keys = new Set(
    [...readFileSync(DICT, 'utf8').matchAll(new RegExp("^\\s*'" + STRING + "':", 'gm'))].map(m => m[1]),
);

/** Every tr('...') literal in the source, with the first file it was seen in. */
const used = new Map();
const walk = (dir) => {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.jsx?$/.test(name) || path.replace(/\\/g, '/') === DICT) continue;
        const src = readFileSync(path, 'utf8');
        for (const m of src.matchAll(new RegExp("tr\\('" + STRING + "'", 'g'))) {
            if (!used.has(m[1])) used.set(m[1], path);
        }
    }
};
walk('src');

const missing = [...used].filter(([text]) => HANGUL.test(text) && !keys.has(text));

if (missing.length) {
    console.error(`${missing.length} string(s) used with tr() but not translated:`);
    for (const [text, path] of missing) console.error(`  ${path}\n    ${text}`);
    console.error('\nAdd them to src/i18n.js, or the English UI shows Korean.');
    process.exit(1);
}

console.log(`i18n check passed - ${used.size} tr() strings, all translated`);
