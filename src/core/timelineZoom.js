// Turning timeline pixels into time, and zooming without the content sliding out from under the
// cursor.
//
// The timeline scrolls horizontally behind a sticky column of track labels, so the pixel where
// time zero sits is not the left edge of the element - it is the left edge plus the width of that
// column. Every conversion between a screen x and a time has to account for it, and the width was
// written as a bare 60 in six places, none of which mentioned where the number came from. The one
// place it is actually defined is `.tl-track-label` in App.css; TRACK_GUTTER below is the same
// number, said once, and the two have to be changed together.
//
// Zooming about a point is the same three lines twice - once for the wheel, once for a two-finger
// pinch - and getting it subtly wrong does not look like a bug, it looks like the timeline
// drifting slightly whenever you zoom. Both go through zoomAnchored now.

/** Width of the sticky track-label column, in px. Must match `.tl-track-label` in App.css. */
export const TRACK_GUTTER = 60;

// Below ten pixels a second the cuts are too small to grab; above three hundred a few seconds
// fill the screen and scrolling becomes the only way to see anything.
export const PPS_MIN = 10;
export const PPS_MAX = 300;

/** @param {number} pps @returns {number} */
export function clampPps(pps) {
    if (!Number.isFinite(pps)) return PPS_MIN;
    return Math.max(PPS_MIN, Math.min(PPS_MAX, pps));
}

/**
 * The time under a point, given where the timeline is scrolled to.
 * @param {number} scrollLeft
 * @param {number} localX x within the timeline element, from its left edge
 * @param {number} pps pixels per second
 * @returns {number}
 */
export function timeAtX(scrollLeft, localX, pps) {
    return (scrollLeft + localX - TRACK_GUTTER) / pps;
}

/**
 * Where a time sits, as a content x - what the playhead's `left` is set to.
 * @param {number} time
 * @param {number} pps
 * @returns {number}
 */
export function xAtTime(time, pps) {
    return time * pps + TRACK_GUTTER;
}

/**
 * Scroll position that puts a time back under a point on screen.
 *
 * Never negative: scrolling before the start is not a place the timeline can be, and asking for
 * it once left the first track label overlapping the ruler.
 *
 * @param {number} time the time to pin
 * @param {number} pps the new scale
 * @param {number} localX where on screen it should stay
 * @returns {number}
 */
export function scrollToHold(time, pps, localX) {
    return Math.max(0, xAtTime(time, pps) - localX);
}

/**
 * Zoom by a factor while keeping whatever is under `localX` under `localX`.
 *
 * @param {number} prevPps
 * @param {number} factor >1 zooms in
 * @param {number} scrollLeft current scroll
 * @param {number} localX the point to hold still
 * @returns {{pps: number, scrollLeft: number} | null} null when already at the limit, so the
 *   caller can leave the scroll position alone rather than recomputing it from an unchanged scale
 */
export function zoomAnchored(prevPps, factor, scrollLeft, localX) {
    const pps = clampPps(prevPps * factor);
    if (pps === prevPps) return null;
    return { pps, scrollLeft: scrollToHold(timeAtX(scrollLeft, localX, prevPps), pps, localX) };
}

/**
 * The same thing for a pinch, which scales from where the fingers started rather than from the
 * current value - accumulating a factor per move event would drift.
 *
 * @param {{startPps: number, startDist: number, anchorTime: number}} pinch captured on the second finger down
 * @param {number} dist current distance between the fingers
 * @param {number} localX midpoint between them, within the element
 * @returns {{pps: number, scrollLeft: number}}
 */
export function pinchZoom(pinch, dist, localX) {
    const pps = clampPps(pinch.startPps * (dist / (pinch.startDist || 1)));
    return { pps, scrollLeft: scrollToHold(pinch.anchorTime, pps, localX) };
}
