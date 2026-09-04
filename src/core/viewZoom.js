// How far the canvas view may be zoomed, in one place.
//
// It was in three, and they disagreed: pinch and the wheel clamped to 0.25-8 while the zoom
// buttons and shortcuts clamped to 0.1-16. So on a tablet - the device this app is for - a pinch
// stopped at 8x while the toolbar kept going, and having zoomed to 16x with the button, one notch
// of the wheel snapped the view back to 8x. Nobody chose that; it is what three copies of a
// number do.
//
// The wider pair won. Narrowing the buttons to match would have taken away detail work people may
// already rely on, and there is no reason a finger should be allowed less than a button.

/** Below this the artwork is too small to place a stroke on. */
export const ZOOM_MIN = 0.1;
/** Above this a single pixel fills a large part of the screen and panning is the only control. */
export const ZOOM_MAX = 16;

/**
 * Constrain a canvas zoom to the usable range.
 *
 * A zoom that is not a number would otherwise propagate into the view transform and blank the
 * canvas, which is a hard thing to trace back to a division by zero in a pinch gesture.
 *
 * @param {number} zoom
 * @returns {number}
 */
export function clampZoom(zoom) {
    if (!Number.isFinite(zoom)) return 1;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}
