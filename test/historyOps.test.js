// Undo/redo. Small arithmetic, entirely off-by-one shaped: every operation has to leave the
// index pointing at the snapshot that is on screen. The three that can break that are trimming
// the redo branch, dropping the oldest entry when full, and stepping at either end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pushSnapshot, canUndo, canRedo, step, limitFor, HISTORY_LIMIT } from '../src/historyOps.js';

// Build a history by pushing in order, the way the app does.
const build = (...snaps) => snaps.reduce(
    (acc, s) => { const r = pushSnapshot(acc.history, acc.index, s); return { history: r.history, index: r.index }; },
    { history: [], index: -1 },
);

test('pushSnapshot: the index always points at what was just recorded', () => {
    const { history, index } = build({ n: 1 }, { n: 2 }, { n: 3 });
    assert.equal(history.length, 3);
    assert.equal(index, 2);
    assert.deepEqual(history[index], { n: 3 });
});

test('pushSnapshot: recording the same state again is not an undo step', () => {
    const a = build({ n: 1 });
    const r = pushSnapshot(a.history, a.index, { n: 1 });
    assert.equal(r.changed, false);
    assert.equal(r.history.length, 1, 'nothing was added');
    assert.equal(r.index, a.index);
});

test('pushSnapshot: same values in a different order still count as the same state', () => {
    // Snapshots are compared as JSON because that is how they are stored, so this is about
    // pinning down what that actually means rather than claiming it is deep equality.
    const a = build({ x: 1, y: 2 });
    assert.equal(pushSnapshot(a.history, a.index, { x: 1, y: 2 }).changed, false, 'identical: no entry');
    assert.equal(pushSnapshot(a.history, a.index, { y: 2, x: 1 }).changed, true, 'key order differs: recorded');
});

test('pushSnapshot: a new action after undoing drops the branch that was undone past', () => {
    // Otherwise redo would jump forward into a future that never happened.
    const built = build({ n: 1 }, { n: 2 }, { n: 3 });
    const back = step(built.history, built.index, -1);   // index 1
    const r = pushSnapshot(built.history, back.index, { n: 9 });
    assert.deepEqual(r.history.map(s => s.n), [1, 2, 9]);
    assert.equal(r.index, 2);
    assert.equal(canRedo(r.history, r.index), false, 'nothing to redo into');
});

test('pushSnapshot: the oldest is dropped when full, and the index comes down with it', () => {
    let acc = { history: [], index: -1 };
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
        const r = pushSnapshot(acc.history, acc.index, { n: i }, HISTORY_LIMIT);
        acc = { history: r.history, index: r.index };
    }
    assert.equal(acc.history.length, HISTORY_LIMIT, 'capped');
    assert.equal(acc.index, HISTORY_LIMIT - 1, 'still pointing at the newest');
    assert.deepEqual(acc.history[acc.index], { n: HISTORY_LIMIT + 9 });
    assert.deepEqual(acc.history[0], { n: 10 }, 'the oldest ten fell off the front');
});

// ── how far back undo reaches ──────────────────────────────────────────────
// A snapshot copies the whole document, so the limit that matters is memory, not a step count.

test('limitFor: a light project gets far more undo than a heavy one', () => {
    const light = limitFor(2 * 1024);          // a few strokes
    const heavy = limitFor(2 * 1024 * 1024);   // a long, dense drawing
    assert.ok(light > heavy, `${light} > ${heavy}`);
    assert.ok(light >= 100, 'a small project should not run out of undo at eighty steps');
});

test('limitFor: the budget is respected, between the two bounds', () => {
    // As many 10KiB snapshots as fit in 1MiB.
    assert.equal(limitFor(10 * 1024, 1024 * 1024), 102);
    assert.equal(limitFor(1, 1024 * 1024), 400, 'but never unbounded');
    assert.equal(limitFor(1024 * 1024 * 1024, 1024 * 1024), 20, 'and never so few as to be useless');
});

test('limitFor: a zero-sized snapshot does not divide by zero', () => {
    assert.equal(limitFor(0), 400);
});

test('pushSnapshot: sizes its own limit when none is given', () => {
    // A huge snapshot should fall back to the minimum rather than the maximum.
    const big = { blob: 'x'.repeat(2 * 1024 * 1024) };
    let acc = { history: [], index: -1 };
    for (let i = 0; i < 30; i++) {
        const r = pushSnapshot(acc.history, acc.index, { ...big, n: i });
        acc = { history: r.history, index: r.index };
    }
    assert.ok(acc.history.length <= 20, `heavy snapshots were capped low (${acc.history.length})`);
    assert.equal(acc.index, acc.history.length - 1, 'and the index still points at the newest');
    assert.equal(acc.history[acc.index].n, 29);
});

test('pushSnapshot: a smaller limit still leaves the index on the newest', () => {
    let acc = { history: [], index: -1 };
    for (let i = 0; i < 5; i++) {
        const r = pushSnapshot(acc.history, acc.index, { n: i }, 3);
        acc = { history: r.history, index: r.index };
    }
    assert.deepEqual(acc.history.map(s => s.n), [2, 3, 4]);
    assert.equal(acc.index, 2);
});

test('pushSnapshot: stores a copy, so later edits to the live state do not rewrite the past', () => {
    const live = { cuts: [{ id: 1 }] };
    const r = pushSnapshot([], -1, live);
    live.cuts[0].id = 999;
    assert.equal(r.history[0].cuts[0].id, 1);
});

test('pushSnapshot: does not modify the list it was given', () => {
    const a = build({ n: 1 }, { n: 2 });
    const before = JSON.stringify(a.history);
    pushSnapshot(a.history, 0, { n: 9 });   // would trim the branch if it mutated
    assert.equal(JSON.stringify(a.history), before);
});

test('canUndo/canRedo: the first snapshot is the original state, not a step back to', () => {
    const one = build({ n: 1 });
    assert.equal(canUndo(one.history, one.index), false, 'nothing before the first');
    assert.equal(canRedo(one.history, one.index), false);
    const two = build({ n: 1 }, { n: 2 });
    assert.equal(canUndo(two.history, two.index), true);
    assert.equal(canRedo(two.history, two.index), false, 'already at the newest');
});

test('canUndo/canRedo: an empty history offers neither', () => {
    assert.equal(canUndo([], -1), false);
    assert.equal(canRedo([], -1), false);
    assert.equal(canRedo(undefined, -1), false);
});

test('step: walks back and forward over the same snapshots', () => {
    const { history, index } = build({ n: 1 }, { n: 2 }, { n: 3 });
    const b1 = step(history, index, -1);
    assert.deepEqual([b1.index, b1.snapshot], [1, { n: 2 }]);
    const b2 = step(history, b1.index, -1);
    assert.deepEqual([b2.index, b2.snapshot], [0, { n: 1 }]);
    const f1 = step(history, b2.index, 1);
    assert.deepEqual([f1.index, f1.snapshot], [1, { n: 2 }]);
});

test('step: returns null at either end rather than an out-of-range index', () => {
    const { history, index } = build({ n: 1 }, { n: 2 });
    assert.equal(step(history, index, 1), null, 'no redo at the newest');
    assert.equal(step(history, 0, -1), null, 'no undo at the original');
    assert.equal(step([], -1, -1), null);
    assert.equal(step([], -1, 1), null);
});

test('undo then redo lands exactly where it started', () => {
    const { history, index } = build({ n: 1 }, { n: 2 }, { n: 3 });
    const back = step(history, index, -1);
    const fwd = step(history, back.index, 1);
    assert.equal(fwd.index, index);
    assert.deepEqual(fwd.snapshot, history[index]);
});
