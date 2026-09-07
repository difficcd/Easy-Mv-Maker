import test from 'node:test';
import assert from 'node:assert/strict';
import { importPlacement, frameDurations, partAssigner, buildImportedCuts } from '../src/core/videoCuts.js';

const rect = { x: 0, y: 0, w: 1920, h: 1080 };
const ids = (n) => { let i = 0; return () => ++i; };

test('placement: an import lands after what is already on the track', () => {
    const cuts = [
        { id: 1, track: 0, startTime: 0, endTime: 3 },
        { id: 2, track: 0, startTime: 3, endTime: 7 },
        { id: 3, track: 1, startTime: 0, endTime: 40 },
    ];
    assert.deepEqual(importPlacement(cuts, 'newsrc', 1), { track: 0, startAt: 7 },
        'starting at zero would drop the import on top of what is there');
});

test('placement: the track is the one the selected cut is on', () => {
    const cuts = [
        { id: 1, track: 0, startTime: 0, endTime: 3 },
        { id: 2, track: 2, startTime: 0, endTime: 9 },
    ];
    assert.deepEqual(importPlacement(cuts, 'newsrc', 2), { track: 2, startAt: 9 });
});

// Re-importing the same file replaces its cuts, so those cuts must not push the new ones along -
// otherwise every re-import would start later than the last.
test('placement: cuts from the same source are ignored, since they are about to be replaced', () => {
    const cuts = [
        { id: 1, track: 0, startTime: 0, endTime: 3 },
        { id: 2, track: 0, startTime: 3, endTime: 90, videoSrc: 'same' },
    ];
    assert.deepEqual(importPlacement(cuts, 'same', 1), { track: 0, startAt: 3 });
});

test('placement: an empty project starts at zero on track zero', () => {
    assert.deepEqual(importPlacement([], 'x', null), { track: 0, startAt: 0 });
    assert.deepEqual(importPlacement(null, 'x', null), { track: 0, startAt: 0 });
});

test('placement: a selected cut that is gone falls back to track zero', () => {
    const cuts = [{ id: 1, track: 3, startTime: 0, endTime: 5 }];
    assert.deepEqual(importPlacement(cuts, 'x', 999), { track: 0, startAt: 0 });
});

test('durations: one frame each at the import fps', () => {
    assert.deepEqual(frameDurations([], 3, 10), [0.1, 0.1, 0.1]);
});

// A still shot is collapsed to one frame that stood for many; it has to last as long as the run
// it replaced, or the still would flash past and leave a gap.
test('durations: a held frame lasts for the whole run it stands in for', () => {
    assert.deepEqual(frameDurations([1, 5, 2], 3, 10), [0.1, 0.5, 0.2]);
});

test('durations: a missing or nonsense hold is one frame, never zero', () => {
    assert.deepEqual(frameDurations([0, -4, NaN, undefined, 'x'], 5, 10), [0.1, 0.1, 0.1, 0.1, 0.1],
        'a cut of zero length cannot be selected');
});

test('durations: an impossible fps does not divide by zero', () => {
    assert.ok(frameDurations([], 1, 0)[0] > 0 && Number.isFinite(frameDurations([], 1, 0)[0]));
    assert.ok(Number.isFinite(frameDurations([], 1, NaN)[0]));
});

test('parts: one part means no part suffixes at all', () => {
    const of = partAssigner(10, 1, 'vb_1', 'Clip');
    assert.deepEqual(of(0), { partId: 'vb_1', partName: 'Clip' });
    assert.deepEqual(of(9), { partId: 'vb_1', partName: 'Clip' });
});

test('parts: split by count, so the last part is the short one', () => {
    const of = partAssigner(10, 3, 'vb_1', 'Clip');           // ceil(10/3) = 4 per part
    assert.deepEqual(of(0).partName, 'Clip 1');
    assert.deepEqual(of(3).partName, 'Clip 1');
    assert.deepEqual(of(4).partName, 'Clip 2');
    assert.deepEqual(of(8).partName, 'Clip 3');
    assert.deepEqual(of(9).partName, 'Clip 3');
});

