// Tests for the layer-tree moves. These used to live inside a drag-and-drop event handler where
// nothing could reach them; the cycle rejection in particular is the kind of rule that is easy to
// break by accident and impossible to notice until a subtree vanishes from the panel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { moveLayer, isDescendantOf, resolveDrawLayer, commitStroke, insertFill, offsetLayers, mergeDown, patchLayer, mkLayer, mkFolder, nextLayerId, appendLayer, appendFolder, removeLayerTree, dropPositionFor, moveLayerToEnd, appendPoints } from '../src/core/layerOps.js';
import { flattenLayersInUiOrder } from '../src/core/layerTree.js';

// f1 > a, b   then c at the root
const tree = () => ([
    { id: 'f1', type: 'folder', parentId: null },
    { id: 'a', type: 'layer', parentId: 'f1' },
    { id: 'b', type: 'layer', parentId: 'f1' },
    { id: 'c', type: 'layer', parentId: null },
]);
const ids = (ls) => ls.map(l => l.id);
const parentOf = (ls, id) => ls.find(l => l.id === id).parentId;

test('isDescendantOf: self, child and unrelated', () => {
    const t = tree();
    assert.equal(isDescendantOf(t, 'f1', 'f1'), true, 'a folder is its own descendant for this check');
    assert.equal(isDescendantOf(t, 'a', 'f1'), true);
    assert.equal(isDescendantOf(t, 'c', 'f1'), false);
});

test('isDescendantOf: a corrupted parent cycle terminates instead of hanging', () => {
    const cyclic = [
        { id: 'x', type: 'folder', parentId: 'y' },
        { id: 'y', type: 'folder', parentId: 'x' },
    ];
    assert.equal(isDescendantOf(cyclic, 'x', 'z'), false);
});

test('moveLayer: reorder within the same parent', () => {
    const out = moveLayer(tree(), 'b', 'a', 'before');
    assert.deepEqual(ids(out), ['f1', 'b', 'a', 'c']);
    assert.equal(parentOf(out, 'b'), 'f1', 'the parent is unchanged');
});

test('moveLayer: dropping beside a target adopts that target\'s parent', () => {
    // c is at the root; dropping it after 'a' should put it inside f1.
    const out = moveLayer(tree(), 'c', 'a', 'after');
    assert.equal(parentOf(out, 'c'), 'f1');
    assert.deepEqual(ids(out), ['f1', 'a', 'c', 'b']);
});

test('moveLayer: dropping inside a folder lands after its existing children', () => {
    const out = moveLayer(tree(), 'c', 'f1', 'inside');
    assert.equal(parentOf(out, 'c'), 'f1');
    assert.deepEqual(ids(out), ['f1', 'a', 'b', 'c'], 'after a and b, not before them');
});

test('moveLayer: a folder cannot be dropped into itself or its own child', () => {
    const nested = [
        { id: 'outer', type: 'folder', parentId: null },
        { id: 'inner', type: 'folder', parentId: 'outer' },
        { id: 'leaf', type: 'layer', parentId: 'inner' },
    ];
    assert.equal(moveLayer(nested, 'outer', 'outer', 'inside'), null, 'into itself');
    assert.equal(moveLayer(nested, 'outer', 'inner', 'inside'), null, 'into its own child');
    // The other direction is legitimate.
    assert.notEqual(moveLayer(nested, 'inner', 'outer', 'inside'), null);
});

test('moveLayer: a plain layer may go inside a folder that a folder may not', () => {
    const nested = [
        { id: 'outer', type: 'folder', parentId: null },
        { id: 'inner', type: 'folder', parentId: 'outer' },
        { id: 'leaf', type: 'layer', parentId: null },
    ];
    const out = moveLayer(nested, 'leaf', 'inner', 'inside');
    assert.equal(parentOf(out, 'leaf'), 'inner');
});

test('moveLayer: refusals return null rather than a mangled array', () => {
    assert.equal(moveLayer(tree(), 'a', 'a', 'after'), null, 'onto itself');
    assert.equal(moveLayer(tree(), 'nope', 'a', 'after'), null, 'unknown source');
    assert.equal(moveLayer(tree(), 'a', 'nope', 'after'), null, 'unknown target');
    assert.equal(moveLayer(null, 'a', 'b'), null, 'no layers at all');
});

