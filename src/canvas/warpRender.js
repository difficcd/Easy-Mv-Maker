// Skew and bend for a pasted bitmap - the two adjustments a lasso selection can carry beyond
// where it sits and how big it is.
//
// Skew is one affine transform: an x-offset that grows with y. Bend is not - its offset varies
// along x - so it is drawn in vertical slices the way sway is, each slice sheared so that
// neighbours agree exactly at their shared edge. shearSlices is where that rule lives; this file
// only supplies the curve.

import { shearSlices } from './shearSlices.js';

/** Slices across a bent selection. Fewer than sway needs: a selection is small and one curve. */
export const BEND_SLICES = 32;

/**
 * How far a point across the box is displaced vertically by the bend, in pixels.
 *
 * A parabola through zero at both ends, so the corners stay where the box says they are and
 * only the middle lifts (bend > 0) or sags (bend < 0). The full bend, +-1, moves the middle by
 * half the box height - enough to turn a straight word into a clear arch without folding it
 * over on itself.
 *
 * @param {number} x canvas x, anywhere across the box
 * @param {{x: number, w: number, h: number, bend: number}} box
 * @returns {number}
 */
export function bendOffsetAt(x, { x: bx, w, h, bend }) {
    if (!bend || !(w > 0)) return 0;
    const u = ((x - bx) / w) * 2 - 1;           // -1 at the left edge, +1 at the right
    return bend * (h / 2) * (u * u - 1);        // 0 at both ends, -bend*h/2 in the middle
}

/**
 * The slices that draw a bent box, in canvas coordinates.
 *
 * @param {{x: number, w: number, h: number, bend: number}} box
 * @param {number} [slices]
 */
export function bendSlices(box, slices = BEND_SLICES) {
    return shearSlices((x) => bendOffsetAt(x, box), box.x, box.w, slices);
}

/**
 * Whether a paste needs this renderer at all. Zero on both means the plain drawImage path, which
 * is what every paste made before these fields existed takes.
 *
 * @param {{skew?: number, bend?: number}} s
 */
export const isWarped = (s) => !!(s && (s.skew || s.bend));

/**
 * Draw `src` into the box, skewed and bent.
 *
 * Skew pivots on the box's middle row, so the middle stays put and the top and bottom lean
 * opposite ways - the same convention partMatrix uses, and the one that does not make the
 * selection jump sideways the moment the slider moves off zero.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} src
 * @param {number} sw source width in source pixels
 * @param {number} sh source height
 * @param {{x: number, y: number, w: number, h: number, skew?: number, bend?: number}} box
 */
export function drawWarped(ctx, src, sw, sh, box) {
    const { x, y, w, h } = box;
    const skew = box.skew || 0, bend = box.bend || 0;
    ctx.save();
    if (skew) ctx.transform(1, 0, skew, 1, -skew * (y + h / 2), 0);
    if (!bend) {
        ctx.drawImage(src, x, y, w, h);
        ctx.restore();
        return;
    }
    const scale = sw / w;                       // source pixels per canvas pixel across
    for (const { a0, len, k, m } of bendSlices({ x, w, h, bend })) {
        ctx.save();
        // x is left alone and y is sheared by it: [1, k, 0, 1, 0, m] maps (x, y) to (x, y + kx + m).
        ctx.transform(1, k, 0, 1, 0, m);
        ctx.drawImage(src, (a0 - x) * scale, 0, len * scale, sh, a0, y, len, h);
        ctx.restore();
    }
    ctx.restore();
}
