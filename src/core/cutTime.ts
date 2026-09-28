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
import type { TimeSpan } from './types.ts';

const MIN_CUT_SECONDS = 0.0001;

/**
 * A cut's length in seconds, never zero.
 * @param {{startTime: number, endTime: number}} ac
 * @returns {number}
 */
export function cutDuration(ac: TimeSpan): number {
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
export function cutProgress(ac: TimeSpan, time: number): number {
    return Math.max(0, Math.min(1, (time - ac.startTime) / cutDuration(ac)));
}

/**
 * The span a group of cuts covers: the earliest start to the latest end.
 *
 * For a camera that travels across a whole part rather than a single cut (#349). A part is not
 * a record anywhere - it is whichever cuts carry the same partId - so its span has to be worked
 * out from the cuts each time.
 *
 * Null when the id names nothing, so the caller falls back to the cut it already had rather
 * than dividing by a span of zero.
 *
 * @param cuts every cut in the document
 * @param partId the part to measure
 */
export function partSpan(cuts: TimeSpan[] | null | undefined, partId: unknown): { start: number, end: number } | null {
    if (partId == null) return null;
    let start = Infinity, end = -Infinity;
    for (const c of (Array.isArray(cuts) ? cuts : [])) {
        if ((c as { partId?: unknown }).partId !== partId) continue;
        if (c.startTime < start) start = c.startTime;
        if (c.endTime > end) end = c.endTime;
    }
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/**
 * How far through an arbitrary span a moment is: 0 at its start, 1 at its end.
 *
 * cutProgress with the span handed in rather than read off a cut, and the same floor under the
 * length so a part whose cuts all sit at one instant cannot divide by zero.
 */
export function spanProgress(span: { start: number, end: number }, time: number): number {
    const length = Math.max(MIN_CUT_SECONDS, span.end - span.start);
    return Math.max(0, Math.min(1, (time - span.start) / length));
}