test('moveLayer: the input array is not mutated', () => {
    const before = tree();
    const snapshot = JSON.stringify(before);
    moveLayer(before, 'c', 'f1', 'inside');
    assert.equal(JSON.stringify(before), snapshot);
});

test('moveLayer: nothing is lost or duplicated by a move', () => {
    for (const [drag, target, pos] of [['c', 'f1', 'inside'], ['a', 'c', 'after'], ['b', 'f1', 'before']]) {
        const out = moveLayer(tree(), drag, target, pos);
        assert.equal(out.length, 4, `${drag}->${target} keeps the count`);
        assert.equal(new Set(ids(out)).size, 4, 'no duplicates');
    }
});

// ── where a stroke goes, and whether it can be seen ────────────────────────
// This project has a history of "the line I just drew disappeared". These two functions are why
// it does not happen any more, so the rules are worth pinning down.

const flat = flattenLayersInUiOrder;

test('resolveDrawLayer: a usable active layer is used as-is', () => {
    const cut = { activeLayerId: 'a', layers: [{ id: 'a', type: 'layer', parentId: null, visible: true }] };
    assert.equal(resolveDrawLayer(cut, flat).id, 'a');
});

test('resolveDrawLayer: a hidden active layer is still chosen, not skipped', () => {
    // Skipping it would move the stroke somewhere the user did not ask for; commitStroke reveals
    // the layer instead.
    const cut = {
        activeLayerId: 'hidden',
        layers: [
            { id: 'vis', type: 'layer', parentId: null, visible: true },
            { id: 'hidden', type: 'layer', parentId: null, visible: false },
        ],
    };
    assert.equal(resolveDrawLayer(cut, flat).id, 'hidden');
});

test('resolveDrawLayer: a folder as active falls back to a real layer', () => {
    const cut = {
        activeLayerId: 'f1',
        layers: [
            { id: 'f1', type: 'folder', parentId: null, visible: true },
            { id: 'a', type: 'layer', parentId: 'f1', visible: true },
        ],
    };
    const got = resolveDrawLayer(cut, flat);
    assert.equal(got.type, 'layer', 'never returns a folder to draw into');
});

test('resolveDrawLayer: a stale active id falls back rather than returning nothing', () => {
    const cut = {
        activeLayerId: 'deleted',
        layers: [{ id: 'a', type: 'layer', parentId: null, visible: true }],
    };
    assert.equal(resolveDrawLayer(cut, flat).id, 'a');
});

test('resolveDrawLayer: nothing drawable means null, not a crash', () => {
    assert.equal(resolveDrawLayer(null, flat), null);
    assert.equal(resolveDrawLayer({ layers: [] }, flat), null);
    assert.equal(resolveDrawLayer({ activeLayerId: 'x', layers: [{ id: 'f', type: 'folder', parentId: null, visible: true }] }, flat), null);
});

test('commitStroke: the stroke is appended and the layer becomes visible', () => {
    const layers = [{ id: 'a', type: 'layer', parentId: null, visible: false, strokes: [] }];
    const out = commitStroke(layers, 'a', { id: 's1' });
    assert.equal(out.activeLayerId, 'a');
    assert.deepEqual(out.layers[0].strokes.map(s => s.id), ['s1']);
    assert.equal(out.layers[0].visible, true, 'drawing into a hidden layer reveals it');
});

test('commitStroke: every folder above the layer is revealed too', () => {
    const layers = [
        { id: 'outer', type: 'folder', parentId: null, visible: false },
        { id: 'inner', type: 'folder', parentId: 'outer', visible: false },
        { id: 'a', type: 'layer', parentId: 'inner', visible: false, strokes: [] },
    ];
    const out = commitStroke(layers, 'a', { id: 's1' });
    for (const l of out.layers) assert.equal(l.visible, true, `${l.id} must be visible`);
});

