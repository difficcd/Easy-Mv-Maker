// How large a project's canvas is allowed to be.
//
// The custom-size prompt in TopBar already clamped to these two numbers, written as literals. The
// loader did not clamp at all, so the limits applied to what a person can type and not to what a
// file can say - and a file is the easier of the two to get a wrong number into: hand-edited,
// written by an older version, or half-corrupted.
//
// A canvas is allocated as width * height * 4 bytes, twice over in places (the layer cache, the
// scratch canvas), so the ceiling is not decoration. 8192 square is 268MB a copy; ten times that
// in each direction is not a big canvas, it is a tab that stops responding.

/** Smallest edge, in px. Below this there is nothing to draw on. */
export const CANVAS_MIN_EDGE = 64;
/** Largest edge, in px. */
export const CANVAS_MAX_EDGE = 8192;

/**
 * A canvas size the app can actually allocate, or null if there isn't one here.
 *
 * Null rather than a default, because the caller knows better what to do without one: opening a
 * project keeps the canvas it already has, which is what a file that predates saved canvas sizes
 * needs. Half a size is treated as none at all - a width with no height would give NaN, and a
 * canvas of NaN fails far away from here.
 *
 * @param {unknown} w
 * @param {unknown} h
 * @returns {{w: number, h: number} | null}
 */
export function clampCanvasSize(w, h) {
    const nw = Number(w), nh = Number(h);
    if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw <= 0 || nh <= 0) return null;
    const fit = (n) => Math.round(Math.max(CANVAS_MIN_EDGE, Math.min(CANVAS_MAX_EDGE, n)));
    return { w: fit(nw), h: fit(nh) };
}
