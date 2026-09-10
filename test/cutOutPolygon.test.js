import test from 'node:test';
import assert from 'node:assert/strict';
import { cutOutPolygon } from '../src/core/lassoOps.js';
import { pointInPolygon } from '../src/canvas/canvasUtils.js';

/** Node has no ImageData; core/ takes it as an argument for exactly this reason. */
const makeImageData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

/** A w*h block of opaque pixels, each a distinguishable colour. */
function filled(w, h, alpha = 255) {
    const img = makeImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        img.data[i * 4] = i + 1;          // r, so a copied pixel can be identified
        img.data[i * 4 + 1] = 2;
        img.data[i * 4 + 2] = 3;
        img.data[i * 4 + 3] = alpha;
    }
    return img;
}

const px = (img, w, x, y) => [...img.data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
const cut = (args) => cutOutPolygon({ makeImageData, inside: pointInPolygon, ...args });

/** A square covering the whole 4x4 bounds. */
const wholeBox = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];

test('pixels inside the polygon are copied, with their colour', () => {
    const r = cut({ layer: filled(4, 4), poly: wholeBox, minX: 0, minY: 0, w: 4, h: 4 });
    assert.equal(r.hasContent, true);
    assert.deepEqual(px(r.selection, 4, 0, 0), [1, 2, 3, 255]);
    assert.deepEqual(px(r.selection, 4, 3, 3), [16, 2, 3, 255]);
});

test('pixels outside are left untouched', () => {
    // A polygon over the left half only.
    const left = [[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]];
    const r = cut({ layer: filled(4, 4), poly: left, minX: 0, minY: 0, w: 4, h: 4 });
    assert.deepEqual(px(r.selection, 4, 0, 0), [1, 2, 3, 255], 'inside taken');
    assert.deepEqual(px(r.selection, 4, 3, 0), [0, 0, 0, 0], 'outside empty');
});

test('the mask marks exactly the pixels the selection took', () => {
    // They describe the same set from both sides. If they drift, the layer keeps a ghost of the
    // artwork that is now floating.
    const left = [[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]];
    const r = cut({ layer: filled(4, 4), poly: left, minX: 0, minY: 0, w: 4, h: 4 });
    for (let i = 0; i < 16; i++) {
        const taken = r.selection.data[i * 4 + 3] > 0;
        const masked = r.eraseMask.data[i * 4 + 3] > 0;
        assert.equal(taken, masked, `pixel ${i}: selection ${taken}, mask ${masked}`);
    }
});

test('fully transparent pixels are not lifted, even inside the polygon', () => {
    // Otherwise the selection box is bigger than the artwork in it, and a rectangle of nothing
    // gets erased from the layer underneath.
    const r = cut({ layer: filled(4, 4, 0), poly: wholeBox, minX: 0, minY: 0, w: 4, h: 4 });
    assert.equal(r.hasContent, false);
    assert.ok(r.eraseMask.data.every(v => v === 0), 'nothing marked for erasing');
});

test('a partly transparent pixel keeps its own alpha', () => {
    const layer = filled(2, 2);
    layer.data[3] = 77;                                  // first pixel half-there
    const r = cut({ layer, poly: [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], minX: 0, minY: 0, w: 2, h: 2 });
    assert.equal(px(r.selection, 2, 0, 0)[3], 77, 'alpha carried, not forced to 255');
    assert.equal(r.eraseMask.data[3], 255, 'but the mask erases it fully');
});

test('a pixel counts by its centre, not by its top-left corner', () => {
    // The edge is at x=1.2, which falls *inside* pixel 1 (it spans 1..2). Its corner at x=1 is
    // left of the edge and its centre at x=1.5 is right of it, so the two rules disagree here -
    // which is what makes this a test rather than a restatement. A pixel barely clipped by the
    // lasso should not come along whole.
    const poly = [[0, -1], [1.2, -1], [1.2, 2], [0, 2], [0, -1]];
    const r = cut({ layer: filled(4, 1), poly, minX: 0, minY: 0, w: 4, h: 1 });
    assert.ok(r.selection.data[0 * 4 + 3] > 0, 'pixel 0 (centre 0.5) is in');
    assert.equal(r.selection.data[1 * 4 + 3], 0, 'pixel 1 (centre 1.5, corner 1.0) is out');
});

test('the bounds offset is applied, so a selection away from the origin still lines up', () => {
    // The layer data is already cropped to the bounds, but the polygon is in canvas coordinates.
    // Forget minX/minY and the region is taken from the wrong place entirely.
    const poly = [[10, 20], [12, 20], [12, 22], [10, 22], [10, 20]];
    const r = cut({ layer: filled(2, 2), poly, minX: 10, minY: 20, w: 2, h: 2 });
    assert.equal(r.hasContent, true);
    assert.ok(r.selection.data.every((v, i) => i % 4 !== 3 || v === 255), 'all four taken');

    const wrong = cut({ layer: filled(2, 2), poly, minX: 0, minY: 0, w: 2, h: 2 });
    assert.equal(wrong.hasContent, false, 'without the offset, nothing is inside');
});

test('an empty polygon takes nothing rather than throwing', () => {
    const r = cut({ layer: filled(2, 2), poly: [], minX: 0, minY: 0, w: 2, h: 2 });
    assert.equal(r.hasContent, false);
});

test('a zero-size region produces empty images rather than failing', () => {
    const r = cut({ layer: filled(1, 1), poly: wholeBox, minX: 0, minY: 0, w: 0, h: 0 });
    assert.equal(r.hasContent, false);
    assert.equal(r.selection.data.length, 0);
});