test('parts: asking for more parts than frames does not make empty ones', () => {
    const of = partAssigner(3, 99, 'vb_1', 'Clip');
    const names = [0, 1, 2].map(i => of(i).partName);
    assert.deepEqual(names, ['Clip 1', 'Clip 2', 'Clip 3']);
});

test('parts: nonsense falls back to one part', () => {
    assert.deepEqual(partAssigner(5, NaN, 'vb_1', 'Clip')(0), { partId: 'vb_1', partName: 'Clip' });
    assert.deepEqual(partAssigner(5, 0, 'vb_1', 'Clip')(0), { partId: 'vb_1', partName: 'Clip' });
});

// Times accumulate rather than being computed from the index, which is what the import has always
// done - 2.1 + 0.3 lands on 2.4000000000000004. The drift is a thousandth of a nanosecond per
// frame, so it is compared with a tolerance rather than pretended away or "fixed" into a change
// of behaviour. What must hold exactly is that each cut starts where the previous one ended.
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} vs ${b}`);

test('cuts: laid end to end with no gaps, holds included', () => {
    const made = buildImportedCuts({
        bitmapIds: ['b0', 'b1', 'b2'], holds: [1, 3, 1], fps: 10,
        track: 1, startAt: 2, batch: 'vb_1', label: 'Clip', srcKey: 'src', parts: 1, rect, nextId: ids(),
    });
    const want = [[2, 2.1], [2.1, 2.4], [2.4, 2.5]];
    made.forEach((c, i) => {
        near(c.startTime, want[i][0], `cut ${i} start`);
        near(c.endTime, want[i][1], `cut ${i} end`);
        assert.equal(c.track, 1);
    });
    for (let i = 1; i < made.length; i++) {
        assert.equal(made[i].startTime, made[i - 1].endTime, 'a gap here would be a frame of nothing');
    }
});

test('cuts: each frame becomes one paste stroke of its own bitmap', () => {
    const made = buildImportedCuts({
        bitmapIds: ['b0', 'b1'], holds: [], fps: 10,
        track: 0, startAt: 0, batch: 'vb_1', label: 'Clip', srcKey: 'src', parts: 1,
        rect: { x: 0, y: 140, w: 1920, h: 800 }, nextId: ids(),
    });
    assert.equal(made.length, 2);
    const s = made[1].layers[0].strokes[0];
    assert.equal(s.tool, 'paste');
    assert.equal(s.bitmapId, 'b1');
    assert.deepEqual([s.x, s.y, s.w, s.h], [0, 140, 1920, 800], 'the letterbox rect is where it is pasted');
    assert.equal(made[0].layers[0].id, 1);
    assert.equal(made[0].activeLayerId, 1);
});

test('cuts: every id is distinct, which is what stops a batch selecting the wrong cut', () => {
    const made = buildImportedCuts({
        bitmapIds: ['a', 'b', 'c', 'd'], holds: [], fps: 12,
        track: 0, startAt: 0, batch: 'vb_1', label: 'Clip', srcKey: 'src', parts: 2, rect, nextId: ids(),
    });
    const seen = new Set(made.map(c => c.id));
    assert.equal(seen.size, made.length);
});

test('cuts: every cut carries the source, so a re-import can find and replace them', () => {
    const made = buildImportedCuts({
        bitmapIds: ['a', 'b'], holds: [], fps: 12,
        track: 0, startAt: 0, batch: 'vb_9', label: 'Clip', srcKey: 'file:abc', parts: 1, rect, nextId: ids(),
    });
    for (const c of made) {
        assert.equal(c.videoSrc, 'file:abc');
        assert.equal(c.videoBatch, 'vb_9');
        assert.equal(c.videoLabel, 'Clip');
    }
});

test('cuts: no frames is no cuts, not one empty one', () => {
    assert.deepEqual(buildImportedCuts({
        bitmapIds: [], holds: [], fps: 12, track: 0, startAt: 0,
        batch: 'vb_1', label: 'Clip', srcKey: 'src', parts: 3, rect, nextId: ids(),
    }), []);
});
