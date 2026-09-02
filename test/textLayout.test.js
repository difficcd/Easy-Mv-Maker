import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutLine, charProgress } from '../src/canvas/textLayout.js';

const chars = (s) => [...s];
const even = (s, w = 10) => chars(s).map(() => w);
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('a straight line puts each character at its own centre', () => {
    const p = layoutLine(chars('abc'), even('abc'));
    assert.deepEqual(p.map(c => c.x), [5, 15, 25]);
    assert.deepEqual(p.map(c => c.y), [0, 0, 0]);
    assert.deepEqual(p.map(c => c.angle), [0, 0, 0]);
    assert.deepEqual(p.map(c => c.ch), ['a', 'b', 'c']);
});

test('letter spacing widens the gaps but not the last character', () => {
    // The trailing gap is not part of the line: adding it would make a centred line sit off-centre
    // by half a space.
    const p = layoutLine(chars('abc'), even('abc'), { letterSpacing: 4 });
    assert.deepEqual(p.map(c => c.x), [5, 19, 33]);
});

test('nothing in, nothing out', () => {
    assert.deepEqual(layoutLine([], []), []);
    assert.deepEqual(layoutLine(chars('abc'), []), []);
});

test('a curve of zero is exactly a straight line', () => {
    const straight = layoutLine(chars('hello'), even('hello'));
    const zero = layoutLine(chars('hello'), even('hello'), { curve: 0 });
    assert.deepEqual(zero, straight);
});

test('a nearly-zero curve does not jump away from a straight line', () => {
    // The arc is computed about the line's middle, so without rebasing, the instant the curve
    // stopped being exactly zero the whole line would slide sideways by half its width.
    const straight = layoutLine(chars('hello'), even('hello'));
    const barely = layoutLine(chars('hello'), even('hello'), { curve: 0.01 });
    for (let i = 0; i < straight.length; i++) {
        assert.ok(close(barely[i].x, straight[i].x, 0.01), `x jumped at ${i}: ${barely[i].x} vs ${straight[i].x}`);
        assert.ok(Math.abs(barely[i].y) < 0.01, `y jumped at ${i}: ${barely[i].y}`);
    }
});

test('a positive curve arcs upward', () => {
    // "Curve" on a banner means the middle rises. Negative is the frown.
    const up = layoutLine(chars('abcde'), even('abcde'), { curve: 60 });
    const mid = up[2], end = up[4];
    assert.ok(mid.y < end.y, 'the middle should sit above the ends');
    const down = layoutLine(chars('abcde'), even('abcde'), { curve: -60 });
    assert.ok(down[2].y > down[4].y, 'a negative curve should dip in the middle');
});

test('the curve is symmetric about the middle of the line', () => {
    const p = layoutLine(chars('abcde'), even('abcde'), { curve: 90 });
    const total = 50;
    // First and last sit the same distance in from each end, and at the same height.
    assert.ok(close(p[0].x, total - p[4].x, 1e-9), `${p[0].x} vs ${total - p[4].x}`);
    assert.ok(close(p[0].y, p[4].y, 1e-9));
    assert.ok(close(p[0].angle, -p[4].angle, 1e-9));
});

test('the middle of an odd-length line stays on the centre line', () => {
    const p = layoutLine(chars('abcde'), even('abcde'), { curve: 120 });
    assert.ok(close(p[2].y, 0, 1e-9), `middle lifted to ${p[2].y}`);
    assert.ok(close(p[2].angle, 0, 1e-9));
    assert.ok(close(p[2].x, 25, 1e-9));
});

test('curving does not change how far the line reaches along its own length', () => {
    // The arc length is the line width, so a curved line occupies the same amount of text.
    for (const curve of [30, 90, 179]) {
        const p = layoutLine(chars('abcdefgh'), even('abcdefgh'), { curve });
        let arc = 0;
        for (let i = 1; i < p.length; i++) arc += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
        // Chords across an arc are shorter than the arc; on eight characters the gap is small.
        assert.ok(arc > 60 && arc < 71, `curve ${curve} gave chord length ${arc}`);
    }
});

test('a character on the arc is turned to face along it', () => {
    const p = layoutLine(chars('abcde'), even('abcde'), { curve: 90 });
    assert.ok(p[0].angle < 0 && p[4].angle > 0, 'the ends should tilt in opposite directions');
    // Total turn across the line is the curve that was asked for.
    const span = p[4].angle - p[0].angle;
    assert.ok(span > 0 && span < Math.PI / 2, `turned ${span} radians for a 90 degree curve`);
});

test('characters of different widths are spaced by their own widths', () => {
    const p = layoutLine(chars('ill'), [4, 12, 12]);
    assert.deepEqual(p.map(c => c.x), [2, 10, 22]);
});

test('charProgress: no spread means every character moves together', () => {
    for (const i of [0, 1, 2]) assert.equal(charProgress(i, 3, 0.4, 0), 0.4);
});

test('charProgress: with spread, later characters start later', () => {
    const p = [0, 1, 2, 3].map(i => charProgress(i, 4, 0.4, 0.6));
    for (let i = 1; i < p.length; i++) assert.ok(p[i] <= p[i - 1], `character ${i} ran ahead of ${i - 1}`);
    assert.ok(p[0] > 0, 'the first character should have started');
    assert.equal(p[3], 0, 'the last should not have started yet at 0.4 with spread 0.6');
});

test('charProgress: everyone finishes by the end', () => {
    for (const spread of [0, 0.3, 0.7, 1]) {
        for (const i of [0, 3, 7]) {
            assert.equal(charProgress(i, 8, 1, spread), 1, `spread ${spread}, char ${i} unfinished`);
        }
    }
});

test('charProgress: nobody has started at zero, and it never leaves 0..1', () => {
    for (const i of [0, 4, 9]) {
        assert.equal(charProgress(i, 10, 0, 0.5), 0);
        for (const p of [-1, 0.5, 2]) {
            const v = charProgress(i, 10, p, 0.5);
            assert.ok(v >= 0 && v <= 1, `out of range: ${v}`);
        }
    }
});

test('charProgress: a spread of one still leaves each character time to move', () => {
    // Otherwise the last character would have a zero-length window and snap.
    const v = charProgress(1, 3, 0.6, 1);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `got ${v}`);
});

test('charProgress: a single character ignores the spread', () => {
    assert.equal(charProgress(0, 1, 0.3, 0.9), 0.3);
});
