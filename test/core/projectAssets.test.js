import test from 'node:test';
import assert from 'node:assert/strict';
import { frameStorage, frameLoad, imageExt, imageExtFromType, audioExt, videoExt, packMedia, unpackMedia } from '../../src/core/projectAssets.js';

const blobEntry = () => ({ blob: new Blob(['x']), url: null });
const urlEntry = () => ({ blob: null, url: 'data:image/webp;base64,AA' });

test('frameStorage: a server save externalizes everything', () => {
    assert.equal(frameStorage(blobEntry(), { assetSink: [] }), 'asset');
    assert.equal(frameStorage(urlEntry(), { assetSink: [] }), 'asset');
    // assetSink wins over blobsOk - a server save never stores Blobs inline.
    assert.equal(frameStorage(blobEntry(), { assetSink: [], blobsOk: true }), 'asset');
});

test('frameStorage: an autosave keeps Blobs off the heap', () => {
    assert.equal(frameStorage(blobEntry(), { blobsOk: true }), 'blob');
});

test('frameStorage: a legacy entry with no Blob still gets saved', () => {
    // The whole point: blobsOk is a preference, not a requirement. An older entry that only ever
    // had a dataURL must embed rather than be dropped from the autosave.
    assert.equal(frameStorage(urlEntry(), { blobsOk: true }), 'dataurl');
});

test('frameStorage: a local file embeds everything', () => {
    assert.equal(frameStorage(blobEntry(), {}), 'dataurl');
    assert.equal(frameStorage(urlEntry(), {}), 'dataurl');
    assert.equal(frameStorage({}, undefined), 'dataurl');
});

test('frameLoad: a Blob from IndexedDB is used as-is', () => {
    assert.equal(frameLoad(new Blob(['x']), new Set(), 'a'), 'blob');
});

test('frameLoad: the manifest marks frames that stay compressed', () => {
    assert.equal(frameLoad('data:image/png;base64,AA', new Set(['a']), 'a'), 'compressed');
});

test('frameLoad: video frames in a file with no manifest are recognised by format', () => {
    // Files written before compressedBitmaps existed have no manifest. Decoding their frames to
    // ImageData is the memory blowup lazy decoding exists to avoid, so the format has to say so.
    assert.equal(frameLoad('data:image/webp;base64,AA', new Set(), 'a'), 'compressed');
    assert.equal(frameLoad('data:image/jpeg;base64,AA', new Set(), 'a'), 'compressed');
});

test('frameLoad: a drawing layer decodes to editable pixels', () => {
    assert.equal(frameLoad('data:image/png;base64,AA', new Set(), 'a'), 'decode');
    assert.equal(frameLoad('data:image/png;base64,AA', new Set(['other']), 'a'), 'decode');
});

test('frameLoad: survives a missing manifest object', () => {
    assert.equal(frameLoad('data:image/png;base64,AA', undefined, 'a'), 'decode');
});

test('imageExt: the recorded extension wins over the dataURL', () => {
    assert.equal(imageExt({ ext: 'png', url: 'data:image/webp;base64,AA' }), 'png');
    assert.equal(imageExt({ url: 'data:image/jpeg;base64,AA' }), 'jpeg');
    assert.equal(imageExt({}), 'webp');
    assert.equal(imageExt(null), 'webp');
});

test('audioExt: container names browsers report are renamed to usable ones', () => {
    assert.equal(audioExt('data:audio/mpeg;base64,AA'), 'mp3');
    assert.equal(audioExt('data:audio/x-m4a;base64,AA'), 'm4a');
});

test('audioExt: anything else is kept, and a missing one defaults to mp3', () => {
    assert.equal(audioExt('data:audio/ogg;base64,AA'), 'ogg');
    assert.equal(audioExt('data:audio/webm;base64,AA'), 'webm');
    assert.equal(audioExt(null), 'mp3');
    assert.equal(audioExt('data:image/png;base64,AA'), 'mp3');
});

test('videoExt: container names browsers report are renamed to usable ones', () => {
    assert.equal(videoExt('video/x-matroska'), 'mkv');
    assert.equal(videoExt('video/quicktime'), 'mov');
});

test('videoExt: anything else is kept, and a missing one defaults to mp4', () => {
    assert.equal(videoExt('video/mp4'), 'mp4');
    assert.equal(videoExt('video/webm'), 'webm');
    assert.equal(videoExt(''), 'mp4');
    assert.equal(videoExt(undefined), 'mp4');
});

