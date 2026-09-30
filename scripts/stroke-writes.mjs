// Every write that adds a stroke to a layer must go through commitStroke.
//
// commitStroke does two things no caller should have to remember: it refuses an id that names
// no layer, so a write cannot evaporate into a folder or a deleted layer, and it makes the
// target and the folders above it visible, so the result cannot land where nobody can see it.
//
// Both failures are silent, and both shipped. The lasso paste evaporated; the mosaic evaporated
// after it; the bucket fill and the eraser landed invisibly. Each was found by someone noticing
// that a tool "did nothing" - the worst way to find a bug, and the same bug four times.
//
// So: a patch that touches `strokes` is only allowed where the write is not a stroke being added
// for the user to see - the selection's erase-hole on the layer it came from, which must not
// reveal anything. Those are listed below, with the reason.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sites where patchLayer is used to change a layer's strokes.
 *
 * Found by looking for `patchLayer(` and then, within that line and the two after it, a
 * `strokes:` field. Crude on purpose: it is a gate, not a parser, and a false positive is one
 * entry in ALLOWED away from being explained.
 *
 * @param {string} src
 * @returns {Array<{line: number, text: string}>}
 */
export function strokeWrites(src) {
    const lines = src.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        // patchLayer is the named way to change a layer, but a hand-rolled `layers.map` doing
        // the same thing is the same write. Looking only for patchLayer let the selection
        // commit through, and that one really was adding a visible stroke without the reveal
        // and without the check that the layer still exists.
        if (!lines[i].includes('patchLayer(') && !/\.map\s*\(/.test(lines[i])) continue;
        const window = lines.slice(i, i + 3).join(' ');   // the call may wrap
        if (!/strokes\s*:/.test(window)) continue;
        // `strokes: []` and `strokes: l.strokes` move nothing into a layer. What this is for is
        // a stroke being *added*, which always builds the new list out of the old one - either
        // by spreading it or by handing it to a helper.
        if (!/strokes\s*:\s*\[[^\]]*\.\.\./.test(window) && !/strokes\s*:\s*[A-Za-z_$][\w$]*\s*\(/.test(window)) continue;
        // The window travels with the hit: a site is often only identifiable by the line
        // under the one that matched, and ALLOWED has to be able to name it.
        out.push({ line: i + 1, text: lines[i].trim(), window });
    }
    return out;
}

/** Sites allowed to write strokes without commitStroke, and why. */
export const ALLOWED = [
    // The hole a lifted selection leaves in the layer it came from. Revealing that layer would
    // be wrong - the user hid it, and its pixels are now floating somewhere else.
    { file: 'src/App.tsx', match: 'sel.sourceLayerId' },
    // The eraser extending the stroke it is already drawing. The first point went through
    // commitStrokeToLayer, so the layer has been resolved and revealed already; this only adds
    // points to that stroke, and appendPoints leaves the list alone if it is not there.
    { file: 'src/tools/canvasTools.ts', match: 'appendPoints' },
    // commitStroke itself. It is the function every other site is told to use, so the write at
    // the bottom of it is the sanctioned one by definition - `place` is its caller-supplied
    // placement, which nothing else has.
    { file: 'src/core/layerOps.ts', match: 'place(l.strokes' },
];

const isAllowed = (file, hit) => ALLOWED.some(a => file.endsWith(a.file)
    && (hit.text.includes(a.match) || (hit.window || '').includes(a.match)));

const found = [];
const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.[jt]sx?$/.test(entry.name)) continue;
        const rel = path.split('\\').join('/');
        for (const hit of strokeWrites(readFileSync(path, 'utf8'))) {
            if (!isAllowed(rel, hit)) found.push({ ...hit, file: rel });
        }
    }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    walk('src');
    if (found.length) {
        console.error(`${found.length} stroke write(s) not going through commitStroke:`);
        for (const f of found) console.error(`  ${f.file}:${f.line}\n    ${f.text.slice(0, 110)}`);
        console.error(`
commitStroke refuses an id that names no layer, and reveals the one it writes to. Both failures
are silent: the lasso paste and the mosaic evaporated, the fill and the eraser landed invisibly.
Use commitStrokeToLayer - it takes a placement function if the stroke does not simply append.
If this site genuinely must do neither, add it to ALLOWED in this file with the reason.`);
        process.exit(1);
    }
    console.log('Stroke writes passed - every one goes through commitStroke.');
}
