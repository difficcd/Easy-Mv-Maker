import test from 'node:test';
import assert from 'node:assert/strict';
import { nextId, resetIds } from '../src/core/ids.js';

test('two ids handed out in the same millisecond are different', () => {
    // This is the whole point. Date.now() twice in a row is the same number, and two call sites
    // had already noticed and written `Date.now() + 1` by hand for the second object they made.
    resetIds();
    assert.notEqual(nextId(), nextId());
});

test('a block of ids has no repeats, however fast it is handed out', () => {
    resetIds();
    const ids = Array.from({ length: 5000 }, () => nextId());
    assert.equal(new Set(ids).size, ids.length);
});

test('two blocks taken back to back do not overlap', () => {
    // Duplicating a selection of cuts twice in quick succession used to produce two overlapping
    // ranges, and cuts are found with `find(c => c.id === id)` - so one selection would pick a
    // cut from the other.
    resetIds();
    const first = Array.from({ length: 20 }, () => nextId());
    const second = Array.from({ length: 20 }, () => nextId());
    assert.equal(new Set([...first, ...second]).size, 40);
});

test('ids only go up, so they still sort by when they were made', () => {
    resetIds();
    const ids = Array.from({ length: 200 }, () => nextId());
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1], `${ids[i]} after ${ids[i - 1]}`);
});

test('the first id is the clock, so it does not collide with a saved document', () => {
    // A project reopened later must not be handed ids the stored objects already have.
    resetIds();
    const before = Date.now();
    const id = nextId();
    assert.ok(id >= before && id <= Date.now() + 1, `${id} is not around now`);
});

test('running ahead of the clock never hands out an id twice', async () => {
    // A burst puts the counter ahead of the wall clock, and it stays ahead until the clock
    // passes it. That is the safe direction: going back to the clock would reissue the ids the
    // burst already handed out.
    resetIds();
    const burst = Array.from({ length: 100 }, () => nextId());
    await new Promise(r => setTimeout(r, 20));
    const after = Array.from({ length: 5 }, () => nextId());
    assert.equal(new Set([...burst, ...after]).size, 105);
    assert.ok(after[0] > burst[burst.length - 1]);
});

test('once the clock has passed the counter, ids follow it again', async () => {
    resetIds();
    nextId();
    await new Promise(r => setTimeout(r, 20));
    const id = nextId();
    assert.ok(Math.abs(id - Date.now()) < 5, `${id} is not around now`);
});

test('ids are numbers, because that is what the document already stores', () => {
    resetIds();
    assert.equal(typeof nextId(), 'number');
    assert.ok(Number.isInteger(nextId()));
});
