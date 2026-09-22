import test from 'node:test';
import assert from 'node:assert/strict';
import { effectAt } from '../../src/core/easing.ts';
import { mosaicBlockAt, LAYER_ANIM_DEFAULT } from '../../src/core/layerAnim.ts';
import { clampRegion } from '../../src/canvas/pixelEffects.ts';

const linear = { ease: 'linear', easePower: 1 };
const at = (t, o) => effectAt(t, { max: 100, ...linear, ...o });

test('no maximum is no effect, whatever else is set', () => {
    for (const max of [0, undefined, -4, NaN]) {
        assert.equal(effectAt(0.5, { max, min: 20, ...linear }), 0, `max ${max}`);
    }
});

test('over the whole cut it runs from nothing to the maximum', () => {
    assert.equal(at(0), 0);
    assert.equal(at(0.5), 50);
    assert.equal(at(1), 100);
});

test('a window delays the start and finishes early', () => {
    const o = { from: 0.25, to: 0.75 };
    assert.equal(at(0, o), 0);
    assert.equal(at(0.25, o), 0);
    assert.equal(at(0.5, o), 50);
    assert.equal(at(0.75, o), 100);
});

test('outside the window it is off, on both sides', () => {
    // The first version held whatever it had reached after `to`, so an end of 0.5 left the
    // static running to the end of the cut - reported as "the end control does nothing". Start
    // and end mean what they say; "come on and stay" is an end of 1.
    const o = { from: 0.1, to: 0.3 };
    assert.equal(at(0.05, o), 0, 'before the start');
    assert.equal(at(0.31, o), 0, 'just after the end');
    assert.equal(at(1, o), 0, 'long after the end');
    assert.equal(at(0.3, o), 100, 'at the end itself, still on');
});

test('an end of 1 is "come on and stay"', () => {
    const o = { from: 0.2, to: 1 };
    assert.equal(at(0.99, o), 100 * ((0.99 - 0.2) / 0.8));
    assert.equal(at(1, o), 100);
});

test('the minimum is what shows outside the window, not zero', () => {
    const o = { from: 0.4, to: 0.6, min: 20 };
    assert.equal(at(0.1, o), 20);
    assert.equal(at(0.9, o), 20);
});

test('speed above 1 arrives early and then holds until the end', () => {
    const o = { speed: 2 };
    assert.equal(at(0.25, o), 50);
    assert.equal(at(0.5, o), 100);
    assert.equal(at(0.9, o), 100, 'should have held at the top, still inside the window');
});

test('speed below 1 has not arrived by the end of the window', () => {
    assert.equal(at(1, { speed: 0.5 }), 50);
});

test('a minimum starts the effect already applied', () => {
    // Not reachable by scaling from nothing, which is the whole reason it exists.
    const o = { min: 20 };
    assert.equal(at(0, o), 20);
    assert.equal(at(0.5, o), 60);
    assert.equal(at(1, o), 100);
});

test('a minimum above the maximum is clamped rather than inverting the effect', () => {
    assert.equal(at(0, { min: 500 }), 100);
    assert.equal(at(1, { min: 500 }), 100);
});

test('a zero-length window is a single moment, not a division by zero', () => {
    const o = { from: 0.5, to: 0.5 };
    assert.equal(at(0.49, o), 0);
    assert.equal(at(0.5, o), 100);
    assert.equal(at(0.51, o), 0);
    assert.ok(Number.isFinite(at(0.5, o)));
});

test('a window given backwards does not run time in reverse', () => {
    // to < from is a typo, not an instruction. It collapses to a moment at `from`.
    const o = { from: 0.8, to: 0.2 };
    for (const t of [0, 0.5, 0.79, 0.81, 1]) assert.equal(at(t, o), 0);
    assert.equal(at(0.8, o), 100);
});

test('a speed of zero does not freeze the effect out of existence', () => {
    assert.ok(Number.isFinite(at(1, { speed: 0 })));
});

// --- the mosaic on top of it ---

const anim = (o) => ({ ...LAYER_ANIM_DEFAULT, ...linear, ...o });

test('the mosaic uses the window', () => {
    const a = anim({ mosaic: 40, mosaicFrom: 0.5, mosaicTo: 1 });
    assert.equal(mosaicBlockAt(a, 0.25, 0.25), 0);
    assert.equal(mosaicBlockAt(a, 0.75, 0.75), 20);
    assert.equal(mosaicBlockAt(a, 1, 1), 40);
});

test('there-and-back still follows the shared swing, not the window', () => {
    // The control that already says "come back" has to go on meaning that, or setting a window
    // would silently turn a pulse into a one-way ramp.
    const a = anim({ mosaic: 40, mode: 'return', mosaicFrom: 0.9, mosaicTo: 1 });
    assert.equal(mosaicBlockAt(a, 0.5, 1), 40, 'swing at full should be full, window notwithstanding');
    assert.equal(mosaicBlockAt(a, 0.5, 0), 0);
});

test('no mosaic set is no mosaic, whatever the window says', () => {
    assert.equal(mosaicBlockAt(anim({ mosaicFrom: 0, mosaicTo: 1 }), 0.5, 0.5), 0);
    assert.equal(mosaicBlockAt(null, 0.5, 0.5), 0);
});

// --- the mosaic's region (#183) ---

test('a region dragged backwards still comes back as a rectangle', () => {
    // Dragging up-left is as ordinary as dragging down-right, and a negative width draws
    // nothing at all rather than failing.
    const forward = clampRegion({ x: 10, y: 10, w: 40, h: 20 }, 1920, 1080);
    const backward = clampRegion({ x: 50, y: 30, w: -40, h: -20 }, 1920, 1080);
    assert.deepEqual(forward, { x: 10, y: 10, w: 40, h: 20 });
    assert.deepEqual(backward, forward);
});

test('a region is clipped to the canvas', () => {
    // Started off the edge, or dragged past it - both routine with a pen.
    assert.deepEqual(clampRegion({ x: -50, y: -50, w: 100, h: 100 }, 1920, 1080), { x: 0, y: 0, w: 50, h: 50 });
    assert.deepEqual(clampRegion({ x: 1900, y: 1060, w: 500, h: 500 }, 1920, 1080), { x: 1900, y: 1060, w: 20, h: 20 });
});

test('a region too small to pixelate is refused rather than returned empty', () => {
    // An accidental tap must not set a region that silently shows nothing.
    assert.equal(clampRegion({ x: 10, y: 10, w: 1, h: 40 }, 1920, 1080), null);
    assert.equal(clampRegion({ x: 10, y: 10, w: 0, h: 0 }, 1920, 1080), null);
    assert.equal(clampRegion(null, 1920, 1080), null);
});

test('a region entirely off the canvas is nothing, not a negative rectangle', () => {
    assert.equal(clampRegion({ x: 3000, y: 3000, w: 100, h: 100 }, 1920, 1080), null);
});
