import test from 'node:test';
import assert from 'node:assert/strict';
import { textAnimStep, charAnimAt, computeTextAnim, TEXT_ANIM_DEFAULT } from '../src/canvas/canvasUtils.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('a settled character has moved nowhere and is fully opaque', () => {
    for (const type of ['fade', 'up', 'down', 'scale', 'blur']) {
        const s = textAnimStep(type, 1, 1);
        assert.equal(s.alpha, 1, type);
        assert.equal(s.dx, 0, type);
        assert.equal(s.dy, 0, type);
        assert.equal(s.scale, 1, type);
        assert.equal(s.blur, 0, type);
    }
});

test('an unknown motion is null rather than a silent no-op object', () => {
    assert.equal(textAnimStep('none', 0.5, 1), null);
    assert.equal(textAnimStep('spiral', 0.5, 1), null);
});

test('up moves upward both ways: from below entering, away above leaving', () => {
    assert.ok(textAnimStep('up', 0, 1).dy > 0, 'enters from below');
    assert.ok(textAnimStep('up', 0, -1).dy < 0, 'leaves upward');
});

test('down is the mirror of up', () => {
    assert.equal(textAnimStep('down', 0.3, 1).dy, -textAnimStep('up', 0.3, 1).dy);
});

test('scale and blur do not care which direction they are going', () => {
    assert.deepEqual(textAnimStep('scale', 0.4, 1), textAnimStep('scale', 0.4, -1));
    assert.deepEqual(textAnimStep('blur', 0.4, 1), textAnimStep('blur', 0.4, -1));
});

// --- the stagger -------------------------------------------------------------------------------

test('with no spread every character is at the same point in the entrance', () => {
    const p = { spread: 0, inType: 'fade', inU: 0.5 };
    const a = charAnimAt(p, 0, 5), b = charAnimAt(p, 4, 5);
    assert.ok(close(a.alpha, b.alpha));
});

test('the first character leads and the last trails', () => {
    const p = { spread: 0.6, inType: 'fade', inU: 0.5 };
    const first = charAnimAt(p, 0, 6).alpha;
    const last = charAnimAt(p, 5, 6).alpha;
    assert.ok(first > last, `${first} should lead ${last}`);
});

test('by the end of the entrance every character has arrived', () => {
    const p = { spread: 0.9, inType: 'down', inU: 1 };
    for (let i = 0; i < 8; i++) {
        const c = charAnimAt(p, i, 8);
        assert.ok(close(c.alpha, 1), `char ${i} alpha ${c.alpha}`);
        assert.ok(close(c.dy, 0), `char ${i} dy ${c.dy}`);
    }
});

test('at the start of a staggered entrance nothing has arrived', () => {
    const p = { spread: 0.5, inType: 'fade', inU: 0 };
    for (let i = 0; i < 4; i++) assert.equal(charAnimAt(p, i, 4).alpha, 0);
});

test('a single character is not divided by zero', () => {
    const c = charAnimAt({ spread: 0.8, inType: 'up', inU: 0.5 }, 0, 1);
    assert.ok(Number.isFinite(c.alpha) && Number.isFinite(c.dy));
});

test('characters fall in from above with the down entrance', () => {
    const p = { spread: 0.6, inType: 'down', inU: 0.3 };
    const c = charAnimAt(p, 0, 5);
    assert.ok(c.dy < 0, 'starts above where it lands');
});

test('the character that arrived first is also the first to leave', () => {
    const p = { spread: 0.5, inType: 'fade', inU: 1, outType: 'fade', outU: 0.5 };
    const first = charAnimAt(p, 0, 4).alpha;
    const last = charAnimAt(p, 3, 4).alpha;
    assert.ok(first < last, `${first} should be further gone than ${last}`);
});

test('an entrance and an exit both staggered compose into one set of values', () => {
    // Mid-exit for a character in the middle: fully entered, partly gone.
    const both = charAnimAt({ spread: 0.5, inType: 'fade', inU: 1, outType: 'fade', outU: 0.4 }, 2, 4);
    assert.ok(both.alpha > 0 && both.alpha < 1, `alpha was ${both.alpha}`);
});

// --- what computeTextAnim hands over -----------------------------------------------------------

const cut = { startTime: 0, endTime: 2 };
const withAnim = (over) => ({ anim: { ...TEXT_ANIM_DEFAULT, ...over } });

test('no stagger means no perChar, and the block animates as it always did', () => {
    const a = computeTextAnim(withAnim({ inType: 'fade', inDur: 1 }), cut, 0.5);
    assert.equal(a.perChar, null);
    assert.ok(a.alpha > 0 && a.alpha < 1, 'the block itself is fading');
});

test('a stagger moves the entrance off the block and onto the characters', () => {
    const a = computeTextAnim(withAnim({ inType: 'fade', inDur: 1, charStagger: 0.6 }), cut, 0.5);
    assert.equal(a.alpha, 1, 'the block is left at rest');
    assert.equal(a.dy, 0);
    assert.ok(a.perChar, 'and the characters are given the progress');
    assert.equal(a.perChar.inType, 'fade');
    assert.ok(close(a.perChar.inU, 0.5));
    assert.equal(a.perChar.spread, 0.6);
});

