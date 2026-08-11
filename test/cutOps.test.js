// Timeline drag and resize maths. This lived inside a pointer-move handler, so the snapping
// thresholds and the overlap rules could only ever be checked by dragging cuts around by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dragCut, resizeCut } from '../src/cutOps.js';

const PPS = 50;                       // pixels per second; 8px snap ≈ 0.16s
const cut = (id, start, end, track = 0) => ({ id, startTime: start, endTime: end, track });
const at = (out, id) => out.cuts.find(c => c.id === id);

// A: 0-1s, B: 2-3s, both on track 0.
const base = () => [cut('A', 0, 1), cut('B', 2, 3)];

// ── dragging ───────────────────────────────────────────────────────────────
test('dragCut: a free move lands exactly where it was dropped', () => {
    const out = dragCut([cut('A', 0, 1)], { cutId: 'A', initialStart: 0, initialTrack: 0 }, 5, 0, 3, PPS);
    assert.equal(at(out, 'A').startTime, 5);
    assert.equal(at(out, 'A').endTime, 6, 'duration is preserved');
    assert.equal(out.snapAt, null, 'nothing to snap to');
});

test('dragCut: the leading edge snaps to a neighbour', () => {
    // Dropped at 3.02s, which is 1px from B's end at 3s.
    const out = dragCut(base(), { cutId: 'A', initialStart: 0, initialTrack: 0 }, 3.02, 0, 3, PPS);
    assert.equal(at(out, 'A').startTime, 3, 'pulled onto the edge');
    assert.equal(out.snapAt, 3, 'and the guide is drawn there');
});

test('dragCut: the trailing edge can snap too', () => {
    // A is 1s long; starting at 0.98 puts its end at 1.98, near B's start at 2.
    const out = dragCut(base(), { cutId: 'A', initialStart: 0, initialTrack: 0 }, 0.98, 0, 3, PPS);
    assert.equal(at(out, 'A').endTime, 2, 'the end landed on B');
    assert.equal(out.snapAt, 2);
});

test('dragCut: far from an edge, nothing snaps', () => {
    const out = dragCut(base(), { cutId: 'A', initialStart: 0, initialTrack: 0 }, 4.5, 0, 3, PPS);
    assert.equal(at(out, 'A').startTime, 4.5);
    assert.equal(out.snapAt, null);
});

test('dragCut: cuts may not overlap - the cut is pushed clear', () => {
    // Dropped squarely on top of B (2-3).
    const out = dragCut(base(), { cutId: 'A', initialStart: 0, initialTrack: 0 }, 2.4, 0, 3, PPS);
    const a = at(out, 'A');
    const overlaps = a.startTime < 3 && a.endTime > 2;
    assert.equal(overlaps, false, `A (${a.startTime}-${a.endTime}) must not sit on B (2-3)`);
    assert.equal(out.snapAt, null, 'a push is not a snap, so no guide');
});

test('dragCut: never starts before zero', () => {
    const out = dragCut([cut('A', 5, 6)], { cutId: 'A', initialStart: 5, initialTrack: 0 }, -100, 0, 3, PPS);
    assert.equal(at(out, 'A').startTime, 0);
});

test('dragCut: the track is clamped to the tracks that exist', () => {
    const c = [cut('A', 0, 1)];
    assert.equal(at(dragCut(c, { cutId: 'A', initialStart: 0, initialTrack: 0 }, 0, 9, 3, PPS), 'A').track, 2);
    assert.equal(at(dragCut(c, { cutId: 'A', initialStart: 0, initialTrack: 0 }, 0, -9, 3, PPS), 'A').track, 0);
});

test('dragCut: a cut on another track is not an obstacle', () => {
    const cuts = [cut('A', 0, 1, 0), cut('B', 2, 3, 1)];
    const out = dragCut(cuts, { cutId: 'A', initialStart: 0, initialTrack: 0 }, 2.4, 0, 3, PPS);
    assert.equal(at(out, 'A').startTime, 2.4, 'B is on track 1, so it does not block');
});

test('dragCut: an unknown cut changes nothing', () => {
    const cuts = base();
    const out = dragCut(cuts, { cutId: 'nope', initialStart: 0, initialTrack: 0 }, 5, 0, 3, PPS);
    assert.equal(out.cuts, cuts);
    assert.equal(out.snapAt, null);
});

// ── resizing ───────────────────────────────────────────────────────────────
test('resizeCut: dragging the right edge extends the cut', () => {
    const out = resizeCut([cut('A', 0, 1)], { cutId: 'A', edge: 'right', initialStart: 0, initialEnd: 1 }, 2, PPS);
    assert.equal(at(out, 'A').endTime, 3);
    assert.equal(at(out, 'A').startTime, 0, 'the other edge is untouched');
});

test('resizeCut: dragging the left edge moves the start only', () => {
    const out = resizeCut([cut('A', 1, 3)], { cutId: 'A', edge: 'left', initialStart: 1, initialEnd: 3 }, 0.5, PPS);
    assert.equal(at(out, 'A').startTime, 1.5);
    assert.equal(at(out, 'A').endTime, 3);
});

test('resizeCut: a cut cannot be inverted or collapsed', () => {
    // Drag the left edge far past the right one.
    const left = resizeCut([cut('A', 0, 1)], { cutId: 'A', edge: 'left', initialStart: 0, initialEnd: 1 }, 99, PPS);
    const a = at(left, 'A');
    assert.ok(a.startTime < a.endTime, `start ${a.startTime} must stay before end ${a.endTime}`);

    // And the right edge past the left one.
    const right = resizeCut([cut('A', 2, 3)], { cutId: 'A', edge: 'right', initialStart: 2, initialEnd: 3 }, -99, PPS);
    const b = at(right, 'A');
    assert.ok(b.endTime > b.startTime, `end ${b.endTime} must stay after start ${b.startTime}`);
});

test('resizeCut: the left edge stops at a neighbour that ends before it', () => {
    // B ends at 3; A runs 4-5 and its left edge is dragged back to 2.
    const cuts = [cut('B', 2, 3), cut('A', 4, 5)];
    const out = resizeCut(cuts, { cutId: 'A', edge: 'left', initialStart: 4, initialEnd: 5 }, -2, PPS);
    assert.ok(at(out, 'A').startTime >= 3, 'A must not swallow B');
});

test('resizeCut: the right edge stops at a neighbour that starts after it', () => {
    const cuts = [cut('A', 0, 1), cut('B', 2, 3)];
    const out = resizeCut(cuts, { cutId: 'A', edge: 'right', initialStart: 0, initialEnd: 1 }, 5, PPS);
    assert.ok(at(out, 'A').endTime <= 2, 'A must not run into B');
});

test('resizeCut: edges snap to neighbours', () => {
    const cuts = [cut('A', 0, 1), cut('B', 2, 3)];
    // Right edge dragged to 1.98, within the snap radius of B's start at 2.
    const out = resizeCut(cuts, { cutId: 'A', edge: 'right', initialStart: 0, initialEnd: 1 }, 0.98, PPS);
    assert.equal(at(out, 'A').endTime, 2);
    assert.equal(out.snapAt, 2);
});

test('resizeCut: an unknown cut changes nothing', () => {
    const cuts = base();
    const out = resizeCut(cuts, { cutId: 'nope', edge: 'left', initialStart: 0, initialEnd: 1 }, 1, PPS);
    assert.equal(out.cuts, cuts);
});
