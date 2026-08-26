import test from 'node:test';
import assert from 'node:assert/strict';
import { frameStorage, frameLoad, imageExt, imageExtFromType, audioExt, videoExt } from '../src/core/projectAssets.js';

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
