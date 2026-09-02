import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBitmaps } from '../src/core/projectAssets.js';

const cuts = (...ids) => [{
    layers: [{ strokes: ids.map(id => (id ? { bitmapId: id } : { tool: 'pen' })) }],
}];

/** The two encoders the real app supplies; here they just say what they were handed. */
const io = (store, cache = new Map(), extra = {}) => ({
    store: { get: (id) => store[id] },
    cache,
    blobToDataURL: async (b) => `data:enc/${b.name}`,
    imageDataToDataURL: (d) => `data:pixels/${d.tag}`,
    ...extra,
});

test('raw pixels are encoded and cached', async () => {
    const data = { tag: 'a' };
    const cache = new Map();
    const out = await collectBitmaps(cuts('a'), io({ a: { imageData: data } }, cache));
    assert.deepEqual(out.bitmaps, { a: 'data:pixels/a' });
    assert.deepEqual(out.compressed, []);
    assert.equal(cache.get('a').url, 'data:pixels/a');
});

test('a cached dataURL is reused rather than re-encoded', async () => {
    const data = { tag: 'a' };
    const cache = new Map([['a', { imageData: data, url: 'data:cached' }]]);
    let encoded = 0;
    const out = await collectBitmaps(cuts('a'), io({ a: { imageData: data } }, cache, {
        imageDataToDataURL: () => { encoded++; return 'data:fresh'; },
    }));
    assert.equal(out.bitmaps.a, 'data:cached');
    assert.equal(encoded, 0);
});

test('the cache is keyed on the pixels, so an edited bitmap re-encodes', async () => {
    // A lasso edit replaces the ImageData under the same id. Keying on the id alone would save
    // the drawing as it was before the edit.
    const cache = new Map([['a', { imageData: { tag: 'old' }, url: 'data:stale' }]]);
    const out = await collectBitmaps(cuts('a'), io({ a: { imageData: { tag: 'new' } } }, cache));
    assert.equal(out.bitmaps.a, 'data:pixels/new');
});

test('a Blob frame embeds as a dataURL for a self-contained file', async () => {
    const out = await collectBitmaps(cuts('v'), io({ v: { blob: { name: 'f', type: 'image/webp' } } }));
    assert.equal(out.bitmaps.v, 'data:enc/f');
    assert.deepEqual(out.compressed, ['v'], 'a whole encoded image stays compressed on restore');
});

test('a Blob frame is stored as a Blob when the destination can hold one', async () => {
    const blob = { name: 'f', type: 'image/webp' };
    const out = await collectBitmaps(cuts('v'), io({ v: { blob } }, new Map(), { blobsOk: true }));
    assert.equal(out.bitmaps.v, blob, 'IndexedDB keeps the Blob; base64 would cost a third more');
    assert.deepEqual(out.compressed, ['v']);
});

test('an old frame with only a dataURL embeds even under blobsOk', async () => {
    // There is no Blob to store, so preferring Blobs must not make it vanish.
    const out = await collectBitmaps(cuts('v'), io({ v: { url: 'data:legacy' } }, new Map(), { blobsOk: true }));
    assert.equal(out.bitmaps.v, 'data:legacy');
});

test('an asset save writes a manifest and pushes the binary to the sink', async () => {
    const sink = [];
    const blob = { name: 'f', type: 'image/png' };
    // ext is carried on the entry, put there when the frame was created or loaded - the Blob's
    // own MIME type is not consulted here.
    const out = await collectBitmaps(cuts('v'), io({ v: { blob, ext: 'png', w: 640, h: 360 } }, new Map(), { assetSink: sink }));
    assert.deepEqual(out.bitmaps, {}, 'nothing embedded, so the JSON stays small');
    assert.deepEqual(out.assets, [{ id: 'v', ext: 'png', w: 640, h: 360 }]);
    assert.equal(sink.length, 1);
    assert.equal(sink[0].blob, blob);
});

test('an asset sink wins over blobsOk', async () => {
    const sink = [];
    const out = await collectBitmaps(cuts('v'),
        io({ v: { blob: { name: 'f', type: 'image/png' } } }, new Map(), { assetSink: sink, blobsOk: true }));
    assert.equal(sink.length, 1);
    assert.deepEqual(out.bitmaps, {});
});

test('an id the store does not have is skipped rather than written as undefined', async () => {
    const out = await collectBitmaps(cuts('ghost'), io({}));
    assert.deepEqual(out.bitmaps, {});
});

test('an entry with neither pixels nor an image contributes nothing', async () => {
    const out = await collectBitmaps(cuts('a'), io({ a: { imageBitmap: {} } }));
    assert.deepEqual(out.bitmaps, {});
});

test('strokes without a bitmap are ignored', async () => {
    const out = await collectBitmaps(cuts(null, 'a'), io({ a: { imageData: { tag: 'a' } } }));
    assert.deepEqual(Object.keys(out.bitmaps), ['a']);
});

test('a bitmap used by two strokes is collected once', async () => {
    let encoded = 0;
    const data = { tag: 'a' };
    await collectBitmaps(cuts('a', 'a'), io({ a: { imageData: data } }, new Map(), {
        imageDataToDataURL: () => { encoded++; return 'x'; },
    }));
    assert.equal(encoded, 1);
});

test('malformed cuts are empty rather than a crash', async () => {
    const out = await collectBitmaps([{}, { layers: null }, { layers: [{}] }], io({}));
    assert.deepEqual(out, { bitmaps: {}, compressed: [], assets: [] });
    const none = await collectBitmaps(null, io({}));
    assert.deepEqual(none.bitmaps, {});
});

test('a frame with no ext falls back to webp, which is what the app writes', async () => {
    const sink = [];
    const out = await collectBitmaps(cuts('v'),
        io({ v: { blob: { name: 'f', type: 'image/png' } } }, new Map(), { assetSink: sink }));
    assert.equal(out.assets[0].ext, 'webp');
});
