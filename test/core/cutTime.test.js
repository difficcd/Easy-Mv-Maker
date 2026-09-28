// How long a cut lasts, how far through it a moment is, and the same for a whole part.

import test from 'node:test';
import assert from 'node:assert/strict';
import { partSpan, spanProgress } from '../../src/core/cutTime.ts';

// --- a part's span, for a camera that travels across one (#349) --------------------------------

test('partSpan: earliest start to latest end of the cuts carrying that id', () => {
    const cuts = [
        { id: 1, startTime: 0, endTime: 1, partId: 'a' },
        { id: 2, startTime: 1, endTime: 2, partId: 'b' },
        { id: 3, startTime: 2, endTime: 3, partId: 'a' },
    ];
    assert.deepEqual(partSpan(cuts, 'a'), { start: 0, end: 3 }, 'spans the gap the other part sits in');
    assert.deepEqual(partSpan(cuts, 'b'), { start: 1, end: 2 });
});

test('partSpan: an id that names nothing is null, not a zero-length span', () => {
    // The caller falls back to the cut it already had; a span of zero would divide by it.
    const cuts = [{ id: 1, startTime: 0, endTime: 1, partId: 'a' }];
    assert.equal(partSpan(cuts, 'nope'), null);
    assert.equal(partSpan(cuts, null), null);
    assert.equal(partSpan(cuts, undefined), null);
    assert.equal(partSpan([], 'a'), null);
    assert.equal(partSpan(null, 'a'), null);
});

test('partSpan: cuts out of order still give the outer bounds', () => {
    const cuts = [
        { id: 1, startTime: 5, endTime: 6, partId: 'a' },
        { id: 2, startTime: 1, endTime: 2, partId: 'a' },
    ];
    assert.deepEqual(partSpan(cuts, 'a'), { start: 1, end: 6 });
});

test('spanProgress: 0 at the start, 1 at the end, clamped outside', () => {
    const s = { start: 2, end: 6 };
    assert.equal(spanProgress(s, 2), 0);
    assert.equal(spanProgress(s, 4), 0.5);
    assert.equal(spanProgress(s, 6), 1);
    assert.equal(spanProgress(s, -100), 0);
    assert.equal(spanProgress(s, 100), 1);
});

test('spanProgress: a part whose cuts all sit at one instant does not divide by zero', () => {
    const p = spanProgress({ start: 3, end: 3 }, 3);
    assert.ok(Number.isFinite(p), `got ${p}`);
});
