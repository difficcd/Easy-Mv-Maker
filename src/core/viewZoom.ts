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

import type { Point } from './types.ts';

/** The canvas view: zoom, and where the canvas origin sits on the stage. */
export interface View { zoom: number; x: number; y: number }

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
export function clampZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) return 1;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/**
 * The view zoomed by a factor about a point, with that point staying put on screen.
 *
 * `cx, cy` are measured from the centre of the canvas area, which is the origin the view's
 * offset is expressed in - so (0, 0) zooms about the centre, which is what the buttons and the
 * shortcuts do, and the cursor position zooms about the cursor, which is what the wheel does.
 * The clamp applies before the offset is scaled, so at a limit the view does not drift.
 *
 * @param {{zoom: number, x: number, y: number}} view
 * @param {number} factor
 * @param {number} [cx]
 * @param {number} [cy]
 * @returns {{zoom: number, x: number, y: number}}
 */
export function zoomAbout(view: View, factor: number, cx = 0, cy = 0): View {
    const zoom = clampZoom(view.zoom * factor);
    const k = zoom / view.zoom;
    return { zoom, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
}

/**
 * The view under a two-finger pinch: zoomed by how far apart the fingers are compared with
 * where they started, and panned by how far their midpoint has moved.
 *
 * @param {{startView: {zoom: number, x: number, y: number}, startDist: number, startMid: {x: number, y: number}}} pinch
 * @param {{x: number, y: number}} a one finger now
 * @param {{x: number, y: number}} b the other
 * @returns {{zoom: number, x: number, y: number}}
 */
export function pinchedView(pinch: { startView: View, startDist: number, startMid: Point }, a: Point, b: Point): View {
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { startView: s } = pinch;
    return { zoom: clampZoom(s.zoom * (dist / pinch.startDist)), x: s.x + (mid.x - pinch.startMid.x), y: s.y + (mid.y - pinch.startMid.y) };
}
