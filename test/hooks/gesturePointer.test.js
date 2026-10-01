import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerIsOwner } from '../../src/hooks/useGesture.ts';

// #338, the "strokes break up on the tablet" half.
//
// A PC has one pointer, so every event on the canvas belonged to the stroke being drawn and no
// handler had to ask. A tablet has several: the pen, and the palm resting on the glass beside
// it. `startDraw` refused to *begin* a gesture from a touch - that is the palm rejection that
// has always been there - but nothing stopped a touch from feeding the gesture already running.
//
// So while the pen drew: the palm's moves were appended to the pen's stroke as points, putting a
// jump across the drawing, and the palm lifting ran stopDraw and committed the stroke early. The
// pen then went on moving over a gesture that had ended, drawing nothing until it was lifted and
// put down again. A line in pieces, only ever on the tablet.

test('while a gesture is in flight, only the pointer that began it is its own', () => {
    assert.equal(pointerIsOwner(true, 1, 1), true);
    assert.equal(pointerIsOwner(true, 1, 2), false, 'the palm got to drive the pen\'s stroke');
});

test('with nothing in flight every pointer passes, so hovering still updates the cursor', () => {
    // onDraw does its hover work through the same guard. Refusing a pointer here would leave the
    // cursor stale over a selection's resize handles, which is the bug the hover branch fixed.
    assert.equal(pointerIsOwner(false, null, 7), true);
    assert.equal(pointerIsOwner(false, 1, 7), true, 'not drawing: an owner left over is not a reason to refuse');
});

test('a call made from code, with no event to name, is always allowed through', () => {
    // onPointerLeaveCanvas ends a stroke without an event. If the guard refused those, leaving
    // the canvas mid-stroke would no longer stop drawing.
    assert.equal(pointerIsOwner(true, 1, undefined), true);
    assert.equal(pointerIsOwner(true, 1, null), true);
});

test('pointer id 0 is a real pointer, not a missing one', () => {
    // The guard cannot test `eventId` for truthiness: a first pointer is legitimately id 0 on
    // some browsers, and `!0` would hand every stroke to whichever pointer came second.
    assert.equal(pointerIsOwner(true, 0, 0), true);
    assert.equal(pointerIsOwner(true, 0, 3), false);
    assert.equal(pointerIsOwner(true, 3, 0), false);
});
