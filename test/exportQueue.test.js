import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceRange, planQueue, seamTimes, queueProgress } from '../src/core/exportQueue.js';

const piece = (...spans) => ({ cuts: spans.map(([startTime, endTime], i) => ({ id: i + 1, startTime, endTime })) });

test('a piece contributes the range it would play', () => {
    assert.deepEqual(pieceRange(piece([0, 2], [2, 5])), { start: 0, end: 5, duration: 5 });
});

// The same rule export already follows: a piece whose cuts start at three seconds does not
// contribute three seconds of nothing to the front of the film.
test('a piece that starts late contributes only its content', () => {
    assert.deepEqual(pieceRange(piece([3, 5])), { start: 3, end: 5, duration: 2 });
});

test('an empty piece contributes nothing at all', () => {
    assert.deepEqual(pieceRange({ cuts: [] }), { start: 0, end: 0, duration: 0 });
    assert.deepEqual(pieceRange(null), { start: 0, end: 0, duration: 0 });
});

test('frames run end to end across pieces, in order', () => {
    const plan = planQueue([piece([0, 1]), piece([0, 0.5])], { fps: 10 });
    assert.equal(plan.frames.length, 15, '10 frames then 5');
    assert.deepEqual(plan.frames.map(f => f.piece).filter((v, i, a) => v !== a[i - 1]), [0, 1]);
    assert.deepEqual(plan.frames.map(f => f.index), [...Array(15).keys()], 'output numbering never restarts');
});

// Sampling at the end of each interval would put the last sample of a piece at t = duration,
// where every cut has already finished - so the piece would lose a frame and gain a blank.
test('each frame samples the start of its interval, not the end', () => {
    const plan = planQueue([piece([0, 0.3])], { fps: 10 });
    assert.deepEqual(plan.frames.map(f => Number(f.t.toFixed(4))), [0, 0.1, 0.2]);
});

test('a piece that starts late is sampled from its own start', () => {
    const plan = planQueue([piece([4, 4.3])], { fps: 10 });
    assert.deepEqual(plan.frames.map(f => Number(f.t.toFixed(4))), [4, 4.1, 4.2]);
});

test('one rate for the whole output, whatever the pieces were authored at', () => {
    const plan = planQueue([piece([0, 1]), piece([0, 1])], { fps: 24 });
    assert.equal(plan.fps, 24);
    assert.equal(plan.frames.length, 48);
    assert.equal(Number(plan.duration.toFixed(4)), 2);
});

test('an empty piece in the middle leaves no gap', () => {
    const plan = planQueue([piece([0, 0.2]), { cuts: [] }, piece([0, 0.2])], { fps: 10 });
    assert.equal(plan.frames.length, 4);
    assert.deepEqual(plan.frames.map(f => f.piece), [0, 0, 2, 2]);
    assert.equal(plan.pieces[1].count, 0);
});

test('a piece too short for one frame still gets one, rather than vanishing', () => {
    const plan = planQueue([piece([0, 0.01])], { fps: 10 });
    assert.equal(plan.frames.length, 1, 'rounding to zero would silently drop the piece');
});

test('no pieces is an empty plan, not a crash', () => {
    const plan = planQueue([], { fps: 12 });
    assert.deepEqual(plan.frames, []);
    assert.equal(plan.duration, 0);
    assert.equal(plan.truncated, false);
    assert.deepEqual(planQueue(null).frames, []);
});

test('an impossible fps falls back rather than dividing by zero', () => {
    for (const bad of [0, -5, NaN, undefined, 'abc']) {
        const plan = planQueue([piece([0, 1])], { fps: bad });
        assert.ok(plan.fps >= 1 && Number.isFinite(plan.fps), `fps ${bad} gave ${plan.fps}`);
        assert.ok(plan.frames.every(f => Number.isFinite(f.t)));
    }
});

// The cap is about memory on the machine doing the export, so it has to stop the queue, not just
// the piece it happens to be in.
test('a frame cap stops the whole queue and says so', () => {
    const plan = planQueue([piece([0, 1]), piece([0, 1])], { fps: 10, maxFrames: 15 });
    assert.equal(plan.frames.length, 15);
    assert.equal(plan.truncated, true);
    assert.equal(plan.pieces.length, 2, 'the piece it stopped inside is still reported');
    assert.equal(plan.pieces[1].count, 5);
});

test('no cap means no truncation', () => {
    const plan = planQueue([piece([0, 1])], { fps: 10, maxFrames: 0 });
    assert.equal(plan.truncated, false);
    assert.equal(plan.frames.length, 10);
});

test('seams are where each piece begins in the finished file', () => {
    const plan = planQueue([piece([0, 1]), piece([0, 0.5]), piece([0, 2])], { fps: 10 });
    assert.deepEqual(seamTimes(plan).map(t => Number(t.toFixed(4))), [0, 1, 1.5]);
});

test('progress counts frames, so a short piece does not make the bar jump', () => {
    const plan = planQueue([piece([0, 0.2]), piece([0, 1.8])], { fps: 10 });
    assert.equal(plan.frames.length, 20);
    assert.equal(queueProgress(plan, 0), 0);
    assert.equal(queueProgress(plan, 2), 0.1, 'the first, short piece is a tenth of the work');
    assert.equal(queueProgress(plan, 20), 1);
    assert.equal(queueProgress(plan, 999), 1);
    assert.equal(queueProgress(planQueue([]), 0), 1, 'nothing to do is done');
});

test('audio and a reference video extend a piece the way they extend playback', () => {
    const withAudio = { cuts: [{ id: 1, startTime: 0, endTime: 1 }], audio: { startTime: 0, endTime: 4 } };
    assert.equal(pieceRange(withAudio).duration, 4);
    const withVideo = { cuts: [{ id: 1, startTime: 0, endTime: 1 }], video: { startTime: 0, endTime: 3 } };
    assert.equal(pieceRange(withVideo).duration, 3);
});
