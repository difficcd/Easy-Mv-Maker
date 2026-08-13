// Parts (scenes) are cuts grouped by a field on the cut, with their time range recomputed rather
// than stored - so the interesting cases are what happens when cuts move, when a part is empty,
// and the difference between ungrouping a part and deleting one.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    derivePartsFrom, deriveVideoBatches, assignPart, renamePartIn, ungroupPartIn, removeVideoBatch,
} from '../src/core/partOps.js';

const cut = (id, partId, startTime, endTime, partName) => ({ id, partId, partName, startTime, endTime });

test('derivePartsFrom: a part spans its cuts and counts them', () => {
    const parts = derivePartsFrom([
        cut(1, 'a', 0, 1, 'Intro'), cut(2, 'a', 1, 2), cut(3, 'a', 2, 3),
    ]);
    assert.equal(parts.length, 1);
    assert.deepEqual({ ...parts[0] }, { id: 'a', name: 'Intro', count: 3, start: 0, end: 3 });
});

test('derivePartsFrom: the range follows the cuts, wherever they have been dragged', () => {
    // Stored bounds would drift the moment a cut moved, and only show up as playback stopping
    // in the wrong place.
    const before = derivePartsFrom([cut(1, 'a', 0, 1), cut(2, 'a', 1, 2)])[0];
    const after = derivePartsFrom([cut(1, 'a', 10, 11), cut(2, 'a', 1, 2)])[0];
    assert.deepEqual([before.start, before.end], [0, 2]);
    assert.deepEqual([after.start, after.end], [1, 11], 'recomputed, not remembered');
});

test('derivePartsFrom: parts come back in timeline order, not insertion order', () => {
    const parts = derivePartsFrom([cut(1, 'late', 10, 11), cut(2, 'early', 0, 1)]);
    assert.deepEqual(parts.map(p => p.id), ['early', 'late']);
});

test('derivePartsFrom: cuts belonging to no part are simply not in one', () => {
    assert.deepEqual(derivePartsFrom([cut(1, null, 0, 1), cut(2, undefined, 1, 2)]), []);
    assert.deepEqual(derivePartsFrom([]), []);
    assert.deepEqual(derivePartsFrom(null), []);
});

test('derivePartsFrom: an unnamed part gets the fallback, and naming any cut names it', () => {
    assert.equal(derivePartsFrom([cut(1, 'a', 0, 1)], 'Part')[0].name, 'Part');
    assert.equal(derivePartsFrom([cut(1, 'a', 0, 1), cut(2, 'a', 1, 2, 'Chorus')], 'Part')[0].name, 'Chorus');
});

test('deriveVideoBatches: imported frame sets group separately from parts', () => {
    // An old project can have batches and no parts at all.
    const cuts = [
        { id: 1, videoBatch: 'v1', videoLabel: 'clip.mp4', startTime: 0, endTime: 1 },
        { id: 2, videoBatch: 'v1', startTime: 1, endTime: 2 },
        { id: 3, partId: 'a', startTime: 5, endTime: 6 },
    ];
    const b = deriveVideoBatches(cuts);
    assert.equal(b.length, 1);
    assert.deepEqual({ id: b[0].id, label: b[0].label, count: b[0].count, start: b[0].start, end: b[0].end },
        { id: 'v1', label: 'clip.mp4', count: 2, start: 0, end: 2 });
});

test('assignPart: only the selected cuts move, and they leave the part they were in', () => {
    const cuts = [cut(1, 'old', 0, 1, 'Old'), cut(2, null, 1, 2), cut(3, 'other', 2, 3, 'Other')];
    const out = assignPart(cuts, new Set([1, 2]), 'new', 'New');
    assert.deepEqual(out.map(c => c.partId), ['new', 'new', 'other']);
    assert.deepEqual(out.map(c => c.partName), ['New', 'New', 'Other']);
});

test('assignPart: takes a plain array of ids as well as a Set', () => {
    const out = assignPart([cut(1, null, 0, 1)], [1], 'p', 'P');
    assert.equal(out[0].partId, 'p');
});

test('renamePartIn: renames every cut of that part and nothing else', () => {
    const cuts = [cut(1, 'a', 0, 1, 'Old'), cut(2, 'a', 1, 2, 'Old'), cut(3, 'b', 2, 3, 'Keep')];
    const out = renamePartIn(cuts, 'a', 'New');
    assert.deepEqual(out.map(c => c.partName), ['New', 'New', 'Keep']);
});

test('ungroupPartIn: the cuts stay - this is not a delete', () => {
    const cuts = [cut(1, 'a', 0, 1, 'A'), cut(2, 'b', 1, 2, 'B')];
    const out = ungroupPartIn(cuts, 'a');
    assert.equal(out.length, 2, 'nothing was removed');
    assert.equal(out[0].partId, undefined);
    assert.equal(out[0].partName, undefined);
    assert.equal(out[0].startTime, 0, 'and it did not move');
    assert.equal(out[1].partId, 'b', 'other parts untouched');
    assert.deepEqual(derivePartsFrom(out).map(p => p.id), ['b'], 'the part is gone from the list');
});

test('removeVideoBatch: this one really does delete', () => {
    const cuts = [
        { id: 1, videoBatch: 'v1', startTime: 0, endTime: 1 },
        { id: 2, videoBatch: 'v2', startTime: 1, endTime: 2 },
    ];
    assert.deepEqual(removeVideoBatch(cuts, 'v1').map(c => c.id), [2]);
    assert.deepEqual(removeVideoBatch(cuts, 'nope').map(c => c.id), [1, 2], 'an unknown batch removes nothing');
});

test('every operation leaves the array it was given alone', () => {
    const cuts = [cut(1, 'a', 0, 1, 'A'), { id: 2, videoBatch: 'v', startTime: 1, endTime: 2 }];
    const before = JSON.parse(JSON.stringify(cuts));
    assignPart(cuts, [1], 'x', 'X');
    renamePartIn(cuts, 'a', 'X');
    ungroupPartIn(cuts, 'a');
    removeVideoBatch(cuts, 'v');
    derivePartsFrom(cuts);
    deriveVideoBatches(cuts);
    assert.deepEqual(cuts, before);
});
