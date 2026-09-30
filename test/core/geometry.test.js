// Small geometry helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inkBounds } from '../../src/core/geometry.ts';

// --- the box a stroke's ink occupies ----------------------------------------------------------
//
// The pencil and the marker each took a full-canvas scratch, painted the stroke, filled the
// whole thing with grain and blitted all of it back - for a stroke that might cover a corner.
// This is what lets them pay for the stroke instead of the canvas.

const pts = (...xy) => xy.map(([x, y]) => ({ x, y }));

test('inkBounds: the points, grown by the pad', () => {
    assert.deepEqual(inkBounds(pts([100, 100], [200, 150]), 10, 1920, 1080),
        { x: 90, y: 90, w: 120, h: 70 });
});

test('inkBounds: rounds outward, so a stroke is never cut by a fraction of a pixel', () => {
    assert.deepEqual(inkBounds(pts([10.4, 10.6], [20.2, 20.1]), 0, 1920, 1080),
        { x: 10, y: 10, w: 11, h: 11 });
});

test('inkBounds: clamped to the canvas', () => {
    assert.deepEqual(inkBounds(pts([-50, -50], [30, 30]), 10, 1920, 1080), { x: 0, y: 0, w: 40, h: 40 });
    const r = inkBounds(pts([1900, 1060], [2200, 1300]), 10, 1920, 1080);
    assert.deepEqual(r, { x: 1890, y: 1050, w: 30, h: 30 });
});

test('inkBounds: null when there is nothing to draw', () => {
    // The caller skips the whole scratch-and-blit rather than allocating a zero-sized canvas.
    assert.equal(inkBounds([], 4, 1920, 1080), null);
    assert.equal(inkBounds(null, 4, 1920, 1080), null);
    assert.equal(inkBounds(pts([5000, 5000]), 4, 1920, 1080), null, 'entirely off-canvas');
    assert.equal(inkBounds(pts([NaN, 1], [undefined, 2]), 4, 1920, 1080), null, 'no usable point');
});

test('inkBounds: a single point still has area once padded', () => {
    assert.deepEqual(inkBounds(pts([100, 100]), 5, 1920, 1080), { x: 95, y: 95, w: 10, h: 10 });
});

test('inkBounds: a negative pad is treated as none, not as a shrink', () => {
    assert.deepEqual(inkBounds(pts([10, 10], [20, 20]), -100, 1920, 1080), { x: 10, y: 10, w: 10, h: 10 });
});
