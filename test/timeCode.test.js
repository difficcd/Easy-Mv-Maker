// Clock display and entry. parseClock reads what a person types, so it has to cope with more
// than fmt ever produces - and it must never hand back NaN, which would reach the playhead, the
// audio element and the cut bounds before anyone traced it back here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt, parseClock } from '../src/core/timeCode.js';

test('fmt: minutes, seconds and hundredths, always padded', () => {
    assert.equal(fmt(0), '00:00.00');
    assert.equal(fmt(5.5), '00:05.50');
    assert.equal(fmt(65.25), '01:05.25');
    assert.equal(fmt(600), '10:00.00');
});

test('fmt: truncates rather than rounding, so a time never reads ahead of itself', () => {
    assert.equal(fmt(1.999), '00:01.99');
    assert.equal(fmt(59.999), '00:59.99', 'and never shows :60');
});

test('fmt: nothing usable still formats', () => {
    assert.equal(fmt(-5), '00:00.00', 'clamped, not "-1:-5"');
    assert.equal(fmt(NaN), '00:00.00');
    assert.equal(fmt(undefined), '00:00.00');
    assert.equal(fmt(Infinity), '00:00.00');
});

test('parseClock: reads the forms a person types', () => {
    assert.equal(parseClock('1:30'), 90);
    assert.equal(parseClock('01:05'), 65);
    assert.equal(parseClock('1:02:03'), 3723, 'hours too');
    assert.equal(parseClock('90'), 90, 'plain seconds');
    assert.equal(parseClock('1.5'), 1.5, 'and fractions of one');
});

test('parseClock: round-trips what fmt produced', () => {
    for (const s of [0, 5.5, 65.25, 600, 3723.75]) {
        assert.equal(parseClock(fmt(s)), s, `${s} survives the round trip`);
    }
});

test('parseClock: nonsense is zero, never NaN', () => {
    for (const bad of ['', '   ', 'abc', ':', '::', 'a:b', null, undefined, {}]) {
        const out = parseClock(bad);
        assert.ok(Number.isFinite(out), `${JSON.stringify(bad)} -> finite`);
        assert.equal(out, 0);
    }
});

test('parseClock: a partly readable time keeps the part it could read', () => {
    assert.equal(parseClock('1:xx'), 60);
    assert.equal(parseClock('xx:30'), 30);
});

test('parseClock: accepts a number as well as a string', () => {
    assert.equal(parseClock(90), 90);
    assert.equal(parseClock(0), 0);
});
