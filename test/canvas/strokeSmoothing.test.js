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

// --- a fast stretch inside a slow stroke ---------------------------------------------------------
//
// Whether a stroke was interpolated was decided by its *mean* sample spacing. A stroke drawn slowly
// and then swept quickly averages out dense - so the fast stretch, with samples 30px apart, was
// never interpolated: resampled along its straight chords, with Chaikin rounding each corner by a
// pixel or two. That is "a fast curve looks angular". Measured on the saved projects: 409 of 4,681
// real strokes (8.7%) had such a stretch, carrying 1,857 kinks.

const arc = (cx, cy, r, from, to, gap) => {
    const n = Math.max(2, Math.ceil(Math.abs(to - from) * r / gap));
    return Array.from({ length: n + 1 }, (_, i) => { const a = from + (to - from) * i / n; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), pressure: 0.5 }; });
};
/** Slow (2px samples) into a fast sweep (30px samples) of the same circle. */
const slowThenFast = () => [...arc(200, 200, 120, Math.PI, Math.PI * 1.25, 2), ...arc(200, 200, 120, Math.PI * 1.25, Math.PI * 2.2, 30).slice(1)];

/** The worst vertex turning far more than the curve around it - a kink, not curvature. */
const worstSpike = (pts) => {
    const t = [];
    for (let i = 1; i < pts.length - 1; i++) {
        const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y, bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la > 1e-6 && lb > 1e-6) t.push(Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180 / Math.PI);
    }
    let worst = 0;
    for (let i = 3; i < t.length - 3; i++) {
        const around = [t[i - 3], t[i - 2], t[i + 2], t[i + 3]].sort((a, b) => a - b);
        worst = Math.max(worst, t[i] - (around[1] + around[2]) / 2);
    }
    return worst;
};

test('a fast sweep inside a slow stroke comes out round, not angular', () => {
    const spike = worstSpike(smoothPoints(slowThenFast()));
    assert.ok(spike < 3, `a ${spike.toFixed(1)} degree kink - the fast stretch was drawn as straight chords`);
});

test('the fast stretch still passes through where it was drawn', () => {
    // Interpolated, so it stays on the circle the hand traced rather than cutting inside it.
    const radii = smoothPoints(slowThenFast()).map(p => Math.hypot(p.x - 200, p.y - 200));
    assert.ok(Math.min(...radii) > 116 && Math.max(...radii) < 124, `radius ${Math.min(...radii).toFixed(1)}..${Math.max(...radii).toFixed(1)}`);
});

test('a sharp corner drawn on purpose is not rounded away', () => {
    // The centripetal form is what keeps this: a uniform spline overshoots a corner between
    // segments of very different lengths, which reads as a loop or a hook at the point of a V.
    const v = [...Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 2, y: 100 + i * 2, pressure: 0.5 })), { x: 180, y: 60, pressure: 0.5 }, { x: 220, y: 20, pressure: 0.5 }];
    const out = smoothPoints(v);
    const xs = out.map(p => p.x), ys = out.map(p => p.y);
    // No loop beyond the drawn extent: the curve stays inside the box of what was drawn, plus a pixel.
    assert.ok(Math.max(...xs) <= 221 && Math.min(...ys) >= 19 && Math.max(...ys) <= 139, `left the drawn box: x..${Math.max(...xs).toFixed(1)} y ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}`);
});

// --- the dot pen ----------------------------------------------------------------------------------
//
// The dot pen is the default tool, so it is what gets drawn with - nearly every stroke in the saved
// projects is one. It stamped squares along *straight chords* between pointer samples, so a fast
// curve came out as a polygon: the screenshot of 2026-10-22, "still bending in that subtle way".
// None of the curve work on the pen reached it, because it never went through the smoothing.

import { dotPath } from '../../src/canvas/strokes.ts';

test('a new dot stroke follows the curve between fast samples', () => {
    const fast = arc(200, 200, 120, 0, Math.PI * 1.5, 30);   // a quick circle, samples 30px apart
    const path = dotPath({ tool: 'pen', curved: true, points: fast });
    assert.ok(path.length > fast.length * 5, 'the gaps were not filled in');
    // What was visible was an angle at every sample. The chords turned the whole 14 degrees at
    // each one; the curve spreads it out.
    assert.ok(worstSpike(path) < 3, `a ${worstSpike(path).toFixed(1)} degree kink at a sample`);
    // And it stays on the circle rather than cutting across it (the chords cut 0.94px inside).
    const radii = path.map(p => Math.hypot(p.x - 200, p.y - 200));
    assert.ok(Math.min(...radii) > 119.3 && Math.max(...radii) < 120.7, `radius ${Math.min(...radii).toFixed(2)}..${Math.max(...radii).toFixed(2)}`);
});

