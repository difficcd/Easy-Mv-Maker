// Pure layer-tree operations, lifted out of App.jsx's drag-and-drop handlers.
//
// The logic here is the interesting part of reordering layers - where a dragged item lands, what
// its parent becomes, and which moves have to be refused - and it was buried inside a DOM event
// handler, so none of it could be tested. Nothing in this file touches React or the DOM; it takes
// a layer array and returns a new one.
//
// The array is flat and ordered as the UI shows it. Nesting is expressed by parentId, and a
// folder's children are the entries that follow it with parentId pointing at it.

/** True when `folderId` is `maybeChildId` itself or an ancestor of it. */
export function isDescendantOf(layers, maybeChildId, folderId) {
    if (maybeChildId === folderId) return true;
    let cur = layers.find(l => l.id === maybeChildId);
    // The walk is bounded by the list length so a corrupted parentId cycle cannot hang the app.
    for (let guard = 0; cur && cur.parentId != null && guard <= layers.length; guard++) {
        if (cur.parentId === folderId) return true;
        cur = layers.find(l => l.id === cur.parentId);
    }
    return false;
}

/**
 * Move `layerId` relative to `targetId`.
 * `position` is 'before', 'after', or 'inside' (only meaningful when the target is a folder).
 * Returns a new array, or null when the move is refused and the caller should change nothing.
 */
export function moveLayer(layers, layerId, targetId, position = 'after') {
    if (!Array.isArray(layers) || layerId === targetId) return null;

    const from = layers.findIndex(l => l.id === layerId);
    if (from < 0) return null;
    if (!layers.some(l => l.id === targetId)) return null;

    const next = [...layers];
    const dragged = { ...next[from] };
    next.splice(from, 1);

    const target = next.find(l => l.id === targetId);
    if (!target) return null;                      // the target was the dragged item's only copy

    if (position === 'inside' && target.type === 'folder') {
        // A folder cannot be dropped into itself or into anything it contains: that detaches the
        // whole subtree from the root and it disappears from the panel.
        if (dragged.type === 'folder' && isDescendantOf(next, targetId, dragged.id)) return null;

        dragged.parentId = targetId;
        // Land after the folder's existing children rather than immediately under the folder row,
        // so repeated drops keep their order instead of stacking in reverse.
        let at = next.findIndex(l => l.id === targetId) + 1;
        while (at < next.length && next[at].parentId === targetId) at++;
        next.splice(at, 0, dragged);
    } else {
        dragged.parentId = target.parentId ?? null;
        const ti = next.findIndex(l => l.id === targetId);
        next.splice(position === 'before' ? ti : ti + 1, 0, dragged);
    }
    return next;
}

/**
 * Which layer a stroke should actually go into.
 *
 * The active layer is not always usable: it can be a folder, or point at something that no longer
 * exists. Falling back to the topmost visible drawable layer is what stops a stroke landing
 * nowhere. A hidden active layer is deliberately kept - commitStroke reveals it instead, so
 * drawing into a hidden layer shows the result rather than silently swallowing it.
 */
export function resolveDrawLayer(cut, flattenVisibleLeaves) {
    if (!cut || !Array.isArray(cut.layers)) return null;
    const active = cut.layers.find(l => l.id === cut.activeLayerId);
    if (active && active.type === 'layer') return active;
    const drawables = flattenVisibleLeaves(cut.layers);
    if (drawables.length) return drawables[drawables.length - 1];
    return cut.layers.find(l => l.type === 'layer') || null;
}

/**
 * Add a stroke to a layer and make sure it will be seen: the layer itself and every folder above
 * it are forced visible. Returns { activeLayerId, layers }, or null if the layer is gone.
 *
 * The reveal is the point. Without it, drawing into a hidden layer - or one inside a collapsed,
 * hidden folder - accepts the stroke and shows nothing, which reads as the drawing being lost.
 */
export function commitStroke(layers, layerId, stroke) {
    if (!Array.isArray(layers) || !layers.some(l => l.id === layerId)) return null;

    const byId = new Map(layers.map(l => [l.id, l]));
    const reveal = new Set();
    let cur = byId.get(layerId);
    for (let guard = 0; cur && cur.parentId != null && guard <= layers.length; guard++) {
        reveal.add(cur.parentId);
        cur = byId.get(cur.parentId);
    }

    return {
        activeLayerId: layerId,
        layers: layers.map(l => {
            if (l.id === layerId) return { ...l, visible: true, strokes: [...(l.strokes || []), stroke] };
            if (reveal.has(l.id)) return { ...l, visible: true };
            return l;
        }),
    };
}

