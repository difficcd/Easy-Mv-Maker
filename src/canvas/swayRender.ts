import { swayWeightAt, swayDispAt } from '../core/sway.ts';
import { shearSlices, type ShearSlice } from './shearSlices.ts';
import type { SwayProfile } from '../core/sway.ts';

/** What the sway is doing at this instant, for when the lag makes that differ along the axis. */
export interface SwayWave { amp: number; speed: number; curve?: readonly number[] | null; time: number; lag?: number }


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
 * @param {number} args.disp full displacement in pixels, at weight 1, when there is no lag
 * @param {number} args.span the canvas edge along the axis
 * @param {{amp: number, speed: number, curve?: number[]|null, time: number, lag?: number}} [args.wave]
 * @param {number} [args.slices]
 * @returns {Array<{a0: number, len: number, k: number, m: number}>}
 */
export function swaySlices({ profile, disp, span, wave, slices = SWAY_SLICES }: { profile: SwayProfile | null | undefined, disp: number, span: number, wave?: SwayWave | null, slices?: number }): ShearSlice[] {
    // Without a lag the displacement is one number for the whole span and `disp` is it. With
    // one, the phase differs at every position, so it has to be asked for per slice - which is
    // also why the slices exist at all.
    const at = (wave && wave.lag)
        ? (pos: number) => swayDispAt(pos / span, wave) * swayWeightAt(profile, pos / span)
        : (pos: number) => disp * swayWeightAt(profile, pos / span);
    return shearSlices(at, 0, span, slices);
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
 * @param {number} args.disp the displacement everywhere, when there is no lag
 * @param {{amp: number, speed: number, curve?: number[]|null, time: number, lag?: number}} [args.wave]
 *   what the sway is doing, for when the lag makes that differ along the axis
 * @param {number} args.cw
 * @param {number} args.ch
 */
export function drawSwayed(ctx: CanvasRenderingContext2D, src: CanvasImageSource, { profile, axis, disp, wave, cw, ch }: { profile: SwayProfile | null | undefined, axis: 'x' | 'y', disp: number, wave?: SwayWave | null, cw: number, ch: number }): void {
    const vertical = axis === 'y';
    const span = vertical ? ch : cw;
    for (const { a0, len, k, m } of swaySlices({ profile, disp, span, wave })) {
        ctx.save();
        // The coordinate along the axis is left untouched (diagonal term 1, that off-diagonal 0),
        // so the slices butt together without gaps.
        if (vertical) { ctx.transform(1, 0, k, 1, m, 0); ctx.drawImage(src, 0, a0, cw, len, 0, a0, cw, len); }
        else { ctx.transform(1, k, 0, 1, 0, m); ctx.drawImage(src, a0, 0, len, ch, a0, 0, len, ch); }
        ctx.restore();
    }
}
