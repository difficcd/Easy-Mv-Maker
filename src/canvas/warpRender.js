// Rotation, skew and bend for a pasted bitmap - the adjustments a lasso selection can carry
// beyond where it sits and how big it is.
//
// Rotation and skew are each one affine transform. Bend is not - its offset varies along x - so
// it is drawn in vertical slices the way sway is, each slice sheared so that neighbours agree
// exactly at their shared edge. shearSlices is where that rule lives; this file only supplies the
// curve.

import { shearSlices } from './shearSlices.js';

/**
 * The largest change of slope allowed where two slices meet, in radians.
 *
 * Each slice is one shear, so a line running through the selection is straight inside a slice
 * and kinks at every boundary by the difference between neighbouring shears. The sag of the
 * curve is tiny even with few slices; the kinks are what the eye catches, and it catches them on
 * a smooth circle at well under a degree. This is what made a large bent selection read as
 * segmented at a fixed thirty-two slices.
 */
const MAX_KINK = 0.006;

/**
 * How many slices a bent box needs so that no boundary kinks by more than MAX_KINK.
 *
 * The bend parabola's slope runs from -2*bend*h/w at one edge to +2*bend*h/w at the other, a
 * change of `4 * bend * h / w` across the width, so per slice it changes by that over the count. Wide, tall and strongly bent all ask for more; a flat or
 * unbent box gets the floor, which is enough to be invisible at any size.
 *
 * @param {{w: number, h: number, bend: number}} box
 */
export function bendSliceCount({ w, h, bend }) {
    if (!(w > 0) || !bend) return 8;
    const n = Math.ceil((4 * Math.abs(bend) * h) / (w * MAX_KINK));
    return Math.max(8, Math.min(512, n));
}

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
export function bendSlices(box, slices = bendSliceCount(box)) {
    return shearSlices((x) => bendOffsetAt(x, box), box.x, box.w, slices);
}

/**
 * Whether a paste needs this renderer at all. Zero on all three means the plain drawImage path,
 * which is what every paste made before these fields existed takes.
 *
 * @param {{rot?: number, skew?: number, bend?: number}} s
 */
export const isWarped = (s) => !!(s && (s.rot || s.skew || s.bend));

/**
 * Draw `src` into the box, rotated, skewed and bent.
 *
 * Rotation is about the box's centre and skew pivots on its middle row, so the middle stays put
 * in both cases - the same convention partMatrix uses, and the one that does not make the
 * selection jump the moment a slider moves off zero. Rotation is applied outermost, so the skew
 * and bend are done in the box's own frame and turn with it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} src
 * @param {number} sw source width in source pixels
 * @param {number} sh source height
 * @param {{x: number, y: number, w: number, h: number, rot?: number, skew?: number, bend?: number}} box rot in radians
 */
export function drawWarped(ctx, src, sw, sh, box) {
    const { x, y, w, h } = box;
    const rot = box.rot || 0, skew = box.skew || 0, bend = box.bend || 0;
    ctx.save();
    if (rot) {
        const cx = x + w / 2, cy = y + h / 2;
        ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy);
    }
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
