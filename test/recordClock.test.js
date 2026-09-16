import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRecordFrame, EXPORT_FPS } from '../src/core/recordClock.js';

test('the first frame is index 0 at the start time', () => {
    assert.deepEqual(nextRecordFrame(2.0, 2.0, 30, -1), { idx: 0, time: 2.0 });
});

test('a clock that has not crossed the next grid line asks for nothing', () => {
    // This is the whole fix: sixty paints a second must not become sixty frames, or thirty
    // uneven ones. Between grid lines the recorder is left alone.
    assert.equal(nextRecordFrame(2.02, 2.0, 30, 0), null);
    assert.equal(nextRecordFrame(2.0333, 2.0, 30, 0), null, 'just short of 1/30');
});

test('crossing a grid line gives the next index at exactly the grid time, not the clock time', () => {
    const f = nextRecordFrame(2.0401, 2.0, 30, 0);
    assert.equal(f.idx, 1);
    assert.ok(Math.abs(f.time - (2.0 + 1 / 30)) < 1e-12, 'painted on the grid, not at 2.0401');
});

test('falling behind skips to the latest frame rather than replaying the missed ones', () => {
    // Audio is the master clock. Painting the two missed frames now would put three pictures at
    // one timestamp; skipping keeps the picture where the sound is.
    const f = nextRecordFrame(2.0 + 3.5 / 30, 2.0, 30, 0);
    assert.equal(f.idx, 3);
});

test('a clock sitting on a boundary with float error rounds to the boundary, not below it', () => {
    // 2.0 + 1/30 in floating point can come back as 2.033333333333333 from an audio element.
    assert.equal(nextRecordFrame(2.0 + 1 / 30 - 1e-9, 2.0, 30, 0)?.idx, 1);
});

test('before the start, and with no rate, nothing is recorded', () => {
    assert.equal(nextRecordFrame(1.9, 2.0, 30, -1), null);
    assert.equal(nextRecordFrame(2.5, 2.0, 0, -1), null);
});

test('the export rate is a whole number of frames per second', () => {
    assert.ok(Number.isInteger(EXPORT_FPS) && EXPORT_FPS > 0);
});
