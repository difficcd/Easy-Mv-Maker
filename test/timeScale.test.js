import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeFactor, scaleProjectTimes, bakePlan } from '../src/core/timeScale.js';
import { computeCutAnim, computeLayerAnim, computeTextAnim, charAnimAt } from '../src/canvas/canvasUtils.js';

const CW = 1920, CH = 1080;

const film = () => ([
    { id: 1, startTime: 0, endTime: 0.5, track: 0 },
    { id: 2, startTime: 0.5, endTime: 1.25, track: 0 },
    { id: 3, startTime: 1.25, endTime: 2, track: 0 },
]);

/** One cut with every kind of animation on it, so the equivalence test has something to catch. */
const animated = () => ([{
    id: 1, startTime: 0, endTime: 2, track: 0,
    anim: { inType: 'fade', inDur: 0.4, outType: 'slide', outDur: 0.3, outDir: 'left', ease: 'inout', easePower: 2, deformAmount: 0.2, deformSpeed: 2, deformCount: 0, deformAxis: 'y', moveX: 40, moveY: 0, moveSpeed: 1, moveReturn: true, moveCount: 0 },
    layers: [{
        id: 1, type: 'layer', visible: true, roughen: 3, roughSpeed: 1.5,
        anim: { mode: 'progress', speed: 2, count: 0, tx: 30, ty: 10, rot: 15, scale: 0.2, pivotX: 0.5, pivotY: 0, ease: 'linear', swayAmount: 20, swaySpeed: 1.5, swayAxis: 'y' },
    }],
    texts: [{
        id: 't1', text: 'hello world', x: 10, y: 10, size: 40, visible: true,
        anim: { inType: 'fade', inDur: 0.4, outType: 'fade', outDur: 0.3, typing: true, typeSpeed: 8, charStagger: 0.2, emphasis: 'pulse', emAmount: 20, emSpeed: 2 },
    }],
}]);

// ---------------------------------------------------------------------------------------------
// The property the whole feature rests on.
// ---------------------------------------------------------------------------------------------

test('after baking at k, the film at t looks like the film before baking at t/k', () => {
    // This is what "완벽히 0.25로" means, and stretching the cuts alone does not deliver it:
    // sway, boil, the cut transitions and the typing entrance are all measured in seconds.
    for (const rate of [0.25, 0.5, 2]) {
        const k = bakeFactor(rate);
        const before = animated();
        const after = scaleProjectTimes(before, k);
        for (let step = 0; step <= 40; step++) {
            const t0 = (step / 40) * 2;      // a moment in the original film
            const t1 = t0 * k;               // the same moment in the baked one
            const cutA = computeCutAnim(before[0], t0, CW, CH);
            const cutB = computeCutAnim(after[0], t1, CW, CH);
            assert.deepEqual(round(cutB), round(cutA), `cut anim, rate ${rate}, t=${t0}`);

            const layA = computeLayerAnim(before[0].layers[0], before[0], t0, CW, CH);
            const layB = computeLayerAnim(after[0].layers[0], after[0], t1, CW, CH);
            assert.deepEqual(round(layB), round(layA), `layer anim, rate ${rate}, t=${t0}`);

            const txtA = computeTextAnim(before[0].texts[0], before[0], t0);
            const txtB = computeTextAnim(after[0].texts[0], after[0], t1);
            assert.deepEqual(round(drawn(txtB)), round(drawn(txtA)), `text anim, rate ${rate}, t=${t0}`);
        }
    }
});


/**
 * What a text animation actually puts on the canvas.
 *
 * `perChar` carries `local` and `dur` straight through for the character renderer to divide one
 * by the other, so after baking both are k times larger and the struct differs while nothing
 * drawn does. Comparing the struct would fail on that; comparing what `charAnimAt` returns for
 * every character is both honest and stricter.
 */
function drawn(anim) {
    if (!anim) return anim;
    const { perChar, ...block } = anim;
    const chars = 'hello world'.length;
    return {
        ...block,
        perChar: perChar ? Array.from({ length: chars }, (_, i) => charAnimAt(perChar, i, chars)) : null,
    };
}

/** Float noise is not a difference. Ten decimals is far finer than a pixel or a frame. */
function round(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? +v.toFixed(10) : v;
    if (Array.isArray(v)) return v.map(round);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
    return v;
}

test('the boil keeps pace, because roughSpeed is the only handle on it', () => {
    // The phase is `time * 10 * roughSpeed`. Nothing else can slow a boiling line down.
    const [c] = scaleProjectTimes(animated(), 4);
    assert.equal(c.layers[0].roughSpeed, 1.5 / 4);
});

test('a rate measured against the cut is left alone, or the animation slows twice', () => {
    const [c] = scaleProjectTimes(animated(), 4);
    assert.equal(c.layers[0].anim.speed, 2);        // cycles across the cut
    assert.equal(c.anim.deformSpeed, 2);
    assert.equal(c.anim.moveSpeed, 1);
    assert.equal(c.anim.deformCount, 0);
});

test('a rate measured in seconds is scaled', () => {
    const [c] = scaleProjectTimes(animated(), 4);
    assert.equal(c.anim.inDur, 1.6);
    assert.equal(c.anim.outDur, 1.2);
    assert.equal(c.layers[0].anim.swaySpeed, 1.5 / 4);
    assert.equal(c.texts[0].anim.inDur, 1.6);
    assert.equal(c.texts[0].anim.typeSpeed, 2);      // 8 characters a second becomes 2
    assert.equal(c.texts[0].anim.emSpeed, 0.5);      // and the pulse slows with everything else
});

