import test from 'node:test';
import assert from 'node:assert/strict';
import { swayDispAt, swayWaveAt } from '../src/canvas/canvasUtils.js';
import { swaySlices } from '../src/canvas/swayRender.js';

const WAVE = { amp: 100, speed: 1, curve: null, time: 0.3, lag: 0 };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('with no lag every point along the axis moves together', () => {
    // This is the old behaviour and it has to stay reachable: a flag, not hair.
    const at0 = swayDispAt(0, WAVE);
    for (const p of [0.25, 0.5, 0.75, 1]) assert.ok(near(swayDispAt(p, WAVE), at0), `p=${p}`);
});

test('with a lag the tip is doing what the root did, that much earlier', () => {
    // The lag is in seconds at the far end, so this is the definition of the control rather
    // than a property of it - if this drifts, the number on the panel stops meaning anything.
    const lag = 0.2;
    const tip = swayDispAt(1, { ...WAVE, lag });
    const rootEarlier = swayDispAt(0, { ...WAVE, lag, time: WAVE.time - lag });
    assert.ok(near(tip, rootEarlier), `${tip} vs ${rootEarlier}`);
});

test('the lag is spread along the axis, not applied all at the end', () => {
    const lag = 0.4;
    const half = swayDispAt(0.5, { ...WAVE, lag });
    const rootHalfEarlier = swayDispAt(0, { ...WAVE, lag, time: WAVE.time - lag / 2 });
    assert.ok(near(half, rootHalfEarlier));
});

test('the root is unaffected by the lag', () => {
    // Whatever the lag, the thing being held still moves now. Otherwise turning the dial would
    // slide the whole animation later.
    for (const lag of [0, 0.1, 0.5, 2]) {
        assert.ok(near(swayDispAt(0, { ...WAVE, lag }), swayDispAt(0, WAVE)));
    }
});

test('a lag makes the ends disagree — which is the whole point', () => {
    // Half a period of lag puts the tip in opposition to the root.
    const opposed = swayDispAt(1, { ...WAVE, lag: 0.5 });
    assert.ok(Math.abs(opposed - swayDispAt(0, WAVE)) > 1, 'tip and root still in phase');
});

test('it is deterministic, so the export matches what was watched', () => {
    for (const t of [0, 0.37, 4.2]) {
        const o = { ...WAVE, time: t, lag: 0.25 };
        assert.equal(swayDispAt(0.6, o), swayDispAt(0.6, o));
    }
});

test('a drawn curve is used in place of the sine, and still lags', () => {
    const curve = [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5];
    const o = { amp: 100, speed: 1, curve, time: 0.3, lag: 0.2 };
    assert.ok(near(swayDispAt(1, o), swayDispAt(0, { ...o, time: 0.1 })));
    // And it really is the curve, not the sine.
    assert.notEqual(swayWaveAt(0.3, 1, curve), swayWaveAt(0.3, 1, null));
});

// --- the slices must still butt together ---

const PROFILE = [{ p: 0, w: 0 }, { p: 0.5, w: 0.6 }, { p: 1, w: 1 }];

/** The offset a slice puts at a position along the axis: offset(a) = k*a + m. */
const offsetAt = (slice, a) => slice.k * a + slice.m;

test('neighbouring slices agree at their shared boundary, lag or no lag', () => {
    // This is what stops the drawing tearing into visible bands, and it is the property most
    // likely to break when the displacement stops being one number for the whole span.
    for (const lag of [0, 0.15, 0.5, 1.2]) {
        const slices = swaySlices({
            profile: PROFILE, disp: 100, span: 1080,
            wave: { amp: 100, speed: 1, curve: null, time: 0.3, lag },
        });
        for (let i = 1; i < slices.length; i++) {
            const prev = slices[i - 1], cur = slices[i];
            const boundary = cur.a0;
            assert.ok(
                near(offsetAt(prev, boundary), offsetAt(cur, boundary), 1e-6),
                `lag ${lag}: slices ${i - 1}/${i} disagree at ${boundary}`,
            );
        }
    }
});

test('the slices cover the whole span with no gap', () => {
    const slices = swaySlices({
        profile: PROFILE, disp: 100, span: 1080,
        wave: { amp: 100, speed: 1, curve: null, time: 0.3, lag: 0.3 },
    });
    assert.equal(slices[0].a0, 0);
    const last = slices[slices.length - 1];
    assert.ok(near(last.a0 + last.len, 1080, 1e-6));
    for (let i = 1; i < slices.length; i++) {
        assert.ok(near(slices[i].a0, slices[i - 1].a0 + slices[i - 1].len, 1e-6), `gap before slice ${i}`);
    }
});

test('with no lag the slices are exactly what they were before', () => {
    // The old path is `disp * weight`. A layer already set up must not shift by a pixel.
    const withWave = swaySlices({
        profile: PROFILE, disp: 100, span: 1080,
        wave: { amp: 100, speed: 1, curve: null, time: 0.3, lag: 0 },
    });
    const plain = swaySlices({ profile: PROFILE, disp: 100, span: 1080 });
    assert.equal(withWave.length, plain.length);
    for (let i = 0; i < plain.length; i++) {
        assert.ok(near(withWave[i].k, plain[i].k, 1e-9), `slice ${i} k`);
        assert.ok(near(withWave[i].m, plain[i].m, 1e-9), `slice ${i} m`);
    }
});
