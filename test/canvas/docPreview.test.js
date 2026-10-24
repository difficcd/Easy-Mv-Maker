import test from 'node:test';
import assert from 'node:assert/strict';
import { firstCut, picturesFor } from '../../src/canvas/docPreview.ts';

test('the first page is the cut that starts earliest, the lowest track winning a tie', () => {
    const cuts = [{ id: 3, startTime: 2, track: 0 }, { id: 2, startTime: 0, track: 1 }, { id: 1, startTime: 0, track: 0 }];
    assert.equal(firstCut(cuts).id, 1);
    assert.equal(firstCut([]), null);
});

test('only the pictures the first page uses are loaded', () => {
    const data = {
        assets: [{ id: 'a1', ext: 'webp' }, { id: 'a2', ext: 'webp' }],
        bitmaps: { 7: 'data:x', 8: 'data:y' },
        compressedBitmaps: ['7', '9'],
    };
    const got = picturesFor(data, new Set(['a2', 7]));
    assert.deepEqual(got.assets.map(a => a.id), ['a2']);
    assert.deepEqual(Object.keys(got.bitmaps), ['7'], 'a numeric id matches its string key');
    assert.deepEqual(got.compressedBitmaps, ['7']);
});

// Rendering, end to end in Node: the canvas factory hands out @napi-rs canvases with the toBlob
// the browser has, and the preview is decoded back to check what it shows.
import { createCanvas, loadImage, ImageData, DOMMatrix } from '@napi-rs/canvas';
import { setCanvasFactory } from '../../src/canvas/canvasFactory.ts';
import { renderDocPreview } from '../../src/canvas/docPreview.ts';
import { renderThumbnail } from '../../src/canvas/thumbnail.ts';

setCanvasFactory(() => {
    const c = createCanvas(1, 1);
    return /** @type {any} */ (Object.assign(c, { toBlob(cb) { cb(new Blob([c.toBuffer('image/png')], { type: 'image/png' })); } }));
});
globalThis.ImageData ??= ImageData;
globalThis.DOMMatrix ??= DOMMatrix;

const decode = async (blob) => {
    const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
    const c = createCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0);
    return c;
};
/** How dark the preview is around a point, 0 (white) to 255. */
const inkNear = (c, x, y) => {
    const d = c.getContext('2d').getImageData(Math.max(0, x - 6), Math.max(0, y - 6), 12, 12).data; let dark = 0;
    for (let i = 0; i < d.length; i += 4) dark = Math.max(dark, 255 - d[i]);
    return dark;
};
const line = (y) => ({ id: y, tool: 'pen', color: '#000000', opacity: 1, size: 40, points: Array.from({ length: 30 }, (_, i) => ({ x: 200 + i * 50, y, pressure: 0.5 })) });
const doc = {
    appName: 'EasyMVMaker', canvas: { w: 1920, h: 1080 },
    cuts: [
        { id: 2, startTime: 1, endTime: 2, track: 0, layers: [{ id: 1, type: 'layer', strokes: [line(800)] }], texts: [] },
        { id: 1, startTime: 0, endTime: 1, track: 0, layers: [
            { id: 1, type: 'layer', strokes: [line(300)] },
            { id: 2, type: 'layer', visible: false, strokes: [line(540)] },
        ], texts: [] },
    ],
};

test('a project without a preview gets its first page, visible layers only', async () => {
    const c = await decode(await renderDocPreview(doc, '/api/projects/x', async () => { throw new Error('no assets here'); }));
    assert.deepEqual([c.width, c.height], [320, 180]);
    const s = 320 / 1920;
    assert.ok(inkNear(c, 160, 300 * s) > 100, 'the first cut is drawn');
    assert.ok(inkNear(c, 160, 540 * s) < 40, 'its hidden layer is not');
    assert.ok(inkNear(c, 160, 800 * s) < 40, 'and the second cut is not');
});

test('a document with no cuts has no preview', async () => {
    assert.equal(await renderDocPreview({ appName: 'EasyMVMaker', cuts: [] }, '/x', async () => new Blob()), null);
});

test('a thumbnail is the painted frame, scaled down', async () => {
    const blob = await renderThumbnail(ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1920, 1080); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 960, 1080); }, 1920, 1080);
    const c = await decode(blob);
    assert.deepEqual([c.width, c.height], [320, 180]);
    assert.ok(inkNear(c, 40, 90) > 200 && inkNear(c, 280, 90) < 40, 'left half dark, right half light');
});
