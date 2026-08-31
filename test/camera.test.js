import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_DEFAULT, CAMERA_PRESETS, resolveCamera, computeCamera, applyCamera, zoomForDrift } from '../src/core/camera.js';

const W = 1920, H = 1080;
const cam = (over) => ({ ...CAMERA_DEFAULT, ...over });

test('no camera means no transform, so the renderer can skip it', () => {
    assert.equal(computeCamera(CAMERA_DEFAULT, 0.5, W, H), null);
    assert.equal(computeCamera(null, 0.5, W, H), null);
    assert.equal(computeCamera(undefined, 0.5, W, H), null);
    assert.equal(computeCamera(cam({ preset: 'none' }), 0.5, W, H), null);
    // A one-point path is a position, not a move, and with no zoom change there is nothing to do.
    assert.equal(computeCamera(cam({ path: [{ x: 10, y: 10 }] }), 0.5, W, H), null);
});

test('an unknown preset is treated as no camera rather than throwing', () => {
    assert.equal(computeCamera(cam({ preset: 'nonsense' }), 0.5, W, H), null);
});

test('zoom in starts at 1 and ends zoomed, centred throughout', () => {
    const c = cam({ preset: 'zoomIn' });
    const a = computeCamera(c, 0, W, H), b = computeCamera(c, 1, W, H);
    assert.equal(a.zoom, 1);
    assert.ok(b.zoom > 1);
    assert.equal(a.cx, W / 2);
    assert.equal(b.cx, W / 2);
    assert.equal(a.cy, H / 2);
});

test('zoom out is zoom in backwards', () => {
    const i = CAMERA_PRESETS.zoomIn.build(W, H), o = CAMERA_PRESETS.zoomOut.build(W, H);
    assert.equal(i.zoomFrom, o.zoomTo);
    assert.equal(i.zoomTo, o.zoomFrom);
});

test('pan presets move the camera and end up opposite where they started', () => {
    for (const [id, axis] of [['panLeft', 'cx'], ['panRight', 'cx'], ['panUp', 'cy'], ['panDown', 'cy']]) {
        const c = cam({ preset: id });
        const a = computeCamera(c, 0, W, H), b = computeCamera(c, 1, W, H);
        const mid = axis === 'cx' ? W / 2 : H / 2;
        assert.ok(Math.abs(a[axis] - mid) > 1, `${id} did not start off centre`);
        assert.ok((a[axis] - mid) * (b[axis] - mid) < 0, `${id} did not cross the centre`);
    }
});

test('panLeft moves leftwards, and the others point the way their names say', () => {
    const dir = (id, axis) => computeCamera(cam({ preset: id }), 1, W, H)[axis] - computeCamera(cam({ preset: id }), 0, W, H)[axis];
    assert.ok(dir('panLeft', 'cx') < 0);
    assert.ok(dir('panRight', 'cx') > 0);
    assert.ok(dir('panUp', 'cy') < 0);
    assert.ok(dir('panDown', 'cy') > 0);
});

test('a pan never shows anything outside the artwork', () => {
    // The reason pan presets zoom in at all. At every moment the visible window - the frame
    // divided by the zoom - has to sit inside the canvas, or blank paper slides into shot.
    for (const id of ['panLeft', 'panRight', 'panUp', 'panDown', 'kenBurns']) {
        for (let i = 0; i <= 20; i++) {
            const c = computeCamera(cam({ preset: id }), i / 20, W, H);
            const halfW = W / (2 * c.zoom), halfH = H / (2 * c.zoom);
            assert.ok(c.cx - halfW >= -0.5, `${id} at ${i / 20} shows past the left edge`);
            assert.ok(c.cx + halfW <= W + 0.5, `${id} at ${i / 20} shows past the right edge`);
            assert.ok(c.cy - halfH >= -0.5, `${id} at ${i / 20} shows past the top edge`);
            assert.ok(c.cy + halfH <= H + 0.5, `${id} at ${i / 20} shows past the bottom edge`);
        }
    }
});

test('a drawn path overrides the preset movement but keeps its zoom', () => {
    // So somebody can take ken burns for the push-in and then say where it should go.
    const drawn = [{ x: 100, y: 100 }, { x: 200, y: 300 }];
    const c = cam({ preset: 'kenBurns', path: drawn });
    const a = computeCamera(c, 0, W, H), b = computeCamera(c, 1, W, H);
    assert.deepEqual({ x: a.cx, y: a.cy }, drawn[0]);
    assert.deepEqual({ x: b.cx, y: b.cy }, drawn[1]);
    assert.equal(a.zoom, CAMERA_PRESETS.kenBurns.build(W, H).zoomFrom);
    assert.equal(b.zoom, CAMERA_PRESETS.kenBurns.build(W, H).zoomTo);
});

