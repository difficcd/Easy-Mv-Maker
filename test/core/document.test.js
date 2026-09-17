import test from 'node:test';
import assert from 'node:assert/strict';
import { mkCut, firstCut } from '../../src/core/document.js';

test('mkCut: every field a cut needs, including an empty texts array', () => {
    // One copy had no texts array. Nothing crashed - safeArray papers over it - but two shapes
    // for the same thing is how the next field goes missing from one of them.
    const c = mkCut({ id: 7, name: 'Cut 7', startTime: 2, endTime: 3.5, track: 1 });
    assert.deepEqual(Object.keys(c).sort(), ['activeLayerId', 'endTime', 'id', 'layers', 'name', 'startTime', 'texts', 'track']);
    assert.deepEqual(c.texts, []);
    assert.equal(c.layers.length, 1);
    assert.equal(c.layers[0].type, 'layer');
    assert.equal(c.activeLayerId, c.layers[0].id, 'the blank layer is the active one');
});

test('mkCut: track defaults to the first', () => {
    assert.equal(mkCut({ id: 1, name: 'x', startTime: 0, endTime: 1 }).track, 0);
});

test('firstCut: a fresh one each time, not a shared object', () => {
    const a = firstCut(), b = firstCut();
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
    assert.notEqual(a.layers, b.layers);
});
