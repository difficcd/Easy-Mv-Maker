import test from 'node:test';
import assert from 'node:assert/strict';
import { pathLength, smoothPath, resampleByLength, preparePath, spacingRatio } from '../src/core/pathMotion.js';
import { samplePath } from '../src/canvas/canvasUtils.js';

/** A path drawn the way a hand draws one: dense where the pen dawdled, sparse where it hurried. */
function handDrawn() {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i * 0.5, y: 0 });      // slow start, 0.5px apart
    for (let i = 1; i <= 6; i++) pts.push({ x: 20 + i * 20, y: 0 });   // fast finish, 20px apart
    return pts;
}

test('pathLength adds up the segments', () => {
    assert.equal(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
    assert.equal(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 4 }]), 5);
    assert.equal(pathLength([{ x: 1, y: 1 }]), 0);
});

test('a hand-drawn path really is as uneven as the stutter suggests', () => {
    // The premise of the whole module. If this were near 1 there would be nothing to fix.
    assert.ok(spacingRatio(handDrawn()) > 5, `ratio was ${spacingRatio(handDrawn())}`);
});

test('resampling makes the spacing even', () => {
    const even = resampleByLength(handDrawn(), 64);
    assert.equal(even.length, 64);
    assert.ok(spacingRatio(even) < 1.05, `ratio was ${spacingRatio(even)}`);
});

test('resampling keeps both ends exactly where they were drawn', () => {
    const pts = handDrawn();
    const even = resampleByLength(pts, 20);
    assert.deepEqual(even[0], { x: pts[0].x, y: pts[0].y });
    assert.deepEqual(even[even.length - 1], { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
});

test('resampling preserves the shape, not just the spacing', () => {
    // An L: right then down. Every resampled point must still sit on one of the two arms.
    const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    for (const p of resampleByLength(L, 33)) {
        const onTop = Math.abs(p.y) < 1e-9 && p.x >= 0 && p.x <= 100;
        const onSide = Math.abs(p.x - 100) < 1e-9 && p.y >= 0 && p.y <= 100;
        assert.ok(onTop || onSide, `${JSON.stringify(p)} left the path`);
    }
});

test('resampling barely changes the length', () => {
    const pts = handDrawn();
    const even = resampleByLength(pts, 128);
    // Chords across a curve are always slightly shorter; on a path this dense it is negligible.
    assert.ok(Math.abs(pathLength(even) - pathLength(pts)) < 0.5);
});

test('a path with no length does not divide by zero', () => {
    const dot = [{ x: 7, y: 9 }, { x: 7, y: 9 }, { x: 7, y: 9 }];
    const out = resampleByLength(dot, 10);
    assert.equal(out.length, 10);
    for (const p of out) assert.deepEqual(p, { x: 7, y: 9 });
});

test('too short to be a path comes back unchanged rather than throwing', () => {
    assert.deepEqual(resampleByLength([], 10), []);
    assert.deepEqual(resampleByLength([{ x: 1, y: 2 }], 10), [{ x: 1, y: 2 }]);
    assert.deepEqual(resampleByLength(null, 10), []);
});

test('smoothing keeps the endpoints and stays inside what was drawn', () => {
    const zig = [{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 20, y: 0 }, { x: 30, y: 40 }];
    const s = smoothPath(zig, 2);
    assert.deepEqual(s[0], zig[0]);
    assert.deepEqual(s[s.length - 1], zig[zig.length - 1]);
    // Corner cutting cannot overshoot: a deliberate spike softens, it does not grow.
    for (const p of s) {
        assert.ok(p.y >= -1e-9 && p.y <= 40 + 1e-9, `y=${p.y} escaped the drawn range`);
        assert.ok(p.x >= -1e-9 && p.x <= 30 + 1e-9, `x=${p.x} escaped the drawn range`);
    }
});

test('smoothing shortens a jagged line and leaves a straight one alone', () => {
    const zig = [{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 20, y: 0 }, { x: 30, y: 40 }];
    assert.ok(pathLength(smoothPath(zig, 3)) < pathLength(zig));

    const straight = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
    assert.ok(Math.abs(pathLength(smoothPath(straight, 3)) - 30) < 1e-6);
});

test('smoothing a two-point line has nothing to cut', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    assert.deepEqual(smoothPath(line, 3), line);
});

test('preparePath rounds to whole pixels and produces the requested count', () => {
    const p = preparePath(handDrawn(), { samples: 32 });
    assert.equal(p.length, 32);
    for (const q of p) {
        assert.equal(q.x, Math.round(q.x));
        assert.equal(q.y, Math.round(q.y));
    }
});

test('preparePath refuses a gesture that is not a path', () => {
    assert.deepEqual(preparePath([{ x: 1, y: 1 }]), []);
    assert.deepEqual(preparePath([]), []);
    assert.deepEqual(preparePath(undefined), []);
});

test('the point of all this: sampling a prepared path moves at a constant speed', () => {
    // samplePath walks the array by index. On raw points that replays the drawing speed; on a
    // prepared path each index step is the same distance, so equal time gives equal travel.
    const raw = handDrawn();
    const prepared = preparePath(raw, { samples: 64 });

    const travel = (path) => {
        const steps = [];
        for (let i = 0; i < 20; i++) {
            const a = samplePath(path, i / 20), b = samplePath(path, (i + 1) / 20);
            steps.push(Math.hypot(b.x - a.x, b.y - a.y));
        }
        return steps;
    };

    const rawSteps = travel(raw);
    const prepSteps = travel(prepared);
    const spread = (s) => Math.max(...s) / (Math.min(...s) || 1e-9);

    assert.ok(spread(rawSteps) > 5, `raw was already even: ${spread(rawSteps)}`);
    assert.ok(spread(prepSteps) < 1.2, `prepared still stutters: ${spread(prepSteps)}`);
});

test('a prepared path still starts and ends where the pen did', () => {
    // Motion along a path is stored as an offset from path[0], so moving the first point would
    // shift the whole animation away from where it was drawn.
    const raw = handDrawn();
    const p = preparePath(raw, { samples: 40 });
    assert.deepEqual(p[0], { x: Math.round(raw[0].x), y: Math.round(raw[0].y) });
    const last = raw[raw.length - 1];
    assert.deepEqual(p[p.length - 1], { x: Math.round(last.x), y: Math.round(last.y) });
});
