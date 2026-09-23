// No alert(), confirm() or prompt() in src/.
//
// A browser can be told to prevent a page from making further dialogs. It is one checkbox on the
// second dialog, it is easy to tick by accident, and it sticks for the origin until the site data
// is cleared. After that alert() shows nothing, confirm() returns false, and prompt() returns
// null - immediately, with no error and no way for the page to find out.
//
// So every guarded action quietly stops working. Delete asks nothing and deletes nothing; save
// asks for no name and saves nothing; a long export refuses to start and says why to nobody. The
// app looks broken in the one way that is hardest to report: the buttons do nothing at all.
//
// It is not hypothetical. LinkPromptModal exists because the YouTube button died exactly this way
// and was assumed to be a network problem. Fifty-two sites followed it, in three passes: the
// alerts to notices, the confirms and prompts to AskModal, and this file so the fourth pass never
// has to happen.
//
// Use instead:
//   alert    notices.setToast for what went right, notices.setError for what did not
//   confirm  await ask.confirm(question, { okLabel })   - hooks/useAsk
//   prompt   await ask.prompt(question, { value, okLabel })

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Calls to the three native dialogs, bare or on window.
 *
 * Matched on the call, not on an import, because these are globals - there is nothing to import
 * and so nothing to grep for. A member call on anything else is left alone: `ask.confirm(...)`
 * and `this.prompt(...)` are not what this is about, and the lookbehind is what tells them apart.
 *
 * @param {string} src
 * @returns {Array<{line: number, text: string}>}
 */
export function nativeDialogs(src) {
    const call = /(?<![.\w$])(?:window\s*\.\s*)?(alert|confirm|prompt)\s*\(/;
    const out = [];
    src.split(/\r?\n/).forEach((text, i) => {
        // A line that is only a comment is describing one, not making one - and this file's own
        // "use instead" list would otherwise fail the check it defines.
        const code = text.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (call.test(code)) out.push({ line: i + 1, text: code });
    });
    return out;
}

/** Sites allowed to call one anyway, and why. Empty, and meant to stay that way. */
export const ALLOWED = [];

const isAllowed = (file, text) => ALLOWED.some(a => file.endsWith(a.file) && text.includes(a.match));

const found = [];
const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.[jt]sx?$/.test(entry.name)) continue;
        const rel = path.split('\\').join('/');
        for (const hit of nativeDialogs(readFileSync(path, 'utf8'))) {
            if (!isAllowed(rel, hit.text)) found.push({ ...hit, file: rel });
        }
    }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    walk('src');
    if (found.length) {
        console.error(`${found.length} native dialog call(s) in src/:`);
        for (const f of found) console.error(`  ${f.file}:${f.line}\n    ${f.text.slice(0, 110)}`);
        console.error(`
A browser told to prevent additional dialogs drops alert(), and makes confirm() return false and
prompt() return null for ever - silently. The guarded action then does nothing and reports nothing.
Use notices.setToast / notices.setError for a message, and ask.confirm / ask.prompt (hooks/useAsk)
for a question. If a site genuinely needs the native one, add it to ALLOWED here with the reason.`);
        process.exit(1);
    }
    console.log('Native dialogs passed - none in src/.');
}
