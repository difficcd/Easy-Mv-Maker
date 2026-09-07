import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBitmapStore } from '../src/core/projectAssets.js';

// The browser calls are injected, which is the convention collectBitmaps already set in this file
// and the reason this can be tested at all. The stubs record what they were asked for, so the
// routing - which value becomes a Blob, which becomes ImageData - is what is being checked.

const deps = (over = {}) => ({
    dataURLToImageData: async (url) => ({ kind: 'imagedata', from: url }),
    createBitmap: async (img) => ({ kind: 'bitmap', of: img.from }),
    urlToBlob: async (url) => ({ type: 'image/webp', from: url }),
    extFromType: (t) => String(t || '').split('/')[1] || 'bin',
    ...over,
});

test('nothing to load is an empty store, not a throw', async () => {
    assert.deepEqual(await loadBitmapStore(null, deps()), { store: new Map(), failed: 0 });
    assert.deepEqual(await loadBitmapStore({}, deps()), { store: new Map(), failed: 0 });
});

test('a drawing layer becomes editable ImageData up front', async () => {
    const { store } = await loadBitmapStore({ bitmaps: { a: 'data:image/png;base64,AAA' } }, deps());
    const e = store.get('a');
    assert.equal(e.imageData.kind, 'imagedata');
    assert.equal(e.imageBitmap.kind, 'bitmap', 'with a fast path for drawing it');
    assert.equal(e.blob, undefined);
});

// Frames stay compressed and are decoded lazily on display. Decoding every frame of a big import
// up front is what used to run the tab out of memory.
test('a compressed frame stays a Blob, undecoded', async () => {
    const { store } = await loadBitmapStore(
        { bitmaps: { f1: 'data:image/webp;base64,AAA' }, compressedBitmaps: ['f1'] }, deps());
    const e = store.get('f1');
    assert.equal(e.imageData, null);
    assert.equal(e.imageBitmap, null);
    assert.equal(e.blob.from, 'data:image/webp;base64,AAA');
    assert.equal(e.ext, 'webp', 'the extension comes from the blob, for saving it again later');
});

// A real Blob, not a stand-in: frameLoad decides with `instanceof Blob`, so a look-alike would
// take the wrong branch and the test would be checking nothing.
test('a value that is already a Blob is kept as one', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/webp' });
    const { store } = await loadBitmapStore({ bitmaps: { f2: blob } }, deps());
    const e = store.get('f2');
    assert.equal(e.blob, blob, 'an autosave stores Blobs directly; re-encoding them would be waste');
    assert.equal(e.imageData, null, 'and it is not decoded on the way in');
    assert.equal(e.ext, 'webp');
});

// One unreadable frame in a thousand should cost that frame, not the project.
test('an entry that will not load is skipped and counted', async () => {
    const { store, failed } = await loadBitmapStore(
        { bitmaps: { good: 'data:image/png;base64,AAA', bad: 'data:image/png;base64,BBB' } },
        deps({ dataURLToImageData: async (url) => { if (url.endsWith('BBB')) throw new Error('nope'); return { kind: 'imagedata', from: url }; } }),
    );
    assert.equal(failed, 1);
    assert.equal(store.size, 1);
    assert.ok(store.has('good'));
});

test('a failed fast path is not a failed frame', async () => {
    const { store, failed } = await loadBitmapStore(
        { bitmaps: { a: 'data:image/png;base64,AAA' } },
        deps({ createBitmap: async () => { throw new Error('no createImageBitmap here'); } }),
    );
    assert.equal(failed, 0);
    assert.equal(store.get('a').imageBitmap, null);
    assert.equal(store.get('a').imageData.kind, 'imagedata', 'the pixels are still there to draw from');
});

test('progress is reported once per entry, loaded or not', async () => {
    let ticks = 0;
    await loadBitmapStore(
        { bitmaps: { a: 'data:image/png;base64,AAA', b: 'data:image/png;base64,BBB', c: 'x' } },
        deps({ onEach: () => ticks++, dataURLToImageData: async (u) => { if (u === 'x') throw new Error('bad'); return { kind: 'imagedata', from: u }; } }),
    );
    assert.equal(ticks, 3, 'a bar that stalls on a broken frame looks like a hang');
});

test('the store it returns is its own, so a caller can merge it where it likes', async () => {
    const { store } = await loadBitmapStore({ bitmaps: { a: 'data:image/png;base64,AAA' } }, deps());
    assert.ok(store instanceof Map);
    assert.equal(store.size, 1);
});
