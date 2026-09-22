import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothPoints } from '../../src/canvas/strokes.ts';

/** The sharpest turn between consecutive segments, in degrees. A smooth curve has small ones. */
const sharpestTurn = (pts) => {
    let worst = 0;
    for (let i = 2; i < pts.length; i++) {
        const a = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x);
        const b = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
        let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
        worst = Math.max(worst, d * 180 / Math.PI);
    }
    return worst;
};
const circle = (n, r = 200) => Array.from({ length: n + 1 }, (_, i) => ({ x: 400 + r * Math.cos(i / n * Math.PI * 2), y: 400 + r * Math.sin(i / n * Math.PI * 2), pressure: 0.5 }));

test('a circle drawn zoomed out (twelve samples) comes out round, not as a dodecagon', () => {
    // Twelve raw samples 100px apart, corners of 30 degrees. Before: the resample laid fifty
    // points down each straight edge and the corner-cutting rounded each corner by half a
    // pixel - a twelve-sided polygon with slightly soft corners. This is #279.
    const out = smoothPoints(circle(12));
    assert.ok(out.length > 100);
    assert.ok(sharpestTurn(out) < 6, `sharpest turn ${sharpestTurn(out).toFixed(1)} degrees`);
});

test('the same circle drawn zoomed in (dense samples) is unchanged in kind', () => {
    const out = smoothPoints(circle(600));
    assert.ok(sharpestTurn(out) < 3, `sharpest turn ${sharpestTurn(out).toFixed(1)} degrees`);
});

test('sparse input still passes through where it was drawn', () => {
    // Interpolating, not corner-cutting the raw points: a circle stays its size.
    const out = smoothPoints(circle(12));
    const radii = out.map(p => Math.hypot(p.x - 400, p.y - 400));
    assert.ok(Math.min(...radii) > 190 && Math.max(...radii) < 210, `radius ${Math.min(...radii).toFixed(0)}..${Math.max(...radii).toFixed(0)}`);
});

test('under three points there is nothing to smooth', () => {
    assert.deepEqual(smoothPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }]), [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    assert.deepEqual(smoothPoints(null), []);
});