test('a drawn path with no preset still moves the camera', () => {
    const c = cam({ path: [{ x: 0, y: 0 }, { x: W, y: H }] });
    assert.deepEqual(computeCamera(c, 0, W, H), { cx: 0, cy: 0, zoom: 1, rot: 0 });
    const b = computeCamera(c, 1, W, H);
    assert.equal(b.cx, W);
    assert.equal(b.cy, H);
});

test('the move is monotonic - it never doubles back on a straight path', () => {
    // Position, zoom and tilt all take the same eased progress. Easing them apart is what makes
    // one move read as two.
    const c = cam({ path: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], zoomFrom: 1, zoomTo: 2, rotTo: 10 });
    let px = -1, pz = -1, pr = -1;
    for (let i = 0; i <= 30; i++) {
        const s = computeCamera(c, i / 30, W, H);
        assert.ok(s.cx >= px - 1e-9, `x went backwards at ${i / 30}`);
        assert.ok(s.zoom >= pz - 1e-9, `zoom went backwards at ${i / 30}`);
        assert.ok(s.rot >= pr - 1e-9, `rotation went backwards at ${i / 30}`);
        px = s.cx; pz = s.zoom; pr = s.rot;
    }
});

test('easing changes the middle but never the ends', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const lin = cam({ path, ease: 'linear' });
    const io = cam({ path, ease: 'inout', easePower: 3 });
    for (const c of [lin, io]) {
        assert.equal(computeCamera(c, 0, W, H).cx, 0);
        assert.equal(computeCamera(c, 1, W, H).cx, 1000);
    }
    assert.notEqual(computeCamera(lin, 0.25, W, H).cx, computeCamera(io, 0.25, W, H).cx);
    // Ease in-out is symmetric, so the halfway point is the one place it agrees with linear.
    assert.ok(Math.abs(computeCamera(io, 0.5, W, H).cx - 500) < 1e-9);
});

test('time outside the cut clamps to the ends rather than extrapolating', () => {
    const c = cam({ path: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] });
    assert.equal(computeCamera(c, -5, W, H).cx, 0);
    assert.equal(computeCamera(c, 5, W, H).cx, 1000);
});

test('rotation is returned in radians', () => {
    const c = cam({ path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], rotFrom: 0, rotTo: 180 });
    assert.ok(Math.abs(computeCamera(c, 1, W, H).rot - Math.PI) < 1e-9);
});

test('resolveCamera reports nothing to do so the renderer can skip the transform', () => {
    assert.equal(resolveCamera(cam({}), W, H), null);
    assert.notEqual(resolveCamera(cam({ preset: 'zoomIn' }), W, H), null);
    assert.notEqual(resolveCamera(cam({ zoomTo: 1.5 }), W, H), null);
    assert.notEqual(resolveCamera(cam({ rotTo: 3 }), W, H), null);
});

test('applyCamera puts the camera centre in the middle of the frame', () => {
    // A fake context that records the transform, so the maths can be checked without a canvas.
    let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const mul = (n) => {
        m = {
            a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
            c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
            e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
        };
    };
    const ctx = {
        translate: (x, y) => mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }),
        scale: (x, y) => mul({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }),
        rotate: (r) => mul({ a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 }),
    };
    const at = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });

    applyCamera(/** @type {any} */(ctx), { cx: 400, cy: 300, zoom: 2, rot: 0 }, W, H);

    const centre = at(400, 300);
    assert.ok(Math.abs(centre.x - W / 2) < 1e-9, `centre landed at ${centre.x}`);
    assert.ok(Math.abs(centre.y - H / 2) < 1e-9, `centre landed at ${centre.y}`);
    // And a point 10px away from the camera centre lands 20px away on screen, at zoom 2.
    const off = at(410, 300);
    assert.ok(Math.abs(off.x - (W / 2 + 20)) < 1e-9);
});

test('zoomForDrift gives exactly the zoom that fits, and no more', () => {
    // At the returned zoom the visible window is exactly 1-2*drift of the frame, so a camera
    // sitting `drift` off centre touches the edge without crossing it.
    for (const d of [0, 0.04, 0.1, 1 / 6, 0.3]) {
        const z = zoomForDrift(d);
        assert.ok(Math.abs((1 / z) - (1 - 2 * d)) < 1e-12, `drift ${d} gave zoom ${z}`);
    }
    assert.equal(zoomForDrift(0), 1);
    // Nonsense in, something usable out - a half-frame drift would need infinite zoom.
    assert.ok(Number.isFinite(zoomForDrift(0.9)));
    assert.equal(zoomForDrift(-1), 1);
});