test('commitStroke: unrelated layers are untouched', () => {
    const layers = [
        { id: 'a', type: 'layer', parentId: null, visible: false, strokes: [] },
        { id: 'b', type: 'layer', parentId: null, visible: false, strokes: [] },
    ];
    const out = commitStroke(layers, 'a', { id: 's1' });
    assert.equal(out.layers[1].visible, false, 'b stays hidden');
    assert.equal(out.layers[1].strokes.length, 0);
});

test('commitStroke: the input is not mutated', () => {
    const layers = [{ id: 'a', type: 'layer', parentId: null, visible: false, strokes: [] }];
    const snapshot = JSON.stringify(layers);
    commitStroke(layers, 'a', { id: 's1' });
    assert.equal(JSON.stringify(layers), snapshot);
});

test('commitStroke: a missing layer returns null instead of losing the stroke silently', () => {
    assert.equal(commitStroke([{ id: 'a', type: 'layer', parentId: null }], 'nope', { id: 's' }), null);
    assert.equal(commitStroke(null, 'a', { id: 's' }), null);
});

test('commitStroke: a parentId cycle cannot hang the reveal walk', () => {
    const layers = [
        { id: 'x', type: 'folder', parentId: 'y', visible: false },
        { id: 'y', type: 'folder', parentId: 'x', visible: false },
        { id: 'a', type: 'layer', parentId: 'x', visible: false, strokes: [] },
    ];
    const out = commitStroke(layers, 'a', { id: 's1' });
    assert.ok(out, 'returns rather than looping forever');
});

// ── bucket fill placement ──────────────────────────────────────────────────
// Paint belongs under the ink so a fill can bleed past the line that bounds it: on a boiling
// layer the ink walks about, and paint that stopped exactly at the old edge leaves a gap.
test('insertFill: paint on a blank region goes under the ink', () => {
    const strokes = [{ id: 1, tool: 'pen' }, { id: 2, tool: 'pen' }];
    const fill = { id: 9, tool: 'paste' };
    assert.deepEqual(insertFill(strokes, fill, false).map(s => s.id), [9, 1, 2]);
});

test('insertFill: recolouring existing paint goes on top, or it would be hidden by it', () => {
    const strokes = [{ id: 1, tool: 'pen' }, { id: 2, tool: 'paste' }];
    const fill = { id: 9, tool: 'paste' };
    assert.deepEqual(insertFill(strokes, fill, true).map(s => s.id), [1, 2, 9]);
});

test('insertFill: never slides beneath an eraser, which would eat it', () => {
    // An eraser composites destination-out against what is below it.
    const strokes = [{ id: 1, tool: 'pen' }, { id: 2, tool: 'eraser' }, { id: 3, tool: 'pen' }];
    const out = insertFill(strokes, { id: 9, tool: 'paste' }, false).map(s => s.id);
    assert.deepEqual(out, [1, 2, 9, 3]);
    assert.ok(out.indexOf(9) > out.indexOf(2), 'above the eraser');
    assert.ok(out.indexOf(9) < out.indexOf(3), 'still under ink drawn after it');
});

test('insertFill: sits above earlier paint, including an imported video frame', () => {
    const strokes = [{ id: 1, tool: 'paste' }, { id: 2, tool: 'pen' }];
    assert.deepEqual(insertFill(strokes, { id: 9, tool: 'paste' }, false).map(s => s.id), [1, 9, 2]);
});

test('insertFill: an empty or missing layer is not a special case for the caller', () => {
    assert.deepEqual(insertFill([], { id: 9 }, false).map(s => s.id), [9]);
    assert.deepEqual(insertFill(undefined, { id: 9 }, false).map(s => s.id), [9]);
});

test('insertFill: does not mutate the list it was given', () => {
    const strokes = [{ id: 1, tool: 'pen' }];
    const copy = [...strokes];
    insertFill(strokes, { id: 9, tool: 'paste' }, false);
    assert.deepEqual(strokes, copy);
});

