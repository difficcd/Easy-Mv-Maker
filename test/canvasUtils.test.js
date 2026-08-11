// Unit tests for the pure helpers in canvasUtils.
//
// These run on Node's built-in test runner with no extra dependency: everything under test is
// plain maths on plain objects, so there is nothing to mock and no DOM to stand up. The functions
// that do touch a canvas (extractVideoFrames, drawStrokesOnCtx, imageDataToDataURL) are left out
// deliberately - they need a real 2D context and belong in a browser test, not here.
//
// The expected values were taken from running the current implementation, so these lock in
// today's behaviour rather than asserting a specification the code never claimed to meet.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    pointInPolygon, dist, safeArray, hexToRgb, fitRect, layerKey, strokeSig,
    applyEase, triwave, swayWeightAt, sampleWave, sampleKeys, targetCanvasFor,
    computeCutAnim, flattenLayersInUiOrder, sizeCanvas,
} from '../src/canvasUtils.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ── geometry ───────────────────────────────────────────────────────────────
test('pointInPolygon: inside, outside and the lasso case', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    assert.equal(pointInPolygon([5, 5], square), true);
    assert.equal(pointInPolygon([15, 5], square), false);
    assert.equal(pointInPolygon([5, -1], square), false);

    // A concave polygon is the interesting one: the notch must not count as inside.
    const c = [[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10]];
    assert.equal(pointInPolygon([5, 8], c), false, 'the notch is outside');
    assert.equal(pointInPolygon([2, 8], c), true, 'the left arm is inside');
});

test('dist: plain euclidean distance', () => {
    assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
    assert.equal(dist({ x: 1, y: 1 }, { x: 1, y: 1 }), 0);
});

test('fitRect: letterboxes and centres on the constrained axis', () => {
    // A portrait source in a landscape box is limited by height and centred horizontally.
    const r = fitRect(1080, 1920, 1920, 1080);
    assert.equal(r.h, 1080);
    near(r.w, 607.5);
    near(r.x, (1920 - 607.5) / 2);
    assert.equal(r.y, 0);

    // Matching aspect ratios fill the box exactly, with no offset.
    assert.deepEqual(fitRect(100, 100, 50, 50), { x: 0, y: 0, w: 50, h: 50 });
});

// ── small helpers ──────────────────────────────────────────────────────────
test('safeArray: anything that is not an array becomes an empty one', () => {
    assert.deepEqual(safeArray(null), []);
    assert.deepEqual(safeArray(undefined), []);
    assert.deepEqual(safeArray('nope'), []);
    const a = [1, 2];
    assert.equal(safeArray(a), a, 'an array is passed through untouched');
});

test('hexToRgb: parses, and falls back to black rather than NaN', () => {
    assert.deepEqual(hexToRgb('#36354b'), { r: 54, g: 53, b: 75 });
    assert.deepEqual(hexToRgb('nope'), { r: 0, g: 0, b: 0 });
    assert.deepEqual(hexToRgb(''), { r: 0, g: 0, b: 0 });
    assert.deepEqual(hexToRgb(null), { r: 0, g: 0, b: 0 });
});

test('layerKey: cut and layer ids make one cache key', () => {
    assert.equal(layerKey('c1', 'L1'), 'c1:L1');
    // Layer ids are not unique across cuts, which is exactly why the cut id is part of the key.
    assert.notEqual(layerKey('c1', 'L1'), layerKey('c2', 'L1'));
});

test('strokeSig: empty is a fixed token, and edits change the signature', () => {
    assert.equal(strokeSig([]), '0');
    assert.equal(strokeSig(null), '0');
    const one = [{ id: 1, points: [{ x: 0, y: 0 }], size: 3, color: '#000', pen: 'brush' }];
    const two = [...one, { id: 2, points: [{ x: 1, y: 1 }], size: 3, color: '#000', pen: 'brush' }];
    assert.notEqual(strokeSig(one), strokeSig(two), 'adding a stroke changes it');
});

// ── easing and waveforms ───────────────────────────────────────────────────
test('applyEase: shape per type, and the input is clamped', () => {
    assert.equal(applyEase(0.5, 'linear'), 0.5);
    assert.equal(applyEase(0.5, 'in'), 0.25, 'ease-in starts slow');
    assert.equal(applyEase(0.5, 'out'), 0.75, 'ease-out starts fast');
    assert.equal(applyEase(0.5, 'inout'), 0.5, 'symmetric at the midpoint');

    // Every curve has to agree at the ends or an animation would jump at its boundaries.
    for (const type of ['linear', 'in', 'out', 'inout']) {
        assert.equal(applyEase(0, type), 0, `${type} starts at 0`);
        assert.equal(applyEase(1, type), 1, `${type} ends at 1`);
    }
    assert.equal(applyEase(-1, 'linear'), 0, 'clamped below');
    assert.equal(applyEase(2, 'linear'), 1, 'clamped above');
});

test('triwave: triangle wave with period 2, peaking at 1', () => {
    assert.deepEqual([0, 0.5, 1, 1.5, 2].map(triwave), [0, 0.5, 1, 0.5, 0]);
    // Negative input must fold the same way; a sway running backwards relies on it.
    assert.equal(triwave(-0.5), triwave(1.5));
    assert.equal(triwave(2.5), triwave(0.5), 'periodic');
});

test('sampleWave: interpolates, and an empty wave is silent', () => {
    assert.equal(sampleWave([], 0.5), 0);
    const w = [0, 1, 0];
    assert.equal(sampleWave(w, 0), 0);
    assert.equal(sampleWave(w, 0.25), 0.75);
});

