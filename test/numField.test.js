import test from 'node:test';
import assert from 'node:assert/strict';
import { clampNum, liveNumber, commitNumber } from '../src/numInput.js';

// The bug these guard against: a number field that clamps on every keystroke cannot be typed
// into. The split is liveNumber (what to report mid-edit, never clamped) versus commitNumber
// (what to settle on when the field is left, clamped).

test('clampNum honours only the bounds it is given', () => {
    assert.equal(clampNum(5, 6, 400), 6);
    assert.equal(clampNum(500, 6, 400), 400);
    assert.equal(clampNum(100, 6, 400), 100);
    assert.equal(clampNum(-50, undefined, 400), -50, 'no minimum means no lower bound');
    assert.equal(clampNum(9e9, 0, undefined), 9e9, 'no maximum means no upper bound');
});

test('typing 100 into a field with a minimum of 6 is not fought at any keystroke', () => {
    // This is the exact sequence that used to produce 6 -> 60 -> 400.
    assert.equal(liveNumber('1'), 1);
    assert.equal(liveNumber('10'), 10);
    assert.equal(liveNumber('100'), 100);
    assert.equal(commitNumber('100', { min: 6, max: 400, fallback: 36 }), 100);
});

test('liveNumber holds on text that is not a number yet', () => {
    for (const raw of ['', ' ', '-', '.', '+', '1e', 'abc', '--3']) {
        assert.equal(liveNumber(raw), null, `${JSON.stringify(raw)} should report nothing`);
    }
});

test('liveNumber accepts the partial forms a keyboard produces', () => {
    assert.equal(liveNumber('1.'), 1);
    assert.equal(liveNumber('.5'), 0.5);
    assert.equal(liveNumber('-12'), -12);
    assert.equal(liveNumber(' 7 '), 7);
    assert.equal(liveNumber('0'), 0, 'zero is a value, not an absence of one');
});

test('liveNumber does not clamp - the caller guards, the field does not interrupt', () => {
    assert.equal(liveNumber('1'), 1);
    assert.equal(liveNumber('99999'), 99999);
});

test('commitNumber falls back when the field is left empty or unreadable', () => {
    assert.equal(commitNumber('', { min: 6, max: 400, fallback: 36 }), 36);
    assert.equal(commitNumber('abc', { fallback: 12 }), 12);
    assert.equal(commitNumber('-', { fallback: 12 }), 12);
});

test('commitNumber applies the range once, at the end', () => {
    assert.equal(commitNumber('1', { min: 6, max: 400, fallback: 36 }), 6);
    assert.equal(commitNumber('9999', { min: 6, max: 400, fallback: 36 }), 400);
    assert.equal(commitNumber('42.5', { min: 0, fallback: 0 }), 42.5);
});

test('commitNumber with no options at all still returns a number', () => {
    assert.equal(commitNumber('3'), 3);
    assert.equal(commitNumber('nope'), 0);
});
