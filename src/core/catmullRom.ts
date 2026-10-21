
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

/**
 * One span of a centripetal Catmull-Rom spline: `n` points from `p1` towards `p2`, `p2` itself
 * left for the next span.
 *
 * Centripetal rather than the uniform form `catmullThrough` uses, for points spaced unevenly - a
 * hand slowing down and speeding up. The uniform form gives every span the same parameter length
 * whatever its real length, so a 2px span beside an 80px one inherits a tangent forty times its
 * own size and swings out into a loop; at the point of a V drawn on purpose that was a 4.5px hook
 * past the corner. Spacing the knots by the square root of each span's length (Barry-Goldman,
 * alpha 0.5) is the standard cure: no cusps, no self-intersection within a span, and on evenly
 * spaced points it is exactly the uniform curve.
 *
 * A missing neighbour at either end is reflected through the end point, so the first and last
 * spans leave and arrive along the drawn direction instead of dividing by a zero-length knot.
 *
 * @param {PressurePoint|null} p0 the point before, or null at the start
 * @param {PressurePoint} p1
 * @param {PressurePoint} p2
 * @param {PressurePoint|null} p3 the point after, or null at the end
 * @param {number} n samples in the span
 * @returns {PressurePoint[]}
 */
export function centripetalSpan(p0: PressurePoint | null, p1: PressurePoint, p2: PressurePoint, p3: PressurePoint | null, n: number): PressurePoint[] {
    const reflect = (a: PressurePoint, b: PressurePoint): PressurePoint => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y, pressure: a.pressure });
    const q0 = p0 && (p0.x !== p1.x || p0.y !== p1.y) ? p0 : reflect(p1, p2);
    const q3 = p3 && (p3.x !== p2.x || p3.y !== p2.y) ? p3 : reflect(p2, p1);
    // Knot spacing: the square root of each span's length, floored so a repeated point cannot
    // make a zero-length interval.
    const step = (a: PressurePoint, b: PressurePoint) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
    const t0 = 0, t1 = t0 + step(q0, p1), t2 = t1 + step(p1, p2), t3 = t2 + step(p2, q3);
    const mix = (a: number, ta: number, b: number, tb: number, t: number) => (tb === ta ? a : ((tb - t) * a + (t - ta) * b) / (tb - ta));
    const pr1 = p1.pressure ?? 0.5, pr2 = p2.pressure ?? 0.5;
    const out: PressurePoint[] = [];
    for (let k = 0; k < n; k++) {
        const s = k / n, t = t1 + (t2 - t1) * s;
        const ax1 = mix(q0.x, t0, p1.x, t1, t), ay1 = mix(q0.y, t0, p1.y, t1, t);
        const ax2 = mix(p1.x, t1, p2.x, t2, t), ay2 = mix(p1.y, t1, p2.y, t2, t);
        const ax3 = mix(p2.x, t2, q3.x, t3, t), ay3 = mix(p2.y, t2, q3.y, t3, t);
        const bx1 = mix(ax1, t0, ax2, t2, t), by1 = mix(ay1, t0, ay2, t2, t);
        const bx2 = mix(ax2, t1, ax3, t3, t), by2 = mix(ay2, t1, ay3, t3, t);
        out.push({ x: mix(bx1, t1, bx2, t2, t), y: mix(by1, t1, by2, t2, t), pressure: pr1 + (pr2 - pr1) * s });
    }
    return out;
}
