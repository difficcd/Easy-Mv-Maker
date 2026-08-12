// The document's state transitions. These used to be forty-odd lambdas scattered through a
// component, reachable only by driving the app; as a reducer they are a pure function and the
// awkward cases - toggling a field that is absent, an action naming something that is gone,
// invariants that a call site has to remember - can be stated directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cutsReducer,
    replaceCuts, addCuts, updateCut, setCutAnim, clearCut,
    updateLayer, setLayerAnim, moveLayers,
    upsertText, moveText, deleteText, toggleTextVisible,
    assignPartTo, renamePart, ungroupPart, removeBatch,
    patchCut, patchCuts,
} from '../src/cutsReducer.js';

const layer = (id, extra = {}) => ({ id, type: 'layer', parentId: null, visible: true, strokes: [], ...extra });
const cut = (id, extra = {}) => ({ id, name: `Cut ${id}`, startTime: 0, endTime: 1, track: 0, layers: [layer('L1')], activeLayerId: 'L1', texts: [], ...extra });
const doc = () => [cut(1), cut(2)];

// ── the document as a whole ────────────────────────────────────────────────
test('replaceCuts: swaps the document, and copes with nothing', () => {
    const next = [cut(9)];
    assert.equal(cutsReducer(doc(), replaceCuts(next)), next);
    assert.deepEqual(cutsReducer(doc(), replaceCuts(null)), []);
});

test('addCuts: appends and keeps what was there', () => {
    const out = cutsReducer(doc(), addCuts([cut(3)]));
    assert.deepEqual(out.map(c => c.id), [1, 2, 3]);
    assert.deepEqual(cutsReducer(doc(), addCuts(null)).map(c => c.id), [1, 2], 'nothing to add is not an error');
});

test('an unknown action leaves the document alone', () => {
    // The difference between a bug and a lost afternoon of work.
    const d = doc();
    // @ts-ignore - deliberately not a real action
    assert.equal(cutsReducer(d, { type: 'nonsense' }), d);
});

test('a missing document does not throw', () => {
    assert.deepEqual(cutsReducer(undefined, addCuts([cut(1)])).map(c => c.id), [1]);
    assert.deepEqual(cutsReducer(null, updateCut(1, { name: 'x' })), []);
});

// ── cuts ───────────────────────────────────────────────────────────────────
test('updateCut: patches one cut and leaves the others identical', () => {
    const d = doc();
    const out = cutsReducer(d, updateCut(1, { name: 'Renamed', track: 2 }));
    assert.equal(out[0].name, 'Renamed');
    assert.equal(out[0].track, 2);
    assert.equal(out[0].endTime, 1, 'untouched fields survive');
    assert.equal(out[1], d[1], 'the other cut is the very same object');
});

test('updateCut: naming a cut that is gone changes nothing', () => {
    assert.deepEqual(cutsReducer(doc(), updateCut(999, { name: 'x' })).map(c => c.name), ['Cut 1', 'Cut 2']);
});

test('setCutAnim: merges over the defaults, so a patch need not be complete', () => {
    const out = cutsReducer(doc(), setCutAnim(1, { inType: 'fade' }));
    assert.equal(out[0].anim.inType, 'fade');
    assert.equal(out[0].anim.outType, 'none', 'the rest comes from the defaults');
    const twice = cutsReducer(out, setCutAnim(1, { outType: 'slide' }));
    assert.equal(twice[0].anim.inType, 'fade', 'and a second patch keeps the first');
});

test('clearCut: empties the drawing but keeps the layers', () => {
    const d = [cut(1, {
        texts: [{ id: 't' }],
        layers: [layer('L1', { strokes: [{ id: 1 }], redoStrokes: [{ id: 2 }] }), { id: 'F', type: 'folder', parentId: null }],
    })];
    const out = cutsReducer(d, clearCut(1));
    assert.equal(out[0].layers.length, 2, 'the structure survives - this is not a delete');
    assert.deepEqual(out[0].layers[0].strokes, []);
    assert.deepEqual(out[0].layers[0].redoStrokes, [], 'redo goes too: those strokes have nowhere to return to');
    assert.deepEqual(out[0].texts, []);
    assert.equal(out[0].layers[1].type, 'folder', 'a folder has no strokes and is left as it is');
});

// ── layers ─────────────────────────────────────────────────────────────────
test('updateLayer: patches one layer of one cut', () => {
    const d = [cut(1, { layers: [layer('a'), layer('b')] })];
    const out = cutsReducer(d, updateLayer(1, 'b', { visible: false, roughen: 2.4 }));
    assert.equal(out[0].layers[1].visible, false);
    assert.equal(out[0].layers[1].roughen, 2.4);
    assert.equal(out[0].layers[0].visible, true, 'its sibling is untouched');
});

test('setLayerAnim: merges over the layer-animation defaults', () => {
    const out = cutsReducer(doc(), setLayerAnim(1, 'L1', { tx: 40 }));
    assert.equal(out[0].layers[0].anim.tx, 40);
    assert.equal(out[0].layers[0].anim.mode, 'progress', 'defaults fill the rest');
});

test('moveLayers: bumps rev, which is the invariant a call site used to have to remember', () => {
    // Only coordinates change, and the cached canvas signature is built from stroke count and
    // the last stroke's identity - so without rev the canvas keeps drawing the old positions.
    const d = [cut(1, { layers: [layer('a', { rev: 1, strokes: [{ id: 1, points: [{ x: 0, y: 0 }] }] })] })];
    const out = cutsReducer(d, moveLayers(1, ['a'], 10, 5, false));
    assert.equal(out[0].layers[0].rev, 2, 'the cache is invalidated');
    assert.deepEqual(out[0].layers[0].strokes[0].points, [{ x: 10, y: 5 }]);
});

