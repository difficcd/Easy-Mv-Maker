// Which pasted bitmaps a layer or a frame needs but does not have decoded yet.
//
// Four callers ask this, for four reasons. Playback asks so it can hold the last frame instead
// of flashing a half-drawn one. The frame exporter asks so it can wait for the decode and write
// a frame that is actually complete. The layer cache asks twice: once to avoid baking a blank
// canvas, and once to note which bitmaps it did use so the LRU keeps them.
//
// All four were the same nested loop around the same four-term predicate, written out separately.
// A predicate copied four times is four chances to disagree about what "decoded" means, and the
// cost of disagreeing here is a blank layer cached under a signature that says it is complete.

/**
 * @typedef {{ blob?: unknown, imageBitmap?: unknown, imageData?: unknown }} BitmapEntry
 * @typedef {{ get(id: string): BitmapEntry | undefined }} BitmapStore
 */

/**
 * Whether this bitmap is known but not yet drawable.
 *
 * A blob with nothing decoded from it is the pending case. No blob at all means there is nothing
 * to wait for - it was never going to arrive - and either decoded form is enough to draw with.
 *
 * @param {BitmapEntry | undefined | null} entry
 * @returns {boolean}
 */
export function bitmapPending(entry) {
    return !!(entry && entry.blob && !entry.imageBitmap && !entry.imageData);
}

/**
 * The pasted bitmaps one layer refers to, split by whether they can be drawn yet.
 *
 * `decoded` is only the ones held as an ImageBitmap, because that is the form the LRU evicts and
 * so the only one worth touching. Ids appear once each.
 *
 * @param {any} layer
 * @param {BitmapStore} store
 * @returns {{ pending: string[], decoded: string[] }}
 */
export function scanLayerBitmaps(layer, store) {
    const pending = [];
    const decoded = [];
    if (!layer || !store) return { pending, decoded };
    const seen = new Set();
    for (const stroke of (Array.isArray(layer.strokes) ? layer.strokes : [])) {
        if (stroke.tool !== 'paste' || !stroke.bitmapId || seen.has(stroke.bitmapId)) continue;
        seen.add(stroke.bitmapId);
        const entry = store.get(stroke.bitmapId);
        if (bitmapPending(entry)) pending.push(stroke.bitmapId);
        else if (entry && entry.imageBitmap) decoded.push(stroke.bitmapId);
    }
    return { pending, decoded };
}

/**
 * @param {any[]} cuts the cuts drawn in this frame, not the whole document
 * @param {BitmapStore} store
 * @returns {string[]} ids to decode, without duplicates
 */
export function pendingBitmapIds(cuts, store) {
    if (!cuts || !store) return [];
    const out = [];
    const seen = new Set();
    for (const cut of cuts) {
        for (const layer of (cut && Array.isArray(cut.layers) ? cut.layers : [])) {
            // Folders hold no pixels, and a hidden layer is not drawn, so neither can stall a frame.
            if (layer.type !== 'layer' || layer.visible === false) continue;
            for (const id of scanLayerBitmaps(layer, store).pending) {
                if (seen.has(id)) continue;
                seen.add(id);
                out.push(id);
            }
        }
    }
    return out;
}
