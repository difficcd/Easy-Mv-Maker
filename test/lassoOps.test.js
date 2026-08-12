// The geometry behind lifting a lasso selection. Both of these decide what a freehand loop
// actually encloses, and both used to live inside a pointer-up handler where the awkward case -
// a path whose ends nearly meet - could not be checked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { closeLassoPath, lassoBounds } from '../src/lassoOps.js';
import { pointInPolygon } from '../src/canvasUtils.js';

const P = (x, y) => ({ x, y });

test('closeLassoPath: ends far apart get a closing edge, keeping every drawn point', () => {
    const pts = [P(0, 0), P(10, 0), P(10, 10), P(0, 40)];
    const out = closeLassoPath(pts);
    assert.equal(out.length, pts.length + 1);
    assert.deepEqual(out[out.length - 1], pts[0], 'ends where it started');
    assert.deepEqual(out.slice(0, -1), pts, 'nothing the user drew was dropped');
});

test('closeLassoPath: ends already touching snap onto the start instead of adding an edge', () => {
    // A stray point one pixel from the first would otherwise leave a hairline edge right where
    // the loop closes, and the crossing test is ambiguous across it.
    const pts = [P(0, 0), P(10, 0), P(10, 10), P(1, 1)];
    const out = closeLassoPath(pts);
    assert.equal(out.length, pts.length, 'the near-duplicate was replaced, not appended');
    assert.deepEqual(out[out.length - 1], pts[0]);
    assert.deepEqual(out[2], pts[2], 'the rest of the path is untouched');
});

test('closeLassoPath: the snap distance is the boundary between the two behaviours', () => {
    const near = [P(0, 0), P(50, 0), P(7, 0)];   // gap 7 <= 8
    const far = [P(0, 0), P(50, 0), P(9, 0)];    // gap 9 > 8
    assert.equal(closeLassoPath(near).length, near.length, 'inside the snap distance');
    assert.equal(closeLassoPath(far).length, far.length + 1, 'outside it');
    // and it is adjustable
    assert.equal(closeLassoPath(far, 20).length, far.length, 'a wider snap swallows the same gap');
});

test('closeLassoPath: too few points to enclose anything is not an error', () => {
    assert.deepEqual(closeLassoPath([]), []);
    assert.deepEqual(closeLassoPath([P(1, 1)]), [P(1, 1)]);
    assert.deepEqual(closeLassoPath(null), []);
    assert.deepEqual(closeLassoPath(undefined), []);
});

test('closeLassoPath: does not mutate the points it was given', () => {
    const pts = [P(0, 0), P(10, 0), P(10, 10), P(0, 40)];
    const copy = JSON.parse(JSON.stringify(pts));
    closeLassoPath(pts);
    assert.deepEqual(pts, copy);
});

test('closeLassoPath: the result is a ring the crossing test can actually use', () => {
    const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(3, 3)]; // ends well inside
    const poly = closeLassoPath(square).map(p => [p.x, p.y]);
    assert.equal(pointInPolygon([5, 8], poly), true, 'a point inside reads as inside');
    assert.equal(pointInPolygon([20, 5], poly), false, 'a point outside reads as outside');
});

test('lassoBounds: rounds outwards so no edge pixel is clipped away', () => {
    const b = lassoBounds([P(10.7, 20.2), P(30.1, 40.9)], 1920, 1080);
    assert.deepEqual(b, { x: 10, y: 20, w: 21, h: 21 });
});

test('lassoBounds: clamps to the canvas rather than reading outside it', () => {
    const b = lassoBounds([P(-50, -50), P(5000, 5000)], 1920, 1080);
    assert.deepEqual(b, { x: 0, y: 0, w: 1920, h: 1080 });
});

test('lassoBounds: a lasso entirely off-canvas has nothing to lift', () => {
    const b = lassoBounds([P(-100, -100), P(-50, -50)], 1920, 1080);
    assert.equal(b.w, 0);
    assert.equal(b.h, 0);
});

test('lassoBounds: no points means an empty rectangle, not NaN', () => {
    for (const pts of [[], null, undefined]) {
        const b = lassoBounds(pts, 1920, 1080);
        assert.deepEqual(b, { x: 0, y: 0, w: 0, h: 0 });
    }
});

test('lassoBounds: a single point encloses no area', () => {
    const b = lassoBounds([P(100, 100)], 1920, 1080);
    assert.deepEqual(b, { x: 100, y: 100, w: 0, h: 0 });
});
