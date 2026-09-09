import test from 'node:test';
import assert from 'node:assert/strict';
import { splitProject, pieceFileName } from '../src/core/splitProject.js';

const cut = (id, partId, partName, bitmapIds = [], startTime = id, endTime = id + 1) => ({
    id, partId, partName, startTime, endTime, track: 0, texts: [],
    layers: [{ id: 1, strokes: bitmapIds.map((b, i) => ({ id: i + 1, tool: 'paste', bitmapId: b })) }],
});

const doc = () => ({
    appName: 'EasyMVMaker', version: '1.5', numTracks: 2, pps: 50,
    canvas: { w: 1920, h: 1080 },
    cuts: [
        cut(1, 'p1', 'Opening', ['a']),
        cut(2, 'p1', 'Opening', ['b']),
        cut(3, 'p2', 'Chorus', ['c']),
    ],
    bitmaps: { a: 'data:image/png;base64,AAA', b: 'data:image/webp;base64,BBB', c: 'data:image/webp;base64,CCC' },
    compressedBitmaps: ['b', 'c'],
    audio: { name: 'song.mp3', dataUrl: 'data:audio/mpeg;base64,ZZZ', startTime: 0, endTime: 90 },
});

test('one piece per part, in timeline order, named after the part', () => {
    const pieces = splitProject(doc());
    assert.deepEqual(pieces.map(p => p.name), ['Opening', 'Chorus']);
    assert.deepEqual(pieces.map(p => p.count), [2, 1]);
});

test('a piece carries only its own cuts', () => {
    const [opening, chorus] = splitProject(doc());
    assert.deepEqual(opening.doc.cuts.map(c => c.id), [1, 2]);
    assert.deepEqual(chorus.doc.cuts.map(c => c.id), [3]);
});

// The whole point. A piece that dragged every frame along would be the same size as the project
// it was split out of, and splitting would buy nothing.
test('a piece carries only the pixels its cuts reference', () => {
    const [opening, chorus] = splitProject(doc());
    assert.deepEqual(Object.keys(opening.doc.bitmaps).sort(), ['a', 'b']);
    assert.deepEqual(Object.keys(chorus.doc.bitmaps).sort(), ['c']);
});

test('the compressed list is filtered with them, and dropped when empty', () => {
    const [opening, chorus] = splitProject(doc());
    assert.deepEqual(opening.doc.compressedBitmaps, ['b']);
    assert.deepEqual(chorus.doc.compressedBitmaps, ['c']);
    const lineArt = splitProject({ ...doc(), compressedBitmaps: [] });
    assert.equal(lineArt[0].doc.compressedBitmaps, undefined,
        'an empty list would claim these frames are compressed');
});

// Times are left alone so that splitting and recombining come back to the same film, rather than
// to every piece stacked at zero.
test('times are left as they were', () => {
    const [opening, chorus] = splitProject(doc());
    assert.deepEqual(opening.doc.cuts.map(c => [c.startTime, c.endTime]), [[1, 2], [2, 3]]);
    assert.deepEqual(chorus.doc.cuts.map(c => [c.startTime, c.endTime]), [[3, 4]]);
});

// A piece you cannot hear the music over is a piece you cannot time anything against, and audio is
// small next to the frames.
test('the audio travels with every piece', () => {
    for (const p of splitProject(doc())) assert.equal(p.doc.audio.dataUrl, 'data:audio/mpeg;base64,ZZZ');
});

test('the settings travel too, so a piece opens the same size', () => {
    const [opening] = splitProject(doc());
    assert.deepEqual(opening.doc.canvas, { w: 1920, h: 1080 });
    assert.equal(opening.doc.numTracks, 2);
    assert.equal(opening.doc.appName, 'EasyMVMaker');
});

// "Split this" must never mean "throw some away".
test('cuts belonging to no part become a piece rather than vanishing', () => {
    const d = doc();
    d.cuts.push(cut(4, null, null, ['d']), cut(5, undefined, undefined, []));
    d.bitmaps.d = 'data:image/png;base64,DDD';
    const pieces = splitProject(d);
    const all = pieces.flatMap(p => p.doc.cuts.map(c => c.id)).sort();
    assert.deepEqual(all, [1, 2, 3, 4, 5], 'every cut is in exactly one piece');
    assert.equal(pieces.length, 3);
    assert.deepEqual(pieces[2].doc.cuts.map(c => c.id), [4, 5], 'and the loose ones come last');
});

test('a project that is entirely one part still splits into one piece', () => {
    const d = doc();
    d.cuts = d.cuts.map(c => ({ ...c, partId: 'p1', partName: 'Only' }));
    const pieces = splitProject(d);
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].doc.cuts.length, 3);
});

test('nothing to split is no pieces, not one empty one', () => {
    assert.deepEqual(splitProject({ cuts: [] }), []);
    assert.deepEqual(splitProject(null), []);
});

test('server assets are dropped, because a piece has to stand on its own', () => {
    const d = { ...doc(), assets: [{ id: 'a', ext: 'webp' }] };
    for (const p of splitProject(d)) assert.equal(p.doc.assets, undefined);
});

test('file names sort into the running order and survive an awkward part name', () => {
    assert.equal(pieceFileName(0, 3, 'Opening'), '1_Opening.emv');
    assert.equal(pieceFileName(9, 12, 'Chorus'), '10_Chorus.emv');
    assert.equal(pieceFileName(0, 12, 'Chorus'), '01_Chorus.emv', 'padded, so 2 sorts before 10');
    assert.equal(pieceFileName(0, 1, 'a/b:c*?"<>|'), '1_abc.emv');
    assert.equal(pieceFileName(0, 1, '   '), '1_part.emv');
    assert.equal(pieceFileName(0, 1, ''), '1_part.emv');
});
