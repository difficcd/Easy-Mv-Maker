import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelateSize } from '../src/canvas/pixelEffects.js';
import { computeLayerAnim, LAYER_ANIM_DEFAULT } from '../src/core/layerAnim.js';

const CUT = { startTime: 0, endTime: 10 };
const anim = (o) => ({ ...LAYER_ANIM_DEFAULT, ...o });
const at = (o, time) => computeLayerAnim({ anim: anim(o) }, CUT, time, 1920, 1080);

test('a block too small to change anything is refused', () => {
    // Below 2 there are no blocks, and the shrink would be a no-op copy at full size.
    for (const b of [0, 1, 1.4, -5, NaN, undefined]) {
        assert.equal(pixelateSize(1920, 1080, b), null, `block ${b}`);
    }
});

test('the shrunk size never reaches zero', () => {
    // A block larger than the canvas rounds to 0 without the floor, and a zero-sized canvas
    // makes drawImage throw rather than draw nothing.
    const s = pixelateSize(100, 40, 4000);
    assert.deepEqual(s, { w: 1, h: 1 });
});

test('the shrunk size is the canvas divided by the block', () => {
    assert.deepEqual(pixelateSize(1920, 1080, 10), { w: 192, h: 108 });
    assert.deepEqual(pixelateSize(640, 480, 16), { w: 40, h: 30 });
});

test('a zero-sized source has nothing to pixelate', () => {
    assert.equal(pixelateSize(0, 100, 8), null);
    assert.equal(pixelateSize(100, 0, 8), null);
});

test('the block grows with progress through the cut', () => {
    const early = at({ mosaic: 40 }, 1);
    const late = at({ mosaic: 40 }, 9);
    assert.ok(late.mosaic > early.mosaic, `${early?.mosaic} -> ${late?.mosaic}`);
    assert.ok(at({ mosaic: 40 }, 10).mosaic <= 40 + 1e-9);
});

test('there-and-back brings the blocks back down', () => {
    // `swing` with no repeat count runs one out-and-back over the first half of the cut, which
    // is what every other animated property on this panel already does - the mosaic inherits
    // that rather than inventing its own timing. So: nothing, peak, nothing.
    const m = (time) => at({ mosaic: 40, mode: 'return' }, time)?.mosaic ?? 0;
    assert.equal(m(0), 0);
    assert.ok(m(2.5) > 39, `peak was ${m(2.5)}`);
    assert.equal(m(5), 0);
    assert.equal(m(10), 0);
});

test('a layer with only a mosaic set still animates', () => {
    // The "nothing is happening" shortcut returns null and the renderer skips the layer's
    // transform entirely. Left out of that test, a mosaic-only layer would never be pixelated.
    assert.ok(at({ mosaic: 40 }, 9), 'a mosaic-only layer resolved to null');
});

test('a layer with nothing set still shortcuts to null', () => {
    assert.equal(at({}, 5), null);
    assert.equal(at({ mosaic: 0 }, 5), null);
});

test('a mosaic too small to see does not switch the transform on by itself', () => {
    // At the very start of a cut the eased progress is ~0, so the block is under a pixel. That
    // must not count as "something is happening", or every mosaic layer pays for a transform
    // through the whole cut to show nothing.
    assert.equal(at({ mosaic: 40 }, 0), null);
});
