// Tests for the layer-tree moves. These used to live inside a drag-and-drop event handler where
// nothing could reach them; the cycle rejection in particular is the kind of rule that is easy to
// break by accident and impossible to notice until a subtree vanishes from the panel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { moveLayer, isDescendantOf } from '../src/layerOps.js';

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
