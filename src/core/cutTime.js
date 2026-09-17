// How long a cut lasts, and how far through it a moment is.

// Easing applied to a 0..1 progress. type: linear | in (slow→fast) | out (fast→slow)
// | inout. power (>=1) is the user-adjustable strength/weight.
// How long a cut lasts, and how far through it a moment is.
//
// Written out six times between here and App - twice as bare arithmetic inside an animation
// function, once inline in the camera call, once as a prop already named cutProgress. The
// concept had a name before it had a function.
//
// The floor is the whole reason it is not just (end - start). A cut can be dragged to zero
// length, and every one of these divides by it.
const MIN_CUT_SECONDS = 0.0001;

/**
 * A cut's length in seconds, never zero.
 * @param {{startTime: number, endTime: number}} ac
 * @returns {number}
 */
export function cutDuration(ac) {
    return Math.max(MIN_CUT_SECONDS, ac.endTime - ac.startTime);
}

/**
 * How far through a cut a moment is: 0 at its start, 1 at its end.
 *
 * Clamped, so a time outside the cut reads as one of its ends rather than extrapolating - which
 * matters because animations are evaluated for cuts that are merely near the playhead.
 *
 * @param {{startTime: number, endTime: number}} ac
 * @param {number} time
 * @returns {number}
 */
export function cutProgress(ac, time) {
    return Math.max(0, Math.min(1, (time - ac.startTime) / cutDuration(ac)));
}
