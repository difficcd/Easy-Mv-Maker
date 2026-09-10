// Imports nothing in the file uses.
//
// The refactoring that pulled hooks and pure modules out of App.jsx left its import list behind:
// twenty-eight names at the top of the file that nothing below them mentioned, and one name
// imported twice from the same module because the second import was easier to add than to check
// for the first. None of it broke anything, which is the problem - a dead import is invisible
// while it makes the header of a file lie about what the file needs.
//
// The other gates could not see it. `unreachable` asks what App's own names reach, and an import
// is not one of App's names. `helper-index` asks whether an export is written down. Neither asks
// whether anything actually imports what is imported.
//
// Comments count as use. A name kept alive only by a JSDoc @type is genuinely needed by the
// typechecker, and one merely mentioned in prose is not worth a false alarm.
//
// Run with UPDATE=1 to see the list without failing.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOTS = ['src', 'server', 'scripts'];
const CODE = /\.(jsx?|mjs)$/;

/** @param {string} dir */
function files(dir) {
    /** @type {string[]} */
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...files(path));
        else if (CODE.test(name)) out.push(path.replaceAll('\\', '/'));
    }
    return out;
}

/**
 * The names one file imports, and where each was written.
 *
 * @param {string} src
 * @returns {Array<{name: string, line: number, from: string}>}
 */
export function importedNames(src) {
    /** @type {Array<{name: string, line: number, from: string}>} */
    const out = [];
    // Only the clause before `from`, so a path containing a word like `camera` is never read as
    // a name. The clause may not contain a `;`, or a side-effect import (`import './App.css';`)
    // would be swallowed into the clause of the statement after it and its names read as one.
    const re = /^import\s+([^;]*?)\s+from\s+'([^']+)';/gm;
    for (const m of src.matchAll(re)) {
        const line = src.slice(0, m.index).split('\n').length;
        const clause = m[1];
        const braces = clause.match(/\{([\s\S]*)\}/);
        // `import React, { useState }` - the part before the brace is the default binding.
        const lead = (braces ? clause.slice(0, clause.indexOf('{')) : clause).replace(/,\s*$/, '').trim();
        if (lead && !lead.startsWith('*')) out.push({ name: lead, line, from: m[2] });
        // A namespace import is used as `ns.thing`, which the word check below still finds.
        const star = lead.match(/^\*\s+as\s+(\w+)$/);
        if (star) out.push({ name: star[1], line, from: m[2] });
        if (braces) {
            for (const part of braces[1].split(',')) {
                const name = part.trim().split(/\s+as\s+/).pop()?.trim();
                if (name) out.push({ name, line, from: m[2] });
            }
        }
    }
    return out;
}

/**
 * Which of a file's imports nothing else in it mentions.
 *
 * @param {string} src
 * @returns {Array<{name: string, line: number, from: string, why: string}>}
 */
export function unusedImports(src) {
    const imports = importedNames(src);
    // Everything after the last import is the body. Anything before it is another import, and an
    // import mentioning a name does not count as using it - otherwise a duplicate would hide
    // itself.
    const lastEnd = [...src.matchAll(/^import\s+[^;]*?\s+from\s+'[^']+';/gm)]
        .reduce((end, m) => Math.max(end, (m.index ?? 0) + m[0].length), 0);
    const body = src.slice(lastEnd);
    const seen = new Set();
    /** @type {Array<{name: string, line: number, from: string, why: string}>} */
    const out = [];
    for (const imp of imports) {
        if (seen.has(imp.name)) { out.push({ ...imp, why: 'imported twice' }); continue; }
        seen.add(imp.name);
        if (!new RegExp(`\\b${imp.name.replace(/[$]/g, '\\$&')}\\b`).test(body)) {
            out.push({ ...imp, why: 'never used' });
        }
    }
    return out;
}

// Only when this file is what was run. The two functions above are imported by the tests, and a
// scan that exits the process on import would take the whole test run down with it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const rows = [];
    for (const root of ROOTS) {
        for (const path of files(root)) {
            for (const bad of unusedImports(readFileSync(path, 'utf8'))) {
                rows.push(`  ${path}:${bad.line}  ${bad.name}  (${bad.why}, from '${bad.from}')`);
            }
        }
    }

    if (!rows.length) {
        console.log('Import check passed - every imported name is used.');
    } else {
        console.log(`${rows.length} unused import(s):`);
        console.log(rows.join('\n'));
        console.log('\nA dead import makes the header of a file lie about what the file needs. Delete it.');
        if (!process.env.UPDATE) process.exit(1);
    }
}
