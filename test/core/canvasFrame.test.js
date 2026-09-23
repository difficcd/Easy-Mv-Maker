import test from 'node:test';
import assert from 'node:assert/strict';
import {
    frameGeometry, hasRoom, fitZoom, windowSize, cameraBounds, clampCameraCentre,
    restingCentre, frameRect,
} from '../../src/core/canvasFrame.ts';
import { zoomForDrift, applyCamera } from '../../src/core/camera.ts';

// The square case is every project that exists: no frame was ever set, so the frame is the
// canvas. Nothing here may behave differently for it than the one-size code already does.
const SQUARE = frameGeometry(1920, 1080);
// The case #327 is about: a background three frames wide, shot at 1920x1080.
const LONG = frameGeometry(5760, 1080, { w: 1920, h: 1080 });

test('a document with no frame gets the canvas as its frame', () => {
    assert.deepEqual(SQUARE, { cw: 1920, ch: 1080, fw: 1920, fh: 1080 });
    assert.deepEqual(frameGeometry(1920, 1080, null), SQUARE);
    assert.deepEqual(frameGeometry(1920, 1080, {}), SQUARE);
});

test('junk sizes fall back rather than propagating NaN', () => {
    // These arrive from a loaded document, so they are whatever was in the file.
    assert.deepEqual(frameGeometry(0, -5), { cw: 1920, ch: 1080, fw: 1920, fh: 1080 });
    assert.deepEqual(frameGeometry('x', undefined), { cw: 1920, ch: 1080, fw: 1920, fh: 1080 });
    // A junk frame falls back to the canvas, not to the default canvas.
    assert.deepEqual(frameGeometry(800, 600, { w: NaN, h: 0 }), { cw: 800, ch: 600, fw: 800, fh: 600 });
});

test('there is room to move only when the artwork is bigger than the frame', () => {
    assert.equal(hasRoom(SQUARE), false);
    assert.equal(hasRoom(LONG), true);
    // One axis is enough - a tall strip pans vertically.
    assert.equal(hasRoom(frameGeometry(1920, 4000, { w: 1920, h: 1080 })), true);
});

test('fitZoom is 1 when the frame is the canvas, and below 1 when the canvas is bigger', () => {
    assert.equal(fitZoom(SQUARE), 1);
    assert.equal(fitZoom(LONG), 1920 / 5760);
    // The tighter axis decides: fitting means fitting both.
    assert.equal(fitZoom(frameGeometry(3840, 4320, { w: 1920, h: 1080 })), 1080 / 4320);
});

test('zoom shrinks the window it looks through', () => {
    assert.deepEqual(windowSize(SQUARE, 1), { w: 1920, h: 1080 });
    assert.deepEqual(windowSize(SQUARE, 2), { w: 960, h: 540 });
    // Below 1 the camera is pulled back and sees more than the frame is wide.
    assert.deepEqual(windowSize(LONG, 0.5), { w: 3840, h: 2160 });
});

test('a zoom of zero or nonsense is read as 1 rather than dividing by it', () => {
    for (const z of [0, -1, NaN, undefined, Infinity]) {
        assert.deepEqual(windowSize(SQUARE, z), { w: 1920, h: 1080 }, String(z));
    }
});

test('with frame == canvas the camera can only sit in the middle', () => {
    // Which is exactly the constraint core/camera describes: at zoom 1 there is nowhere to pan.
    const b = cameraBounds(SQUARE, 1);
    assert.deepEqual(b, { minX: 960, maxX: 960, minY: 540, maxY: 540 });
});

test('zooming in buys somewhere to pan, and the amount is what zoomForDrift assumes', () => {
    // At zoom 2 the window is half the canvas, so the centre may sit anywhere in the middle half.
    const b = cameraBounds(SQUARE, 2);
    assert.deepEqual(b, { minX: 480, maxX: 1440, minY: 270, maxY: 810 });
});

test('a long canvas can be panned across at zoom 1, which is the point of all this', () => {
    const b = cameraBounds(LONG, 1);
    assert.equal(b.minX, 960);
    assert.equal(b.maxX, 5760 - 960);
    // Nothing spare vertically, so the vertical stays pinned.
    assert.equal(b.minY, 540);
    assert.equal(b.maxY, 540);
});

