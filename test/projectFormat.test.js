// Opening a saved project. These rules only matter for files written by older versions, which is
// exactly why they need tests: the failure is quiet - an old project opens with its parts unnamed
// or its folder structure flattened - and by the time anyone notices, it has been saved again in
// the new shape and the evidence is gone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSettings, migrateCuts, makeLoadProgress } from '../src/core/projectFormat.js';

// ── settings ───────────────────────────────────────────────────────────────
test('projectSettings: takes what the file says', () => {
    const s = projectSettings({
        canvas: { w: 1080, h: 1920 }, numTracks: 4, pps: 80,
        onionPrev: true, onionNext: true, cuts: [{ id: 42 }],
    });
    assert.deepEqual(s, {
        canvas: { w: 1080, h: 1920 }, numTracks: 4, currentCutId: 42,
        onionPrev: true, onionNext: true, pps: 80,
    });
});

test('projectSettings: fills in everything an older file never wrote', () => {
    const s = projectSettings({ cuts: [{ id: 7 }] });
    assert.equal(s.canvas, null, 'no canvas recorded means keep the current one');
    assert.equal(s.numTracks, 2);
    assert.equal(s.pps, 50);
    assert.equal(s.onionPrev, false);
    assert.equal(s.onionNext, false);
});

test('projectSettings: onion skin off is honoured, not treated as missing', () => {
    // `||` here would silently turn a deliberate false back on at every load.
    const s = projectSettings({ cuts: [], onionPrev: false, onionNext: false, pps: 0 });
    assert.equal(s.onionPrev, false);
    assert.equal(s.onionNext, false);
    assert.equal(s.pps, 0, 'a real zoom of zero is kept as written');
});

test('projectSettings: half a canvas size is no canvas size', () => {
    assert.equal(projectSettings({ canvas: { w: 1920 }, cuts: [] }).canvas, null);
    assert.equal(projectSettings({ canvas: { h: 1080 }, cuts: [] }).canvas, null);
    assert.equal(projectSettings({ canvas: { w: 0, h: 0 }, cuts: [] }).canvas, null);
});

test('projectSettings: a project with no cuts still opens on something', () => {
    assert.equal(projectSettings({ cuts: [] }).currentCutId, 1);
    assert.equal(projectSettings({}).currentCutId, 1);
    assert.equal(projectSettings(undefined).currentCutId, 1);
});

test('projectSettings: a cut whose id is 0 is a real cut', () => {
    assert.equal(projectSettings({ cuts: [{ id: 0 }] }).currentCutId, 0);
});

// ── cut migration ──────────────────────────────────────────────────────────
test('migrateCuts: a video batch becomes a part, keeping its label', () => {
    const [c] = migrateCuts([{ id: 1, videoBatch: 'b1', videoLabel: 'intro.mp4', layers: [] }]);
    assert.equal(c.partId, 'b1');
    assert.equal(c.partName, 'intro.mp4');
});

test('migrateCuts: a file that already has parts is left alone', () => {
    const [c] = migrateCuts([{ id: 1, partId: 'p1', partName: 'Chorus', videoBatch: 'old', videoLabel: 'old.mp4', layers: [] }]);
    assert.equal(c.partId, 'p1', 'the real value wins over the migrated one');
    assert.equal(c.partName, 'Chorus');
});

test('migrateCuts: layers predating folders become plain layers at the root', () => {
    const [c] = migrateCuts([{ id: 1, layers: [{ id: 'a', strokes: [] }] }]);
    assert.deepEqual({ type: c.layers[0].type, parentId: c.layers[0].parentId }, { type: 'layer', parentId: null });
});

test('migrateCuts: a real folder is not flattened into a layer', () => {
    // Spread-then-override: what the file says beats the default, or every folder would be lost.
    const [c] = migrateCuts([{ id: 1, layers: [{ id: 'f', type: 'folder', parentId: null }, { id: 'a', type: 'layer', parentId: 'f' }] }]);
    assert.equal(c.layers[0].type, 'folder');
    assert.equal(c.layers[1].parentId, 'f', 'nesting survives');
});

