import test from 'node:test';
import assert from 'node:assert/strict';
import { BRUSH_MIN, BRUSH_MAX, clampBrush, brushUp, brushDown } from '../src/core/brushSize.js';

test('the range holds, from either direction', () => {
    assert.equal(clampBrush(0), BRUSH_MIN);
    assert.equal(clampBrush(-40), BRUSH_MIN);
    assert.equal(clampBrush(9999), BRUSH_MAX);
    assert.equal(clampBrush(BRUSH_MIN), BRUSH_MIN);
    assert.equal(clampBrush(BRUSH_MAX), BRUSH_MAX);
});

test('a width is always a whole number, and never NaN', () => {
    assert.equal(clampBrush(7.4), 7);
    assert.equal(clampBrush(7.6), 8);
    assert.equal(clampBrush(NaN), BRUSH_MIN);
    assert.equal(clampBrush(undefined), BRUSH_MIN);
});

// The bug: 2 / 1.25 is 1.6, which rounds back to 2. The shortcut for a smaller brush did nothing
// at all at size 2, and the way up had a +1 for exactly this reason with nothing to match it.
test('the shortcut always moves, at every size in the range', () => {
    for (let s = BRUSH_MIN; s <= BRUSH_MAX; s++) {
        if (s < BRUSH_MAX) assert.ok(brushUp(s) > s, `up from ${s} went to ${brushUp(s)}`);
        if (s > BRUSH_MIN) assert.ok(brushDown(s) < s, `down from ${s} stayed at ${brushDown(s)}`);
    }
});

test('size 2 in particular, which is where it was stuck', () => {
    assert.equal(brushDown(2), 1);
    assert.equal(Math.round(2 / 1.25), 2, 'the old formula, for the record');
});

test('the ends hold rather than stepping out of range', () => {
    assert.equal(brushDown(BRUSH_MIN), BRUSH_MIN);
    assert.equal(brushUp(BRUSH_MAX), BRUSH_MAX);
});

test('stepping up then down does not run away in either direction', () => {
    let s = 5;
    for (let i = 0; i < 40; i++) s = brushUp(s);
    assert.equal(s, BRUSH_MAX);
    for (let i = 0; i < 200; i++) s = brushDown(s);
    assert.equal(s, BRUSH_MIN);
});

test('the way up is unchanged - only the way down was broken', () => {
    const old = (s) => Math.max(1, Math.min(200, Math.round(s * 1.25) + 1));
    for (let s = BRUSH_MIN; s <= BRUSH_MAX; s++) assert.equal(brushUp(s), old(s), `up from ${s}`);
});
