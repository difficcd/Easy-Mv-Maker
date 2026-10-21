import test from 'node:test';
import assert from 'node:assert/strict';
import { planPress } from '../../src/core/pressPlan.ts';

// What a pen press on the canvas starts. This was the opening of App's startDraw - a chain of
// early returns whose *order* is the behaviour - and the draw handlers were the largest cluster
// of fixes inside App: startDraw, onDraw and stopDraw were changed by 21 fix commits, 11 of them
// in the last 45 days (docs/process/2026-10-21.md). Every rule below was written down only as a
// comment beside its `if`; now each is a test, and a reordering fails here instead of on a tablet.

/** A press with a pen, a layer to draw on, and nothing else going on. */
const press = (over = {}) => ({
    spaceHeld: false, button: 0, panning: false, pointerType: 'pen',
    pickingColour: false, recordingPath: false, hasDrawLayer: true,
    editingText: false, hasSelection: false, tool: 'pen', etool: 'pen',
    ...over,
});

test('an ordinary press goes to the tool', () => {
    assert.deepEqual(planPress(press()), { offerSelection: false, route: 'tool' });
});

test('panning beats everything, the eyedropper included', () => {
    // Space, the middle button or a pan already under way belong to the canvas area, not to
    // drawing - the press must not also pick a colour or start a stroke.
    for (const over of [{ spaceHeld: true }, { button: 1 }, { panning: true }]) {
        assert.deepEqual(planPress(press({ ...over, pickingColour: true })), { stop: 'pan' }, JSON.stringify(over));
    }
});

test('a finger never draws, whatever the tool', () => {
    // Palm rejection: a finger navigates. Checked before the eyedropper, so a palm on the glass
    // cannot pick a colour either.
    assert.deepEqual(planPress(press({ pointerType: 'touch' })), { stop: 'touch' });
    assert.deepEqual(planPress(press({ pointerType: 'touch', pickingColour: true })), { stop: 'touch' });
    assert.deepEqual(planPress(press({ pointerType: 'mouse' })).route, 'tool');
});

test('the eyedropper takes the press before a path recording does', () => {
    assert.deepEqual(planPress(press({ pickingColour: true, recordingPath: true })), { stop: 'pick-colour' });
});

test('a path records even when there is no layer to draw on', () => {
    // A camera path belongs to the cut, not to a layer, so it is checked before the layer is
    // resolved - it has to work on a cut whose active layer is a folder or hidden.
    assert.deepEqual(planPress(press({ recordingPath: true, hasDrawLayer: false })), { stop: 'record-path' });
});

test('with no layer to draw on, nothing starts', () => {
    assert.deepEqual(planPress(press({ hasDrawLayer: false })), { stop: 'no-layer' });
});

test('while a text is being edited, the canvas ignores presses', () => {
    // Even with a selection: the editor owns the press.
    assert.deepEqual(planPress(press({ editingText: true, hasSelection: true })), { stop: 'editing-text' });
});

test('a selection is offered the press first, whatever the tool', () => {
    // It decides whether the press is a handle or a drag; if it declines, the caller commits
    // the selection and carries on to the tool - that is what the route is for.
    for (const tool of ['pen', 'text', 'move', 'eraser']) {
        const plan = planPress(press({ hasSelection: true, tool, etool: tool }));
        assert.equal(plan.offerSelection, true, tool);
    }
});

test('the text and move tools have their own routes', () => {
    assert.equal(planPress(press({ tool: 'text', etool: 'text' })).route, 'text');
    assert.equal(planPress(press({ tool: 'move', etool: 'move' })).route, 'move');
});

test('the curve ruler is chosen by the effective tool, text by the selected one', () => {
    // The pen and the ruler share a button, so whether a press places a curve anchor depends on
    // the tool that button resolves to (etool); the text tool is never resolved. Pinned because
    // swapping the two reads is an easy edit to make and would route presses wrongly.
    assert.equal(planPress(press({ tool: 'pen', etool: 'curve' })).route, 'curve');
    assert.equal(planPress(press({ tool: 'curve', etool: 'pen' })).route, 'tool');
});
