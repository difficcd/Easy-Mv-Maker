import test from 'node:test';
import assert from 'node:assert/strict';
import { effectAt, mosaicBlockAt, LAYER_ANIM_DEFAULT } from '../src/canvas/canvasUtils.js';

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

test('outside the window it holds rather than snapping back', () => {
    // "Come on over the first second and stay" is the case this exists for. Returning is what
    // mode: 'return' is for, and that is a different control.
    const o = { from: 0.1, to: 0.3 };
    assert.equal(at(0.31, o), 100);
    assert.equal(at(1, o), 100);
    assert.equal(at(0.05, o), 0);
});

test('speed above 1 arrives early and then holds', () => {
    const o = { speed: 2 };
    assert.equal(at(0.25, o), 50);
    assert.equal(at(0.5, o), 100);
    assert.equal(at(0.9, o), 100, 'should have held at the top');
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

test('a zero-length window is a step, not a division by zero', () => {
    const o = { from: 0.5, to: 0.5 };
    assert.equal(at(0.49, o), 0);
    assert.equal(at(0.5, o), 100);
    assert.ok(Number.isFinite(at(0.5, o)));
});

test('a window given backwards does not run time in reverse', () => {
    // to < from is a typo, not an instruction. It collapses to a step at `from`.
    const o = { from: 0.8, to: 0.2 };
    for (const t of [0, 0.5, 0.79]) assert.equal(at(t, o), 0);
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
