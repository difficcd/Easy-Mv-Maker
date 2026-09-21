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
 * Replace one layer with a patched copy, leaving the rest of the list alone.
 *
 * Eight call sites wrote this map out by hand. On its own that is only noise, but the guard
 * inside it is not noise: layer ids are unique within a cut and *not* across cuts, so this must
 * only ever be handed one cut's layers. Written out eight times, that is eight places to hand it
 * the wrong list.
 *
 * The patch is a function of the layer because most callers need what was there - appending to
 * `strokes`, flipping `visible`. It returns the fields to change, not the whole layer.
 *
 * @param {any[]} layers one cut's layers
 * @param {any} layerId
 * @param {(layer: any) => object} patch fields to merge into the matching layer
 * @returns {any[]} a new list; the same one back if nothing matched
 */
export function patchLayer(layers, layerId, patch) {
    if (!Array.isArray(layers)) return [];
    return layers.map(l => (l.id === layerId ? { ...l, ...patch(l) } : l));
}

/**
 * Add a stroke - or several, as one change - to a layer and make sure it will be seen: the layer
 * itself and every folder above it are forced visible. Returns { activeLayerId, layers }, or null
 * if the layer is gone.
 *
 * Several at once is for the tools whose result is an erase-hole plus a paste. Committed one at
 * a time those would be two history entries, and undo would put the hole back without the
 * pixels.
 *
 * `place` decides where in the list the stroke goes; the default appends, which is on top. The
 * bucket fill passes insertFill instead, because paint belongs under the ink it fills around.
 *
 * The reveal is the point. Without it, drawing into a hidden layer - or one inside a collapsed,
 * hidden folder - accepts the stroke and shows nothing, which reads as the drawing being lost.
 */
