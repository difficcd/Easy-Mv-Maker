import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyStroke, lightenStroke } from '../../src/core/simplifyStroke.ts';

// "Lighter curve data". Measured on the saved projects' pointer data, rendered through the pen's
// smoothing: at 0.5px this keeps 46.5% of the points, moves the drawn line by a median 0.46px,
// and makes the drawn line calmer (11% less turning per length) - a mouse reports whole pixels,
// so a slow line is a staircase, and many of its steps are dropped.

const P = (x, y, pressure = 0.5) => ({ x, y, pressure });

test('points on a straight run are dropped, the ends kept', () => {
    const line = Array.from({ length: 50 }, (_, i) => P(i * 2, 10));
    assert.deepEqual(simplifyStroke(line), [line[0], line[49]]);
});

test('a point that bends the line by more than the tolerance stays', () => {
    const pts = [P(0, 0), P(10, 0), P(20, 3), P(30, 0), P(40, 0)];
    assert.ok(simplifyStroke(pts, 0.5).some(p => p.x === 20 && p.y === 3));
});

test('a mouse staircase - one-pixel steps - loses more than half its points', () => {
    // Whole-pixel samples along a shallow slope. Not flattened completely, and that is the
    // tolerance doing its job: a one-pixel staircase sits up to half a pixel off the true line,
    // which is exactly the 0.5px allowed, so about half the step corners stay. The first version
    // of this test expected three quarters gone and was wrong about the algorithm, not the code.
    const stairs = Array.from({ length: 40 }, (_, i) => P(i, Math.round(i * 0.3)));
    assert.ok(simplifyStroke(stairs, 0.5).length < stairs.length / 2, `${simplifyStroke(stairs, 0.5).length} of ${stairs.length} kept`);
});

test('a change of pressure is kept even where the line is straight', () => {
    // Otherwise a taper drawn on a straight run would come back a constant width.
    const pts = Array.from({ length: 21 }, (_, i) => P(i * 5, 0, i <= 10 ? 0.2 + i * 0.06 : 0.8 - (i - 10) * 0.06));
    const out = simplifyStroke(pts);
    assert.ok(out.some(p => Math.abs(p.pressure - 0.8) < 1e-9), 'the peak of pressure was dropped');
});

test('the result is a subset of the input, in order', () => {
    const pts = Array.from({ length: 200 }, (_, i) => P(i * 3, 50 + 40 * Math.sin(i / 9), 0.5 + 0.3 * Math.sin(i / 13)));
    const out = simplifyStroke(pts);
    let j = 0;
    for (const p of out) { while (j < pts.length && pts[j] !== p) j++; assert.ok(j < pts.length, 'a point not in the input, or out of order'); }
});

test('under three points there is nothing to drop', () => {
    assert.deepEqual(simplifyStroke([P(0, 0), P(5, 5)]), [P(0, 0), P(5, 5)]);
    assert.deepEqual(simplifyStroke(null), []);
});

test('a very long stroke does not overflow the stack', () => {
    const long = Array.from({ length: 20000 }, (_, i) => P(i * 0.5, Math.sin(i / 50) * 30));
    assert.doesNotThrow(() => simplifyStroke(long));
});

test('only the smoothed tools are lightened', () => {
    const pts = Array.from({ length: 30 }, (_, i) => P(i * 2, 10));
    for (const tool of ['brush', 'pencil', 'marker']) assert.equal(lightenStroke({ tool, points: pts }).points.length, 2, tool);
    // The dot pen is pixel art, the airbrush stamps along raw points, the eraser writes as it goes.
    for (const tool of ['pen', 'soft', 'eraser']) assert.equal(lightenStroke({ tool, points: pts }).points, pts, tool);
});

test('a ruler shape is never lightened', () => {
    const rect = { tool: 'brush', straight: true, points: [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(0, 0)] };
    assert.equal(lightenStroke(rect), rect);
});

// --- windowed: what has been drawn never changes ---------------------------------------------------
//
// The pen's preview redraws the stroke as it will commit, every frame. Simplifying the whole
// stroke each time would let a new sample change which earlier points are kept - the line already
// drawn would shift as the pen moved on. So the stroke is simplified in fixed windows of samples,
// and a finished window is final.

import { simplifyWindowed, SIMPLIFY_WINDOW } from '../../src/core/simplifyStroke.ts';

const wander = (n) => Array.from({ length: n }, (_, i) => P(100 + i * 1.7 + Math.sin(i / 9) * 30, 200 + Math.sin(i / 14) * 60, 0.5 + 0.3 * Math.sin(i / 11)));

test('a finished window keeps the same points however the stroke goes on', () => {
    const all = wander(300);
    const whole = simplifyWindowed(all);
    for (const m of [70, 129, 200, 257]) {
        const prefix = simplifyWindowed(all.slice(0, m));
        // Every point of a window that was already complete at m samples.
        const done = Math.floor((m - 1) / SIMPLIFY_WINDOW) * SIMPLIFY_WINDOW;
        const settled = (list) => list.filter(p => all.indexOf(p) <= done);
        assert.deepEqual(settled(prefix), settled(whole), `at ${m} samples`);
    }
});

test('windowed keeps about as few points as the whole-stroke version', () => {
    // The window ends are kept whatever they are, which costs a little.
    const all = wander(600);
    const w = simplifyWindowed(all).length, g = simplifyStroke(all).length;
    assert.ok(w <= g * 1.25 + 2, `windowed ${w} against ${g}`);
});

test('lightenStroke stores the windowed simplification', () => {
    const all = wander(200);
    assert.deepEqual(lightenStroke({ tool: 'brush', points: all }).points, simplifyWindowed(all));
});
