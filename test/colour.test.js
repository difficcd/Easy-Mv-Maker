import test from 'node:test';
import assert from 'node:assert/strict';
import { withAlpha } from '../src/core/colour.js';

test('an hsl colour takes the alpha inside the function', () => {
    assert.equal(withAlpha('hsl(220 80% 74%)', 0.4), 'hsl(220 80% 74% / 0.4)');
    assert.equal(withAlpha('rgb(1, 2, 3)', 0.5), 'rgb(1, 2, 3 / 0.5)');
});

test('a hex colour becomes rgba - the case that used to lose its alpha silently', () => {
    // The stylesheet's default for the accent is a hex, and a variable that has not been set
    // yet reads back as one. Handling only hsl meant a "40%" path drew solid.
    assert.equal(withAlpha('#7c8cff', 0.4), 'rgba(124, 140, 255, 0.4)');
    assert.equal(withAlpha('#abc', 0.5), 'rgba(170, 187, 204, 0.5)');
    assert.equal(withAlpha('#7C8CFF', 0.4), 'rgba(124, 140, 255, 0.4)', 'case does not matter');
});

test('a colour that already carries an alpha has it replaced, not appended', () => {
    // 'hsl(h s% l% / .55 / 0.4)' is not a colour; a canvas would ignore the assignment and keep
    // whatever was set before, which is exactly the fault this family of bug keeps taking.
    assert.equal(withAlpha('hsl(220 80% 45% / .55)', 0.2), 'hsl(220 80% 45% / 0.2)');
});

test('an alpha of 1 or more leaves the colour exactly as it was', () => {
    assert.equal(withAlpha('hsl(220 80% 74%)', 1), 'hsl(220 80% 74%)');
    assert.equal(withAlpha('#7c8cff', 2), '#7c8cff');
});

test('a colour this does not understand is returned opaque rather than mangled', () => {
    assert.equal(withAlpha('rebeccapurple', 0.5), 'rebeccapurple');
    assert.equal(withAlpha('', 0.5), '');
    assert.equal(withAlpha(undefined, 0.5), '');
});
