import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraShake, computeCamera, resolveCamera } from '../../src/core/camera.js';

const CW = 1920, CH = 1080;

test('no amplitude is no wobble at all', () => {
    for (const amp of [0, undefined, null, NaN]) {
        assert.deepEqual(cameraShake(1.234, amp, 6), { dx: 0, dy: 0 });
    }
});

test('it stays within the amplitude it was given', () => {
    // The weights add to 1 so `amp` is a real bound, not a rough one. If it overshoots, a shake
    // set to a few pixels can throw the frame further than the user asked for.
    for (let i = 0; i < 2000; i++) {
        const { dx, dy } = cameraShake(i * 0.011, 10, 6);
        assert.ok(Math.abs(dx) <= 10 + 1e-9, `dx ${dx}`);
        assert.ok(Math.abs(dy) <= 10 + 1e-9, `dy ${dy}`);
    }
});

test('it is deterministic — the export must shake the same way the preview did', () => {
    // The export repaints the same frames through this function. Anything random here would
    // produce a file that does not match what was watched.
    for (const t of [0, 0.5, 1.75, 12.3]) {
        assert.deepEqual(cameraShake(t, 8, 6), cameraShake(t, 8, 6));
    }
});

test('the two axes do not move together', () => {
    // Equal dx and dy every frame is a diagonal slide, not a wobble.
    let same = 0, n = 0;
    for (let i = 0; i < 500; i++) {
        const { dx, dy } = cameraShake(i * 0.017, 10, 6);
        if (Math.abs(dx - dy) < 0.05) same++;
        n++;
    }
    assert.ok(same / n < 0.05, `axes matched on ${same}/${n} frames`);
});

test('it does not visibly repeat over the length of a shot', () => {
    // One sine would return to the same place every period and read as mechanical. Sampling a
    // whole period of the base wave and comparing against the next one should not line up.
    const speed = 6, period = 1 / speed;
    let matches = 0;
    for (let i = 0; i < 200; i++) {
        const t = i * period / 200;
        const a = cameraShake(t, 10, speed);
        const b = cameraShake(t + period, 10, speed);
        if (Math.abs(a.dx - b.dx) < 0.05 && Math.abs(a.dy - b.dy) < 0.05) matches++;
    }
    assert.ok(matches < 20, `repeated on ${matches}/200 samples`);
});

test('speed changes how fast it moves', () => {
    const slow = cameraShake(0.1, 10, 1);
    const fast = cameraShake(0.1, 10, 20);
    assert.notDeepEqual(slow, fast);
});

test('a camera with nothing but shake still resolves', () => {
    // Left out of the "is it still?" test, a wobble-only camera would resolve to null and the
    // wobble would silently never happen.
    const r = resolveCamera({ shake: 6 }, CW, CH);
    assert.ok(r, 'a shake-only camera resolved to null');
    assert.equal(r.shake, 6);
});

test('a camera with nothing set at all still resolves to null', () => {
    assert.equal(resolveCamera({ shake: 0 }, CW, CH), null);
    assert.equal(resolveCamera({}, CW, CH), null);
    assert.equal(resolveCamera(null, CW, CH), null);
});

test('the wobble moves the centre, and is driven by seconds not by progress', () => {
    const cam = { shake: 20, shakeSpeed: 6 };
    // Same progress through the cut, different elapsed time: the wobble must differ, or a long
    // cut would shake more slowly than a short one for the same setting.
    const a = computeCamera(cam, 0.5, CW, CH, 1);
    const b = computeCamera(cam, 0.5, CW, CH, 2);
    assert.ok(a && b);
    assert.notEqual(a.cx, b.cx);
    // And it is a displacement from the centre, not a replacement of it.
    assert.ok(Math.abs(a.cx - CW / 2) <= 20 + 1e-9);
    assert.ok(Math.abs(a.cy - CH / 2) <= 20 + 1e-9);
});

test('the wobble is not eased away at the end of the cut', () => {
    // Eased with the move, a shake would slow to a stop into the last frames, which reads as the
    // camera being set down rather than as a handheld shot.
    const cam = { shake: 20, shakeSpeed: 6, ease: 'inout', easePower: 3 };
    const late = [0.95, 0.97, 0.99, 1].map(p => computeCamera(cam, p, CW, CH, 10 + p));
    const spread = Math.max(...late.map(c => c.cx)) - Math.min(...late.map(c => c.cx));
    assert.ok(spread > 0.5, `barely moved at the end: ${spread}`);
});