test('a stopped boil stays stopped rather than becoming very slightly alive', () => {
    // roughSpeed 0 means "do not boil". Dividing it would be fine arithmetically and wrong in
    // meaning, but `swaySpeed: 0` divided is still 0 - the guard is about not turning an
    // explicit zero into something the UI shows as a rate.
    const cuts = [{ startTime: 0, endTime: 1, layers: [{ id: 1, roughSpeed: 0, anim: { swaySpeed: 0 } }] }];
    const [c] = scaleProjectTimes(cuts, 4);
    assert.equal(c.layers[0].roughSpeed, 0);
    assert.equal(c.layers[0].anim.swaySpeed, 0);
});

// ---------------------------------------------------------------------------------------------
// The timeline itself.
// ---------------------------------------------------------------------------------------------

test('quarter speed makes everything four times longer', () => {
    assert.equal(bakeFactor(0.25), 4);
    const out = scaleProjectTimes(film(), bakeFactor(0.25));
    assert.deepEqual(out.map(c => [c.startTime, c.endTime]), [[0, 2], [2, 5], [5, 8]]);
});

test('cuts still abut exactly after scaling - this is why one factor is used for all of them', () => {
    // Scaling each duration on its own instead would accumulate rounding and leave gaps that
    // show up as one-frame flashes of nothing.
    for (const rate of [0.1, 0.25, 0.75, 1.5, 3]) {
        const out = scaleProjectTimes(film(), bakeFactor(rate));
        for (let i = 1; i < out.length; i++) {
            assert.equal(out[i].startTime, out[i - 1].endTime, `gap at ${i}, rate ${rate}`);
        }
    }
});

test('a film that does not start at zero keeps its lead-in, scaled', () => {
    assert.deepEqual(scaleProjectTimes([{ startTime: 3, endTime: 4 }], 2), [{ startTime: 6, endTime: 8 }]);
});

test('speeding up is the same operation, and undoes a slow-down exactly', () => {
    const once = scaleProjectTimes(animated(), bakeFactor(0.25));
    const back = scaleProjectTimes(once, bakeFactor(4));
    assert.deepEqual(round(back), round(animated()));
});

test('everything else about a cut is left alone', () => {
    const [c] = scaleProjectTimes([{ id: 7, startTime: 1, endTime: 2, track: 2, name: 'Cut 7' }], 3);
    assert.equal(c.id, 7);
    assert.equal(c.track, 2);
    assert.equal(c.name, 'Cut 7');
});

test('a layer or text without animation is not given one', () => {
    const cuts = [{ startTime: 0, endTime: 1, layers: [{ id: 1, type: 'layer' }], texts: [{ id: 't' }] }];
    const [c] = scaleProjectTimes(cuts, 4);
    assert.equal('anim' in c.layers[0], false);
    assert.equal('anim' in c.texts[0], false);
    assert.equal('anim' in c, false);
});

test('normal speed is a no-op that returns the very same array', () => {
    // Identity, not just equality: a new array here would re-render the whole timeline for
    // nothing.
    const cuts = film();
    assert.equal(scaleProjectTimes(cuts, 1), cuts);
    assert.equal(bakeFactor(1), 1);
});

test('an unusable rate bakes nothing rather than wiping the timeline', () => {
    // The failure worth guarding: 1/0 is Infinity, and every cut would end at Infinity.
    for (const bad of [0, -1, NaN, Infinity, undefined, null, 'fast']) {
        assert.equal(bakeFactor(/** @type {any} */(bad)), 1, `for ${String(bad)}`);
    }
    assert.deepEqual(scaleProjectTimes(film(), Infinity), film());
});

test('a cut with junk times is left as it was rather than turned into a broken one', () => {
    const cuts = [{ startTime: NaN, endTime: 2 }, { startTime: 0, endTime: 1 }];
    const out = scaleProjectTimes(cuts, 4);
    assert.ok(Number.isNaN(out[0].startTime));   // untouched, not multiplied into more NaN
    assert.deepEqual(out[1], { startTime: 0, endTime: 4 });
});

// ---------------------------------------------------------------------------------------------
// The message shown afterwards.
// ---------------------------------------------------------------------------------------------

test('the plan says how much longer the film gets', () => {
    const p = bakePlan(film(), 0.25);
    assert.equal(p.factor, 4);
    assert.equal(p.before, 2);
    assert.equal(p.after, 8);
    assert.equal(p.noop, false);
});

test('the plan names the tracks that will be left behind', () => {
    // Slowing a sound means resampling it, which nothing here can do, so the caller has to say
    // that the music is about to stop matching the drawing.
    assert.deepEqual(bakePlan(film(), 0.5, { audio: true }).stranded, ['audio']);
    assert.deepEqual(bakePlan(film(), 0.5, { audio: true, video: true }).stranded, ['audio', 'video']);
    assert.deepEqual(bakePlan(film(), 0.5).stranded, []);
});

test('at normal speed the plan says there is nothing to do', () => {
    const p = bakePlan(film(), 1);
    assert.equal(p.noop, true);
    assert.equal(p.before, p.after);
});

test('an empty film has a length of zero rather than -Infinity', () => {
    // Math.max of nothing is -Infinity, which would print as a negative running time.
    assert.equal(bakePlan([], 0.5).before, 0);
    assert.equal(bakePlan([], 0.5).after, 0);
});