export function commitStroke(layers, layerId, stroke, place = (strokes, st) => [...strokes, ...(Array.isArray(st) ? st : [st])]) {
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
            if (l.id === layerId) return { ...l, visible: true, strokes: place(l.strokes || [], stroke) };
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
 *  - So does the mosaic effect's region, which is in canvas coordinates. It says which part of
 *    *this drawing* is pixelated - a face, usually - so leaving it behind while the drawing walks
 *    out from under it is the whole of the bug it was reported as.
 *
 *    `anim.path` is deliberately not moved with them. That is where the part travels, which is a
 *    statement about the frame rather than about the drawing, and it has always worked that way.
 *  - Only coordinates change, so the cached canvas signature - built from stroke count and the
 *    last stroke's identity - does not notice, and the layer would keep drawing at its old
 *    position. Bumping rev is what invalidates it.
 *
 * @param {Cut} cut the cut being edited
 * @param {any[]} layerIds ids of the layers to move
 * @param {number} dx
 * @param {number} dy
 * @returns {{layers: Array}} the changed field, for the caller to merge
 */
export function offsetLayers(cut, layerIds, dx, dy) {
    const ids = new Set(layerIds || []);
    const layers = Array.isArray(cut?.layers) ? cut.layers : [];
    // Texts are not touched. A text and a layer coexist in a cut without one belonging to the
    // other, and a move applies to what is selected; texts riding along with a layer move was
    // the bug (#177).
    return {
        layers: layers.map(l => !ids.has(l.id) ? l : ({
            ...l,
            rev: (l.rev || 0) + 1,
            strokes: (Array.isArray(l.strokes) ? l.strokes : []).map(st => st.points
                ? { ...st, points: st.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) }
                : { ...st, x: (st.x || 0) + dx, y: (st.y || 0) + dy }),
            ...(l.anim?.mosaicRect
                ? { anim: { ...l.anim, mosaicRect: { ...l.anim.mosaicRect, x: l.anim.mosaicRect.x + dx, y: l.anim.mosaicRect.y + dy } } }
                : null),
        })),
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

/** A blank drawable layer. The one shape, so a layer made anywhere has every field. */
/** @returns {Layer} */
export const mkLayer = (id, name = `L${id}`) => ({ id, name, type: /** @type {const} */ ('layer'), strokes: [], redoStrokes: [], visible: true, parentId: null });

/** A blank folder. */
/** @returns {Layer} */
export const mkFolder = (id) => ({ id, name: `Folder ${id}`, type: /** @type {const} */ ('folder'), visible: true, collapsed: false, parentId: null });

/**
 * The next free layer id within a cut. Layer ids are per cut, not global (see the gotchas):
 * one past the largest in use, or 1 for an empty cut.
 *
 * This was written out in three places - adding a layer, adding a folder, extracting a part -
 * and a fourth site used the global id counter instead, so a layer added after a delete could
 * carry an id in the millions beside layers numbered 1 to 5.
 */
export const nextLayerId = (layers) => Math.max(...(Array.isArray(layers) ? layers : []).map(l => l.id), 0) + 1;

/**
 * A new layer at the end of the stack, made active.
 *
 * @param {{layers: any[]}} cut
 * @returns {{layers: any[], activeLayerId: number}}
 */
export function appendLayer(cut) {
    const layers = Array.isArray(cut?.layers) ? cut.layers : [];
    const id = nextLayerId(layers);
    return { layers: [...layers, mkLayer(id)], activeLayerId: id };
}

/**
 * A new folder at the end of the stack. Not made active: a folder cannot be drawn on.
 *
 * @param {{layers: any[]}} cut
 * @returns {{layers: any[]}}
 */
export function appendFolder(cut) {
    const layers = Array.isArray(cut?.layers) ? cut.layers : [];
    return { layers: [...layers, mkFolder(nextLayerId(layers))] };
}

/**
 * Remove a layer, or a folder and everything inside it.
 *
 * Two things must hold afterwards. The cut still has a drawable layer - deleting the last one
 * leaves a fresh blank rather than a cut that nothing can be drawn on. And the active layer is
 * still one that exists: if the deletion took it, the first remaining drawable layer is made
 * active, so the next stroke has somewhere to go.
 *
 * @param {{layers: any[], activeLayerId: any}} cut
 * @param {any} layerId
 * @returns {{layers: any[], activeLayerId: any}}
 */
export function removeLayerTree(cut, layerId) {
    const layers = Array.isArray(cut?.layers) ? cut.layers : [];
    const gone = new Set([layerId]);
    // Folders can nest, so walk until no new child turns up.
    let grew = true;
    while (grew) {
        grew = false;
        for (const l of layers) if (!gone.has(l.id) && gone.has(l.parentId)) { gone.add(l.id); grew = true; }
    }
    let kept = layers.filter(l => !gone.has(l.id));
    if (!kept.some(l => l.type === 'layer')) kept = [...kept, mkLayer(nextLayerId(kept))];
    const activeLayerId = gone.has(cut?.activeLayerId) ? (kept.find(l => l.type === 'layer')?.id ?? null) : cut.activeLayerId;
    return { layers: kept, activeLayerId };
}

/**
 * Where a dragged row would land relative to the row under the pointer.
 *
 * The middle band of a folder row means "inside"; the top half of any row means before it and
 * the bottom half after. The band is offset upward a little and reaches further down, so that
 * hovering the folder's name - which sits slightly above centre - reads as inside, and there is
 * still a strip at the top for dropping before it.
 *
 * @param {number} clientY
 * @param {{top: number, height: number}} rect the row's bounding rect
 * @param {'layer'|'folder'} targetType
 * @returns {'before'|'after'|'inside'}
 */
export function dropPositionFor(clientY, rect, targetType) {
    const mid = rect.top + rect.height / 2;
    if (targetType === 'folder' && clientY > mid - 4 && clientY < mid + rect.height * 0.4) return 'inside';
    return clientY < mid ? 'before' : 'after';
}

/**
 * A layer moved to the end of the stack at the top level - what a drop below every row means.
 * Null if the layer is not there, so the caller changes nothing.
 *
 * @param {any[]} layers
 * @param {any} layerId
 * @returns {any[] | null}
 */
export function moveLayerToEnd(layers, layerId) {
    if (!Array.isArray(layers)) return null;
    const i = layers.findIndex(l => l.id === layerId);
    if (i < 0) return null;
    const next = [...layers];
    const [dragged] = next.splice(i, 1);
    next.push({ ...dragged, parentId: null });
    return next;
}

/**
 * The strokes with more points on the one being drawn - the last one - as a new array with a
 * new last stroke rather than a mutation of the old. The eraser draws straight into the layer
 * while the pen is down, so this runs on every move; a paste or a fill at the end of the list
 * is not a stroke being drawn and is left alone.
 *
 * @param {any[]} strokes
 * @param {Array<{x: number, y: number}>} points
 * @returns {any[]}
 */
export function appendPoints(strokes, points) {
    const list = Array.isArray(strokes) ? strokes : [];
    const last = list[list.length - 1];
    if (!last || last.tool === 'paste' || last.tool === 'fill' || !Array.isArray(last.points)) return list;
    return [...list.slice(0, -1), { ...last, points: [...last.points, ...points] }];
}
