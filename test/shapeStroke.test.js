import test from 'node:test';
import assert from 'node:assert/strict';
import { rectPoints, ellipsePoints, shapePoints } from '../src/core/shapeStroke.js';

const p = (x, y) => ({ x, y });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('a rectangle is its four corners, closed', () => {
    const r = rectPoints(p(10, 20), p(30, 50));
    assert.equal(r.length, 5);
    assert.deepEqual(r[0], { x: 10, y: 20 });
    assert.deepEqual(r[2], { x: 30, y: 50 }, 'the far corner is the drag end');
    assert.deepEqual(r[4], r[0], 'closed, so the brush leaves no notch');
});

test('dragging up and left gives the same rectangle as down and right', () => {
    // The failure this pins is a shape that vanishes, or inverts, when the drag goes backwards -
    // which is half of all drags and the first thing anyone tries.
    assert.deepEqual(rectPoints(p(30, 50), p(10, 20)), rectPoints(p(10, 20), p(30, 50)));
});

test('a zero-size drag is a point, not an error', () => {
    // A tap with the ruler selected: it must produce something harmless rather than throw inside
    // the pointer handler, which would leave the gesture stuck mid-stroke.
    const r = rectPoints(p(5, 5), p(5, 5));
    assert.equal(r.length, 5);
    assert.ok(r.every(q => q.x === 5 && q.y === 5));
    const e = ellipsePoints(p(5, 5), p(5, 5));
    assert.ok(e.length > 2);
    assert.ok(e.every(q => Number.isFinite(q.x) && Number.isFinite(q.y)), 'no NaN from a zero radius');
});

test('a missing corner returns nothing rather than throwing', () => {
    assert.deepEqual(rectPoints(null, p(1, 1)), []);
    assert.deepEqual(ellipsePoints(p(1, 1), null), []);
});

test('an ellipse fills the same box the rectangle would', () => {
    // Inscribed, not centred on the first corner. If these drift apart the two ruler shapes stop
    // feeling like one tool, and a drag no longer means what it looks like it means.
    const e = ellipsePoints(p(10, 20), p(30, 60));
    const xs = e.map(q => q.x), ys = e.map(q => q.y);
    near(Math.min(...xs), 10, 'left'); near(Math.max(...xs), 30, 'right');
    near(Math.min(...ys), 20, 'top'); near(Math.max(...ys), 60, 'bottom');
});

test('an ellipse is closed', () => {
    const e = ellipsePoints(p(0, 0), p(40, 40));
    assert.deepEqual(e.at(-1), e[0], 'first point repeated, not merely approached');
});

test('every point of a circle is the same distance from its centre', () => {
    const e = ellipsePoints(p(0, 0), p(100, 100), 64);
    for (const q of e) near(Math.hypot(q.x - 50, q.y - 50), 50, 'radius');
});

/** How far the straight chords sag away from the true ellipse - what is actually visible. */
function maxSag(pts, cx, cy, rx, ry) {
    let worst = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        const t = Math.atan2((my - cy) / ry, (mx - cx) / rx);
        worst = Math.max(worst, Math.hypot(mx - (cx + rx * Math.cos(t)), my - (cy + ry * Math.sin(t))));
    }
    return worst;
}

test('the outline stays under a fifth of a pixel from the true curve, at every size', () => {
    // This is the property, and it is the reason the segment count is solved rather than picked:
    // sag is c^2/8r, so holding the *segment length* constant instead over-tessellates a large
    // circle by an order of magnitude to fix a deviation nobody could see.
    for (const size of [8, 60, 200, 600, 1920]) {
        const e = ellipsePoints(p(0, 0), p(size, size));
        const sag = maxSag(e, size / 2, size / 2, size / 2, size / 2);
        assert.ok(sag <= 0.21, `${size}px circle sags ${sag.toFixed(3)}px`);
    }
});

test('a large circle costs a sane number of points', () => {
    // The above is satisfiable by tessellating everything to death. A full-canvas circle should
    // not be a thousand-point stroke in the saved project.
    const big = ellipsePoints(p(0, 0), p(1920, 1920)).length;
    assert.ok(big > 100 && big < 250, `1920px circle used ${big} points`);
});

test('the segment count is bounded at both ends', () => {
    // A tap must still produce a round-looking dot, and a very eccentric ellipse - whose tightest
    // curvature is almost a point - must not ask for unbounded detail.
    assert.equal(ellipsePoints(p(0, 0), p(8, 8)).length, 25, 'floored at 24 segments');
    assert.equal(ellipsePoints(p(0, 0), p(1920, 20)).length, 361, 'capped at 360');
    assert.ok(ellipsePoints(p(0, 0), p(300, 300)).length > 25, 'and it varies in between');
});

test('shapePoints dispatches on the tool, and passes anything else through', () => {
    assert.equal(shapePoints('rect', p(0, 0), p(1, 1)).length, 5);
    assert.ok(shapePoints('ellipse', p(0, 0), p(1, 1)).length > 2);
    assert.equal(shapePoints('line', p(0, 0), p(1, 1)), null, 'the line ruler is not a shape');
    assert.equal(shapePoints('brush', p(0, 0), p(1, 1)), null);
});
