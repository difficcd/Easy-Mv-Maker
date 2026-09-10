import { swayWeightAt } from './canvasUtils.js';

/**
 * Bending a layer along an axis: hair swinging from its roots, a ribbon trailing from where it
 * is held.
 *
 * The displacement varies along the axis - that is the whole point of a profile - so a single
 * transform cannot express it. An affine matrix moves every pixel by the same rule, and what is
 * wanted here is a different offset at every height.
 *
 * The layer is therefore drawn in slices. The mistake worth writing down is the obvious version:
 * translate each slice as a rigid block by the displacement at its centre. That leaves a step
 * between neighbouring slices, and the drawing comes out visibly torn into bands.
 *
 * What works is giving each slice a *shear* instead of a translation. Inside a slice the offset
 * then varies linearly, and the line is chosen to pass through the true displacement at both of
 * the slice's own boundaries - so where two slices meet, both agree on the offset exactly and
 * there is no seam, at any slice count. More slices only make the piecewise-linear curve a
 * closer fit to the profile; they are not what removes the tearing.
 */

/** Slices across the span. Enough that the straight segments read as a curve. */
export const SWAY_SLICES = 64;

/**
 * The shear for each slice: `offset(a) = k * a + m`, in the coordinate along the axis.
 *
 * Separate from the drawing because this is where the correctness lives - the boundary values
 * either match or the image tears - and a canvas is a bad place to check that.
 *
 * @param {object} args
 * @param {Array<number | {p: number, w: number}>} args.profile
 * @param {number} args.disp full displacement in pixels, at weight 1
 * @param {number} args.span the canvas edge along the axis
 * @param {number} [args.slices]
 * @returns {Array<{a0: number, len: number, k: number, m: number}>}
 */
export function swaySlices({ profile, disp, span, slices = SWAY_SLICES }) {
    const dispAt = (pos) => disp * swayWeightAt(profile, pos / span);
    const out = [];
    for (let i = 0; i < slices; i++) {
        // Rounded to whole pixels so the source rectangles tile the span exactly; the last
        // slice absorbs the remainder rather than a fractional strip being left over.
        const a0 = Math.round(i * span / slices);
        const a1 = Math.round((i + 1) * span / slices);
        const len = a1 - a0;
        if (len <= 0) continue;
        const d0 = dispAt(a0), d1 = dispAt(a1);
        const k = (d1 - d0) / len;  // gradient within the slice
        const m = d0 - k * a0;      // so that it equals d0 exactly at a0
        out.push({ a0, len, k, m });
    }
    return out;
}

/**
 * Draw `src` onto `ctx`, bent by the profile.
 *
 * The caller's transform is respected: each slice saves, applies its own shear on top, draws,
 * and restores.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} src a canvas the size of the frame
 * @param {object} args
 * @param {Array<number | {p: number, w: number}>} args.profile
 * @param {'x'|'y'} args.axis which way the slices run
 * @param {number} args.disp
 * @param {number} args.cw
 * @param {number} args.ch
 */
export function drawSwayed(ctx, src, { profile, axis, disp, cw, ch }) {
    const vertical = axis === 'y';
    const span = vertical ? ch : cw;
    for (const { a0, len, k, m } of swaySlices({ profile, disp, span })) {
        ctx.save();
        // The coordinate along the axis is left untouched (diagonal term 1, that off-diagonal 0),
        // so the slices butt together without gaps.
        if (vertical) { ctx.transform(1, 0, k, 1, m, 0); ctx.drawImage(src, 0, a0, cw, len, 0, a0, cw, len); }
        else { ctx.transform(1, k, 0, 1, 0, m); ctx.drawImage(src, a0, 0, len, ch, a0, 0, len, ch); }
        ctx.restore();
    }
}
