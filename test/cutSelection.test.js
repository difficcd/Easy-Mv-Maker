import test from 'node:test';
import assert from 'node:assert/strict';
import { toggled, inReadingOrder, selectionAfterClick, cutsToCopy } from '../src/core/cutSelection.js';

// Made out of order on purpose: b was made first but sits later on track 1.
const cuts = [
    { id: 'b', track: 1, startTime: 5 },
    { id: 'a', track: 0, startTime: 0 },
    { id: 'c', track: 1, startTime: 0 },
    { id: 'd', track: 0, startTime: 3 },
];

test('toggled: adds when absent, removes when present, never mutates the input', () => {
    const s = new Set([1]);
    assert.deepEqual([...toggled(s, 2)], [1, 2]);
    assert.deepEqual([...toggled(s, 1)], []);
    assert.deepEqual([...s], [1]);
});

test('reading order is by track, then by start time - not the order the cuts were made', () => {
    assert.deepEqual(inReadingOrder(cuts).map(c => c.id), ['a', 'd', 'c', 'b']);
});

test('a plain click selects that cut alone, whatever was selected', () => {
    assert.deepEqual([...selectionAfterClick(new Set(['a', 'b']), cuts, 'a', 'c')], ['c']);
});

test('ctrl-click toggles the cut in and out of the selection', () => {
    assert.deepEqual([...selectionAfterClick(new Set(['a']), cuts, 'a', 'c', { ctrl: true })], ['a', 'c']);
    assert.deepEqual([...selectionAfterClick(new Set(['a', 'c']), cuts, 'a', 'c', { ctrl: true })], ['a']);
});

test('shift-click selects the run from the current cut, in reading order, in either direction', () => {
    // From a (track 0, first) to c (track 1, first): everything between in reading order,
    // which crosses the track boundary and includes d.
    assert.deepEqual([...selectionAfterClick(new Set(), cuts, 'a', 'c', { shift: true })], ['a', 'd', 'c']);
    // Backwards gives the same run.
    assert.deepEqual([...selectionAfterClick(new Set(), cuts, 'c', 'a', { shift: true })], ['a', 'd', 'c']);
});

test('shift-click with no current cut, or an unknown one, falls back to a plain click', () => {
    assert.deepEqual([...selectionAfterClick(new Set(['a']), cuts, null, 'c', { shift: true })], ['c']);
    assert.deepEqual([...selectionAfterClick(new Set(['a']), cuts, 'zzz', 'c', { shift: true })], ['c']);
});

test('cutsToCopy: the whole multi-selection when the copied cut is in it, else just that cut', () => {
    assert.deepEqual(cutsToCopy(cuts, new Set(['c', 'a']), 'c').map(c => c.id), ['a', 'c'], 'in reading order');
    assert.deepEqual(cutsToCopy(cuts, new Set(['c', 'a']), 'd').map(c => c.id), ['d'], 'a cut outside the selection copies alone');
    assert.deepEqual(cutsToCopy(cuts, new Set(['c']), 'c').map(c => c.id), ['c'], 'a selection of one is not a multi-selection');
});
