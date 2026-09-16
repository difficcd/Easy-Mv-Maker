import test from 'node:test';
import assert from 'node:assert/strict';
import { regionBounds, rectBounds, mosaic } from '../src/canvas/pixelEffects.js';

/** Node has no ImageData; these take the shape as an argument for exactly this reason. */
const img = (w, h, fill) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const [r, g, b, a] = fill(i % w, (i / w) | 0);
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
    }
    return { data, width: w, height: h };
};
const px = (im, x, y) => [...im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];

test('regionBounds surrounds the points and adds the reach of the effect', () => {
    const b = regionBounds([{ x: 10, y: 20 }, { x: 30, y: 25 }], 4, 100, 100);
    assert.deepEqual(b, { x: 6, y: 16, w: 28, h: 13 });
});

test('regionBounds never leaves the canvas', () => {
    // A brush at the corner reaches past it. Reading those pixels is a blank strip down the
    // side of the result, and writing them is an exception.
    const b = regionBounds([{ x: 1, y: 1 }, { x: 99, y: 99 }], 20, 100, 100);
    assert.deepEqual(b, { x: 0, y: 0, w: 100, h: 100 });
});

test('regionBounds refuses a region too small to be worth processing', () => {
    assert.equal(regionBounds([{ x: 5, y: 5 }], 0, 100, 100), null);
    assert.equal(regionBounds([], 10, 100, 100), null);
    assert.equal(regionBounds(null, 10, 100, 100), null);
});

test('rectBounds reads the same whichever corner it was dragged from', () => {
    const forward = rectBounds({ x0: 10, y0: 10, x1: 40, y1: 30 }, 100, 100);
    const backward = rectBounds({ x0: 40, y0: 30, x1: 10, y1: 10 }, 100, 100);
    assert.deepEqual(forward, { x: 10, y: 10, w: 30, h: 20 });
    assert.deepEqual(backward, forward);
});

test('rectBounds clips to the canvas and refuses a rectangle dragged to nothing', () => {
    assert.deepEqual(rectBounds({ x0: 90, y0: 90, x1: 200, y1: 200 }, 100, 100), { x: 90, y: 90, w: 10, h: 10 });
    assert.equal(rectBounds({ x0: 50, y0: 50, x1: 51, y1: 80 }, 100, 100), null);
});

test('mosaic replaces each block with its average', () => {
    // A 4x4 of two flat 2x2 quadrants on the left and a gradient on the right.
    const im = img(4, 4, (x) => (x < 2 ? [100, 100, 100, 255] : [x * 10, 0, 0, 255]));
    mosaic(im, 2);
    assert.deepEqual(px(im, 0, 0), [100, 100, 100, 255]);   // already flat, unchanged
    assert.deepEqual(px(im, 1, 1), [100, 100, 100, 255]);
    // The right block averages x=2 and x=3, so 20 and 30 -> 25, over all four pixels.
    for (const [x, y] of [[2, 0], [3, 0], [2, 1], [3, 1]]) assert.deepEqual(px(im, x, y), [25, 0, 0, 255]);
});

test('mosaic averages alpha with the colour, so a partly empty block fades', () => {
    // Half the block is transparent. Leaving alpha alone would stamp a hard square of colour
    // over pixels that were not there.
    const im = img(2, 2, (x) => [200, 0, 0, x === 0 ? 255 : 0]);
    mosaic(im, 2);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.deepEqual(px(im, x, y), [200, 0, 0, 128]);
});

test('mosaic handles a block that runs off the edge', () => {
    // 3x3 with a block of 2: the right column and bottom row are 1px wide. Averaging over the
    // block as if it were full would read past the end of the buffer.
    const im = img(3, 3, () => [60, 60, 60, 255]);
    mosaic(im, 2);
    assert.deepEqual(px(im, 2, 2), [60, 60, 60, 255]);
});

test('mosaic will not take a block size that would do nothing', () => {
    const im = img(4, 1, (x) => [x * 60, 0, 0, 255]);
    mosaic(im, 0);   // clamped to 2, not treated as "every pixel is its own block"
    assert.deepEqual(px(im, 0, 0), px(im, 1, 0));
});
