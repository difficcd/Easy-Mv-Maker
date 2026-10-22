// Fewer points for the same line.
//
// A stroke stores every pointer sample - 28 per stroke on average in the saved projects, 131,897
// across them - and most of those samples say nothing the neighbours do not: they sit within a
// fraction of a pixel of the line through them. Some of what they do say is noise, too: a mouse
// reports whole pixels, so a slow line is a staircase that the smoothing then has to iron out.
//
// Ramer-Douglas-Peucker keeps a point only if dropping it would move the line by more than a
// tolerance. Pressure is part of the test, not an afterthought: a point where the pen pressed
// harder is kept even on a straight run, or a taper would be flattened into a constant width.
// The renderer interpolates sparse stretches as curves (core/catmullRom.centripetalSpan), which
// is what makes a sparser point list safe to draw.

import type { PressurePoint } from './types.ts';

/**
 * @param {PressurePoint[]} pts a stroke's points, in order
 * @param {number} [tol] how far, in pixels, the line may move
 * @param {number} [pressureTol] how far pressure may drift from a straight interpolation
 * @returns {PressurePoint[]} a subset of `pts`, in order, always with both ends
 */
export function simplifyStroke(pts: readonly PressurePoint[] | null | undefined, tol = 0.5, pressureTol = 0.04): PressurePoint[] {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    // A stack rather than recursion: a long stroke can have thousands of points.
    const stack: Array<[number, number]> = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop()!;
        if (b - a < 2) continue;
        const A = pts[a], B = pts[b];
        const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy;
        let worst = -1, at = -1;
        for (let i = a + 1; i < b; i++) {
            const P = pts[i];
            // Position along the chord, clamped to it, so a point beyond an end is measured to the end.
            const t = L2 ? Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / L2)) : 0;
            const ex = A.x + dx * t - P.x, ey = A.y + dy * t - P.y;
            const dist = Math.hypot(ex, ey);
            const pa = A.pressure ?? 0.5, pb = B.pressure ?? 0.5;
            const pdev = Math.abs((P.pressure ?? 0.5) - (pa + (pb - pa) * t));
            // One scale for both: each is measured as a fraction of its own tolerance.
            const err = Math.max(dist / tol, pdev / pressureTol);
            if (err > worst) { worst = err; at = i; }
        }
        if (worst > 1) {
            keep[at] = 1;
            stack.push([a, at], [at, b]);
        }
    }
    const out: PressurePoint[] = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
}

/**
 * The tools whose strokes go through the curve smoothing when drawn, so a sparser point list
 * still draws the same line. Not the dot pen - pixel art, where each sample is a deliberate
 * pixel - nor the airbrush, which stamps along the raw points and would turn angular, nor the
 * eraser, which writes its points into the layer as it goes.
 */
export const SIMPLIFIED_TOOLS: ReadonlySet<string> = new Set(['brush', 'pencil', 'marker']);

/**
 * A freehand stroke as it should be stored: simplified if its tool draws through the smoothing,
 * otherwise unchanged. A ruler shape (`straight`) is already exactly what was asked for.
 *
 * @template {{tool?: string, straight?: boolean, points?: PressurePoint[]}} S
 * @param {S} s
 * @returns {S}
 */
export function lightenStroke<S extends { tool?: string, straight?: boolean, points?: PressurePoint[] }>(s: S): S {
    if (s.straight || !s.tool || !SIMPLIFIED_TOOLS.has(s.tool) || !Array.isArray(s.points) || s.points.length < 3) return s;
    return { ...s, points: simplifyWindowed(s.points) };
}

/** Samples per window of `simplifyWindowed`. */
export const SIMPLIFY_WINDOW = 64;

/**
 * `simplifyStroke`, a window of samples at a time, so a finished window is final.
 *
 * The pen's preview redraws the stroke exactly as it will commit, every frame, so what is on
 * screen while drawing is what lands. Simplifying the whole stroke each frame would undo that in a
 * different way: a new sample moves the chord every split is measured against, so which earlier
 * points survive could change, and the line already drawn would shift as the pen went on. Each
 * window is simplified on its own with both ends kept; once a window is full, nothing after it can
 * reach it. The kept ends cost a few points against the whole-stroke version.
 *
 * @param {PressurePoint[]} pts
 * @param {number} [tol]
 * @param {number} [pressureTol]
 * @returns {PressurePoint[]}
 */
export function simplifyWindowed(pts: readonly PressurePoint[] | null | undefined, tol = 0.5, pressureTol = 0.04): PressurePoint[] {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    const out: PressurePoint[] = [];
    for (let a = 0; a < pts.length - 1; a += SIMPLIFY_WINDOW) {
        const b = Math.min(pts.length - 1, a + SIMPLIFY_WINDOW);
        const part = simplifyStroke(pts.slice(a, b + 1), tol, pressureTol);
        // Windows share their end point; take it once.
        out.push(...(out.length ? part.slice(1) : part));
    }
    return out;
}
