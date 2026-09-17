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

/**
 * Split a rectangle of layer pixels into the part inside a polygon and a mask of where it was.
 *
 * Two images out of one pass, because they describe the same set of pixels from both sides: the
 * selection is what now floats, and the mask is the hole it leaves behind. Building them
 * separately is how they drift, and a mask that does not match its selection shows as a ghost of
 * the lifted artwork left in the layer.
 *
 * Only pixels that are **both** inside the polygon and not fully transparent are taken. Lifting
 * empty pixels would make the selection box larger than the artwork in it, and erase a
 * rectangle's worth of nothing from the layer underneath.
 *
 * `makeImageData` is injected rather than `new ImageData(...)` being called here, the same way
 * the rest of `core/` takes its browser functions - so the awkward cases can be checked without
 * a canvas.
 *
 * @param {object} args
 * @param {{data: Uint8ClampedArray}} args.layer pixels already cropped to the bounds
 * @param {number[][]} args.poly a closed ring, in canvas coordinates
 * @param {number} args.minX left edge of the bounds, in canvas coordinates
 * @param {number} args.minY top edge
 * @param {number} args.w
 * @param {number} args.h
 * @param {(w: number, h: number) => {data: Uint8ClampedArray, width: number, height: number}} args.makeImageData
 * @param {(pt: number[], poly: number[][]) => boolean} args.inside
 * @returns {{selection: {data: Uint8ClampedArray, width: number, height: number},
 *   eraseMask: {data: Uint8ClampedArray, width: number, height: number}, hasContent: boolean,
 *   painted: {x: number, y: number, w: number, h: number} | null}}
 *   `painted` is where the taken pixels actually sit inside the box, relative to it, or null
 *   when nothing was taken. The caller crops the selection to it; the mask is left alone.
 */
export function cutOutPolygon({ layer, poly, minX, minY, w, h, makeImageData, inside }) {
    const selection = makeImageData(w, h);
    const eraseMask = makeImageData(w, h);
    let hasContent = false;
    // Where the pixels actually landed inside the box, tracked in this loop because it already
    // visits every one of them - a second pass to find out would cost the same as the cut.
    let px0 = w, py0 = h, px1 = -1, py1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            // Tested at the pixel centre. On the boundary itself the crossing test could go
            // either way, and the half-pixel offset makes the answer definite - otherwise which
            // pixels come along depends on where the polygon happens to land on the grid.
            if (!inside([minX + x + 0.5, minY + y + 0.5], poly)) continue;
            const a = layer.data[i + 3];
            if (a === 0) continue;
            hasContent = true;
            selection.data[i] = layer.data[i];
            selection.data[i + 1] = layer.data[i + 1];
            selection.data[i + 2] = layer.data[i + 2];
            selection.data[i + 3] = a;
            eraseMask.data[i + 3] = 255;
            if (x < px0) px0 = x;
            if (x > px1) px1 = x;
            if (y < py0) py0 = y;
            if (y > py1) py1 = y;
        }
    }
    const painted = px1 < 0 ? null : { x: px0, y: py0, w: px1 - px0 + 1, h: py1 - py0 + 1 };
    return { selection, eraseMask, hasContent, painted };
}

/**
 * A rectangle of one image, as a new image.
 *
 * What the lasso needs after a cut: the loop the user drew is nearly always looser than the
 * artwork inside it, and the box it implies is what the handles and the marquee are drawn from.
 * Left uncropped, a generous loop around a small drawing puts the handles out in empty space and
 * rotation turns about a centre nowhere near the picture.
 *
 * The hole left behind is *not* cropped with it. That is the full loop, because that is what was
 * lifted; shrinking it would leave a ring of the original artwork behind.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} src
 * @param {{x: number, y: number, w: number, h: number}} box
 * @param {(w: number, h: number) => {data: Uint8ClampedArray, width: number, height: number}} makeImageData
 */
export function cropImageData(src, box, makeImageData) {
    const out = makeImageData(box.w, box.h);
    for (let y = 0; y < box.h; y++) {
        const from = ((y + box.y) * src.width + box.x) * 4;
        out.data.set(src.data.subarray(from, from + box.w * 4), y * box.w * 4);
    }
    return out;
}

