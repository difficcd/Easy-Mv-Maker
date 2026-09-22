import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitmapStore } from '../../src/canvas/bitmapStore.ts';
import { DECODED_CAP } from '../../src/core/decodeBudget.ts';

/** Node has no ImageData, ImageBitmap or Blob decoding; the store takes all three as arguments. */
function make(opts = {}) {
    let n = 0;
    const calls = [];
    const s = createBitmapStore({
        canvasSize: () => [1920, 1080],
        makeBitmap: async (src, o) => { calls.push([src, o]); return { src, o, closed: false, close() { this.closed = true; } }; },
        makeImageData: (data, width, height) => ({ data, width, height }),
        newId: () => `b${++n}`,
        ...opts,
    });
    return { s, calls };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('store: drawn pixels are kept as ImageData and get a display bitmap when it is ready', async () => {
    const { s } = make();
    const img = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const id = s.store(img);
    assert.equal(id, 'b1');
    assert.equal(s.map.get(id).imageData, img);
    assert.equal(s.map.get(id).imageBitmap, null, 'drawing does not wait for the bitmap');
    await tick();
    assert.equal(s.map.get(id).imageBitmap.src, img);
});

test('storeBlob: a frame is kept compressed, with its type as the extension, and not decoded', () => {
    const { s, calls } = make();
    const id = s.storeBlob({ type: 'image/webp' }, 3840, 2160);
    assert.deepEqual(s.map.get(id), { imageData: null, imageBitmap: null, blob: { type: 'image/webp' }, ext: 'webp', w: 3840, h: 2160 });
    assert.equal(calls.length, 0, 'decoding at import is what ran a big video out of memory');
    assert.equal(s.map.get(s.storeBlob({ type: 'application/octet-stream' })).ext, 'webp', 'unknown type: webp');
});

test('decodeFrame: a frame larger than the canvas is decoded no larger than the canvas', async () => {
    const { s, calls } = make();
    await s.decodeFrame({ blob: 'B', w: 3840, h: 2160 });
    assert.deepEqual(calls[0][1], { resizeWidth: 1920, resizeHeight: 1080, resizeQuality: 'high' });
    await s.decodeFrame({ blob: 'B', w: 1280, h: 720 });
    assert.equal(calls[1][1], undefined, 'a smaller one is decoded as it is');
});

test('trim: decoded frames beyond the cap are released oldest-first, keeping their Blob', async () => {
    const { s } = make();
    const ids = [];
    for (let i = 0; i < DECODED_CAP + 3; i++) {
        const id = s.storeBlob({ type: 'image/webp' });
        s.map.get(id).imageBitmap = { closed: false, close() { this.closed = true; } };
        s.touch(id);
        ids.push(id);
    }
    s.trim(new Set());
    const released = ids.filter(id => s.map.get(id).imageBitmap === null);
    assert.equal(released.length, 3);
    assert.deepEqual(released, ids.slice(0, 3), 'the three least recently used');
    assert.ok(released.every(id => s.map.get(id).blob), 'the compressed frame stays for re-decoding');
});

test('clone: a copy of drawn pixels under a new id, shared within one operation; frames are not copied', () => {
    const { s } = make();
    const img = { data: new Uint8ClampedArray([1, 2, 3, 4]), width: 1, height: 1 };
    const a = s.store(img);
    const f = s.storeBlob({ type: 'image/webp' });
    const cache = new Map();
    const a2 = s.clone(a, cache);
    assert.notEqual(a2, a);
    assert.deepEqual([...s.map.get(a2).imageData.data], [1, 2, 3, 4]);
    assert.notEqual(s.map.get(a2).imageData.data, img.data, 'its own pixels, not a view on the source');
    assert.equal(s.clone(a, cache), a2, 'the same source in the same operation is the same copy');
    assert.equal(s.clone(f, cache), f, 'a frame is shared, not copied');
    assert.equal(s.clone(null, cache), null);
});
