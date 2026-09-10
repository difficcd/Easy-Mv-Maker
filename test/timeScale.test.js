import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeFactor, scaleCutTimes, bakePlan } from '../src/core/timeScale.js';

const film = () => ([
    { id: 1, startTime: 0, endTime: 0.5, track: 0 },
    { id: 2, startTime: 0.5, endTime: 1.25, track: 0 },
    { id: 3, startTime: 1.25, endTime: 2, track: 0 },
]);

test('quarter speed makes everything four times longer', () => {
    assert.equal(bakeFactor(0.25), 4);
    const out = scaleCutTimes(film(), bakeFactor(0.25));
    assert.deepEqual(out.map(c => [c.startTime, c.endTime]), [[0, 2], [2, 5], [5, 8]]);
});

test('cuts still abut exactly after scaling - this is why one factor is used for all of them', () => {
    // Scaling each duration on its own instead would accumulate rounding and leave gaps that
    // show up as one-frame flashes of nothing.
    for (const rate of [0.1, 0.25, 0.75, 1.5, 3]) {
        const out = scaleCutTimes(film(), bakeFactor(rate));
        for (let i = 1; i < out.length; i++) {
            assert.equal(out[i].startTime, out[i - 1].endTime, `gap at ${i}, rate ${rate}`);
        }
    }
});

test('a film that starts at zero still starts at zero', () => {
    assert.equal(scaleCutTimes(film(), 4)[0].startTime, 0);
});

test('a film that does not start at zero keeps its lead-in, scaled', () => {
    const out = scaleCutTimes([{ startTime: 3, endTime: 4 }], 2);
    assert.deepEqual(out, [{ startTime: 6, endTime: 8 }]);
});

test('speeding up is the same operation, and undoes a slow-down', () => {
    const once = scaleCutTimes(film(), bakeFactor(0.25));
    const back = scaleCutTimes(once, bakeFactor(4));
    assert.deepEqual(back.map(c => [c.startTime, c.endTime]), film().map(c => [c.startTime, c.endTime]));
});

test('everything else about a cut is left alone', () => {
    const [c] = scaleCutTimes([{ id: 7, startTime: 1, endTime: 2, track: 2, layers: ['x'], name: 'Cut 7' }], 3);
    assert.equal(c.id, 7);
    assert.equal(c.track, 2);
    assert.equal(c.name, 'Cut 7');
    assert.deepEqual(c.layers, ['x']);
});

test('normal speed is a no-op that returns the very same array', () => {
    // Identity, not just equality: a new array here would re-render the whole timeline for
    // nothing.
    const cuts = film();
    assert.equal(scaleCutTimes(cuts, 1), cuts);
    assert.equal(bakeFactor(1), 1);
});

test('an unusable rate bakes nothing rather than wiping the timeline', () => {
    // The failure worth guarding: 1/0 is Infinity, and every cut would end at Infinity.
    for (const bad of [0, -1, NaN, Infinity, undefined, null, 'fast']) {
        assert.equal(bakeFactor(/** @type {any} */(bad)), 1, `for ${String(bad)}`);
    }
    assert.equal(scaleCutTimes(film(), 0).length, 3);
    assert.deepEqual(scaleCutTimes(film(), Infinity), film());
});

test('a cut with junk times is left as it was rather than turned into a broken one', () => {
    const cuts = [{ startTime: NaN, endTime: 2 }, { startTime: 0, endTime: 1 }];
    const out = scaleCutTimes(cuts, 4);
    assert.ok(Number.isNaN(out[0].startTime));   // untouched, not multiplied into more NaN
    assert.deepEqual(out[1], { startTime: 0, endTime: 4 });
});

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
