// Copying the contents of a cut, for duplicate and paste.
//
// A cut cannot be copied by reference, and a deep copy alone is not enough either, because two
// things in it are shared rather than owned:
//
//  - Layer ids are only unique within a cut, so a copy renumbers them from 1. Keeping the
//    originals would be fine on its own, but the cache is keyed per (cut, layer) and the panel
//    addresses layers by id, so overlapping ids across cuts are a source of confusion at best.
//  - Stroke pixels live in a separate store and the stroke only carries an id. Copying the id
//    means both cuts point at the same pixels, and editing one changes the other - or worse,
//    deleting one cut frees pixels the other is still using. The pixels are copied too, and the
//    copies are shared within this one operation so a bitmap used by several strokes stays one
//    bitmap rather than becoming several.

/**
 * @param {object} srcCut the cut to copy from
 * @param {(oldId: any, cache: Map) => any} cloneBitmapId copies stored pixels, returning the new
 *   id; given the shared cache so it can return the same new id for a repeated old one
 * @returns {{layers: Array, activeLayerId: any, texts: Array}} the contents, ready for a new cut
 */
export function cloneCutContents(srcCut, cloneBitmapId) {
    const srcLayers = Array.isArray(srcCut?.layers) ? srcCut.layers : [];

    // Renumbered in order, so the copy reads 1..n whatever the original had.
    const idMap = new Map();
    let next = 1;
    for (const l of srcLayers) idMap.set(l.id, next++);

    const bmpCache = new Map();
    const layers = srcLayers.map(l => {
        const cl = JSON.parse(JSON.stringify(l));
        cl.id = idMap.get(l.id);
        // A parent outside this cut cannot come along, so the layer is promoted to the root
        // rather than left pointing at an id that means something else here.
        cl.parentId = (l.parentId != null && idMap.has(l.parentId)) ? idMap.get(l.parentId) : null;
        // Redo belongs to the editing session that produced it, not to the strokes.
        cl.redoStrokes = [];
        if (Array.isArray(cl.strokes)) {
            cl.strokes = cl.strokes.map(s => s.bitmapId ? { ...s, bitmapId: cloneBitmapId(s.bitmapId, bmpCache) } : s);
        }
        return cl;
    });

    // Falling back to any real layer matters: with none, drawing into the copy would have nowhere
    // to go and the first stroke would vanish.
    const activeLayerId = idMap.get(srcCut?.activeLayerId) ?? layers.find(l => l.type === 'layer')?.id ?? 1;
    const texts = (Array.isArray(srcCut?.texts) ? srcCut.texts : []).map(t => JSON.parse(JSON.stringify(t)));
    return { layers, activeLayerId, texts };
}
