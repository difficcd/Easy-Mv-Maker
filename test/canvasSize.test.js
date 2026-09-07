import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCanvasSize, CANVAS_MIN_EDGE, CANVAS_MAX_EDGE } from '../src/core/canvasSize.js';

test('an ordinary size passes through untouched', () => {
    assert.deepEqual(clampCanvasSize(1920, 1080), { w: 1920, h: 1080 });
    assert.deepEqual(clampCanvasSize(CANVAS_MIN_EDGE, CANVAS_MAX_EDGE), { w: CANVAS_MIN_EDGE, h: CANVAS_MAX_EDGE });
});

test('a canvas nobody can allocate is brought back to the ceiling', () => {
    assert.deepEqual(clampCanvasSize(100000, 100000), { w: CANVAS_MAX_EDGE, h: CANVAS_MAX_EDGE });
    assert.deepEqual(clampCanvasSize(1e12, 20), { w: CANVAS_MAX_EDGE, h: CANVAS_MIN_EDGE });
});

test('half a size is no size, because a width with no height gives NaN', () => {
    assert.equal(clampCanvasSize(1920, undefined), null);
    assert.equal(clampCanvasSize(undefined, 1080), null);
    assert.equal(clampCanvasSize(undefined, undefined), null);
    assert.equal(clampCanvasSize(null, null), null);
});

test('nonsense is no size rather than a canvas of NaN', () => {
    assert.equal(clampCanvasSize('wide', 'tall'), null);
    assert.equal(clampCanvasSize(NaN, 1080), null);
    assert.equal(clampCanvasSize(Infinity, 1080), null);
    assert.equal(clampCanvasSize(0, 0), null);
    assert.equal(clampCanvasSize(-1920, -1080), null);
});

test('numeric strings work, because the size prompt hands over match groups', () => {
    assert.deepEqual(clampCanvasSize('1920', '1080'), { w: 1920, h: 1080 });
    assert.deepEqual(clampCanvasSize('4', '4'), { w: CANVAS_MIN_EDGE, h: CANVAS_MIN_EDGE });
});

test('a size is always whole pixels', () => {
    assert.deepEqual(clampCanvasSize(1920.4, 1080.6), { w: 1920, h: 1081 });
});
