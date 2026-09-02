import test from 'node:test';
import assert from 'node:assert/strict';
import { cutsAt, visibleCutsAt, onionNeighbours, topCutAt } from '../src/engine/selectCuts.js';

const cut = (id, start, end, track = 0) => ({ id, startTime: start, endTime: end, track });
const ids = (cs) => cs.map(c => c.id);

// Two cuts touching on track 0, one overlapping them on track 1.
const doc = () => [cut('a', 0, 2), cut('b', 2, 4), cut('over', 1, 3, 1)];

test('a cut covers its start and not its end', () => {
    // The boundary is the whole reason this is one function. Two copies that disagreed on < vs <=
    // would show two cuts at the seam in one place and one in the other, which reads as a flicker.
    assert.deepEqual(ids(cutsAt(doc(), 0)), ['a']);
    assert.deepEqual(ids(cutsAt(doc(), 2)), ['b', 'over']);
    assert.deepEqual(ids(cutsAt(doc(), 4)), []);
});

test('active cuts come back bottom track first, which is drawing order', () => {
    assert.deepEqual(ids(cutsAt(doc(), 1.5)), ['a', 'over']);
});

test('nothing playing at that moment is an empty list, not a throw', () => {
    assert.deepEqual(cutsAt([], 1), []);
    assert.deepEqual(cutsAt(null, 1), []);
    assert.deepEqual(ids(cutsAt(doc(), 99)), []);
});

test('while playing, only what is actually at t is drawn', () => {
    assert.deepEqual(ids(visibleCutsAt(doc(), 3.5, 'a', true)), ['b']);
    assert.deepEqual(ids(visibleCutsAt(doc(), 9, 'a', true)), []);
});

test('while paused, the cut being edited is drawn even off the playhead', () => {
    // Otherwise clicking a cut in the timeline and finding a blank canvas is the normal
    // experience of the app.
    assert.deepEqual(ids(visibleCutsAt(doc(), 9, 'a', false)), ['a']);
    // Appended, so among cuts on the same track the one being edited draws last - on top, which
    // is what you want to see while working on it.
    assert.deepEqual(ids(visibleCutsAt(doc(), 3.5, 'a', false)), ['b', 'a']);
});

test('the edited cut is not added twice when the playhead is already over it', () => {
    const v = visibleCutsAt(doc(), 0.5, 'a', false);
    assert.deepEqual(ids(v), ['a']);
});

test('an edited cut that no longer exists is simply absent', () => {
    assert.deepEqual(ids(visibleCutsAt(doc(), 9, 'gone', false)), []);
});

test('onion neighbours are the cuts either side on the same track', () => {
    const cuts = [cut('a', 0, 2), cut('b', 2, 4), cut('c', 4, 6)];
    const { prev, next } = onionNeighbours(cuts, cuts[1]);
    assert.equal(prev.id, 'a');
    assert.equal(next.id, 'c');
});

test('onion ignores other tracks', () => {
    // A cut on another track is a different element of the same shot, not the previous frame.
    const cuts = [cut('a', 0, 2), cut('b', 2, 4), cut('other', 0, 2, 1), cut('other2', 4, 6, 1)];
    const { prev, next } = onionNeighbours(cuts, cuts[1]);
    assert.equal(prev.id, 'a');
    assert.equal(next, null);
});

test('next starts at endTime, because cuts abut', () => {
    // A strict comparison would find nothing in the common case, which is every hand-drawn
    // sequence ever made in this app.
    const cuts = [cut('a', 0, 2), cut('b', 2, 4)];
    assert.equal(onionNeighbours(cuts, cuts[0]).next.id, 'b');
});

test('the ends of a sequence have one neighbour each', () => {
    const cuts = [cut('a', 0, 2), cut('b', 2, 4)];
    assert.equal(onionNeighbours(cuts, cuts[0]).prev, null);
    assert.equal(onionNeighbours(cuts, cuts[1]).next, null);
});

test('onion of nothing is nothing', () => {
    assert.deepEqual(onionNeighbours([], null), { prev: null, next: null });
    assert.deepEqual(onionNeighbours(null, undefined), { prev: null, next: null });
});

test('the playhead selects the topmost cut it is over', () => {
    // Upper tracks are what a click would land on, so that is what following the playhead picks.
    assert.equal(topCutAt(doc(), 1.5).id, 'over');
    assert.equal(topCutAt(doc(), 0.5).id, 'a');
    assert.equal(topCutAt(doc(), 99), null);
});