test('migrateCuts: redo is dropped, so undo cannot resurrect a past session', () => {
    const [c] = migrateCuts([{ id: 1, layers: [{ id: 'a', strokes: [{ id: 1 }], redoStrokes: [{ id: 99 }] }] }]);
    assert.deepEqual(c.layers[0].redoStrokes, []);
    assert.deepEqual(c.layers[0].strokes.map(s => s.id), [1], 'the actual strokes are untouched');
});

test('migrateCuts: a cut from before texts existed gets an empty list', () => {
    const [c] = migrateCuts([{ id: 1, layers: [] }]);
    assert.deepEqual(c.texts, []);
    // and anything that is not a list is replaced rather than trusted
    assert.deepEqual(migrateCuts([{ id: 1, texts: null, layers: [] }])[0].texts, []);
    assert.deepEqual(migrateCuts([{ id: 1, texts: 'nope', layers: [] }])[0].texts, []);
});

test('migrateCuts: existing texts are kept as they are', () => {
    const texts = [{ id: 't', text: 'hi' }];
    assert.deepEqual(migrateCuts([{ id: 1, texts, layers: [] }])[0].texts, texts);
});

test('migrateCuts: everything else about a cut passes through untouched', () => {
    const cut = { id: 1, name: 'Cut 1', startTime: 2, endTime: 3, track: 1, anim: { inType: 'fade' }, layers: [] };
    const [out] = migrateCuts([cut]);
    for (const k of ['id', 'name', 'startTime', 'endTime', 'track']) assert.deepEqual(out[k], cut[k], k);
    assert.deepEqual(out.anim, cut.anim);
});

test('migrateCuts: a malformed file yields an empty project, not a crash', () => {
    assert.deepEqual(migrateCuts(undefined), []);
    assert.deepEqual(migrateCuts(null), []);
    assert.deepEqual(migrateCuts([{ id: 1 }])[0].layers, [], 'a cut with no layers array');
});

test('migrateCuts: does not mutate what it was given', () => {
    const cuts = [{ id: 1, videoBatch: 'b', layers: [{ id: 'a', redoStrokes: [{ id: 9 }] }] }];
    const before = JSON.parse(JSON.stringify(cuts));
    migrateCuts(cuts);
    assert.deepEqual(cuts, before);
});

// ── load progress ──────────────────────────────────────────────────────────
test('makeLoadProgress: a small project reports nothing, so no bar flashes up', () => {
    let calls = 0;
    const { heavy, tick } = makeLoadProgress(5, () => calls++);
    assert.equal(heavy, false);
    for (let i = 0; i < 5; i++) tick();
    assert.equal(calls, 0);
});

test('makeLoadProgress: a big one reports, but around a hundred times, not once per item', () => {
    const seen = [];
    const { heavy, tick } = makeLoadProgress(5000, p => seen.push(p.done));
    assert.equal(heavy, true);
    for (let i = 0; i < 5000; i++) tick();
    assert.ok(seen.length <= 101, `${seen.length} updates for 5000 items`);
    assert.ok(seen.length >= 50, 'but still enough to look like progress');
    assert.equal(seen[seen.length - 1], 5000, 'and it always finishes at the total');
});

test('makeLoadProgress: counts up, never backwards', () => {
    const seen = [];
    const { tick } = makeLoadProgress(300, p => seen.push(p.done));
    for (let i = 0; i < 300; i++) tick();
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], 'monotonic');
});

test('makeLoadProgress: just over the threshold still reports its last item', () => {
    const seen = [];
    const { heavy, tick } = makeLoadProgress(13, p => seen.push(p.done));
    assert.equal(heavy, true);
    for (let i = 0; i < 13; i++) tick();
    assert.equal(seen[seen.length - 1], 13);
});

test('makeLoadProgress: nothing to load is not a division by zero', () => {
    const { heavy, tick } = makeLoadProgress(0, () => { throw new Error('should not report'); });
    assert.equal(heavy, false);
    tick();
});
