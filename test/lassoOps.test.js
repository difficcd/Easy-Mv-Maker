// The geometry behind lifting a lasso selection. Both of these decide what a freehand loop
// actually encloses, and both used to live inside a pointer-up handler where the awkward case -
// a path whose ends nearly meet - could not be checked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { closeLassoPath, lassoBounds, applyResize, MIN_SELECTION_SIZE } from '../src/lassoOps.js';
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

// ── resizing a selection ───────────────────────────────────────────────────
const SEL = { tx: 100, ty: 100, tw: 200, th: 100 }; // right edge 300, bottom 200

test('applyResize: a corner handle moves both of its edges and no others', () => {
    assert.deepEqual(applyResize('se', SEL, 50, 20), { tx: 100, ty: 100, tw: 250, th: 120 });
    // nw moves the origin, so the size changes by the opposite amount
    assert.deepEqual(applyResize('nw', SEL, 50, 20), { tx: 150, ty: 120, tw: 150, th: 80 });
    assert.deepEqual(applyResize('ne', SEL, 50, 20), { tx: 100, ty: 120, tw: 250, th: 80 });
    assert.deepEqual(applyResize('sw', SEL, 50, 20), { tx: 150, ty: 100, tw: 150, th: 120 });
});

test('applyResize: an edge handle leaves the other axis untouched', () => {
    // The perpendicular delta must not leak in, however far the pointer wandered off-axis.
    assert.deepEqual(applyResize('e', SEL, 50, 999), { tx: 100, ty: 100, tw: 250, th: 100 });
    assert.deepEqual(applyResize('w', SEL, 50, -999), { tx: 150, ty: 100, tw: 150, th: 100 });
    assert.deepEqual(applyResize('n', SEL, 999, 20), { tx: 100, ty: 120, tw: 200, th: 80 });
    assert.deepEqual(applyResize('s', SEL, -999, 20), { tx: 100, ty: 100, tw: 200, th: 120 });
});

test('applyResize: dragging an edge past its opposite stops instead of inverting', () => {
    // A negative or zero size cannot be grabbed again to undo the mistake.
    const out = applyResize('e', SEL, -500, 0);
    assert.equal(out.tw, 2, 'held at the minimum');
    assert.ok(out.tw > 0 && out.th > 0);
});

test('applyResize: the edge being dragged is the one that stops', () => {
    // Pushing the left edge far right must park the left edge against the right one; moving the
    // right edge instead would slide the whole selection away from the pointer.
    const out = applyResize('w', SEL, 500, 0);
    assert.equal(out.tx, 298, 'the left edge parked two pixels short of the fixed right edge');
    assert.equal(out.tx + out.tw, 300, 'and the right edge never moved');
});

test('applyResize: the same holds vertically, in both directions', () => {
    const up = applyResize('s', SEL, 0, -500);
    assert.equal(up.ty, 100, 'the top edge is the fixed one here');
    assert.equal(up.th, 2);
    const down = applyResize('n', SEL, 0, 500);
    assert.equal(down.ty, 198, 'the dragged top edge stops just short of the bottom');
    assert.equal(down.ty + down.th, 200);
});

test('applyResize: no movement is not a resize', () => {
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
        assert.deepEqual(applyResize(h, SEL, 0, 0), SEL, `${h} with no delta`);
    }
});

test('applyResize: never returns a selection too small to grab', () => {
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
        for (const [dx, dy] of [[-9999, -9999], [9999, 9999], [-9999, 9999], [9999, -9999]]) {
            const out = applyResize(h, SEL, dx, dy);
            assert.ok(out.tw >= MIN_SELECTION_SIZE, `${h} width stayed grabbable`);
            assert.ok(out.th >= MIN_SELECTION_SIZE, `${h} height stayed grabbable`);
        }
    }
});

test('applyResize: does not mutate the selection it started from', () => {
    const before = { ...SEL };
    applyResize('nw', SEL, 30, 30);
    assert.deepEqual(SEL, before);
});