test('past the entrance there is nothing left to stagger', () => {
    const a = computeTextAnim(withAnim({ inType: 'fade', inDur: 0.4, charStagger: 0.6 }), cut, 1.0);
    assert.equal(a.perChar, null);
});

test('emphasis stays on the block: it is a loop, not an entrance', () => {
    const a = computeTextAnim(withAnim({ emphasis: 'pulse', emAmount: 40, charStagger: 0.6 }), cut, 0.3);
    assert.notEqual(a.scale, 1);
});

test('a stagger of zero is the same animation as before it existed', () => {
    const args = { inType: 'up', inDur: 1 };
    const before = computeTextAnim(withAnim(args), cut, 0.4);
    const after = computeTextAnim(withAnim({ ...args, charStagger: 0 }), cut, 0.4);
    assert.equal(before.alpha, after.alpha);
    assert.equal(before.dy, after.dy);
});

// --- typing that animates, rather than snapping a letter at a time ----------------------------

test('typing with an entrance hands the entrance to the characters', () => {
    const a = computeTextAnim(withAnim({ typing: true, typeSpeed: 10, inType: 'down', inDur: 0.3 }), cut, 0.5);
    assert.equal(a.alpha, 1, 'the block is left at rest');
    assert.ok(a.perChar, 'and the characters are given the clock');
    assert.equal(a.perChar.inMode, 'typing');
    assert.equal(a.perChar.speed, 10);
    assert.equal(a.perChar.dur, 0.3);
});

test('typing without an entrance still just reveals, as it always did', () => {
    const a = computeTextAnim(withAnim({ typing: true, typeSpeed: 10 }), cut, 0.5);
    assert.equal(a.perChar, null);
    assert.equal(a.chars, 5);
});

// The invariant that makes typing look animated rather than merely sliced: the newest visible
// character must be at the very start of its entrance. Getting this off by one keystroke - which
// it was - leaves every character most of the way through its entrance before it is ever drawn,
// and on screen that is indistinguishable from plain typing.
test('the character that has just appeared has not begun to arrive', () => {
    const speed = 10, dur = 0.2;
    const at = (t) => computeTextAnim(withAnim({ typing: true, typeSpeed: speed, inType: 'fade', inDur: dur }), cut, t);
    for (const n of [1, 2, 3, 7]) {
        const t = n / speed + 1e-4;          // a hair after the nth character is revealed
        const a = at(t);
        assert.equal(a.chars, n, `at ${t}s, ${n} characters are drawn`);
        const newest = charAnimAt(a.perChar, n - 1, 12);
        assert.ok(newest.alpha < 0.02, `newest character should be invisible, was ${newest.alpha}`);
    }
});

test('a character is fully arrived one entrance-duration after it appeared', () => {
    const speed = 10, dur = 0.2;
    const p = (local) => ({ inMode: 'typing', inType: 'fade', speed, dur, local });
    // Character 1 is the second drawn, revealed at 2/10 = 0.2s and settled by 0.4s.
    assert.equal(charAnimAt(p(0.2), 1, 8).alpha, 0, 'not started at the moment it appears');
    assert.ok(close(charAnimAt(p(0.4), 1, 8).alpha, 1), 'settled a duration later');
    assert.ok(close(charAnimAt(p(0.9), 1, 8).alpha, 1), 'and stays settled');
});

test('a character not yet revealed has nothing to show', () => {
    const p = { inMode: 'typing', inType: 'fade', speed: 10, dur: 0.2, local: 0.5 };
    assert.equal(charAnimAt(p, 9, 12).alpha, 0, 'character 9 appears at 1.0s');
});

test('a typed entrance outlasts the entrance window', () => {
    // The last character of a long text is revealed well after inDur, and it still has to
    // animate in. An entrance that stopped at inDur would drop it on screen fully formed.
    const a = computeTextAnim(withAnim({ typing: true, typeSpeed: 4, inType: 'up', inDur: 0.3 }), cut, 1.2);
    assert.ok(a.perChar, 'still per-character well past inDur');
    assert.equal(a.perChar.inMode, 'typing');
});

test('typing wins over a stagger: a character cannot arrive before it is revealed', () => {
    const a = computeTextAnim(withAnim({ typing: true, typeSpeed: 10, inType: 'fade', inDur: 0.3, charStagger: 0.9 }), cut, 0.2);
    assert.equal(a.perChar.inMode, 'typing');
});

test('a staggered exit still works while typing drives the entrance', () => {
    const a = computeTextAnim(withAnim({
        typing: true, typeSpeed: 10, inType: 'fade', inDur: 0.2,
        outType: 'fade', outDur: 0.4, charStagger: 0.8,
    }), cut, 1.8);   // inside the exit of a 2s cut
    assert.equal(a.perChar.outType, 'fade');
    assert.equal(a.perChar.spread, 0.8);
});

test('a faster typing speed brings a given character in sooner', () => {
    const at = (speed) => charAnimAt({ inMode: 'typing', inType: 'fade', speed, dur: 0.2, local: 0.5 }, 6, 10).alpha;
    assert.ok(at(20) > at(8), 'the same character is further along at 20 cps than at 8');
});

test('a zero typing speed is not a division by zero', () => {
    const c = charAnimAt({ inMode: 'typing', inType: 'fade', speed: 0, dur: 0.2, local: 0.5 }, 3, 8);
    assert.ok(Number.isFinite(c.alpha));
});
