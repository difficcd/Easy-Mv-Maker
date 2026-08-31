// Turning a drawn line into something that can be moved along smoothly.
//
// A path captured from a pen is not a shape, it is a recording of a hand: points pile up wherever
// the pen slowed down and spread out wherever it sped up, and every one of them carries a little
// tremor. Animating along it by index - step one point per tick - replays the drawing speed
// rather than the drawn shape, so the motion crawls through the careful parts and lurches through
// the confident ones. That is the stutter, and it is not a rendering problem: the data is uneven.
//
// The fix is to even out the data once, when the drawing is committed, rather than to do
// arc-length work on every frame. A prepared path has its points equally spaced, so sampling it
// by index IS sampling it by distance, and the renderer keeps the cheap lookup it already had.
// Nothing in the animation loop gets slower.
//
// Smoothing runs first because resampling a jittery line just produces evenly spaced jitter.

/** Total length along a polyline. @param {{x:number,y:number}[]} pts @returns {number} */
export function pathLength(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return total;
}

/**
 * Chaikin corner cutting: replace each point with two points a quarter in from its neighbours.
 *
 * Chosen over a spline fit because it is a few multiplications per point with no solver, and
 * because it cannot overshoot - the result stays inside the hull of what was drawn, so a
 * deliberately sharp corner softens rather than bulging past where the pen went.
 *
 * The endpoints are kept exactly. Somebody who starts a camera move at the edge of the frame
 * means the edge, and an interpolation that quietly pulls the start inward is a bug they cannot
 * see the cause of.
 *
 * @param {{x:number,y:number}[]} pts
 * @param {number} [iterations] each pass roughly doubles the point count
 * @returns {{x:number,y:number}[]}
 */
export function smoothPath(pts, iterations = 2) {
    let out = pts;
    for (let n = 0; n < iterations; n++) {
        if (out.length < 3) return out;
        const next = [out[0]];
        for (let i = 0; i < out.length - 1; i++) {
            const a = out[i], b = out[i + 1];
            next.push(
                { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
                { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
            );
        }
        next.push(out[out.length - 1]);
        out = next;
    }
    return out;
}

/**
 * Re-space a polyline so consecutive points are an equal distance apart.
 *
 * This is the whole trick. Afterwards, walking the array at a constant rate moves at a constant
 * speed, which is what the animation loop already does.
 *
 * @param {{x:number,y:number}[]} pts
 * @param {number} count how many points to produce, including both ends
 * @returns {{x:number,y:number}[]}
 */
export function resampleByLength(pts, count = 64) {
    if (!Array.isArray(pts) || pts.length < 2) return Array.isArray(pts) ? pts.slice() : [];
    const n = Math.max(2, Math.floor(count));

    // Cumulative distance to each input point, so a target distance can be located by scanning.
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1];
    // A path drawn as a single dot, or one that returns exactly to its start with no travel, has
    // no length to distribute along. Spreading points over it would divide by zero.
    if (total <= 0) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));

    const out = [{ x: pts[0].x, y: pts[0].y }];
    let seg = 1;
    for (let i = 1; i < n - 1; i++) {
        const want = (total * i) / (n - 1);
        while (seg < cum.length - 1 && cum[seg] < want) seg++;
        const span = cum[seg] - cum[seg - 1];
        const f = span > 0 ? (want - cum[seg - 1]) / span : 0;
        const a = pts[seg - 1], b = pts[seg];
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
    out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    return out;
}

/**
 * What gets stored when a drawn path is committed: smoothed, evenly spaced, rounded.
 *
 * Rounding to whole pixels is deliberate - it keeps the saved project small, and a path is a
 * motion guide rather than artwork, so a half-pixel of precision buys nothing.
 *
 * @param {{x:number,y:number}[]} pts raw pointer samples
 * @param {{smooth?: number, samples?: number}} [opts]
 * @returns {{x:number,y:number}[]} empty when there was no real gesture to record
 */
export function preparePath(pts, { smooth = 2, samples = 64 } = {}) {
    if (!Array.isArray(pts) || pts.length < 2) return [];
    const even = resampleByLength(smoothPath(pts, smooth), samples);
    return even.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

/**
 * How evenly spaced a path is: the longest gap between consecutive points divided by the mean.
 *
 * 1 is perfect. A raw hand-drawn path is usually somewhere past 5, which is the same thing as
 * saying it would stutter. Exported so the tests can state the property rather than assert on
 * particular coordinates.
 *
 * @param {{x:number,y:number}[]} pts
 * @returns {number} Infinity for a path with no length
 */
export function spacingRatio(pts) {
    if (!pts || pts.length < 3) return 1;
    let max = 0, total = 0;
    for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (d > max) max = d;
        total += d;
    }
    const mean = total / (pts.length - 1);
    return mean > 0 ? max / mean : Infinity;
}
