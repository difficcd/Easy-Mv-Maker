import test from 'node:test';
import assert from 'node:assert/strict';
import { falloffAt, sampleBilinear, pushPixels, pushAlong } from '../../src/core/liquify.ts';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

/** A w*h transparent buffer with one opaque red pixel at (x, y). */
function dotAt(w, h, x, y) {
    const buf = new Uint8ClampedArray(w * h * 4);
    const i = (y * w + x) * 4;
    buf[i] = 255; buf[i + 3] = 255;
    return buf;
}
const alphaAt = (buf, w, x, y) => buf[(y * w + x) * 4 + 3];
/** Alpha-weighted centre of mass, which is where "the dot" is once it has been smeared. */
function centroid(buf, w, h) {
    let sx = 0, sy = 0, sa = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = alphaAt(buf, w, x, y); sx += x * a; sy += y * a; sa += a; }
    return { x: sx / sa, y: sy / sa, mass: sa };
}

test('falloff is full at the centre, nothing at the rim, and smooth between', () => {
    near(falloffAt(0, 10), 1, 'centre');
    near(falloffAt(10, 10), 0, 'rim');
    near(falloffAt(12, 10), 0, 'beyond');
    near(falloffAt(5, 10), 0.5625, 'halfway: (1 - 0.25)^2');
    near(falloffAt(3, 0), 0, 'a zero radius pushes nothing');
});

test('bilinear sampling on a whole pixel returns that pixel, and outside is transparent', () => {
    const buf = dotAt(3, 3, 1, 1);
    const out = [0, 0, 0, 0];
    sampleBilinear(buf, 3, 3, 1, 1, out);
    assert.deepEqual(out, [255, 0, 0, 255]);
    sampleBilinear(buf, 3, 3, 1.5, 1, out);
    near(out[3], 127.5, 'halfway to the transparent neighbour');
    sampleBilinear(buf, 3, 3, -1, 5, out);
    assert.deepEqual(out, [0, 0, 0, 0]);
});

test('a push moves a dot at the brush centre along the push, by less than the full step', () => {
    // Less, not equal: a destination pixel reads from behind itself by *its own* falloff, and
    // the pixel the dot lands on is off-centre, where the falloff is already under 1. That is
    // how a forward warp behaves - the pen leads and the paint follows - and it is what keeps a
    // single step from opening a hole. The test pins the direction and the order of magnitude.
    const w = 20, h = 20;
    const buf = dotAt(w, h, 8, 10);
    const before = centroid(buf, w, h);
    pushPixels(buf, w, h, { x: 8, y: 10, r: 6, dx: 3, dy: 0 });
    const after = centroid(buf, w, h);
    const moved = after.x - before.x;
    assert.ok(moved > 1.5 && moved < 3, `moved with the push: ${moved.toFixed(2)}`);
    near(after.y - before.y, 0, 'not in y', 0.05);
});

test('pixels outside the brush are untouched', () => {
    const w = 20, h = 20;
    const buf = dotAt(w, h, 2, 2);          // far from the brush
    const snapshot = buf.slice();
    pushPixels(buf, w, h, { x: 14, y: 14, r: 4, dx: 3, dy: 3 });
    assert.deepEqual(buf, snapshot);
});

test('a push spreads the dot but keeps roughly its ink', () => {
    // Bilinear reads spread one pixel over up to four; what must not happen is ink appearing
    // from nowhere or vanishing entirely.
    const w = 20, h = 20;
    const buf = dotAt(w, h, 10, 10);
    pushPixels(buf, w, h, { x: 10, y: 10, r: 6, dx: 1.5, dy: 0.5 });
    const { mass } = centroid(buf, w, h);
    assert.ok(mass > 255 * 0.6 && mass < 255 * 1.6, `ink roughly conserved: ${mass / 255}`);
});

test('a brush hanging off the canvas edge clips rather than throwing', () => {
    const w = 10, h = 10;
    const buf = dotAt(w, h, 1, 1);
    const box = pushPixels(buf, w, h, { x: 0, y: 0, r: 5, dx: 2, dy: 2 });
    assert.deepEqual(box, { x0: 0, y0: 0, x1: 6, y1: 6 });
    assert.equal(pushPixels(buf, w, h, { x: -20, y: -20, r: 3, dx: 1, dy: 1 }), null, 'entirely outside: nothing');
});

test('no movement, no strength or no radius is a no-op that reports nothing touched', () => {
    const buf = dotAt(5, 5, 2, 2);
    const snap = buf.slice();
    assert.equal(pushPixels(buf, 5, 5, { x: 2, y: 2, r: 3, dx: 0, dy: 0 }), null);
    assert.equal(pushPixels(buf, 5, 5, { x: 2, y: 2, r: 3, dx: 1, dy: 0, strength: 0 }), null);
    assert.equal(pushPixels(buf, 5, 5, { x: 2, y: 2, r: 0, dx: 1, dy: 0 }), null);
    assert.deepEqual(buf, snap);
});

test('a long drag is walked in steps, so the dot follows the whole way', () => {
    // One push forty pixels long would read from forty pixels back - empty - and the dot would
    // simply vanish. Stepping carries it along.
    const w = 80, h = 20;
    const buf = dotAt(w, h, 10, 10);
    const box = pushAlong(buf, w, h, { x: 10, y: 10 }, { x: 50, y: 10 }, 8);
    const c = centroid(buf, w, h);
    assert.ok(c.mass > 255 * 0.3, `the dot survived the trip: ${c.mass / 255}`);
    assert.ok(c.x > 30, `and travelled most of the way with the brush: x=${c.x.toFixed(1)}`);
    // Steps of r/4 = 2px: the first push is centred at 12, the last at 50, radius 8.
    assert.equal(box.x0, 4, 'touched box starts at the first push');
    assert.equal(box.x1, 59, 'and ends a radius past the last');
});

test('pushAlong with no distance is a no-op', () => {
    const buf = dotAt(5, 5, 2, 2);
    assert.equal(pushAlong(buf, 5, 5, { x: 1, y: 1 }, { x: 1, y: 1 }, 3), null);
});
