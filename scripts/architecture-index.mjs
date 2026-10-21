// Keeps ARCHITECTURE.md's file map honest.
//
// The map is the first thing to read before editing - its own title says so - and on 2026-10-14
// it was missing 34 of the 152 files under src/, 22% of the codebase. Nothing had gone wrong in
// any one change. Each file was added by a PR that had something else to do, and the map was
// never on anyone's list, so it fell further behind with every module: the same drift the
// process review (docs/process/) put down to incremental development itself, where producing a
// document for every version is never the cheapest next step.
//
// HELPERS.md had the same problem and solved it by being checked, and this is that rule applied
// to the map. Add a file under src/ and forget to say what it is, and the gate fails. It checks
// that the file is named, not that the sentence beside it is good - the same line HELPERS.md
// draws, and for the same reason: whether a description is right is a review question, whether
// it exists at all is not.
//
// A file counts as named when its filename appears in backticks - `layerOps.ts`, or a path that
// ends in it. Basenames under src/ are unique, which is what makes the filename alone enough.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MAP = 'ARCHITECTURE.md';

/**
 * The files the map does not name.
 *
 * @param {string} doc the map's text
 * @param {string[]} files repository paths
 * @returns {string[]}
 */
export function unnamed(doc, files) {
    const named = new Set();
    for (const m of doc.matchAll(/`([^`\n]+)`/g)) {
        // A backtick span can hold several names ("`a.ts` / `b.ts`" is two spans, but
        // "`frameExport.ts`/`exportQueue.ts`" and a path like `src/core/x.ts` are common too).
        for (const part of m[1].split(/[\s,/]+/)) if (/\.(tsx?|d\.ts)$/.test(part)) named.add(part);
    }
    return files.filter(f => !named.has(f.split('/').pop()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // --others as well: a file not yet added is still a file the map should name, and checking
    // only the index let a new one pass here and fail later in CI.
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { encoding: 'utf8' })
        .split('\n').filter(f => /\.(ts|tsx)$/.test(f));
    const missing = unnamed(readFileSync(MAP, 'utf8'), files);
    if (missing.length) {
        console.error(`${missing.length} file(s) under src/ that ${MAP} does not name:`);
        for (const f of missing) console.error(`  ${f}`);
        console.error(`
${MAP} is read before editing, and a map that is missing a fifth of the territory teaches
people to stop reading it. Add a line under the file's folder saying what it is for - one
sentence is enough; the name alone is what this checks.`);
        process.exit(1);
    }
    console.log(`Architecture map passed - all ${files.length} files under src/ are named in ${MAP}`);
}
