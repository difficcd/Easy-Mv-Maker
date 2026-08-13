// Tests for the layer-tree moves. These used to live inside a drag-and-drop event handler where
// nothing could reach them; the cycle rejection in particular is the kind of rule that is easy to
// break by accident and impossible to notice until a subtree vanishes from the panel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { moveLayer, isDescendantOf, resolveDrawLayer, commitStroke, insertFill, offsetLayers } from '../src/core/layerOps.js';
import { flattenLayersInUiOrder } from '../src/canvas/canvasUtils.js';

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

test('offsetLayers: texts move only when the drag includes them', () => {
    const cut = { layers: [], texts: [{ id: 't', x: 10, y: 10 }] };
    assert.deepEqual(offsetLayers(cut, [], 5, 5, true).texts, [{ id: 't', x: 15, y: 15 }]);
    assert.deepEqual(offsetLayers(cut, [], 5, 5, false).texts, [{ id: 't', x: 10, y: 10 }]);
    // A text with no position yet starts from the origin rather than becoming NaN.
    const noPos = { layers: [], texts: [{ id: 't' }] };
    assert.deepEqual(offsetLayers(noPos, [], 5, 5, true).texts, [{ id: 't', x: 5, y: 5 }]);
});

test('offsetLayers: does not mutate the cut it was given', () => {
    const cut = { layers: [{ id: 'a', strokes: [{ id: 1, points: [{ x: 10, y: 20 }] }] }], texts: [{ id: 't', x: 1, y: 2 }] };
    const before = JSON.parse(JSON.stringify(cut));
    offsetLayers(cut, ['a'], 100, 100, true);
    assert.deepEqual(cut, before);
});

test('offsetLayers: a cut with nothing in it is not a special case for the caller', () => {
    assert.deepEqual(offsetLayers({}, ['a'], 1, 1, true), { layers: [], texts: [] });
    assert.deepEqual(offsetLayers(undefined, undefined, 1, 1, false), { layers: [], texts: [] });
});
