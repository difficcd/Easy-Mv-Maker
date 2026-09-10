// Making a preview speed the film's real speed.
//
// The playback selector slows the preview; the exported film comes out at whatever the cuts say.
// So a project that only looks right at 0.25x is a project whose cuts are four times too short,
// and watching it slowly is a workaround for that rather than a setting.
//
// This is the other half: take the speed being previewed at and write it into the cuts, so 0.25x
// becomes the new normal and the export matches what was on screen. Every cut's start and end are
// multiplied by the same factor, which is the only way to do it - scaling each duration
// independently would leave gaps, and cuts abut.
//
// What does not scale, and cannot: the audio and the reference video. Slowing a sound means
// resampling it, and nothing here can re-encode a track. Their positions are left exactly where
// they are and the caller says so, rather than moving them somewhere that is wrong differently.
//
// Animation is unaffected on purpose. Cut and part animation are functions of progress through a
// cut, 0 to 1, so a cut that lasts four times as long animates four times as slowly with no
// arithmetic here at all.

/** Below this the factor is a rounding error, not an intention. */
const MIN_FACTOR = 1e-6;

/**
 * How much longer everything gets when a preview rate is made the real one.
 *
 * Playing at 0.25x means a second of film takes four seconds to watch, so the cuts have to be
 * four times longer to take that long on their own.
 *
 * @param {number} rate the preview speed being made permanent
 * @returns {number} 1 when the rate is unusable, so a bad number is a no-op rather than a wipe
 */
export function bakeFactor(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < MIN_FACTOR) return 1;
    return 1 / n;
}

/**
 * The same cuts, stretched (or squeezed) about time zero.
 *
 * @template {{startTime: number, endTime: number}} C
 * @param {C[]} cuts
 * @param {number} k
 * @returns {C[]} the input untouched when there is nothing to do, so React can skip the render
 */
export function scaleCutTimes(cuts, k) {
    if (!Array.isArray(cuts)) return [];
    if (!Number.isFinite(k) || k <= 0 || k === 1) return cuts;
    return cuts.map(c => {
        const a = Number(c.startTime), b = Number(c.endTime);
        // Checked before multiplying, not after. `Number(NaN) || 0` is 0, so a cut with a broken
        // start would quietly move to the beginning of the film instead of staying where it was
        // and staying obviously wrong. A cut that ends before it starts is the same case.
        if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return c;
        return { ...c, startTime: a * k, endTime: b * k };
    });
}

/**
 * What baking a rate will do, for the message shown before it happens.
 *
 * @param {Array<{startTime: number, endTime: number}>} cuts
 * @param {number} rate
 * @param {{audio?: boolean, video?: boolean}} [media] which tracks are loaded
 */
export function bakePlan(cuts, rate, media = {}) {
    const k = bakeFactor(rate);
    const end = (cuts || []).reduce((m, c) => Math.max(m, Number(c.endTime) || 0), 0);
    return {
        factor: k,
        /** Nothing to do: the preview is already the real speed. */
        noop: k === 1,
        before: end,
        after: end * k,
        /** Tracks that will stay where they are, because a sound cannot be stretched. */
        stranded: [media.audio && 'audio', media.video && 'video'].filter(Boolean),
    };
}
