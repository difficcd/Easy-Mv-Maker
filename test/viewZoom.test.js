import test from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, ZOOM_MIN, ZOOM_MAX } from '../src/core/viewZoom.js';

test('a zoom inside the range is left alone', () => {
    for (const z of [0.1, 0.5, 1, 4, 15.9, 16]) assert.equal(clampZoom(z), z);
});

test('past either end it stops at the end', () => {
    assert.equal(clampZoom(100), ZOOM_MAX);
    assert.equal(clampZoom(0.001), ZOOM_MIN);
    assert.equal(clampZoom(0), ZOOM_MIN);
    assert.equal(clampZoom(-3), ZOOM_MIN);
});

test('every input gets the same range, which is the point', () => {
    // Pinch clamped to 0.25-8, the wheel to 0.25-8, and the buttons to 0.1-16. Zooming to 16x
    // with a button and then touching the wheel snapped the view back to 8x, and on a tablet a
    // pinch stopped where a button did not.
    const pinched = clampZoom(12);
    const wheeled = clampZoom(12);
    const buttoned = clampZoom(12);
    assert.equal(pinched, 12);
    assert.equal(pinched, wheeled);
    assert.equal(wheeled, buttoned);
});

test('a zoom that is not a number becomes 1 rather than blanking the canvas', () => {
    // A pinch divides by the starting finger distance, which can be zero.
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'big']) {
        assert.equal(clampZoom(/** @type {any} */(bad)), 1, `${bad}`);
    }
});

test('the range is the wider of the two that used to exist', () => {
    // Narrowing the buttons to match pinch would have taken away detail work people may rely on.
    assert.equal(ZOOM_MIN, 0.1);
    assert.equal(ZOOM_MAX, 16);
});

test('clamping something already clamped changes nothing', () => {
    for (const z of [0.05, 1, 99]) assert.equal(clampZoom(clampZoom(z)), clampZoom(z));
});
