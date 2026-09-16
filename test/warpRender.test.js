import test from 'node:test';
import assert from 'node:assert/strict';
import { bendOffsetAt, bendSlices, drawWarped, isWarped } from '../src/canvas/warpRender.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const box = { x: 100, y: 50, w: 200, h: 80, bend: 0.5 };

test('the bend leaves both ends of the box where they are', () => {
    // The corners are what the handles sit on. If the ends moved, the box the user drags and
    // the picture they see would come apart.
    near(bendOffsetAt(100, box), 0, 'left edge');
    near(bendOffsetAt(300, box), 0, 'right edge');
});

test('full bend lifts the middle by half the box height', () => {
    near(bendOffsetAt(200, { ...box, bend: 1 }), -40, 'up is negative y');
    near(bendOffsetAt(200, { ...box, bend: -1 }), 40, 'and a negative bend sags');
});

test('no bend is no offset anywhere, and a zero-width box cannot divide by zero', () => {
    near(bendOffsetAt(150, { ...box, bend: 0 }), 0, 'zero');
    near(bendOffsetAt(150, { ...box, w: 0 }), 0, 'degenerate');
});

test('neighbouring slices agree exactly where they meet', () => {
    // This is the whole reason for the slicing rule. A per-slice translation instead of a shear
    // leaves a step at every boundary and the selection tears into bands.
    const slices = bendSlices(box);
    for (let i = 1; i < slices.length; i++) {
        const prev = slices[i - 1], cur = slices[i];
        const edge = cur.a0;
        assert.equal(prev.a0 + prev.len, edge, 'slices tile');
        near(prev.k * edge + prev.m, cur.k * edge + cur.m, `seam at ${edge}`);
    }
});

test('the slices cover exactly the box, starting at its left edge', () => {
    const slices = bendSlices(box);
    assert.equal(slices[0].a0, 100);
    assert.equal(slices.reduce((s, sl) => s + sl.len, 0), 200);
});

test('isWarped is false for every paste made before these fields existed', () => {
    assert.equal(isWarped({}), false);
    assert.equal(isWarped({ skew: 0, bend: 0 }), false);
    assert.equal(isWarped({ skew: 0.2 }), true);
    assert.equal(isWarped({ bend: -0.1 }), true);
});

// ---------------------------------------------------------------------------------------------

function fakeCtx(log) {
    return {
        save: () => log.push('save'),
        restore: () => log.push('restore'),
        transform: (...a) => log.push(`T(${a.map(v => +v.toFixed(4)).join(',')})`),
        drawImage: (_src, ...a) => log.push(`draw(${a.join(',')})`),
    };
}

test('with neither adjustment the draw is one plain drawImage into the box', () => {
    const log = [];
    drawWarped(fakeCtx(log), 'S', 40, 20, { x: 10, y: 20, w: 40, h: 20 });
    assert.deepEqual(log, ['save', 'draw(10,20,40,20)', 'restore']);
});

test('skew pivots on the middle row of the box', () => {
    // transform(1, 0, k, 1, e, 0) sends (x, y) to (x + k*y + e, y). With e = -k * midY the middle
    // row is unmoved, so nudging the slider off zero leans the selection instead of sliding it.
    const log = [];
    drawWarped(fakeCtx(log), 'S', 40, 20, { x: 10, y: 20, w: 40, h: 20, skew: 0.5 });
    assert.equal(log[1], 'T(1,0,0.5,1,-15,0)');       // midY = 30, e = -0.5 * 30
});

test('bend draws the box in slices whose source strips tile the bitmap', () => {
    const log = [];
    const sw = 400, sh = 20;                          // source twice the box width
    drawWarped(fakeCtx(log), 'S', sw, sh, { x: 10, y: 20, w: 200, h: 20, bend: 0.3 });
    const draws = log.filter(l => l.startsWith('draw(')).map(l => l.slice(5, -1).split(',').map(Number));
    assert.ok(draws.length > 1, 'more than one strip');
    // Source strips: consecutive, starting at 0, ending at sw, scaled by sw / w.
    let sx = 0;
    for (const [srcX, srcY, srcW, srcH, dx, dy, dw, dh] of draws) {
        near(srcX, sx, 'source strip starts where the last one ended');
        assert.equal(srcY, 0); assert.equal(srcH, sh);
        near(srcW, dw * (sw / 200), 'source width scaled');
        assert.equal(dy, 20); assert.equal(dh, 20);
        sx += srcW;
    }
    near(sx, sw, 'the strips use the whole bitmap');
    near(draws.reduce((s, d) => s + d[6], 0), 200, 'and fill the whole box');
});
