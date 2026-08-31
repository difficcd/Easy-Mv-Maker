// Which stored bitmaps are still referenced by something.
//
// Pixels for pasted regions, lifted lasso selections and imported video frames live in one store
// keyed by id; strokes only carry the id. Anything not reachable from a reference source can be
// freed. Getting that set wrong is expensive in one direction only: miss a source and the
// collector deletes pixels that are still needed, so an undo or a paste comes back blank.
//
// The sources are easy to forget because most of them are not the current drawing: undo history
// holds older cuts, the clipboard holds a copied cut, and a live selection holds both its own
// bitmap and its mask. That is why this is one function with every source named, rather than a
// scan spread across the code that collects them.

/** Ids referenced by the strokes of a list of cuts. */
function scanCuts(cuts, into) {
    if (!Array.isArray(cuts)) return;
    for (const c of cuts) {
        if (!c || !Array.isArray(c.layers)) continue;
        for (const l of c.layers) {
            if (!l || !Array.isArray(l.strokes)) continue;
            for (const s of l.strokes) if (s && s.bitmapId) into.add(s.bitmapId);
        }
    }
}

/**
 * @param {object} [sources]
 * @param {Cut[]} [sources.cuts]       the cuts on screen now
 * @param {{cuts?: Cut[]}[]} [sources.history] undo snapshots
 * @param {Cut|Cut[]|null} [sources.copiedCut] clipboard: one cut or several
 * @param {{bitmapId?: string|null}|null} [sources.lassoClip] copied lasso selection
 * @param {{bitmapId?: string|null, maskBitmapId?: string|null}|null} [sources.selection] the live selection, which has a mask as well
 * @returns {Set<string>} every id that must be kept
 */
export function collectUsedBitmapIds({ cuts, history, copiedCut, lassoClip, selection } = {}) {
    const used = new Set();

    scanCuts(cuts, used);

    // Undo snapshots reference bitmaps the current cuts no longer do; dropping those makes undo
    // restore an empty region.
    if (Array.isArray(history)) for (const snap of history) scanCuts(snap?.cuts, used);

    if (copiedCut) scanCuts(Array.isArray(copiedCut) ? copiedCut : [copiedCut], used);

    if (lassoClip?.bitmapId) used.add(lassoClip.bitmapId);

    // A selection keeps two: the lifted pixels and the mask that shapes them. Losing the mask
    // alone is the subtler failure - the region comes back as a rectangle.
    if (selection) {
        if (selection.bitmapId) used.add(selection.bitmapId);
        if (selection.maskBitmapId) used.add(selection.maskBitmapId);
    }

    return used;
}

/** Ids present in the store that nothing references any more. */
export function unusedBitmapIds(storeKeys, sources) {
    const used = collectUsedBitmapIds(sources);
    return [...storeKeys].filter(id => !used.has(id));
}