test('a centre outside the artwork is pulled back to the edge, not rejected', () => {
    assert.deepEqual(clampCameraCentre({ x: -500, y: 0 }, LONG, 1), { x: 960, y: 540 });
    assert.deepEqual(clampCameraCentre({ x: 99999, y: 99999 }, LONG, 1), { x: 4800, y: 540 });
    // Already inside: left alone.
    assert.deepEqual(clampCameraCentre({ x: 2000, y: 540 }, LONG, 1), { x: 2000, y: 540 });
});

test('a non-finite centre lands in the middle of what is allowed', () => {
    assert.deepEqual(clampCameraCentre({ x: NaN, y: NaN }, LONG, 1), { x: 2880, y: 540 });
});

test('the resting centre is the middle of the artwork', () => {
    assert.deepEqual(restingCentre(LONG), { x: 2880, y: 540 });
});

test('frameRect places the window, and covers the whole canvas at fitZoom', () => {
    assert.deepEqual(frameRect(SQUARE, { x: 960, y: 540 }, 1), { x: 0, y: 0, w: 1920, h: 1080 });
    // Panned to the far right of the long canvas, the window ends exactly at its edge.
    assert.deepEqual(frameRect(LONG, { x: 4800, y: 540 }, 1), { x: 3840, y: 0, w: 1920, h: 1080 });
    // At the zoom that fits, the window is at least as big as the canvas on both axes.
    const r = frameRect(LONG, restingCentre(LONG), fitZoom(LONG));
    assert.ok(r.w >= LONG.cw - 1e-9 && r.h >= LONG.ch - 1e-9, `${r.w}x${r.h}`);
});

test('the identity claim, on the square case, for every function that takes a zoom', () => {
    // The promise this module makes: put it in front of the existing code and nothing moves.
    // At zoom 1 with frame == canvas, the window is the canvas and the camera is pinned centre.
    assert.deepEqual(windowSize(SQUARE, 1), { w: SQUARE.cw, h: SQUARE.ch });
    assert.deepEqual(clampCameraCentre(restingCentre(SQUARE), SQUARE, 1), restingCentre(SQUARE));
    assert.deepEqual(frameRect(SQUARE, restingCentre(SQUARE), 1), { x: 0, y: 0, w: SQUARE.cw, h: SQUARE.ch });
    assert.equal(fitZoom(SQUARE), 1);
});

// --- agreement with the code this will eventually replace -------------------------------------

test('cameraBounds allows exactly the drift zoomForDrift was built to buy', () => {
    // core/camera picks its pan zoom with zoomForDrift(drift), drift being a fraction of the
    // frame. If these two ever disagree, a preset pans into blank paper - the bug its own
    // comment says the tests caught once already. Written down so they cannot drift apart.
    for (const d of [0, 0.04, 0.1, 1 / 6, 0.3]) {
        const b = cameraBounds(SQUARE, zoomForDrift(d));
        assert.ok(Math.abs((SQUARE.cw / 2 - b.minX) - SQUARE.cw * d) < 1e-9, `drift ${d}`);
        assert.ok(Math.abs((b.maxX - SQUARE.cw / 2) - SQUARE.cw * d) < 1e-9, `drift ${d}`);
    }
});

test('a pan across the long canvas never leaves the artwork', () => {
    const b = cameraBounds(LONG, 1);
    for (let i = 0; i <= 20; i++) {
        const cx = b.minX + (b.maxX - b.minX) * (i / 20);
        const r = frameRect(LONG, { x: cx, y: 540 }, 1);
        assert.ok(r.x >= -1e-9 && r.x + r.w <= LONG.cw + 1e-9, `at ${cx}: ${r.x}..${r.x + r.w}`);
    }
});

test('applyCamera centres the shot in the frame, not in the canvas', () => {
    // The same recording context camera.test.js uses. The distinction only became visible once
    // the two sizes could differ: with the camera at the left end of a long canvas, canvas x=0
    // has to land at screen x=0, not at minus the difference between the sizes.
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

    const b = cameraBounds(LONG, 1);
    applyCamera(ctx, { cx: b.minX, cy: 540, zoom: 1, rot: 0 }, LONG.fw, LONG.fh);

    assert.ok(Math.abs(at(0, 0).x) < 1e-9, `canvas left landed at ${at(0, 0).x}`);
    assert.ok(Math.abs(at(LONG.fw, 0).x - LONG.fw) < 1e-9);
    // The far end of the artwork is off to the right, unseen, which is the whole idea.
    assert.ok(at(LONG.cw, 0).x > LONG.fw);
});
