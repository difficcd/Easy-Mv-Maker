
import type { PressurePoint } from './types.ts';

/**
 * A Catmull-Rom spline through every point it is given.
 *
 * Used by the curve ruler: the user taps anchors and the line has to pass through each of them,
 * which is what picks Catmull-Rom over a Bezier - a Bezier's control points are near the curve
 * rather than on it, so the line would miss the taps.
 *
 * The two end points have no neighbour on one side, so they stand in for their own: `at` clamps
 * the index. Without that the curve leaves the first anchor in whatever direction the arithmetic
 * happens to produce, which reads as a hook at each end of the line.
 *
 * Pressure is carried through and interpolated linearly, so a stroke tapered by pen pressure
 * stays tapered after it is resampled.
 *
 * @param {Array<{x: number, y: number, pressure?: number}>} pts the anchors, in order
 * @param {number} [seg] samples per span; more is smoother and slower
 * @returns {Array<{x: number, y: number, pressure?: number}>} a dense point list
 */
export function catmullThrough(pts: ReadonlyArray<PressurePoint> | null | undefined, seg = 16): PressurePoint[] {
    // Under three points there is no curve to fit - a line through two points is the two points.
    if (!pts || pts.length < 3) return (pts || []).slice();
    const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    const out: PressurePoint[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        for (let t = 0; t < seg; t++) {
            const s = t / seg, s2 = s * s, s3 = s2 * s;
            const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3);
            const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3);
            const pr = (p1.pressure ?? 0.5) + ((p2.pressure ?? 0.5) - (p1.pressure ?? 0.5)) * s;
            out.push({ x, y, pressure: pr });
        }
    }
    // The loop stops one sample short of the last anchor, since t never reaches seg. Without
    // this the curve ends just before the final tap.
    out.push(at(pts.length - 1));
    return out;
}