/**
 * Where a bucket fill belongs in a layer's stroke list.
 *
 * Paint goes *under* the ink. That is how ink-and-paint has always worked, and here it is what
 * lets a fill bleed a few pixels past the line that bounds it: the line covers the overspill, so
 * when a boiling layer walks the line about, there is still paint underneath and the shape does
 * not read as hollow.
 *
 * Two things stop it being simply "put it at the bottom":
 *
 *  - Recolouring. Filling a region that is already painted produces paint over exactly the old
 *    paint's pixels; underneath, it would be completely hidden by the colour it is replacing.
 *    Those go on top, as before.
 *  - Erasers. An eraser composites destination-out against whatever is below it, so paint slid
 *    beneath an earlier eraser stroke would be eaten by it. The fill sits above the last eraser.
 *
 * @param {Array} strokes the layer's strokes
 * @param {object} fill the new fill stroke
 * @param {boolean} [overPaint] true when the fill is recolouring existing paint
 */
export function insertFill(strokes, fill, overPaint) {
    const list = Array.isArray(strokes) ? strokes : [];
    if (overPaint) return [...list, fill];
    let at = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] && (list[i].tool === 'eraser' || list[i].tool === 'paste')) { at = i + 1; break; }
    }
    return [...list.slice(0, at), fill, ...list.slice(at)];
}

/**
 * Shift whole layers, and optionally the cut's texts, by a pixel offset.
 *
 * This is what a move-everything drag commits. Two things are easy to get wrong and are the
 * reason it lives here rather than inline in the pointer-up handler:
 *
 *  - A stroke is either a path or a placed bitmap, and they carry position differently: one in
 *    every point, the other in a single x/y. Both have to move.
 *  - Only coordinates change, so the cached canvas signature - built from stroke count and the
 *    last stroke's identity - does not notice, and the layer would keep drawing at its old
 *    position. Bumping rev is what invalidates it.
 *
 * @param {object} cut the cut being edited
 * @param {Array} layerIds ids of the layers to move
 * @param {number} dx
 * @param {number} dy
 * @param {boolean} [withTexts] move the cut's text objects too
 * @returns {{layers: Array, texts: Array}} the changed fields, for the caller to merge
 */
export function offsetLayers(cut, layerIds, dx, dy, withTexts) {
    const ids = new Set(layerIds || []);
    const layers = Array.isArray(cut?.layers) ? cut.layers : [];
    const texts = Array.isArray(cut?.texts) ? cut.texts : [];
    return {
        layers: layers.map(l => !ids.has(l.id) ? l : ({
            ...l,
            rev: (l.rev || 0) + 1,
            strokes: (Array.isArray(l.strokes) ? l.strokes : []).map(st => st.points
                ? { ...st, points: st.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) }
                : { ...st, x: (st.x || 0) + dx, y: (st.y || 0) + dy }),
        })),
        texts: withTexts ? texts.map(t => ({ ...t, x: (t.x || 0) + dx, y: (t.y || 0) + dy })) : texts,
    };
}

/**
 * Flatten a layer into the one below it.
 *
 * "Below" means the next drawable layer in UI order — folders are containers, not surfaces, so
 * they are skipped as a target and refused as a source. The upper layer's strokes go after the
 * lower one's, which is what keeps it looking the same: later strokes draw on top.
 *
 * Stroke bitmap ids are carried across unchanged rather than copied. The pixels have one owner
 * either way, because the layer they came from is being removed in the same move — duplicating
 * them here would leave the originals unreferenced and the collector would free them.
 *
 * @param {Array} layers the cut's layers, in UI order
 * @param {any} layerId the layer to merge downwards
 * @param {(layers: Array) => Array} flattenVisibleLeaves ordering helper (flattenLayersInUiOrder)
 * @returns {{layers: Array, activeLayerId: any} | null} null when there is nothing to merge into
 */
export function mergeDown(layers, layerId, flattenVisibleLeaves) {
    const list = Array.isArray(layers) ? layers : [];
    const src = list.find(l => l.id === layerId);
    if (!src || src.type === 'folder') return null;

    // The order the user sees, which is what "the one below" means - not the array order, since
    // nesting makes those differ.
    const order = flattenVisibleLeaves(list).filter(l => l.type === 'layer');
    const at = order.findIndex(l => l.id === layerId);
    if (at < 0 || at + 1 >= order.length) return null;   // nothing underneath
    const target = order[at + 1];

    return {
        layers: list
            .filter(l => l.id !== layerId)
            .map(l => l.id !== target.id ? l : ({
                ...l,
                // Visible, because merging into a hidden layer would make the work vanish.
                visible: true,
                rev: (l.rev || 0) + 1,
                strokes: [...(l.strokes || []), ...(src.strokes || [])],
                // Redo belongs to the layers as they were; those steps cannot be replayed onto
                // the merged result.
                redoStrokes: [],
            })),
        activeLayerId: target.id,
    };
}