// ── moving whole layers ────────────────────────────────────────────────────
test('offsetLayers: moves path strokes point by point and placed bitmaps by their origin', () => {
    const cut = {
        layers: [
            { id: 'a', strokes: [{ id: 1, points: [{ x: 10, y: 20, pressure: 0.5 }, { x: 30, y: 40 }] }] },
            { id: 'b', strokes: [{ id: 2, tool: 'paste', x: 100, y: 200 }] },
        ],
        texts: [],
    };
    const out = offsetLayers(cut, ['a', 'b'], 5, -3, false);
    assert.deepEqual(out.layers[0].strokes[0].points, [{ x: 15, y: 17, pressure: 0.5 }, { x: 35, y: 37 }],
        'pressure and any other point field survive the move');
    assert.deepEqual({ x: out.layers[1].strokes[0].x, y: out.layers[1].strokes[0].y }, { x: 105, y: 197 });
});

test('offsetLayers: bumps rev, because a move is invisible to the stroke signature', () => {
    // strokeSig is built from stroke count and the last stroke's identity, so coordinates
    // changing underneath it would leave the cached canvas drawing at the old position.
    const cut = { layers: [{ id: 'a', rev: 2, strokes: [{ id: 1, points: [{ x: 0, y: 0 }] }] }], texts: [] };
    assert.equal(offsetLayers(cut, ['a'], 1, 1, false).layers[0].rev, 3);
    const noRev = { layers: [{ id: 'a', strokes: [] }], texts: [] };
    assert.equal(offsetLayers(noRev, ['a'], 1, 1, false).layers[0].rev, 1, 'starts from nothing');
});

test('offsetLayers: layers not being dragged are left exactly as they were', () => {
    const other = { id: 'z', rev: 7, strokes: [{ id: 9, points: [{ x: 1, y: 1 }] }] };
    const cut = { layers: [{ id: 'a', strokes: [] }, other], texts: [] };
    const out = offsetLayers(cut, ['a'], 10, 10, false);
    assert.equal(out.layers[1], other, 'the very same object, not a copy');
});

test('offsetLayers: texts never move with a layer', () => {
    // A text and a layer coexist in a cut; neither belongs to the other. Texts riding along with
    // a layer move was reported as a bug (#177): the user moved the drawing and the caption went
    // with it.
    const cut = { layers: [{ id: 'a', strokes: [{ id: 1, points: [{ x: 0, y: 0 }] }] }], texts: [{ id: 't', x: 10, y: 10 }] };
    const out = offsetLayers(cut, ['a'], 5, 5);
    assert.equal('texts' in out, false, 'the cut keeps its own texts untouched');
    assert.deepEqual(out.layers[0].strokes[0].points, [{ x: 5, y: 5 }]);
});

test('offsetLayers: does not mutate the cut it was given', () => {
    const cut = { layers: [{ id: 'a', strokes: [{ id: 1, points: [{ x: 10, y: 20 }] }] }], texts: [{ id: 't', x: 1, y: 2 }] };
    const before = JSON.parse(JSON.stringify(cut));
    offsetLayers(cut, ['a'], 100, 100, true);
    assert.deepEqual(cut, before);
});

test('offsetLayers: a cut with nothing in it is not a special case for the caller', () => {
    assert.deepEqual(offsetLayers({}, ['a'], 1, 1), { layers: [] });
    assert.deepEqual(offsetLayers(undefined, undefined, 1, 1), { layers: [] });
});

// ── merging a layer down ───────────────────────────────────────────────────
const stack = () => ([
    { id: 'top', type: 'layer', parentId: null, visible: true, strokes: [{ id: 't1' }] },
    { id: 'mid', type: 'layer', parentId: null, visible: true, strokes: [{ id: 'm1' }] },
    { id: 'bot', type: 'layer', parentId: null, visible: true, strokes: [{ id: 'b1' }] },
]);

test('mergeDown: the upper layer goes away and its strokes land on top of the lower one', () => {
    // Order matters: later strokes draw over earlier ones, so appending is what keeps the
    // merged layer looking like the two did.
    const out = mergeDown(stack(), 'top', flat);
    assert.deepEqual(out.layers.map(l => l.id), ['mid', 'bot']);
    assert.deepEqual(out.layers[0].strokes.map(s => s.id), ['m1', 't1']);
    assert.equal(out.activeLayerId, 'mid', 'the surviving layer becomes the active one');
});

test('mergeDown: "below" follows what the user sees, not the array', () => {
    const out = mergeDown(stack(), 'mid', flat);
    assert.deepEqual(out.layers.map(l => l.id), ['top', 'bot']);
    assert.deepEqual(out.layers[1].strokes.map(s => s.id), ['b1', 'm1']);
});