/**
 * The two strokes that put a floating selection back into a layer: a hole where it was lifted
 * from, and the pixels where they were dropped.
 *
 * Committing in place and extracting to a part both need exactly this pair, and each had its
 * own copy of the rounding - which is how one of them would have grown the skew and bend fields
 * and the other not. The hole never carries them: it is where the pixels *were*, and that was a
 * plain rectangle.
 *
 * Rotation, skew and bend are written only when set. A paste made with none is byte-identical
 * to one made before the fields existed, so old projects and old builds are unaffected.
 *
 * @param {{x:number,y:number,tx:number,ty:number,tw:number,th:number,bitmapId:string,maskBitmapId:string,rot?:number,skew?:number,bend?:number}} sel
 * @param {number} eraseId id for the hole
 * @param {number} pasteId id for the pixels
 * @returns {{erase: object, paste: object}}
 */
export function selectionStrokes(sel, eraseId, pasteId) {
    const erase = { id: eraseId, tool: 'eraseBitmap', bitmapId: sel.maskBitmapId, x: Math.round(sel.x), y: Math.round(sel.y) };
    const paste = {
        id: pasteId, tool: 'paste', bitmapId: sel.bitmapId,
        x: Math.round(sel.tx), y: Math.round(sel.ty),
        w: Math.max(1, Math.round(sel.tw)), h: Math.max(1, Math.round(sel.th)),
    };
    if (sel.rot) paste.rot = sel.rot;
    if (sel.skew) paste.skew = sel.skew;
    if (sel.bend) paste.bend = sel.bend;
    return { erase, paste };
}

const TWO_PI = Math.PI * 2;

/** An angle folded into [-pi, pi), which is the range the rotation slider shows. */
const normaliseAngle = (a) => {
    const m = (a + Math.PI) % TWO_PI;
    return (m < 0 ? m + TWO_PI : m) - Math.PI;
};

/**
 * Rotation from dragging the knob above the selection.
 *
 * Measured as the angle the pointer has swept about the box's centre **since the drag began**,
 * added to the rotation the box already had. Taken from the start rather than accumulated per
 * move, so it cannot drift, and grabbing the knob anywhere on it does not make the box jump to
 * meet the pointer.
 *
 * The result is folded into [-pi, pi). Past half a turn the raw difference flips sign, which
 * would be a problem if the value meant anything - it does not: a rotation is modulo a full
 * turn, so the picture is identical either way, and folding keeps the number in the range the
 * slider displays instead of letting it wander.
 *
 * @param {{tx: number, ty: number, tw: number, th: number, rot?: number}} startSel
 * @param {{x: number, y: number}} startPos where the drag began
 * @param {{x: number, y: number}} pos where the pointer is now
 * @returns {{rot: number}}
 */
export function applyRotateDrag(startSel, startPos, pos) {
    const cx = startSel.tx + startSel.tw / 2;
    const cy = startSel.ty + startSel.th / 2;
    const swept = Math.atan2(pos.y - cy, pos.x - cx) - Math.atan2(startPos.y - cy, startPos.x - cx);
    return { rot: normaliseAngle((startSel.rot || 0) + swept) };
}

/** Furthest a drag can push skew or bend. The same as the sliders' range, so the two agree. */
export const WARP_LIMIT = 1;

/**
 * Skew and bend from a Ctrl-drag inside the selection (#175).
 *
 * Both are scaled so the picture follows the pointer: a skew of 1 moves the top edge sideways by
 * half the height, so dragging sideways by half the height gives skew 1 and the top edge lands
 * under the pen; a bend of 1 lifts the middle by half the height, so dragging up by that gives
 * bend 1. Up is negative y on a canvas, hence the sign on dy.
 *
 * @param {{th: number, skew?: number, bend?: number}} startSel the selection when the drag began
 * @param {number} dx pointer movement since then
 * @param {number} dy
 * @returns {{skew: number, bend: number}}
 */
export function applyWarpDrag(startSel, dx, dy) {
    const half = Math.max(1, (startSel.th || 0) / 2);
    const clamp = (v) => Math.max(-WARP_LIMIT, Math.min(WARP_LIMIT, v));
    return {
        skew: clamp((startSel.skew || 0) + dx / half),
        bend: clamp((startSel.bend || 0) - dy / half),
    };
}

/**
 * The rectangle of pixels that have any alpha, or null for an empty buffer.
 *
 * What "select the whole layer" (#176) selects: not the canvas, which would make a floating
 * selection the size of the screen around a small drawing, but the drawing itself.
 *
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} w
 * @param {number} h
 * @returns {{x: number, y: number, w: number, h: number} | null} integer pixel bounds
 */
export function paintedBounds(data, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            if (data[row + x * 4 + 3] === 0) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