test('moveLayers: carries the texts only when asked', () => {
    const d = [cut(1, { texts: [{ id: 't', x: 0, y: 0 }] })];
    assert.deepEqual(cutsReducer(d, moveLayers(1, [], 10, 10, true))[0].texts, [{ id: 't', x: 10, y: 10 }]);
    assert.deepEqual(cutsReducer(d, moveLayers(1, [], 10, 10, false))[0].texts, [{ id: 't', x: 0, y: 0 }]);
});

// ── texts ──────────────────────────────────────────────────────────────────
test('upsertText: adds one that is new, updates one that exists', () => {
    const added = cutsReducer(doc(), upsertText(1, { id: 't1', text: 'hello' }));
    assert.deepEqual(added[0].texts.map(t => t.id), ['t1']);
    const edited = cutsReducer(added, upsertText(1, { id: 't1', text: 'goodbye' }));
    assert.equal(edited[0].texts.length, 1, 'not a duplicate');
    assert.equal(edited[0].texts[0].text, 'goodbye');
});

test('moveText: sets an absolute position on one text', () => {
    const d = [cut(1, { texts: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 5, y: 5 }] })];
    const out = cutsReducer(d, moveText(1, 'b', 100, 200));
    assert.deepEqual(out[0].texts[1], { id: 'b', x: 100, y: 200 });
    assert.deepEqual(out[0].texts[0], { id: 'a', x: 0, y: 0 });
});

test('deleteText: removes just that one', () => {
    const d = [cut(1, { texts: [{ id: 'a' }, { id: 'b' }] })];
    assert.deepEqual(cutsReducer(d, deleteText(1, 'a'))[0].texts.map(t => t.id), ['b']);
});

test('toggleTextVisible: a text with no visible field counts as visible, so it hides first', () => {
    const d = [cut(1, { texts: [{ id: 'a' }] })];
    const hidden = cutsReducer(d, toggleTextVisible(1, 'a'));
    assert.equal(hidden[0].texts[0].visible, false, 'absent means visible, so the first toggle hides');
    assert.equal(cutsReducer(hidden, toggleTextVisible(1, 'a'))[0].texts[0].visible, true);
});

test('text actions cope with a cut that never had a texts array', () => {
    const d = [{ id: 1, layers: [] }];
    assert.deepEqual(cutsReducer(d, upsertText(1, { id: 't' }))[0].texts.map(t => t.id), ['t']);
    assert.deepEqual(cutsReducer(d, deleteText(1, 't'))[0].texts, []);
    assert.deepEqual(cutsReducer(d, toggleTextVisible(1, 't'))[0].texts, []);
});

// ── parts ──────────────────────────────────────────────────────────────────
test('the part actions reach the same operations the panel uses', () => {
    const d = [cut(1), cut(2)];
    const grouped = cutsReducer(d, assignPartTo(new Set([1]), 'p1', 'Intro'));
    assert.deepEqual(grouped.map(c => c.partId), ['p1', undefined]);
    const renamed = cutsReducer(grouped, renamePart('p1', 'Verse'));
    assert.equal(renamed[0].partName, 'Verse');
    const ungrouped = cutsReducer(renamed, ungroupPart('p1'));
    assert.equal(ungrouped.length, 2, 'ungrouping keeps the cuts');
    assert.equal(ungrouped[0].partId, undefined);
    const batched = [{ id: 9, videoBatch: 'v' }, cut(1)];
    assert.deepEqual(cutsReducer(batched, removeBatch('v')).map(c => c.id), [1], 'removing a batch does delete');
});

// ── escape hatches ─────────────────────────────────────────────────────────
test('patchCut merges what the function returns into one cut', () => {
    const out = cutsReducer(doc(), patchCut(2, c => ({ name: c.name + '!' })));
    assert.equal(out[1].name, 'Cut 2!');
    assert.equal(out[1].track, 0, 'a partial return patches rather than replaces');
    assert.equal(out[0].name, 'Cut 1');
});

test('patchCuts replaces the whole list with what the function returns', () => {
    assert.deepEqual(cutsReducer(doc(), patchCuts(list => list.filter(c => c.id === 2))).map(c => c.id), [2]);
});

// ── immutability ───────────────────────────────────────────────────────────
test('no action mutates the document it was given', () => {
    const actions = [
        addCuts([cut(3)]), updateCut(1, { name: 'x' }), setCutAnim(1, { inType: 'fade' }), clearCut(1),
        updateLayer(1, 'L1', { visible: false }), setLayerAnim(1, 'L1', { tx: 1 }), moveLayers(1, ['L1'], 5, 5, true),
        upsertText(1, { id: 't' }), moveText(1, 't', 1, 1), deleteText(1, 't'), toggleTextVisible(1, 't'),
        assignPartTo([1], 'p', 'P'), renamePart('p', 'Q'), ungroupPart('p'), removeBatch('v'),
        patchCut(1, () => ({ name: 'y' })), patchCuts(l => l.slice(0, 1)),
    ];
    for (const action of actions) {
        const before = doc();
        const snapshot = JSON.stringify(before);
        cutsReducer(before, action);
        assert.equal(JSON.stringify(before), snapshot, `${action.type} mutated the input`);
    }
});
