import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayerAnim, LAYER_ANIM_DEFAULT } from '../src/canvas/canvasUtils.js';
import { staticCanvas } from '../src/canvas/pixelEffects.js';

const CUT = { startTime: 0, endTime: 10 };
const anim = (o) => ({ ...LAYER_ANIM_DEFAULT, ...o });
const at = (o, time) => computeLayerAnim({ anim: anim(o) }, CUT, time, 1920, 1080);

test('noise is a gate: full strength the moment its window opens, off outside it', () => {
    // Reported as "the strength control does not do much" when it ramped like the mosaic.
    const o = { noise: 0.6, noiseFrom: 0.2, noiseTo: 0.7 };
    // Outside the window nothing about the layer is animated, so it is not a layer anim at all.
    assert.equal(at(o, 1), null);
    assert.equal(at(o, 2).noise, 0.6);
    assert.equal(at(o, 4.5).noise, 0.6);
    assert.equal(at(o, 7).noise, 0.6);
    assert.equal(at(o, 7.1), null);
});

test('an off layer is still a layer once noise is on', () => {
    // computeLayerAnim returns null when nothing about the layer is animated; the static alone
    // has to be enough to keep it from being skipped.
    assert.equal(at({}, 5), null);
    assert.ok(at({ noise: 0.3 }, 5));
});

test('an end before the start is an empty window, not a reversed one', () => {
    assert.equal(at({ noise: 1, noiseFrom: 0.8, noiseTo: 0.2 }, 5), null);
});

test('no static at zero strength, without touching a canvas', () => {
    const boom = () => { throw new Error('scratch touched'); };
    assert.equal(staticCanvas({}, null, { cw: 10, ch: 10, amount: 0, seconds: 1 }, {}, boom), null);
    assert.equal(staticCanvas({}, null, { cw: 10, ch: 10, amount: NaN, seconds: 1 }, {}, boom), null);
});

test('colour static is an option on the static: it follows the same window and needs a strength', () => {
    assert.equal(at({ noise: 0.5, noiseColor: 0.8 }, 5).noiseColor, 0.8);
    assert.equal(at({ noise: 0.5, noiseColor: 0.8, noiseFrom: 0.9 }, 5), null);
    // Colour alone does nothing: it is a flavour of the static, not a second effect.
    assert.equal(at({ noise: 0, noiseColor: 1 }, 5), null);
});
