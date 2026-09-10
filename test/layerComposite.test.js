import test from 'node:test';
import assert from 'node:assert/strict';
import { partMatrix, drawMaskedLayer } from '../src/canvas/layerComposite.js';

/** Where a point lands under a matrix. Easier to reason about than the six numbers. */
const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

const base = { px: 100, py: 50, tx: 0, ty: 0, rot: 0, sc: 1, shear: 0 };

test('no animation is the identity', () => {
    assert.deepEqual(partMatrix(null), [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(partMatrix({ ...base }), [1, 0, 0, 1, 0, 0]);
});

test('a plain offset moves everything by it', () => {
    const [x, y] = at(partMatrix({ ...base, tx: 30, ty: -10 }), 0, 0);
    near(x, 30, 'x'); near(y, -10, 'y');
});

test('rotation turns the part in place, about its pivot', () => {
    // The failure this pins: get the order wrong and the part orbits the top-left corner, which
    // reads as the drawing flying off screen rather than as a wrong pivot.
    const m = partMatrix({ ...base, rot: Math.PI / 2 });
    const [px, py] = at(m, 100, 50);
    near(px, 100, 'pivot x stays'); near(py, 50, 'pivot y stays');
});

test('scale also happens about the pivot', () => {
    const m = partMatrix({ ...base, sc: 2 });
    const [px, py] = at(m, 100, 50);
    near(px, 100, 'pivot x stays'); near(py, 50, 'pivot y stays');
    // A point 10 to the right of the pivot ends up 20 away.
    const [qx] = at(m, 110, 50);
    near(qx, 120, 'scaled about the pivot');
});

test('a quarter turn sends a point right of the pivot to below it', () => {
    const m = partMatrix({ ...base, rot: Math.PI / 2 });
    const [x, y] = at(m, 110, 50);          // 10 to the right of the pivot
    near(x, 100, 'x back to the pivot'); near(y, 60, 'y ten below');
});

test('shear pivots at py, so the pivot row does not slide', () => {
    // Without the -shear*py term the whole layer slides sideways by shear*py, which looks like
    // the drawing jumping the moment sway is switched on.
    const m = partMatrix({ ...base, shear: 0.25 });
    const [x] = at(m, 0, 50);               // on the pivot row
    near(x, 0, 'pivot row stays put');
    const [x2] = at(m, 0, 150);             // 100 below it
    near(x2, 25, 'a row 100 below shifts by shear*100');
});

test('offset and rotation compose - the offset moves the pivot too', () => {
    const m = partMatrix({ ...base, tx: 20, ty: 5, rot: Math.PI / 2 });
    const [x, y] = at(m, 100, 50);
    near(x, 120, 'pivot carried by tx'); near(y, 55, 'pivot carried by ty');
});

test('a missing scale reads as 1, not as 0', () => {
    // `la.sc ?? 1` rather than `la.sc || 1`: both give 1 for undefined, but an explicit 0 is a
    // real request to collapse the part, and || would silently turn it into full size.
    const [x] = at(partMatrix({ ...base, sc: undefined }), 110, 50);
    near(x, 110, 'undefined scale leaves the point alone');
    const m0 = partMatrix({ ...base, sc: 0 });
    const [cx, cy] = at(m0, 110, 60);
    near(cx, 100, 'zero scale collapses to the pivot'); near(cy, 50, 'and in y');
});

// ---------------------------------------------------------------------------------------------

/** Enough of a 2D context to record the call order, which is the whole of what matters here. */
function fakeCtx(name, log) {
    return {
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        setTransform: (...a) => log.push(`${name}.setTransform(${a.join(',')})`),
        drawImage: (src, x = '', y = '') => log.push(`${name}.draw(${src},${x},${y})`),
    };
}

test('the mask is erased on the scratch, never on the frame', () => {
    // Erasing straight onto the frame would take the artwork already drawn there with it.
    const log = [];
    const tctx = fakeCtx('scratch', log);
    const ctx = fakeCtx('frame', log);
    const ops = [];
    Object.defineProperty(tctx, 'globalCompositeOperation', {
        get: () => ops.at(-1) || 'source-over', set: (v) => ops.push(v),
    });
    drawMaskedLayer(ctx, 'LAYER', 'MASK', { x: 12.4, y: 7.6 }, { canvas: 'TMP', ctx: tctx });

    assert.deepEqual(ops, ['source-over', 'destination-out', 'source-over']);
    assert.deepEqual(log, [
        'scratch.setTransform(1,0,0,1,0,0)',
        'scratch.draw(LAYER,0,0)',
        'scratch.draw(MASK,12,8)',      // rounded - a half pixel would resample the mask edge
        'frame.draw(TMP,0,0)',
    ]);
});

test('the scratch is reset before use, because it is shared', () => {
    const log = [];
    const tctx = fakeCtx('scratch', log);
    tctx.globalAlpha = 0.3;                     // left over from whoever used it last
    drawMaskedLayer(fakeCtx('frame', log), 'L', 'M', { x: 0, y: 0 }, { canvas: 'T', ctx: tctx });
    assert.equal(tctx.globalAlpha, 1.0);
    assert.equal(log[0], 'scratch.setTransform(1,0,0,1,0,0)');
});
