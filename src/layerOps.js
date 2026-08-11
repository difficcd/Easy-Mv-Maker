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
