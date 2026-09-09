// Cutting one long project into pieces that can be worked on separately.
//
// The other half of #123. Past a certain number of cuts the app lags, and that is not really
// fixable - lossless frames, a lot of data, a local machine or a free server tier - so the advice
// is to work in pieces. Advice like that is only followable if both halves exist: something to
// split with, and something to combine with. The combining is the export queue; this is the
// splitting, and without it the pieces had to be made by hand.
//
// It works on a document rather than on the app's state, which is what makes it testable and also
// what makes it cheap: the document is built once and sliced, rather than the app being rearranged
// once per piece.
//
// The one rule worth stating: **no cut may be lost.** Cuts that belong to no part are a piece of
// their own rather than being dropped, because "split this" must never mean "throw some away".

import { collectUsedBitmapIds } from './bitmapRefs.js';
import { derivePartsFrom } from './partOps.js';

/**
 * The pieces a project splits into, one per part.
 *
 * Times are left as they are. A piece that covered 30s to 60s of the original still says so, and
 * the export queue reads each piece's own range, so a split and a recombine come back to the same
 * film rather than to everything stacked at zero.
 *
 * Only the bitmaps a piece actually references travel with it - that is the whole point, and it is
 * `collectUsedBitmapIds`, the same function the garbage collector uses, rather than a second
 * opinion about what counts as a reference.
 *
 * The audio and the reference video are copied into every piece. They are small next to the
 * frames, and a piece you cannot hear the music over is a piece you cannot time anything against.
 *
 * @param {any} doc a document as buildData produces it
 * @param {string} [fallbackName] what to call a part whose cuts carry no name
 * @returns {{id: string, name: string, count: number, doc: any}[]}
 */
export function splitProject(doc, fallbackName = 'Part') {
    const cuts = Array.isArray(doc?.cuts) ? doc.cuts : [];
    if (!cuts.length) return [];

    const groups = [];
    for (const part of derivePartsFrom(cuts, fallbackName)) {
        groups.push({ id: part.id, name: part.name, cuts: cuts.filter(c => c.partId === part.id) });
    }
    // Anything the parts did not claim. Last, so a project that is entirely grouped is unaffected
    // and one that is partly grouped still comes back whole.
    const loose = cuts.filter(c => !c?.partId);
    if (loose.length) groups.push({ id: '', name: fallbackName, cuts: loose });

    return groups
        .filter(g => g.cuts.length)
        .map((g, i) => ({
            id: g.id || `rest-${i}`,
            name: g.name,
            count: g.cuts.length,
            doc: pieceOf(doc, g.cuts),
        }));
}

/**
 * One piece: the document with only these cuts, and only the pixels they use.
 *
 * @param {any} doc
 * @param {any[]} cuts
 * @returns {any}
 */
function pieceOf(doc, cuts) {
    const keep = collectUsedBitmapIds({ cuts });
    const bitmaps = {};
    for (const [id, value] of Object.entries(doc.bitmaps || {})) {
        if (keep.has(id)) bitmaps[id] = value;
    }
    const compressed = (doc.compressedBitmaps || []).filter(id => keep.has(id));
    return {
        ...doc,
        savedAt: new Date().toISOString(),
        cuts,
        bitmaps,
        // Only written when there is something in it, so a piece of pure line art does not carry
        // an empty list that says "these frames are compressed".
        ...(compressed.length ? { compressedBitmaps: compressed } : { compressedBitmaps: undefined }),
        // Server assets are addressed by the project they were uploaded under, and a piece is not
        // that project. Dropping the list turns a piece into a self-contained file, which is what
        // it has to be to be opened on its own.
        assets: undefined,
    };
}

/**
 * A file name for a piece: ordered, so a directory listing is the running order.
 *
 * @param {number} index zero-based
 * @param {number} total
 * @param {string} name
 * @returns {string}
 */
export function pieceFileName(index, total, name) {
    const width = String(Math.max(1, total)).length;
    const safe = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'part';
    return `${String(index + 1).padStart(width, '0')}_${safe}.emv`;
}