test('mergeDown: the bottom layer has nothing to merge into', () => {
    // Returning null rather than deleting it: losing a layer to a misplaced click is expensive.
    assert.equal(mergeDown(stack(), 'bot', flat), null);
});

test('mergeDown: a folder is neither a source nor a target', () => {
    const withFolder = [
        { id: 'f', type: 'folder', parentId: null, visible: true },
        { id: 'a', type: 'layer', parentId: 'f', visible: true, strokes: [{ id: 'a1' }] },
        { id: 'b', type: 'layer', parentId: null, visible: true, strokes: [{ id: 'b1' }] },
    ];
    assert.equal(mergeDown(withFolder, 'f', flat), null, 'a folder is a container, not a surface');
    const out = mergeDown(withFolder, 'a', flat);
    assert.deepEqual(out.layers.find(l => l.id === 'b').strokes.map(s => s.id), ['b1', 'a1'],
        'the folder is skipped as a target');
});

test('mergeDown: merging into a hidden layer reveals it', () => {
    // Otherwise the work disappears at the moment of merging, which reads as data loss.
    const s = [
        { id: 'top', type: 'layer', parentId: null, visible: true, strokes: [{ id: 't' }] },
        { id: 'bot', type: 'layer', parentId: null, visible: false, strokes: [] },
    ];
    assert.equal(mergeDown(s, 'top', flat).layers[0].visible, true);
});

test('mergeDown: bumps rev and drops redo on the surviving layer', () => {
    const s = [
        { id: 'top', type: 'layer', parentId: null, visible: true, strokes: [{ id: 't' }] },
        { id: 'bot', type: 'layer', parentId: null, visible: true, rev: 3, strokes: [], redoStrokes: [{ id: 'r' }] },
    ];
    const merged = mergeDown(s, 'top', flat).layers[0];
    assert.equal(merged.rev, 4);
    assert.deepEqual(merged.redoStrokes, [], 'those steps cannot be replayed onto the merged result');
});

test('mergeDown: bitmap ids are carried across, not copied', () => {
    // The pixels keep one owner because the source layer is removed in the same move; copying
    // would leave the originals unreferenced for the collector to free.
    const s = [
        { id: 'top', type: 'layer', parentId: null, visible: true, strokes: [{ id: 't', bitmapId: 'bmp' }] },
        { id: 'bot', type: 'layer', parentId: null, visible: true, strokes: [] },
    ];
    assert.equal(mergeDown(s, 'top', flat).layers[0].strokes[0].bitmapId, 'bmp');
});

test('mergeDown: an unknown layer, or none at all, changes nothing', () => {
    assert.equal(mergeDown(stack(), 'nope', flat), null);
    assert.equal(mergeDown([], 'a', flat), null);
    assert.equal(mergeDown(null, 'a', flat), null);
});

test('mergeDown: does not mutate the layers it was given', () => {
    const before = stack();
    const snapshot = JSON.stringify(before);
    mergeDown(before, 'top', flat);
    assert.equal(JSON.stringify(before), snapshot);
});

// --- patchLayer --------------------------------------------------------------------------------

test('patchLayer changes the matching layer and leaves the others identical', () => {
    const a = { id: 1, visible: true }, b = { id: 2, visible: true };
    const out = patchLayer([a, b], 2, () => ({ visible: false }));
    assert.equal(out[0], a, 'untouched layers are the same object, so React can skip them');
    assert.deepEqual(out[1], { id: 2, visible: false });
    assert.notEqual(out[1], b, 'the patched one is a copy');
});

test('patchLayer sees the layer, so a caller can build on what was there', () => {
    const out = patchLayer([{ id: 1, strokes: ['a'] }], 1, l => ({ strokes: [...l.strokes, 'b'] }));
    assert.deepEqual(out[0].strokes, ['a', 'b']);
});

test('patchLayer leaves the original list alone', () => {
    const layers = [{ id: 1, visible: true }];
    patchLayer(layers, 1, () => ({ visible: false }));
    assert.equal(layers[0].visible, true);
});

