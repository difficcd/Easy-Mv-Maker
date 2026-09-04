import test from 'node:test';
import assert from 'node:assert/strict';
import { SWING, swing, triwave } from '../src/canvas/canvasUtils.js';

// This was a naming change, not a motion change, so the test that matters is that every call site
// still computes exactly what it computed before. The four originals are written out here
// verbatim and compared across the range - if a shape drifts, this is what says so.

const OLD = {
    // computeCutAnim, deform
    deform: (t, speed, count) => { const cyc = (speed || 1) * t; return (count > 0 && cyc >= count) ? 0 : Math.sin(2 * Math.PI * cyc); },
    // computeCutAnim, move
    move: (t, speed, count) => { const cyc = (speed || 1) * t; return (count > 0 && cyc >= count) ? 0 : (1 - Math.cos(2 * Math.PI * cyc)) / 2; },
    // computeLayerAnim, transform
    layer: (t, speed, count) => { const cyc = speed * t; return (count > 0 && cyc >= count) ? 0 : Math.sin(2 * Math.PI * cyc); },
    // computeLayerAnim, path
    path: (t, speed, count) => { let x = 2 * speed * t; if (count > 0 && x >= 2 * count) x = 0; return triwave(x); },
};

const SAMPLES = [];
for (let i = 0; i <= 40; i++) SAMPLES.push(i / 40);

const across = (fn, old, speed, count) => {
    for (const t of SAMPLES) {
        assert.ok(Math.abs(fn(t) - old(t, speed, count)) < 1e-12,
            `t=${t} speed=${speed} count=${count}: ${fn(t)} vs ${old(t, speed, count)}`);
    }
};

for (const speed of [0.5, 1, 2, 3.5]) {
    for (const count of [0, 1, 2, 5]) {
        test(`the deform swing is unchanged (speed ${speed}, count ${count})`, () => {
            across(t => swing(SWING.through, t, speed, count), OLD.deform, speed, count);
        });
        test(`the cut move swing is unchanged (speed ${speed}, count ${count})`, () => {
            across(t => swing(SWING.there, t, speed, count), OLD.move, speed, count);
        });
        test(`the layer transform swing is unchanged (speed ${speed}, count ${count})`, () => {
            across(t => swing(SWING.through, t, speed, count), OLD.layer, speed, count);
        });
        test(`the path swing is unchanged (speed ${speed}, count ${count})`, () => {
            across(t => swing(SWING.along, t, speed, count), OLD.path, speed, count);
        });
    }
}

test('a missing speed is one trip, as it was', () => {
    for (const t of SAMPLES) {
        assert.equal(swing(SWING.through, t, 0, 0), swing(SWING.through, t, 1, 0));
        assert.equal(swing(SWING.through, t, undefined, 0), swing(SWING.through, t, 1, 0));
    }
});

// The shapes differ on purpose, and this is the difference: two of them never pass the resting
// position, one goes out the other side. The layer presets - 둥실둥실, 숨쉬기 - are the reason.
test('through goes both ways; there and along do not', () => {
    const lows = { through: 0, there: 0, along: 0 };
    const highs = { through: 0, there: 0, along: 0 };
    for (const t of SAMPLES) {
        for (const k of Object.keys(lows)) {
            const v = SWING[k](t);
            lows[k] = Math.min(lows[k], v);
            highs[k] = Math.max(highs[k], v);
        }
    }
    assert.ok(lows.through < -0.99, 'through must reach the far side');
    assert.equal(lows.there, 0);
    assert.equal(lows.along, 0);
    for (const k of Object.keys(highs)) assert.ok(highs[k] > 0.99, `${k} must reach the target`);
});

test('one cycle is one whole trip for all three, so speed means the same thing', () => {
    for (const shape of Object.values(SWING)) {
        assert.ok(Math.abs(shape(0)) < 1e-12, 'starts at rest');
        assert.ok(Math.abs(shape(1)) < 1e-12, 'a whole trip ends at rest');
        assert.ok(Math.abs(shape(2)) < 1e-12, 'and so does the next');
    }
});

test('running out of repeats settles at rest rather than mid-swing', () => {
    assert.equal(swing(SWING.through, 0.9, 2, 1), 0);
    assert.equal(swing(SWING.there, 0.9, 2, 1), 0);
    assert.equal(swing(SWING.along, 0.9, 2, 1), 0);
    assert.notEqual(swing(SWING.through, 0.4, 2, 1), 0, 'and not before the cap is reached');
});
