import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRotateDrag } from '../src/core/lassoOps.js';
import { rotateKnob, ROTATE_STEM_PX } from '../src/canvas/warpRender.js';

/** A 100x100 box at the origin, so its centre is (50, 50). */
const box = { tx: 0, ty: 0, tw: 100, th: 100 };
const deg = (rad) => (rad * 180) / Math.PI;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('dragging a quarter turn round the centre rotates by ninety degrees', () => {
    // Start directly above the centre, end directly to its right: a quarter turn clockwise.
    const { rot } = applyRotateDrag(box, { x: 50, y: 0 }, { x: 100, y: 50 });
    assert.ok(near(deg(rot), 90), `${deg(rot)}°`);
});

test('it adds to the rotation the box already had', () => {
    const quarter = Math.PI / 2;
    const { rot } = applyRotateDrag({ ...box, rot: quarter }, { x: 50, y: 0 }, { x: 100, y: 50 });
    // Half a turn. The fold is [-pi, pi), so exactly half comes back as -180 rather than +180 -
    // the same picture either way, and the slider has both ends.
    assert.ok(near(Math.abs(deg(rot)), 180), `${deg(rot)}°`);
});

test('not moving does not rotate, wherever the knob was grabbed', () => {
    // Taken from the start angle rather than accumulated, so grabbing the knob off-centre must
    // not make the box jump round to meet the pointer.
    for (const p of [{ x: 50, y: -30 }, { x: 62, y: -25 }, { x: 10, y: 10 }]) {
        assert.equal(applyRotateDrag(box, p, p).rot, 0);
    }
});

test('the result stays in the range the slider shows', () => {
    // The slider is ±180°. Anything outside would be clamped on display and the two would
    // disagree about what the selection is doing.
    const angles = [0, 1, 2, 3, -1, -2, -3];
    for (const start of angles) {
        for (const end of angles) {
            const { rot } = applyRotateDrag(
                { ...box, rot: start },
                { x: 50 + 40 * Math.cos(start), y: 50 + 40 * Math.sin(start) },
                { x: 50 + 40 * Math.cos(end), y: 50 + 40 * Math.sin(end) },
            );
            assert.ok(rot >= -Math.PI - 1e-9 && rot < Math.PI + 1e-9, `${rot} out of range`);
        }
    }
});

test('past half a turn it wraps rather than flipping to a different picture', () => {
    // 190° and -170° draw the same thing, so the wrap is invisible - this pins that the value
    // stays in range rather than asserting a sign nobody can see.
    const { rot } = applyRotateDrag(box, { x: 50, y: 0 }, { x: 50, y: 100 + 1 });
    assert.ok(Math.abs(rot) <= Math.PI + 1e-9);
});

test('a drag through the centre does not produce NaN', () => {
    // atan2(0, 0) is 0 rather than NaN, but this is the input a shaky pen actually produces.
    const { rot } = applyRotateDrag(box, { x: 50, y: 50 }, { x: 50, y: 50 });
    assert.ok(Number.isFinite(rot));
});

test('the knob sits a stem above the top edge, in screen pixels', () => {
    const plain = { x: 0, y: 0, w: 100, h: 100 };
    // At zoom 1 the stem is its screen length; zoomed in it is shorter in canvas units, so it
    // stays the same distance away on screen instead of drifting off it.
    assert.deepEqual(rotateKnob(plain, 1), { x: 50, y: -ROTATE_STEM_PX });
    assert.deepEqual(rotateKnob(plain, 2), { x: 50, y: -ROTATE_STEM_PX / 2 });
});

test('the knob orbits with the box rather than staying above it', () => {
    // Half a turn should put the knob below the box - if it did not follow the rotation it
    // would read as a button that happens to be up there, not as part of the selection.
    const turned = rotateKnob({ x: 0, y: 0, w: 100, h: 100, rot: Math.PI }, 1);
    assert.ok(near(turned.x, 50, 1e-9), `x ${turned.x}`);
    assert.ok(turned.y > 100, `expected below the box, got y ${turned.y}`);
});
