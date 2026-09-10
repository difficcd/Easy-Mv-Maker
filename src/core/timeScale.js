// Making a preview speed the film's real speed.
//
// The playback selector slows the preview; the exported film comes out at whatever the cuts say.
// So a project that only reads right at 0.25x is a project whose cuts are four times too short,
// and watching it slowly is a workaround rather than a setting.
//
// The rule this has to satisfy is exact, and it is the whole reason the file is this long:
//
//     after baking at factor k, the film at time t must look exactly like the film before
//     baking at time t/k.
//
// Stretching the cuts alone does not do that. Most animation is a function of progress through
// a cut - 0 to 1 - and follows for free. But five values are rates or durations in *seconds*,
// measured against the clock rather than against the cut, and they carry on at their old pace
// while everything around them slows down. That is why part animation did not come out at 0.25x:
// the hair kept swinging at its original frequency over a drawing that now took four times as
// long, and a 0.4-second fade sat inside a cut four times longer, so it read four times faster.
//
//   cut.anim.inDur / outDur     seconds        x k
//   text.anim.inDur / outDur    seconds        x k
//   text.anim.typeSpeed         chars/second   / k
//   text.anim.emSpeed           cycles/second  / k
//   layer.anim.swaySpeed        cycles/second  / k
//   layer.roughSpeed            multiplies a fixed 10Hz boil phase   / k
//
// Everything else already measures itself against the cut and must NOT be touched:
// `layer.anim.speed`, `deformSpeed`, `moveSpeed` and `count` are cycles *across the cut*, and
// keyframes and motion paths are sampled by progress. Scaling those would slow the animation
// twice over.

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

/** A duration in seconds, k times longer. Anything that is not a number is left as it is. */
const longer = (v, k) => (Number.isFinite(Number(v)) ? Number(v) * k : v);
/** A rate per second, k times slower. Zero stays zero - it means "stopped", not "very slow". */
const slower = (v, k) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? Number(v) / k : v);

/** @param {any} anim @param {number} k */
function scaleCutAnim(anim, k) {
    if (!anim) return anim;
    // inDur/outDur are compared against `time - cut.startTime`, so they are seconds.
    // deformSpeed, moveSpeed and the counts are cycles across the cut and stay put.
    return { ...anim, inDur: longer(anim.inDur, k), outDur: longer(anim.outDur, k) };
}

/** @param {any} anim @param {number} k */
function scaleTextAnim(anim, k) {
    if (!anim) return anim;
    // `typeSpeed` is characters per second and `emSpeed` is cycles per second against the
    // absolute clock - both rates, unlike the `speed` on a layer animation, which is cycles
    // across the cut. `charStagger` is a fraction of the entrance and follows inDur on its own.
    return {
        ...anim,
        inDur: longer(anim.inDur, k),
        outDur: longer(anim.outDur, k),
        ...(anim.typeSpeed !== undefined ? { typeSpeed: slower(anim.typeSpeed, k) } : {}),
        ...(anim.emSpeed !== undefined ? { emSpeed: slower(anim.emSpeed, k) } : {}),
    };
}

/** @param {any} layer @param {number} k */
function scaleLayer(layer, k) {
    const out = { ...layer };
    // swaySpeed drives sin(2*PI*swaySpeed*time) off the absolute clock.
    if (layer.anim?.swaySpeed !== undefined) {
        out.anim = { ...layer.anim, swaySpeed: slower(layer.anim.swaySpeed, k) };
    }
    // roughSpeed multiplies a phase that advances at a fixed rate per second, so it is the only
    // handle on how fast a boiling line boils.
    if (layer.roughSpeed !== undefined) out.roughSpeed = slower(layer.roughSpeed, k);
    return out;
}

/**
 * The whole film, k times longer, with every per-second rate slowed to match.
 *
 * @template {Record<string, any>} C
 * @param {C[]} cuts
 * @param {number} k
 * @returns {C[]} the input untouched when there is nothing to do, so React can skip the render
 */
export function scaleProjectTimes(cuts, k) {
    if (!Array.isArray(cuts)) return [];
    if (!Number.isFinite(k) || k <= 0 || k === 1) return cuts;
    return cuts.map(c => {
        const a = Number(c.startTime), b = Number(c.endTime);
        // Checked before multiplying, not after. `Number(NaN) || 0` is 0, so a cut with a broken
        // start would quietly move to the beginning of the film instead of staying where it was
        // and staying obviously wrong. A cut that ends before it starts is the same case.
        if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return c;
        /** @type {any} */
        const out = { ...c, startTime: a * k, endTime: b * k };
        if (c.anim) out.anim = scaleCutAnim(c.anim, k);
        if (Array.isArray(c.layers)) out.layers = c.layers.map(l => scaleLayer(l, k));
        if (Array.isArray(c.texts)) out.texts = c.texts.map(t => (t.anim ? { ...t, anim: scaleTextAnim(t.anim, k) } : t));
        return out;
    });
}

/**
 * What baking a rate will do, for the message shown after it happens.
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
