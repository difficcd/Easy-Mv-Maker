// How fast preview playback runs, and the fact that the choice is remembered.
//
// The speed selector has been in the timeline toolbar for a while, but it reset to 1x on every
// reload, so "work at half speed" had to be re-chosen every session. Making it a stored
// preference is the whole feature.
//
// Storing it is what makes the guard below matter. A session value could only ever be one of the
// options; a stored one is whatever is in localStorage, and `parseFloat` is happy with `0` and
// `-2`. Zero freezes the clock - playback runs and the playhead never moves - and there is
// nothing on screen that would explain why. So an unusable stored rate falls back to 1 rather
// than being clamped to the nearest legal value: a rate someone did not choose should not be a
// rate they then have to notice and undo.

/**
 * The speeds offered, slowest first.
 *
 * The low end goes below what the audio can follow on purpose. Browsers stop playing sound
 * outside roughly 0.25x-4x, and at 0.1x the point is to watch the drawing, not to hear it.
 */
export const PLAYBACK_RATES = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Neither of these is a speed: one never arrives, the other runs the film backwards. */
export const RATE_MIN = 0.05;
export const RATE_MAX = 16;

/** The speed nothing has been chosen: normal. */
export const RATE_DEFAULT = 1;

/**
 * A usable playback rate, or the default.
 *
 * @param {unknown} v
 * @returns {number}
 */
export function safePlaybackRate(v) {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (!Number.isFinite(n) || n < RATE_MIN || n > RATE_MAX) return RATE_DEFAULT;
    return n;
}

/** For `useStored`. A rate that will not decode is the default, not a frozen clock. */
export const playbackRateCodec = {
    decode: (/** @type {string} */ raw) => safePlaybackRate(raw),
    encode: (/** @type {number} */ value) => String(safePlaybackRate(value)),
};
