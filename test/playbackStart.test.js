// Where playback begins when play is pressed. Two situations look alike from inside the app and
// want opposite things: a playhead left at the end by playback finishing, and a playhead put
// somewhere on purpose. Getting the boundary wrong is what made pressing play in an empty gap
// yank the playhead back to a cut.

import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackStartFrom } from '../src/core/playbackStart.js';

const START = 2, END = 10, ANCHOR = 4;
const from = (t) => playbackStartFrom(t, START, END, ANCHOR);

test('a position inside the range is played from, not overridden', () => {
    assert.equal(from(5), 5);
    assert.equal(from(2), 2, 'the very start counts as inside');
    assert.equal(from(9.5), 9.5);
});

test('an empty gap is a deliberate position — this is the bug that was reported', () => {
    // Parking after the current cut but before the end used to count as "finished" and rewind.
    assert.equal(from(8), 8);
});

test('at or past the end, pressing play means "again"', () => {
    assert.equal(from(END), ANCHOR);
    assert.equal(from(END + 5), ANCHOR);
    assert.equal(from(END - 0.0005), ANCHOR, 'within the epsilon of the end counts as at it');
});

test('before the range, the playhead has to come in somewhere', () => {
    assert.equal(from(0), ANCHOR);
    assert.equal(from(-100), ANCHOR);
});

test('nonsense falls back to the start of the range rather than NaN', () => {
    assert.equal(playbackStartFrom(NaN, START, END, ANCHOR), START);
    assert.equal(playbackStartFrom(undefined, START, END, ANCHOR), START);
});

test('an empty range does not loop or return something outside it', () => {
    // Nothing to play: whatever comes back, it must be the anchor rather than a time past the end.
    assert.equal(playbackStartFrom(5, 5, 5, 5), 5);
});
