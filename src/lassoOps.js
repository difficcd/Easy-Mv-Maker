// The geometry behind lifting a lasso selection.
//
// Freehand points come in as drawn: an open path, roughly but not exactly back where it started.
// Turning that into a region means deciding how to close it and which pixels to look at. Both
// answers are small and both were buried in a pointer-up handler, where the awkward case - a
// path whose ends nearly meet - could not be checked.

/**
 * Close a freehand path into a polygon.
 *
 * If the ends are far apart the path is left as drawn and joined back to the start, adding an
 * edge. If they nearly meet, that last point is a near-duplicate of the first: snapping it to
 * the start rather than appending avoids a hairline edge between two points a pixel apart, which
 * makes the even-odd crossing test ambiguous right where the user closed the loop.
 *
 * @param {Array<{x:number,y:number}>} pts points as drawn
 * @param {number} [snap] how close the ends must be to count as already closed, in pixels
 * @returns {Array<{x:number,y:number}>} a closed ring: the first point repeated at the end
 */
export function closeLassoPath(pts, snap = 8) {
    if (!Array.isArray(pts) || pts.length < 2) return Array.isArray(pts) ? [...pts] : [];
    const first = pts[0];
    const last = pts[pts.length - 1];
    const gap = Math.hypot(last.x - first.x, last.y - first.y);
    return gap > snap
        ? [...pts, first]                   // far apart: add the closing edge
        : [...pts.slice(0, -1), first];     // nearly closed: snap the stray end onto the start
}

/**
 * The pixel rectangle a lasso covers, clamped to the canvas.
 *
 * Returned as integers because it indexes into image data: the left and top round down and the
 * right and bottom round up, so a region is never clipped by a fraction of a pixel.
 *
 * @returns {{x:number,y:number,w:number,h:number}} w or h of 0 means there is nothing to lift
 */
export function lassoBounds(pts, canvasW, canvasH) {
    if (!Array.isArray(pts) || !pts.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const x = Math.max(0, Math.floor(minX));
    const y = Math.max(0, Math.floor(minY));
    const right = Math.min(canvasW, Math.ceil(maxX));
    const bottom = Math.min(canvasH, Math.ceil(maxY));
    return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** Smallest a selection may be dragged to, in pixels. Below this it is impossible to grab again. */
export const MIN_SELECTION_SIZE = 2;

/**
 * Resize a selection by dragging one of its handles.
 *
 * The handle names read as compass points, so which edges move falls out of the letters: 'nw'
 * moves the top and left, 'e' moves the right edge alone. An edge handle must leave the other
 * axis exactly as it was rather than letting the perpendicular delta leak into it, which is what
 * the two lines pinning the opposite pair are for.
 *
 * Dragging an edge past its opposite would otherwise invert the rectangle, and a zero-width
 * selection cannot be grabbed to undo the mistake. So the moving edge is stopped a minimum apart
 * from the fixed one - the *moving* edge, which is the detail worth having a test for: pushing
 * the left edge rightwards must park the left edge, not drag the right one along with it.
 *
 * @param {string} handle one of n, s, e, w, ne, nw, se, sw
 * @param {{tx:number,ty:number,tw:number,th:number}} startSel the selection when the drag began
 * @param {number} dx pointer movement since then
 * @param {number} dy
 * @returns {{tx:number,ty:number,tw:number,th:number}}
 */
export function applyResize(handle, startSel, dx, dy) {
    const min = MIN_SELECTION_SIZE;
    let left = startSel.tx, top = startSel.ty;
    let right = startSel.tx + startSel.tw, bottom = startSel.ty + startSel.th;

    const moveLeft = handle.includes('w');
    const moveRight = handle.includes('e');
    const moveTop = handle.includes('n');
    const moveBottom = handle.includes('s');

    if (moveLeft) left += dx;
    if (moveRight) right += dx;
    if (moveTop) top += dy;
    if (moveBottom) bottom += dy;

    // An edge handle constrains one axis only.
    if (handle === 'n' || handle === 's') { left = startSel.tx; right = startSel.tx + startSel.tw; }
    if (handle === 'w' || handle === 'e') { top = startSel.ty; bottom = startSel.ty + startSel.th; }

    if (right - left < min) {
        if (moveLeft && !moveRight) left = right - min;
        if (moveRight && !moveLeft) right = left + min;
    }
    if (bottom - top < min) {
        if (moveTop && !moveBottom) top = bottom - min;
        if (moveBottom && !moveTop) bottom = top + min;
    }

    return { tx: left, ty: top, tw: Math.max(min, right - left), th: Math.max(min, bottom - top) };
}