test('swayWeightAt: no profile means full sway, and it interpolates between points', () => {
    assert.equal(swayWeightAt([], 0.5), 1, 'no profile = unweighted');
    assert.equal(swayWeightAt(undefined, 0.5), 1);
    assert.equal(swayWeightAt([1, 0], 0), 1);
    assert.equal(swayWeightAt([1, 0], 1), 0);
    assert.equal(swayWeightAt([1, 0], 0.5), 0.5, 'halfway between the two weights');
});

test('sampleKeys: interpolates between keyframes and holds outside the range', () => {
    const keys = [{ p: 0, tx: 0 }, { p: 1, tx: 100 }];
    assert.equal(sampleKeys(keys, 0.5).tx, 50);
    assert.equal(sampleKeys(keys, 0).tx, 0);
    assert.equal(sampleKeys(keys, 1).tx, 100);
    assert.equal(sampleKeys(keys, -1).tx, 0, 'before the first key holds it');
    assert.equal(sampleKeys(keys, 2).tx, 100, 'after the last key holds it');
});

// ── video import sizing ────────────────────────────────────────────────────
test('targetCanvasFor: presets, matching the source, and the fallbacks', () => {
    assert.deepEqual(targetCanvasFor({ canvasMode: 'landscape' }, 800, 600), { w: 1920, h: 1080 });
    assert.deepEqual(targetCanvasFor({ canvasMode: 'portrait' }, 800, 600), { w: 1080, h: 1920 });
    assert.deepEqual(targetCanvasFor({ canvasMode: 'keep' }, 800, 600), { w: 800, h: 600 });

    // Matching the source is the default, and is what stops a shorts clip being letterboxed.
    assert.deepEqual(targetCanvasFor({ canvasMode: 'source', srcW: 1080, srcH: 1920 }, 1920, 1080), { w: 1080, h: 1920 });

    // Odd dimensions are rounded to even so frames do not resample onto half pixels.
    assert.deepEqual(targetCanvasFor({ canvasMode: 'source', srcW: 1081, srcH: 1921 }, 1920, 1080), { w: 1082, h: 1922 });

    // Without metadata there is nothing to match, so the current canvas stands.
    assert.deepEqual(targetCanvasFor({ canvasMode: 'source', srcW: 0, srcH: 0 }, 1920, 1080), { w: 1920, h: 1080 });
    assert.deepEqual(targetCanvasFor(undefined, 1920, 1080), { w: 1920, h: 1080 });
});

// ── layers ─────────────────────────────────────────────────────────────────
test('flattenLayersInUiOrder: only leaves, and a hidden folder hides its children', () => {
    const layers = [
        { id: 'f1', type: 'folder', parentId: null, visible: true },
        { id: 'a', type: 'layer', parentId: 'f1', visible: true },
        { id: 'f2', type: 'folder', parentId: null, visible: false },
        { id: 'b', type: 'layer', parentId: 'f2', visible: true },
        { id: 'c', type: 'layer', parentId: null, visible: true },
    ];
    const ids = flattenLayersInUiOrder(layers).map(l => l.id);
    assert.ok(ids.includes('a'), 'a visible child of a visible folder is included');
    assert.ok(!ids.includes('f1'), 'folders themselves are not drawable');
    assert.ok(ids.includes('c'), 'a top-level layer is included');
});

// ── cut animation ──────────────────────────────────────────────────────────
test('computeCutAnim: no anim means nothing to apply', () => {
    assert.equal(computeCutAnim({ startTime: 0, endTime: 1 }, 0.5), null);
});

// ── canvas sizing ──────────────────────────────────────────────────────────
// Assigning canvas.width reallocates the backing store even when the value is unchanged. A
// boiling layer redraws ten times a second, and the unconditional `cnv.width = CANVAS_W` on the
// reused canvas was measured churning 79MB a second per layer - the tab ran out of memory.
// A plain object stands in for the canvas: sizeCanvas only reads and writes width/height.
test('sizeCanvas: does not touch a canvas that is already the right size', () => {
    let writes = 0;
    const cnv = { _w: 1920, _h: 1080,
        get width() { return this._w; }, set width(v) { writes++; this._w = v; },
        get height() { return this._h; }, set height(v) { writes++; this._h = v; } };
    assert.equal(sizeCanvas(cnv, 1920, 1080), false, 'reports that it did not reallocate');
    assert.equal(writes, 0, 'the whole point: no assignment, so no 8MB reallocation');
});

test('sizeCanvas: resizes when either dimension differs', () => {
    const mk = (w, h) => ({ width: w, height: h });
    const a = mk(300, 150);
    assert.equal(sizeCanvas(a, 1920, 1080), true);
    assert.deepEqual([a.width, a.height], [1920, 1080]);

    const b = mk(1920, 720); // height alone differs
    assert.equal(sizeCanvas(b, 1920, 1080), true);
    assert.deepEqual([b.width, b.height], [1920, 1080]);

    const c = mk(640, 1080); // width alone differs
    assert.equal(sizeCanvas(c, 1920, 1080), true);
    assert.deepEqual([c.width, c.height], [1920, 1080]);
});

test('sizeCanvas: a true return means the canvas is already blank, so callers may skip clearing', () => {
    const cnv = { width: 300, height: 150 };
    assert.equal(sizeCanvas(cnv, 1920, 1080), true, 'resized, and a resize blanks the bitmap');
    assert.equal(sizeCanvas(cnv, 1920, 1080), false, 'second call is a no-op, caller must clear');
});