test('an id that matches nothing changes nothing', () => {
    const layers = [{ id: 1 }, { id: 2 }];
    const out = patchLayer(layers, 99, () => ({ visible: false }));
    assert.deepEqual(out, layers);
});

test('the patch never runs for a layer that does not match', () => {
    // Ids are unique within a cut and not across cuts, so a patch handed the wrong cut's layers
    // must do nothing rather than something surprising to a same-numbered layer elsewhere.
    let calls = 0;
    patchLayer([{ id: 1 }, { id: 2 }, { id: 3 }], 2, () => { calls++; return {}; });
    assert.equal(calls, 1);
});

test('patchLayer survives being handed nothing', () => {
    assert.deepEqual(patchLayer(null, 1, () => ({})), []);
    assert.deepEqual(patchLayer(undefined, 1, () => ({})), []);
});

test('commitStroke: several strokes land as one change, in order', () => {
    // An erase-hole plus a paste is one edit. Committed separately they would be two history
    // entries, and undo would put the hole back without the pixels.
    const layers = [{ id: 1, type: 'layer', parentId: null, visible: false, strokes: [{ id: 0 }] }];
    const r = commitStroke(layers, 1, [{ id: 'hole' }, { id: 'pixels' }]);
    assert.deepEqual(r.layers[0].strokes.map(s => s.id), [0, 'hole', 'pixels']);
    assert.equal(r.layers[0].visible, true, 'and the layer is revealed the same way');
});

// ── adding and removing ────────────────────────────────────────────────────
test('nextLayerId: one past the largest in the cut, and 1 for an empty cut', () => {
    assert.equal(nextLayerId([{ id: 3 }, { id: 7 }, { id: 2 }]), 8);
    assert.equal(nextLayerId([]), 1);
    assert.equal(nextLayerId(undefined), 1);
});

test('appendLayer: a blank layer at the end, made active; appendFolder: not made active', () => {
    const cut = { layers: [mkLayer(1)], activeLayerId: 1 };
    const a = appendLayer(cut);
    assert.deepEqual(a.layers.map(l => l.id), [1, 2]);
    assert.equal(a.activeLayerId, 2);
    assert.deepEqual(a.layers[1], mkLayer(2), 'every field a layer needs');
    const f = appendFolder(cut);
    assert.deepEqual(f.layers[1], mkFolder(2));
    assert.equal('activeLayerId' in f, false, 'a folder cannot be drawn on');
});

test('removeLayerTree: a folder takes everything nested inside it, at any depth', () => {
    const layers = [
        { id: 1, type: 'folder', parentId: null }, { id: 2, type: 'folder', parentId: 1 },
        { id: 3, type: 'layer', parentId: 2 }, { id: 4, type: 'layer', parentId: null },
    ];
    const r = removeLayerTree({ layers, activeLayerId: 4 }, 1);
    assert.deepEqual(r.layers.map(l => l.id), [4]);
    assert.equal(r.activeLayerId, 4, 'an active layer the deletion did not touch stays');
});

test('removeLayerTree: deleting the active layer moves activity to the first drawable one left', () => {
    const layers = [{ id: 1, type: 'folder', parentId: null }, { id: 2, type: 'layer', parentId: null }, { id: 3, type: 'layer', parentId: null }];
    const r = removeLayerTree({ layers, activeLayerId: 2 }, 2);
    assert.equal(r.activeLayerId, 3, 'not the folder, which comes first but cannot be drawn on');
});

test('removeLayerTree: deleting the last drawable layer leaves a fresh blank one, active', () => {
    // A cut with no drawable layer is one nothing can be drawn on; the next stroke would vanish.
    const r = removeLayerTree({ layers: [mkLayer(5)], activeLayerId: 5 }, 5);
    assert.equal(r.layers.length, 1);
    assert.equal(r.layers[0].type, 'layer');
    assert.equal(r.layers[0].id, 1, 'numbered within the cut, not from the global counter');
    assert.equal(r.activeLayerId, 1);
});

