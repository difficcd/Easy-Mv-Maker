import test from 'node:test';
import assert from 'node:assert/strict';
import { playRange } from '../src/core/playRange.js';

// The bugs this replaces, stated as the cases that used to come out wrong:
//   - the frame and GIF export began at zero, not where the content begins
//   - the screen recording ended at the last cut or the audio, never at the reference video
//   - neither export knew about the selected part, which playback scopes to

const cut = (startTime, endTime) => ({ startTime, endTime });

test('an empty project is nothing to do, not Infinity', () => {
    assert.deepEqual(playRange({}), { start: 0, end: 0 });
    assert.deepEqual(playRange({ cuts: [] }), { start: 0, end: 0 });
    assert.deepEqual(playRange(), { start: 0, end: 0 });
});

test('the range starts where the content starts, not at zero', () => {
    const r = playRange({ cuts: [cut(3, 5), cut(5, 8)] });
    assert.equal(r.start, 3, 'exporting from 0 here gave three seconds of blank frames');
    assert.equal(r.end, 8);
});

test('cuts out of order do not decide the bounds by their position in the array', () => {
    const r = playRange({ cuts: [cut(5, 8), cut(1, 2), cut(3, 5)] });
    assert.deepEqual(r, { start: 1, end: 8 });
});

test('audio past the last cut extends the end', () => {
    const r = playRange({ cuts: [cut(0, 4)], audio: { startTime: 0, endTime: 12 } });
    assert.equal(r.end, 12);
});

test('the reference video counts too - it is on the canvas being recorded', () => {
    const r = playRange({ cuts: [cut(0, 4)], video: { startTime: 0, endTime: 9 } });
    assert.equal(r.end, 9, 'the recorder used to stop at 4 while the canvas kept showing video');
});

test('audio or video starting before the first cut moves the start back', () => {
    assert.equal(playRange({ cuts: [cut(6, 9)], audio: { startTime: 2, endTime: 9 } }).start, 2);
    assert.equal(playRange({ cuts: [cut(6, 9)], video: { startTime: 1, endTime: 9 } }).start, 1);
});

test('a selected part is the range, whatever else is on the timeline', () => {
    const r = playRange({
        cuts: [cut(0, 4), cut(10, 14)],
        audio: { startTime: 0, endTime: 30 },
        part: { start: 10, end: 14 },
    });
    assert.deepEqual(r, { start: 10, end: 14 }, 'export used to run the whole timeline regardless');
});

test('a part with no width is ignored rather than exporting nothing', () => {
    const r = playRange({ cuts: [cut(0, 4)], part: { start: 2, end: 2 } });
    assert.deepEqual(r, { start: 0, end: 4 });
});

test('negative times are clamped, and the start never passes the end', () => {
    assert.equal(playRange({ cuts: [cut(-5, 3)] }).start, 0);
    assert.equal(playRange({ cuts: [cut(-9, -2)] }).end, 0);
    const r = playRange({ cuts: [cut(-9, -2)] });
    assert.ok(r.start <= r.end, 'a start past the end would make the frame count negative');
});

test('junk in the timeline does not become NaN in the range', () => {
    const r = playRange({
        cuts: [cut(0, 4), null, { startTime: NaN, endTime: 7 }, { startTime: 1 }],
        audio: { endTime: undefined },
        video: null,
    });
    assert.deepEqual(r, { start: 0, end: 4 });
});
