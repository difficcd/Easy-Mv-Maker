// Putting one layer onto the frame: where it sits, and how a floating selection is cut out of it.
//
// Both of these lived inside the composite loop in paintFrame, which is the hottest code in the
// app - it runs for every layer of every visible cut, sixty times a second. Neither needed to be
// there. The placement is arithmetic, and the mask is a fixed sequence of canvas operations whose
// only subtlety is which canvas is which.

/** A 2x3 affine, in the order canvas uses: [a, b, c, d, e, f]. */
const I = [1, 0, 0, 1, 0, 0];

/** m then n, as canvas applies them - n is the later transform and nests inside m. */
function mul(m, n) {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ];
}

/**
 * Where a part sits: its own transform, nested inside whatever the cut is already doing.
 *
 * Returned as a matrix rather than applied to a context, because the whole of the reasoning is
 * in the composition order and that can then be checked without a canvas:
 *
 *   translate(px + tx, py + ty)   move to the pivot, plus the animated offset
 *   rotate, scale                 which therefore happen about the pivot, not the origin
 *   translate(-px, -py)           and back
 *   shear                         with `-shear * py`, so the shear pivots at py too
 *
 * Get that order wrong and a rotated part orbits the top-left corner instead of turning in place,
 * which reads as the drawing flying off rather than as a wrong pivot.
 *
 * @param {any} la a layer animation, or null
 * @returns {number[]} [a, b, c, d, e, f]
 */
export function partMatrix(la) {
    if (!la) return I.slice();
    let m = mul(I, [1, 0, 0, 1, la.px + la.tx, la.py + la.ty]);
    const cos = Math.cos(la.rot || 0), sin = Math.sin(la.rot || 0);
    m = mul(m, [cos, sin, -sin, cos, 0, 0]);
    const s = la.sc ?? 1;
    m = mul(m, [s, 0, 0, s, 0, 0]);
    m = mul(m, [1, 0, 0, 1, -la.px, -la.py]);
    // hair/cloth sway, as a single shear. A per-point profile is not this - it varies along the
    // axis and is drawn in slices by canvas/swayRender.
    if (la.shear) m = mul(m, [1, 0, la.shear, 1, -la.shear * la.py, 0]);
    return m;
}

/**
 * Apply a part's placement to a context, including its keyframe opacity.
 *
 * Opacity multiplies rather than replaces: the cut it sits in may already have faded, and a part
 * inside a fading cut has to fade with it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} la
 */
export function applyPartTransform(ctx, la) {
    if (!la) return;
    if (la.alpha != null && la.alpha < 1) ctx.globalAlpha *= la.alpha;
    const [a, b, c, d, e, f] = partMatrix(la);
    ctx.transform(a, b, c, d, e, f);
}

/**
 * Draw a layer with a region cut out of it - what a floating selection needs, since the pixels
 * it lifted must not also still be in the layer underneath.
 *
 * `destination-out` on a scratch canvas rather than on the frame: erasing straight onto the frame
 * would take the artwork already drawn there with it.
 *
 * The scratch canvas is reused. This runs inside the composite loop, so a fresh one here is 8MB
 * per masked layer per frame, sixty times a second while playing - the shape of allocation that
 * took a tab out once.
 *
 * @param {CanvasRenderingContext2D} ctx the frame
 * @param {CanvasImageSource} layerCanvas
 * @param {CanvasImageSource} mask the lifted region, already a drawable
 * @param {{x: number, y: number}} at where the mask sits
 * @param {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}} scratch a sized scratch pair
 */
export function drawMaskedLayer(ctx, layerCanvas, mask, at, scratch) {
    const { canvas: tmp, ctx: tctx } = scratch;
    // Reset in full: the scratch is shared, so whatever the last user left on it is still set.
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalAlpha = 1.0;
    tctx.globalCompositeOperation = 'source-over';
    tctx.drawImage(layerCanvas, 0, 0);
    tctx.globalCompositeOperation = 'destination-out';
    tctx.drawImage(mask, Math.round(at.x), Math.round(at.y));
    tctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0);
}
