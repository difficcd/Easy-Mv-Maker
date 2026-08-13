// Text measuring and drawing.
//
// These ran inside paintFrame, so the only way to check the drawing order was to look at pixels
// and squint. A recording context makes the order itself the thing under test: what is stroked
// before what is filled, when the shadow is turned off, whether save and restore balance.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clampFontSize, textFontOf, textLineHeight, measureTextBox,
    textNeedsBox, revealLines, drawTextObject,
} from '../src/canvas/textRender.js';

// A context that writes down what it was asked to do. Width is faked as 10px per character,
// which is enough for the geometry to be checkable without a font engine.
const recorder = () => {
    const calls = [];
    const state = {};
    const rec = (name) => (...args) => { calls.push([name, ...args]); };
    const ctx = {
        calls, state,
        save: rec('save'), restore: rec('restore'),
        translate: rec('translate'), scale: rec('scale'), rotate: rec('rotate'),
        beginPath: rec('beginPath'), fill: rec('fill'), rect: rec('rect'), roundRect: rec('roundRect'),
        fillText: rec('fillText'), strokeText: rec('strokeText'),
        measureText: (s) => ({ width: s.length * 10 }),
        createLinearGradient: (...a) => { calls.push(['createLinearGradient', ...a]); return { addColorStop: rec('addColorStop'), __gradient: true }; },
    };
    // Record property writes too - font, fillStyle, shadowColor and the rest are set, not called.
    for (const p of ['font', 'fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation',
        'textBaseline', 'textAlign', 'letterSpacing', 'filter', 'lineJoin', 'lineWidth',
        'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY']) {
        Object.defineProperty(ctx, p, {
            configurable: true, // so a test can replace one with a throwing stub
            get() { return state[p]; },
            set(v) { state[p] = v; calls.push(['set:' + p, v]); },
        });
    }
    return ctx;
};
const names = (ctx) => ctx.calls.map(c => c[0]);
const only = (ctx, name) => ctx.calls.filter(c => c[0] === name);

// ── font and metrics ───────────────────────────────────────────────────────
test('clampFontSize: holds the editor range and survives a missing size', () => {
    assert.equal(clampFontSize({ fontSize: 100 }), 100);
    assert.equal(clampFontSize({ fontSize: 1 }), 6);
    assert.equal(clampFontSize({ fontSize: 9999 }), 400);
    assert.equal(clampFontSize({}), 32, 'the default size');
    assert.equal(clampFontSize(undefined), 32);
});

test('textFontOf: builds the shorthand in the order the canvas requires', () => {
    assert.equal(textFontOf({ fontSize: 40 }), '40px sans-serif');
    assert.equal(textFontOf({ fontSize: 40, bold: true }), 'bold 40px sans-serif');
    assert.equal(textFontOf({ fontSize: 40, italic: true }), 'italic 40px sans-serif');
    // style before weight before size before family, or the whole declaration is ignored
    assert.equal(textFontOf({ fontSize: 40, bold: true, italic: true, fontFamily: 'Nanum' }),
        'italic bold 40px Nanum');
});

test('textLineHeight: a whole number of pixels, defaulting to 1.25em', () => {
    assert.equal(textLineHeight({ fontSize: 40 }), 50);
    assert.equal(textLineHeight({ fontSize: 40, lineHeight: 1.5 }), 60);
    assert.equal(textLineHeight({ fontSize: 33, lineHeight: 1.25 }), 41, 'rounded, never fractional');
});

test('measureTextBox: sized by the widest line and the number of lines', () => {
    const b = measureTextBox({ text: 'ab\nabcd', fontSize: 40, x: 0, y: 0 }, recorder());
    assert.equal(b.w, 40, 'the widest line, not the first');
    assert.equal(b.h, 100, 'two lines at a 50px line height');
});

test('measureTextBox: x is the left edge, which alignment moves off the anchor', () => {
    const t = { text: 'abcd', fontSize: 40, x: 1000, y: 100 };
    assert.equal(measureTextBox({ ...t, align: 'left' }, recorder()).x, 1000);
    assert.equal(measureTextBox({ ...t, align: 'center' }, recorder()).x, 980, 'half the width left of the anchor');
    assert.equal(measureTextBox({ ...t, align: 'right' }, recorder()).x, 960, 'a full width left of it');
});

test('measureTextBox: empty text still has a box, so nothing divides by zero', () => {
    const b = measureTextBox({ text: '', fontSize: 40 }, recorder());
    assert.ok(b.w >= 1 && b.h >= 1);
});

test('textNeedsBox: measured only when something actually needs the geometry', () => {
    assert.equal(textNeedsBox({ text: 'x' }, null), false, 'plain text skips the measuring');
    assert.equal(textNeedsBox({ gradient: true }, null), true);
    assert.equal(textNeedsBox({ bgColor: '#fff' }, null), true);
    assert.equal(textNeedsBox({ rotation: 10 }, null), true);
    assert.equal(textNeedsBox({}, { alpha: 1 }), true, 'any animation pivots on the box');
    assert.equal(textNeedsBox({ rotation: 0 }, null), false, 'no rotation is not a rotation');
});

// ── typing ─────────────────────────────────────────────────────────────────
test('revealLines: null means no typing, so everything is drawn', () => {
    assert.deepEqual(revealLines('ab\ncd', null), ['ab', 'cd']);
    assert.deepEqual(revealLines('', null), ['']);
    assert.deepEqual(revealLines(undefined, null), ['']);
});

test('revealLines: reveals a character at a time across the line break', () => {
    const steps = [0, 1, 2, 3, 4].map(n => revealLines('ab\ncd', n));
    assert.deepEqual(steps, [
        ['', ''],
        ['a', ''],
        ['ab', ''],
        ['ab', 'c'],
        ['ab', 'cd'],
    ]);
});

