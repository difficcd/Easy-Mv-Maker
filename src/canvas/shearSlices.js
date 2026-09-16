// One slice rule, shared by every warp that displaces pixels along an axis.
//
// The mistake it exists to prevent: translating each slice as a rigid block by the displacement
// at its centre. That leaves a step between neighbours and the drawing tears into bands. Each
// slice is given a shear instead, chosen to pass through the true displacement at both of its
// own boundaries, so where two slices meet they agree exactly - at any slice count.

/**
 * Cut `[start, start + span)` into slices, each with the shear that matches `dispAt` exactly at
 * both of its boundaries. Any displacement-along-an-axis warp reduces to this; the sway profile
 * above and the selection bend in warpRender are two callers.
 *
 * @param {(pos: number) => number} dispAt displacement across the axis, at a position along it
 * @param {number} start
 * @param {number} span
 * @param {number} slices
 * @returns {Array<{a0: number, len: number, k: number, m: number}>}
 */
export function shearSlices(dispAt, start, span, slices) {
    const out = [];
    for (let i = 0; i < slices; i++) {
        // Rounded to whole pixels so the source rectangles tile the span exactly; the last
        // slice absorbs the remainder rather than a fractional strip being left over.
        const a0 = start + Math.round(i * span / slices);
        const a1 = start + Math.round((i + 1) * span / slices);
        const len = a1 - a0;
        if (len <= 0) continue;
        const d0 = dispAt(a0), d1 = dispAt(a1);
        const k = (d1 - d0) / len;  // gradient within the slice
        const m = d0 - k * a0;      // so that it equals d0 exactly at a0
        out.push({ a0, len, k, m });
    }
    return out;
}
