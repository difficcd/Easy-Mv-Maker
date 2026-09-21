import test from 'node:test';
import assert from 'node:assert/strict';
import { keysOrNull, snapProgress, upsertKey, patchKey, removeKey, KEY_SNAP } from '../../src/core/keyframes.ts';

let n = 0;
const mkId = () => `k${++n}`;
const keys = [{ id: 'a', p: 0, tx: 0 }, { id: 'b', p: 0.5, tx: 10 }, { id: 'c', p: 1, tx: 20 }];

test('keysOrNull: sorted by position; empty becomes null, which is how "no keys" is stored', () => {
    assert.deepEqual(keysOrNull([{ p: 1 }, { p: 0 }]).map(k => k.p), [0, 1]);
    assert.equal(keysOrNull([]), null);
    assert.equal(keysOrNull(undefined), null);
});

test('snapProgress: clamped to the cut and rounded to a whole percent', () => {
    assert.equal(snapProgress(0.3333), 0.33);
    assert.equal(snapProgress(-2), 0);
    assert.equal(snapProgress(7), 1);
});

test('upsertKey: a new position adds a key with a fresh id, and the list stays sorted', () => {
    const out = upsertKey(keys, 0.25, { tx: 5 }, mkId);
    assert.deepEqual(out.map(k => k.p), [0, 0.25, 0.5, 1]);
    const added = out.find(k => k.p === 0.25);
    assert.equal(added.tx, 5);
    assert.ok(added.id.startsWith('k'), 'ids are what let React follow a row that moves');
});

test('upsertKey: a position already taken is replaced, not stacked', () => {
    // Two keys at one instant would make the tween jump between them.
    const out = upsertKey(keys, 0.5 + KEY_SNAP / 2, { tx: 99 }, mkId);
    assert.equal(out.length, 3);
    const k = out.find(k => k.id === 'b');
    assert.equal(k.tx, 99, 'the values are new');
    assert.equal(k.p, 0.5 + KEY_SNAP / 2, 'and so is the exact position asked for');
});

test('patchKey: editing a position moves the row; removeKey empties to null', () => {
    const moved = patchKey(keys, 0, { p: 0.75 });
    assert.deepEqual(moved.map(k => k.id), ['b', 'a', 'c'], 'a at 0.75 now sits between 0.5 and 1');
    assert.deepEqual(removeKey(keys, 1).map(k => k.id), ['a', 'c']);
    assert.equal(removeKey([keys[0]], 0), null);
});
