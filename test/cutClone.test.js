// Copying a cut. Two things in a cut are shared rather than owned - layer ids, which are only
// unique within a cut, and stroke pixels, which live in a separate store - so a deep copy alone
// produces a duplicate that quietly aliases the original.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneCutContents } from '../src/cutClone.js';

// Stands in for the real one: hands back a new id per distinct old id, sharing within a call.
const fakeCloneBitmap = () => {
    let n = 0;
    const fn = (oldId, cache) => {
        if (!oldId) return oldId;
        if (cache.has(oldId)) return cache.get(oldId);
        const id = `copy${++n}`;
        cache.set(oldId, id);
        return id;
    };
    fn.count = () => n;
    return fn;
};
const clone = (cut) => cloneCutContents(cut, fakeCloneBitmap());

test('layer ids are renumbered from 1, since they are only unique within a cut', () => {
    const out = clone({ layers: [{ id: 77, type: 'layer' }, { id: 5, type: 'layer' }], activeLayerId: 5 });
    assert.deepEqual(out.layers.map(l => l.id), [1, 2]);
    assert.equal(out.activeLayerId, 2, 'the active layer follows the renumbering');
});

test('nesting survives the renumbering', () => {
    const out = clone({
        layers: [{ id: 'f', type: 'folder' }, { id: 'a', type: 'layer', parentId: 'f' }],
        activeLayerId: 'a',
    });
    assert.equal(out.layers[1].parentId, out.layers[0].id, 'still inside the same folder');
});

test('a parent left outside the copy becomes a root layer, not a dangling id', () => {
    // The old id would mean something else in the destination cut.
    const out = clone({ layers: [{ id: 'a', type: 'layer', parentId: 'elsewhere' }], activeLayerId: 'a' });
    assert.equal(out.layers[0].parentId, null);
});

test('stroke pixels are copied, so editing one cut cannot change the other', () => {
    const out = clone({
        layers: [{ id: 1, type: 'layer', strokes: [{ id: 's1', bitmapId: 'bmp' }] }],
        activeLayerId: 1,
    });
    assert.notEqual(out.layers[0].strokes[0].bitmapId, 'bmp', 'a fresh bitmap, not the same one');
});

test('a bitmap used twice stays one bitmap in the copy', () => {
    const cloneBitmap = fakeCloneBitmap();
    const out = cloneCutContents({
        layers: [
            { id: 1, type: 'layer', strokes: [{ id: 'a', bitmapId: 'shared' }] },
            { id: 2, type: 'layer', strokes: [{ id: 'b', bitmapId: 'shared' }] },
        ],
        activeLayerId: 1,
    }, cloneBitmap);
    assert.equal(cloneBitmap.count(), 1, 'copied once, not once per stroke');
    assert.equal(out.layers[0].strokes[0].bitmapId, out.layers[1].strokes[0].bitmapId);
});

test('strokes without pixels are left alone', () => {
    const out = clone({ layers: [{ id: 1, type: 'layer', strokes: [{ id: 's', tool: 'pen', points: [{ x: 1, y: 2 }] }] }], activeLayerId: 1 });
    assert.deepEqual(out.layers[0].strokes[0].points, [{ x: 1, y: 2 }]);
    assert.equal('bitmapId' in out.layers[0].strokes[0], false);
});

test('redo is not carried over: it belongs to the session that produced it', () => {
    const out = clone({ layers: [{ id: 1, type: 'layer', strokes: [], redoStrokes: [{ id: 'r' }] }], activeLayerId: 1 });
    assert.deepEqual(out.layers[0].redoStrokes, []);
});

test('the copy is deep: changing it does not reach back to the original', () => {
    const src = {
        layers: [{ id: 1, type: 'layer', strokes: [{ id: 's', points: [{ x: 0, y: 0 }] }] }],
        activeLayerId: 1,
        texts: [{ id: 't', text: 'hello' }],
    };
    const out = clone(src);
    out.layers[0].strokes[0].points[0].x = 999;
    out.texts[0].text = 'changed';
    assert.equal(src.layers[0].strokes[0].points[0].x, 0);
    assert.equal(src.texts[0].text, 'hello');
});

test('an active layer that no longer exists falls back to a real one', () => {
    // With none, the first stroke drawn into the copy would have nowhere to go.
    const out = clone({ layers: [{ id: 'x', type: 'folder' }, { id: 'y', type: 'layer' }], activeLayerId: 'gone' });
    const active = out.layers.find(l => l.id === out.activeLayerId);
    assert.equal(active.type, 'layer', 'never a folder');
});

test('an empty or malformed cut copies to something usable', () => {
    for (const src of [{}, { layers: [] }, undefined]) {
        const out = clone(src);
        assert.deepEqual(out.layers, []);
        assert.deepEqual(out.texts, []);
        assert.equal(out.activeLayerId, 1, 'a usable id even with no layers');
    }
});
