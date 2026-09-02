// Which pasted bitmaps a set of cuts needs but does not have decoded yet.
//
// Two callers ask the same question for opposite reasons. Playback asks so it can hold the last
// frame instead of flashing a half-drawn one; the frame exporter asks so it can wait for the
// decode and write a frame that is actually complete. Both used to be the same nested loop,
// which is the kind of duplication where the two copies quietly drift apart.

/**
 * @typedef {{ blob?: unknown, imageBitmap?: unknown, imageData?: unknown }} BitmapEntry
 * @typedef {{ get(id: string): BitmapEntry | undefined }} BitmapStore
 */

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
            for (const stroke of (Array.isArray(layer.strokes) ? layer.strokes : [])) {
                if (stroke.tool !== 'paste' || !stroke.bitmapId || seen.has(stroke.bitmapId)) continue;
                const entry = store.get(stroke.bitmapId);
                // A blob with nothing decoded from it is the pending case. No blob at all means
                // there is nothing to wait for, and either decoded form is enough to draw with.
                if (entry && entry.blob && !entry.imageBitmap && !entry.imageData) {
                    seen.add(stroke.bitmapId);
                    out.push(stroke.bitmapId);
                }
            }
        }
    }
    return out;
}
