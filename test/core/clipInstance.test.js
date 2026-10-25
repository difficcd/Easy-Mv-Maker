import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSource, clipFrameAt, clipPlacement, combineCutAnim, freeTrack, makeClipCopy, duplicateClipCopy, unpackClipCopy, isClipCopy } from '../../src/core/clipInstance.ts';
import { evaluateFrame } from '../../src/engine/evaluateFrame.ts';
import { cutsToCache } from '../../src/engine/selectCuts.ts';

// A three-frame part on track 0, 0-3s, and a copy of it on track 1 from 10s.
const frame = (id, s) => ({ id, name: `F${id}`, startTime: s, endTime: s + 1, track: 0, partId: 'walk', partName: 'Walk', layers: [{ id: 1, type: 'layer', strokes: [{ id }] }], texts: [] });
const part = [frame(1, 0), frame(2, 1), frame(3, 2)];
const copyAt = (start, end, clip = {}) => ({ id: 9, name: 'copy', startTime: start, endTime: end, track: 1, layers: [], texts: [], partId: null, clip: { partId: 'walk', dx: 0, dy: 0, scale: 1, loop: true, ...clip } });

test('a clip is its part\'s own cuts, never other copies', () => {
    const doc = [...part, { ...copyAt(10, 13), partId: 'walk' }];
    const src = clipSource(doc, 'walk');
    assert.deepEqual(src.cuts.map(c => c.id), [1, 2, 3]);
    assert.deepEqual([src.start, src.end], [0, 3]);
});

test('a copy shows the frame at the matching moment of the part, looping', () => {
    const copy = copyAt(10, 20);
    const doc = [...part, copy];
    assert.deepEqual(clipFrameAt(doc, copy, 10.5).cuts.map(c => c.id), [1]);
    assert.deepEqual(clipFrameAt(doc, copy, 12.2).cuts.map(c => c.id), [3]);
    assert.deepEqual(clipFrameAt(doc, copy, 13.4).cuts.map(c => c.id), [1], 'second time round');
    assert.equal(clipFrameAt(doc, copy, 9).cuts.length, 0, 'not before it starts');
});

test('a copy that plays once shows nothing after the part has run', () => {
    const copy = copyAt(10, 20, { loop: false });
    assert.equal(clipFrameAt([...part, copy], copy, 13.5).cuts.length, 0);
});

test('a copy of a part that is gone shows nothing', () => {
    const copy = copyAt(10, 20);
    assert.equal(clipFrameAt([copy], copy, 10.5).cuts.length, 0);
});

test('placement is offset and size, and nests with the animation', () => {
    assert.equal(clipPlacement({ partId: 'walk', dx: 0, dy: 0, scale: 1, loop: true }), null);
    const place = clipPlacement({ partId: 'walk', dx: 100, dy: -20, scale: 0.5, loop: true });
    assert.deepEqual(place, { alpha: 1, sx: 0.5, sy: 0.5, tx: 100, ty: -20 });
    assert.deepEqual(combineCutAnim(place, { alpha: 0.5, sx: 2, sy: 2, tx: 40, ty: 0 }), { alpha: 0.5, sx: 1, sy: 1, tx: 120, ty: -20 });
    assert.equal(combineCutAnim(null, null), null);
});

test('the engine draws a copy as the part\'s own cut, placed - so it shares the part\'s layers', () => {
    const copy = copyAt(10, 20, { dx: 50 });
    const scene = evaluateFrame([...part, copy], 11.5, { playing: false, currentCutId: null, cw: 1920, ch: 1080 });
    assert.deepEqual(scene.cuts.map(e => e.cut.id), [2]);
    assert.deepEqual(scene.cuts[0].anim, { alpha: 1, sx: 1, sy: 1, tx: 50, ty: 0 }, 'placed even while paused');
});

test('the original and a copy play together, each where it is', () => {
    const copy = { ...copyAt(0, 3), clip: { partId: 'walk', dx: 0, dy: 0, scale: 1, loop: true } };
    const scene = evaluateFrame([...part, copy], 1.5, { playing: true, currentCutId: null, cw: 1920, ch: 1080 });
    assert.deepEqual(scene.cuts.map(e => e.cut.id), [2, 2], 'frame 2 twice: the part itself, and the copy of it');
});

test('the layers a copy shows are baked even when the part is off the playhead', () => {
    const copy = copyAt(10, 20);
    const ids = cutsToCache([...part, copy], 12.5, null, {});
    assert.ok(ids.has(3) && ids.has(9));
});

test('a new copy goes on the first free track above the part, nudged', () => {
    const doc = [...part, { ...frame(4, 0), partId: null, track: 1 }];
    const c = makeClipCopy(doc, 'walk', 'Clip: Walk', 50);
    assert.equal(c.track, 2);
    assert.deepEqual([c.startTime, c.endTime], [0, 3]);
    assert.ok(isClipCopy(c) && c.layers.length === 0);
    assert.equal(c.clip.dx, 40);
    assert.equal(makeClipCopy(doc, 'nothing', 'x', 51), null);
    assert.equal(freeTrack(doc, 0, 3, 0), 2);
});

test('another copy sits on the next free track, nudged again', () => {
    const copy = copyAt(10, 13, { dx: 40, dy: 40 });
    const more = duplicateClipCopy([...part, copy], copy, 77);
    assert.equal(more.track, 2);
    assert.deepEqual([more.clip.dx, more.clip.dy], [80, 80]);
    assert.equal(more.clip.partId, 'walk');
});

test('unpacking lays the part\'s frames over the copy\'s span as ordinary cuts', () => {
    const copy = copyAt(10, 17.5);
    let n = 100;
    const made = unpackClipCopy([...part, copy], copy, c => ({ layers: structuredClone(c.layers) }), () => n++);
    assert.deepEqual(made.map(c => [c.startTime, c.endTime]), [[10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 17.5]]);
    assert.ok(made.every(c => !c.clip && c.partId === null && c.track === 1));
    assert.notEqual(made[0].layers, part[0].layers, 'a drawing of its own');
    const once = unpackClipCopy([...part, { ...copy, clip: { ...copy.clip, loop: false } }], { ...copy, clip: { ...copy.clip, loop: false } }, c => ({}), () => n++);
    assert.equal(once.length, 3, 'once: one pass of the part');
});