test('the audio and video rename maps stay separate', () => {
    // quicktime is a video container; nothing should rename it on the audio side, and vice versa.
    assert.equal(audioExt('data:audio/quicktime;base64,AA'), 'quicktime');
    assert.equal(videoExt('video/mpeg'), 'mpeg');
});

test('imageExtFromType: a Blob MIME type, with webp as the fallback', () => {
    assert.equal(imageExtFromType('image/png'), 'png');
    assert.equal(imageExtFromType('image/webp'), 'webp');
    assert.equal(imageExtFromType(''), 'webp');
    assert.equal(imageExtFromType(undefined), 'webp');
    // A Blob with no recorded type reads as empty, not as some other image format.
    assert.equal(imageExtFromType('application/octet-stream'), 'webp');
});


const meta = { name: 'song', startTime: 0, endTime: 3 };

test('packMedia: a server save sends the bytes out as an asset and keeps only a reference', async () => {
    const sink = [];
    const out = await packMedia(meta, { id: '__audio__', ext: 'mp3', assetSink: sink, dataUrl: 'data:audio/mpeg;base64,AAA' });
    assert.deepEqual(out, { ...meta, asset: true, ext: 'mp3' });
    assert.deepEqual(sink, [{ id: '__audio__', url: 'data:audio/mpeg;base64,AAA', ext: 'mp3' }]);
    const sink2 = [];
    const blob = new Blob(['x']);
    await packMedia(meta, { id: '__video__', ext: 'webm', assetSink: sink2, blob });
    assert.equal(sink2[0].blob, blob, 'a Blob at hand goes out as the Blob');
});

test('packMedia: the browser store keeps a Blob, making one if needed, and falls back to the dataURL', async () => {
    const blob = new Blob(['x']);
    assert.equal((await packMedia(meta, { id: 'v', ext: 'webm', blobsOk: true, blob })).blob, blob);
    const made = await packMedia(meta, { id: 'a', ext: 'mp3', blobsOk: true, dataUrl: 'data:x', toBlob: async () => blob });
    assert.equal(made.blob, blob, 'made from the dataURL');
    const failed = await packMedia(meta, { id: 'a', ext: 'mp3', blobsOk: true, dataUrl: 'data:x', toBlob: async () => null });
    assert.equal(failed.dataUrl, 'data:x', 'a large autosave beats one with no music in it');
});

test('packMedia: a self-contained file embeds the dataURL, made from the Blob if that is what is at hand', async () => {
    assert.equal((await packMedia(meta, { id: 'a', ext: 'mp3', dataUrl: 'data:x' })).dataUrl, 'data:x');
    const out = await packMedia(meta, { id: 'v', ext: 'webm', blob: new Blob(['x']), toDataUrl: async () => 'data:made' });
    assert.equal(out.dataUrl, 'data:made');
    assert.equal('blob' in out, false);
});

test('unpackMedia: gives back whichever shape the file holds, and counts a missing asset', async () => {
    const blob = new Blob(['x']);
    assert.deepEqual(await unpackMedia({ blob }, '__audio__', { fetchAsset: async () => { throw new Error('no'); } }), { blob, dataUrl: null, missing: 0 });
    assert.deepEqual(await unpackMedia({ dataUrl: 'data:x' }, '__audio__', { fetchAsset: async () => { throw new Error('no'); } }), { blob: null, dataUrl: 'data:x', missing: 0 });
    const fetched = await unpackMedia({ asset: true, ext: 'mp3' }, '__audio__', { assetBase: '/p/1', fetchAsset: async (u) => { assert.equal(u, '/p/1/asset/__audio__'); return blob; } });
    assert.deepEqual(fetched, { blob, dataUrl: null, missing: 0 });
    assert.deepEqual(await unpackMedia({ asset: true }, '__video__', { assetBase: '/p/1', fetchAsset: async () => { throw new Error('404'); } }), { blob: null, dataUrl: null, missing: 1 });
    assert.deepEqual(await unpackMedia({ asset: true }, '__video__', { fetchAsset: async () => blob }), { blob: null, dataUrl: null, missing: 0 }, 'an asset with no base to fetch from is simply absent');
    assert.deepEqual(await unpackMedia(undefined, 'x', { fetchAsset: async () => blob }), { blob: null, dataUrl: null, missing: 0 });
});
