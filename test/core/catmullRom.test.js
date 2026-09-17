import test from 'node:test';
import assert from 'node:assert/strict';
import { catmullThrough } from '../../src/core/catmullRom.js';

const P = (x, y, pressure) => ({ x, y, ...(pressure === undefined ? {} : { pressure }) });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('too few points to fit a curve come back as they are', () => {
    assert.deepEqual(catmullThrough([]), []);
    assert.deepEqual(catmullThrough([P(1, 2)]), [P(1, 2)]);
    assert.deepEqual(catmullThrough([P(1, 2), P(3, 4)]), [P(1, 2), P(3, 4)]);
    assert.deepEqual(catmullThrough(null), []);
});

test('the curve passes through every anchor, not near it', () => {
    // This is the whole reason for Catmull-Rom over a Bezier here: the user taps where the
    // line should go, so the line has to arrive there.
    const anchors = [P(0, 0), P(10, 30), P(40, 10), P(60, 50)];
    const out = catmullThrough(anchors, 16);
    for (const a of anchors) {
        assert.ok(
            out.some(p => near(p.x, a.x, 1e-9) && near(p.y, a.y, 1e-9)),
            `no sample lands on (${a.x}, ${a.y})`,
        );
    }
});

test('it begins at the first anchor and ends at the last', () => {
    const anchors = [P(2, 3), P(9, 1), P(4, 8)];
    const out = catmullThrough(anchors, 8);
    assert.deepEqual([out[0].x, out[0].y], [2, 3]);
    assert.deepEqual([out.at(-1).x, out.at(-1).y], [4, 8]);
});

test('a straight line of anchors stays straight', () => {
    // Overshoot at the ends is what a missing clamp on the neighbour index produces, and it
    // shows up as a hook at each end of an otherwise straight line.
    const out = catmullThrough([P(0, 0), P(10, 0), P(20, 0), P(30, 0)], 8);
    for (const p of out) assert.ok(near(p.y, 0, 1e-9), `y drifted to ${p.y}`);
    for (const p of out) assert.ok(p.x >= -1e-9 && p.x <= 30 + 1e-9, `x left the span at ${p.x}`);
});

test('pressure is interpolated along the curve, not dropped', () => {
    const out = catmullThrough([P(0, 0, 0), P(10, 0, 1), P(20, 0, 0)], 10);
    assert.ok(out.every(p => typeof p.pressure === 'number'));
    assert.equal(out[0].pressure, 0);
    // Somewhere in the middle it reaches the anchor's full pressure.
    assert.ok(out.some(p => near(p.pressure, 1, 1e-9)));
});

test('a point with no pressure is treated as the middle of the range', () => {
    const out = catmullThrough([P(0, 0), P(10, 0), P(20, 0)], 4);
    assert.ok(out.slice(0, -1).every(p => near(p.pressure, 0.5)));
});

test('more segments means more samples, and the anchors are still hit', () => {
    const anchors = [P(0, 0), P(5, 5), P(10, 0)];
    const coarse = catmullThrough(anchors, 4);
    const fine = catmullThrough(anchors, 32);
    assert.ok(fine.length > coarse.length);
    for (const out of [coarse, fine]) {
        assert.ok(out.some(p => near(p.x, 5) && near(p.y, 5)));
    }
});
