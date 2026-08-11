// The bitmap collector only fails in one direction: if a reference source is missed, pixels that
// are still needed get freed and an undo or a paste comes back blank. Each source gets its own
// test so adding a new one without teaching the collector about it shows up here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUsedBitmapIds, unusedBitmapIds } from '../src/bitmapRefs.js';

const cutWith = (...bitmapIds) => ({
    id: 'c1',
    layers: [{ id: 'L1', strokes: bitmapIds.map((b, i) => ({ id: i, tool: 'paste', bitmapId: b })) }],
});

test('collects ids from the cuts on screen', () => {
    const used = collectUsedBitmapIds({ cuts: [cutWith('b1', 'b2')] });
    assert.deepEqual([...used].sort(), ['b1', 'b2']);
});

test('undo history counts - its bitmaps are gone from the current cuts by definition', () => {
    const used = collectUsedBitmapIds({
        cuts: [cutWith('current')],
        history: [{ cuts: [cutWith('older')] }, { cuts: [cutWith('oldest')] }],
    });
    assert.ok(used.has('older') && used.has('oldest'), 'undo would restore an empty region without these');
});

test('the clipboard counts, whether it holds one cut or several', () => {
    assert.ok(collectUsedBitmapIds({ copiedCut: cutWith('one') }).has('one'));
    const many = collectUsedBitmapIds({ copiedCut: [cutWith('a'), cutWith('b')] });
    assert.ok(many.has('a') && many.has('b'));
});

test('a copied lasso clip counts', () => {
    assert.ok(collectUsedBitmapIds({ lassoClip: { bitmapId: 'clip' } }).has('clip'));
});

test('a live selection keeps both its pixels and its mask', () => {
    const used = collectUsedBitmapIds({ selection: { bitmapId: 'sel', maskBitmapId: 'mask' } });
    assert.ok(used.has('sel'), 'the lifted pixels');
    assert.ok(used.has('mask'), 'losing the mask alone makes the region come back as a rectangle');
});

test('strokes without a bitmap contribute nothing', () => {
    const cuts = [{ id: 'c', layers: [{ id: 'L', strokes: [{ id: 1, pen: 'brush' }, { id: 2, bitmapId: 'b' }] }] }];
    assert.deepEqual([...collectUsedBitmapIds({ cuts })], ['b']);
});

test('malformed input is tolerated rather than throwing mid-collection', () => {
    // Throwing here would abort the sweep and leak instead of over-deleting, but a crash during
    // autosave is its own problem.
    assert.doesNotThrow(() => collectUsedBitmapIds());
    assert.doesNotThrow(() => collectUsedBitmapIds({ cuts: null, history: null }));
    assert.doesNotThrow(() => collectUsedBitmapIds({ cuts: [null, { layers: null }, { layers: [null] }] }));
    assert.equal(collectUsedBitmapIds({ cuts: [{ layers: [{ strokes: [null] }] }] }).size, 0);
});

test('unusedBitmapIds: only ids no source mentions are returned', () => {
    const keys = ['keep', 'inHistory', 'inClip', 'orphan'];
    const out = unusedBitmapIds(keys, {
        cuts: [cutWith('keep')],
        history: [{ cuts: [cutWith('inHistory')] }],
        copiedCut: cutWith('inClip'),
    });
    assert.deepEqual(out, ['orphan']);
});

test('unusedBitmapIds: with no sources at all everything is orphaned', () => {
    assert.deepEqual(unusedBitmapIds(['a', 'b'], {}), ['a', 'b']);
});
