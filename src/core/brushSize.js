// How wide a brush may be, and how a keystroke changes it.
//
// The range was written twice: the panel clamped 1..200 when you typed or picked a preset, and
// the keyboard shortcut clamped 1..200 again on its own. They agree today. The canvas zoom range
// also agreed, in two places, right up until it did not - and then zooming to 16x with a button
// and turning the wheel one notch snapped back to 8x, because the other copy had never heard of
// 16. Two copies of a range is that bug waiting for someone to edit one of them.
//
// The slider is deliberately not part of this: it stops at 80 and shows `Math.min(80, size)` for
// anything larger, because a slider that spans the whole range makes every ordinary size land in
// the first fifth of it. That is a decision about the control, not about the brush.

export const BRUSH_MIN = 1;
export const BRUSH_MAX = 200;

/**
 * A brush width the app will accept: a whole number inside the range.
 *
 * @param {number} n
 * @returns {number}
 */
export function clampBrush(n) {
    return Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(n) || BRUSH_MIN));
}

/**
 * The next width up, for the shortcut.
 *
 * A quarter wider, plus one. The plus one is not decoration: a size of 1 multiplied by 1.25 is
 * 1.25, which rounds back to 1, so without it the shortcut does nothing at the sizes where a
 * single pixel matters most.
 *
 * @param {number} size
 * @returns {number}
 */
export function brushUp(size) {
    return clampBrush(Math.round(size * 1.25) + 1);
}

/**
 * The next width down.
 *
 * The mirror of the above, and it was missing: 2 / 1.25 is 1.6, which rounds back to 2, so the
 * shortcut for a smaller brush did nothing at all at size 2. Taking at least one pixel off means
 * the key always does something, all the way down to the minimum.
 *
 * @param {number} size
 * @returns {number}
 */
export function brushDown(size) {
    return clampBrush(Math.min(size - 1, Math.round(size / 1.25)));
}