test('revealLines: a budget past the end reveals everything and no more', () => {
    assert.deepEqual(revealLines('ab\ncd', 999), ['ab', 'cd']);
});

test('revealLines: later lines stay empty rather than going negative', () => {
    // The budget runs out on line one; the rest must slice to nothing, not to a negative index.
    assert.deepEqual(revealLines('abcdef\ngh\nij', 3), ['abc', '', '']);
});

test('revealLines: blank lines in the middle cost nothing and are preserved', () => {
    assert.deepEqual(revealLines('ab\n\ncd', 3), ['ab', '', 'c']);
});

// ── drawing ────────────────────────────────────────────────────────────────
test('drawTextObject: balances save and restore however it returns', () => {
    for (const t of [
        { text: 'hi' },
        { text: 'hi', shadow: true, outline: true, gradient: true, bgColor: '#fff', rotation: 30 },
        { text: '' },
    ]) {
        const ctx = recorder();
        drawTextObject(ctx, t, { box: { x: 0, y: 0, w: 10, h: 10 } });
        const n = names(ctx);
        assert.equal(n.filter(x => x === 'save').length, 1, 'one save');
        assert.equal(n.filter(x => x === 'restore').length, 1, 'one restore');
        assert.equal(n[0], 'save', 'saved before anything is changed');
        assert.equal(n[n.length - 1], 'restore', 'restored last, so no state leaks out');
    }
});

test('drawTextObject: one fillText per line, at stacked baselines', () => {
    const ctx = recorder();
    drawTextObject(ctx, { text: 'a\nb\nc', fontSize: 40, x: 100, y: 200 }, {});
    const fills = only(ctx, 'fillText');
    assert.deepEqual(fills.map(f => f[1]), ['a', 'b', 'c']);
    assert.deepEqual(fills.map(f => f[3]), [200, 250, 300], 'one line height apart');
    assert.ok(fills.every(f => f[2] === 100), 'all at the same x');
});

test('drawTextObject: the outline is stroked under every line before any line is filled', () => {
    // Otherwise the next line's outline paints over the previous line's descenders.
    const ctx = recorder();
    drawTextObject(ctx, { text: 'a\nb', outline: true }, {});
    const n = names(ctx);
    assert.equal(only(ctx, 'strokeText').length, 2);
    assert.ok(n.lastIndexOf('strokeText') < n.indexOf('fillText'), 'all strokes precede all fills');
});

test('drawTextObject: no outline means nothing is stroked at all', () => {
    const ctx = recorder();
    drawTextObject(ctx, { text: 'a' }, {});
    assert.equal(only(ctx, 'strokeText').length, 0);
});

test('drawTextObject: the shadow is cast once, not once per line', () => {
    // Left on, every line would drop a shadow on the one below and the stack would darken.
    const ctx = recorder();
    drawTextObject(ctx, { text: 'a\nb\nc', shadow: true }, {});
    const n = names(ctx);
    const firstFill = n.indexOf('fillText');
    const cleared = ctx.calls.findIndex(c => c[0] === 'set:shadowColor' && c[1] === 'transparent');
    assert.ok(cleared > firstFill, 'cleared after the first line is drawn');
    assert.ok(cleared < n.lastIndexOf('fillText'), 'and before the last one');
});

test('drawTextObject: alpha multiplies the text, the layer and the animation together', () => {
    const ctx = recorder();
    drawTextObject(ctx, { text: 'a', opacity: 0.5 }, { alpha: 0.5, anim: { alpha: 0.5, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, chars: null }, box: { x: 0, y: 0, w: 1, h: 1 } });
    assert.equal(ctx.state.globalAlpha, 0.125);
});

test('drawTextObject: the background box is painted before the glyphs', () => {
    const ctx = recorder();
    drawTextObject(ctx, { text: 'a', bgColor: '#fff' }, { box: { x: 10, y: 10, w: 100, h: 50 } });
    const n = names(ctx);
    assert.ok(n.indexOf('fill') < n.indexOf('fillText'), 'behind the text, not over it');
});

test('drawTextObject: effects needing a box are skipped when there is none', () => {
    // textNeedsBox decides whether to measure; asking for a gradient without one must not throw.
    const ctx = recorder();
    drawTextObject(ctx, { text: 'a', gradient: true, bgColor: '#fff', rotation: 45 }, { box: null });
    assert.equal(only(ctx, 'createLinearGradient').length, 0);
    assert.equal(only(ctx, 'rotate').length, 0);
    assert.equal(only(ctx, 'fill').length, 0, 'no background box either');
    assert.equal(only(ctx, 'fillText').length, 1, 'the text itself is still drawn');
});

test('drawTextObject: typing reaches the canvas as sliced lines', () => {
    const ctx = recorder();
    const anim = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, chars: 3 };
    drawTextObject(ctx, { text: 'hello' }, { anim, box: { x: 0, y: 0, w: 1, h: 1 } });
    assert.deepEqual(only(ctx, 'fillText').map(c => c[1]), ['hel']);
});

test('drawTextObject: a context without letterSpacing or roundRect is still usable', () => {
    // Both are recent additions; assigning an unimplemented property throws in some engines.
    const ctx = recorder();
    delete ctx.roundRect;
    Object.defineProperty(ctx, 'letterSpacing', { set() { throw new TypeError('unsupported'); }, get() { return ''; } });
    drawTextObject(ctx, { text: 'a', bgColor: '#fff' }, { box: { x: 0, y: 0, w: 10, h: 10 } });
    assert.equal(only(ctx, 'rect').length, 1, 'fell back to a square-cornered box');
    assert.equal(only(ctx, 'fillText').length, 1);
});