// ── drag and drop geometry ─────────────────────────────────────────────────
test('dropPositionFor: top half before, bottom half after; a folder has an inside band', () => {
    const rect = { top: 100, height: 32 };            // mid = 116
    assert.equal(dropPositionFor(105, rect, 'layer'), 'before');
    assert.equal(dropPositionFor(120, rect, 'layer'), 'after');
    assert.equal(dropPositionFor(120, rect, 'folder'), 'inside', 'the band reaches below the middle');
    assert.equal(dropPositionFor(113, rect, 'folder'), 'inside', 'and a little above it');
    assert.equal(dropPositionFor(104, rect, 'folder'), 'before', 'a strip at the top still drops before');
    assert.equal(dropPositionFor(130, rect, 'folder'), 'after', 'and past the band, after');
});

test('moveLayerToEnd: to the end at the top level; a layer that is not there changes nothing', () => {
    const layers = [{ id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: null }];
    assert.deepEqual(moveLayerToEnd(layers, 2), [{ id: 1, parentId: null }, { id: 3, parentId: null }, { id: 2, parentId: null }]);
    assert.equal(moveLayerToEnd(layers, 99), null);
    assert.deepEqual(layers.map(l => l.id), [1, 2, 3], 'the input is not mutated');
});

test('appendPoints: extends the stroke being drawn without touching the old objects', () => {
    const last = { id: 2, tool: 'eraser', points: [{ x: 0, y: 0 }] };
    const strokes = [{ id: 1, tool: 'brush', points: [] }, last];
    const out = appendPoints(strokes, [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    assert.equal(out[1].points.length, 3);
    assert.equal(last.points.length, 1, 'the stroke in the old state is untouched');
    assert.equal(out[0], strokes[0], 'earlier strokes are shared, not copied');
    assert.deepEqual(appendPoints([{ tool: 'paste', bitmapId: 'b' }], [{ x: 1, y: 1 }]), [{ tool: 'paste', bitmapId: 'b' }], 'a paste is not being drawn');
    assert.deepEqual(appendPoints([], [{ x: 1, y: 1 }]), []);
});

test('commitStroke: a placement decides where the stroke lands, and the reveal still happens', () => {
    // The bucket fill puts paint *under* the ink it fills around, so it cannot simply append -
    // but it needs the reveal as much as any stroke, or a fill into a hidden layer lands and
    // shows nothing.
    const layers = [{ id: 1, type: 'layer', parentId: null, visible: false, strokes: [{ id: 'ink' }] }];
    const r = commitStroke(layers, 1, { id: 'paint' }, (strokes, st) => [st, ...strokes]);
    assert.deepEqual(r.layers[0].strokes.map(s => s.id), ['paint', 'ink']);
    assert.equal(r.layers[0].visible, true);
});

// --- a move takes the mosaic region with it ---

test('offsetLayers moves the mosaic region with the drawing', () => {
    // The region says which part of *this drawing* is pixelated. Left behind, the drawing walks
    // out from under its own mosaic.
    const cut = { layers: [{
        id: 'a', strokes: [{ points: [{ x: 10, y: 10 }] }],
        anim: { mosaic: 40, mosaicRect: { x: 100, y: 200, w: 300, h: 150 } },
    }] };
    const out = offsetLayers(cut, ['a'], 25, -15);
    assert.deepEqual(out.layers[0].anim.mosaicRect, { x: 125, y: 185, w: 300, h: 150 });
});

test('offsetLayers leaves a layer without a region alone', () => {
    const cut = { layers: [{ id: 'a', strokes: [], anim: { mosaic: 40 } }] };
    const out = offsetLayers(cut, ['a'], 25, -15);
    assert.deepEqual(out.layers[0].anim, { mosaic: 40 });
    const noAnim = offsetLayers({ layers: [{ id: 'a', strokes: [] }] }, ['a'], 5, 5);
    assert.equal(noAnim.layers[0].anim, undefined);
});

test('offsetLayers does not move the motion path', () => {
    // Where the part travels is a statement about the frame, not about the drawing, and it has
    // always worked that way. Pinned so the region change above does not quietly grow.
    const path = [{ x: 0, y: 0 }, { x: 50, y: 50 }];
    const cut = { layers: [{ id: 'a', strokes: [], anim: { path } }] };
    assert.deepEqual(offsetLayers(cut, ['a'], 25, -15).layers[0].anim.path, path);
});