test('every sample is still where it was put', () => {
    // Interpolation, not smoothing: a deliberate pixel is passed through, not averaged away.
    const fast = arc(200, 200, 120, 0, Math.PI, 30);
    const path = dotPath({ tool: 'pen', curved: true, points: fast });
    for (const s of fast) assert.ok(path.some(p => p.x === s.x && p.y === s.y), `sample ${s.x.toFixed(1)},${s.y.toFixed(1)} missing`);
});

test('slow pixel work - dense samples - is left exactly as drawn', () => {
    const dense = Array.from({ length: 30 }, (_, i) => ({ x: 10 + i, y: 10 + (i % 3), pressure: 0.5 }));
    assert.deepEqual(dotPath({ tool: 'pen', curved: true, points: dense }), dense);
});

test('a dot stroke drawn before this keeps its shape', () => {
    // Strokes are re-drawn from their points on every paint; without the flag, every dot drawing
    // already made would change at once.
    const fast = arc(200, 200, 120, 0, Math.PI, 30);
    assert.equal(dotPath({ tool: 'pen', points: fast }), fast);
});

// --- the live preview draws exactly what commits ---------------------------------------------------
//
// The preview adds only the new part of a stroke each frame. A curved span's shape depends on the
// sample *after* it, so the newest span was drawn as a guess and then drawn again once the next
// sample came - the guess staying on the overlay underneath. On fast loops the guess was off by
// 1.15px on average, 1.44px at worst: a ghost edge while drawing that settled when the pen lifted.
// The overlay now draws only spans whose neighbours are all known, so every piece is final.

import { dotPathRange } from '../../src/canvas/strokes.ts';

const loops = () => Array.from({ length: 27 }, (_, i) => { const a = i / 26 * Math.PI * 4; return { x: 100 + i * 12 + Math.cos(a) * 60, y: 200 + Math.sin(a) * 80, pressure: 0.5 }; });

test('drawn in pieces, a dot stroke comes out exactly as drawn whole', () => {
    const pts = loops();
    const whole = dotPath({ tool: 'pen', curved: true, points: pts });
    // Every way the frames could fall: pieces of one, two and seven spans.
    for (const step of [1, 2, 7]) {
        const joined = [];
        for (let from = 0; from < pts.length - 1; from += step) {
            const piece = dotPathRange(pts, from, Math.min(pts.length - 1, from + step));
            joined.push(...(joined.length ? piece.slice(1) : piece));   // pieces share their end point
        }
        assert.deepEqual(joined, whole, `in pieces of ${step}`);
    }
});

test('a range covers just its spans, ending on its last point', () => {
    const pts = loops();
    const r = dotPathRange(pts, 5, 9);
    assert.deepEqual(r[0], pts[5]);
    assert.deepEqual(r[r.length - 1], pts[9]);
});

// --- renderer version 2: spacing -------------------------------------------------------------------

import { OUTPUT_SPACING } from '../../src/canvas/strokes.ts';

test('with a spacing, the smoothed points come out that far apart', () => {
    // 0.25px apart they cost a stroke() call each: 6,776 for a 1,700px pen stroke.
    const out = smoothPoints(circle(600), null, OUTPUT_SPACING);
    const gaps = []; for (let i = 1; i < out.length - 1; i++) gaps.push(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    assert.ok(Math.abs(mean - OUTPUT_SPACING) < 0.05, `mean spacing ${mean.toFixed(3)}px`);
});

test('without one, the output is the dense version-1 path, unchanged', () => {
    const out = smoothPoints(circle(600));
    const gaps = []; for (let i = 1; i < out.length - 1; i++) gaps.push(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
    assert.ok(gaps.reduce((a, b) => a + b, 0) / gaps.length < 0.4, 'version 1 strokes must keep their dense path');
});

test('a dot stroke marked v2 follows the curve, as `curved` did', () => {
    const fast = arc(200, 200, 120, 0, Math.PI, 30);
    assert.ok(dotPath({ tool: 'pen', v: 2, points: fast }).length > fast.length * 5);
});
