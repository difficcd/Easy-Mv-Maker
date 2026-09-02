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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DICT = 'src/i18n.js';
const JA_DICT = 'src/i18n.ja.js';
const HANGUL = /[가-힣]/;
// A single-quoted JS string: anything but a quote or a backslash, or an escape pair.
const STRING = "((?:[^'\\\\]|\\\\.)*)";

const dictKeys = (path) => new Set(
    [...readFileSync(path, 'utf8').matchAll(new RegExp("^\\s*'" + STRING + "':", 'gm'))].map(m => m[1]),
);
const keys = dictKeys(DICT);
const jaKeys = dictKeys(JA_DICT);

/** Every tr('...') literal in the source, with the first file it was seen in. */
const used = new Map();
const walk = (dir) => {
    // withFileTypes rather than a stat per entry: one syscall instead of two, and no window
    // between asking what a path is and reading it - which is what CodeQL flags, and it is
    // right that the two-step version is the worse way to write this.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const name = entry.name;
        const path = join(dir, name);
        if (entry.isDirectory()) { walk(path); continue; }
        const rel = path.replace(/\\/g, '/');
        if (!/\.jsx?$/.test(name) || rel === DICT || rel === JA_DICT) continue;
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

// Japanese is allowed to be incomplete - tr() falls back to English, which a Japanese reader
// can work with. What is not allowed is a key the English dictionary does not have: English is
// the authority on what the keys are, so an entry outside it is dead weight nobody will notice,
// and it usually means a string was reworded and the translation left behind.
//
// Checking against the English dictionary rather than against the tr() literals is deliberate:
// some strings reach tr() through a variable, so they are real keys the scanner never sees.
// A Japanese entry may be the trimmed form of a padded English key: tr() retries with the
// key trimmed, so one entry covers both, and requiring the padding back would be busywork.
const trimmed = new Set([...keys].map(k => k.trim()));
const stale = [...jaKeys].filter(k => !keys.has(k) && !trimmed.has(k));
if (stale.length) {
    console.error(`${stale.length} Japanese entr(y/ies) with no English key:`);
    for (const k of stale) console.error(`    ${k}`);
    console.error('\nRemove them from src/i18n.ja.js, or fix the key if the string was reworded.');
    process.exit(1);
}

// Trimmed too, because tr() retries with the key trimmed: the dictionary keeps one entry
// for '\uc0ad\uc81c \uc2e4\ud328:' and it covers the padded '\uc0ad\uc81c \uc2e4\ud328: ' as well.
const jaHave = [...keys].filter(k => jaKeys.has(k) || jaKeys.has(k.trim())).length;
const pct = keys.size ? Math.round((jaHave / keys.size) * 100) : 100;
console.log(`i18n check passed - ${used.size} tr() strings, all translated`);
console.log(`  Japanese: ${jaHave}/${keys.size} (${pct}%)${jaHave === keys.size ? `` : `, the rest falls back to English`}`);
