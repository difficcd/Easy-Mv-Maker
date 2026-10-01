import test from 'node:test';
import assert from 'node:assert/strict';
import { layerSig, strokeSig, appendedAfter } from '../../src/core/layerTree.ts';

// Committing a stroke redrew every stroke the layer held. The Nth stroke of a drawing cost N
// times the first, so a session's baking grew with the square of the strokes drawn - measured on
// a 1920x1080 layer, 40 brush strokes drawn one at a time cost ~38s of baking where drawing only
// each new stroke costs ~1.9s. appendedAfter is what lets the cache draw only the new ones.
//
// Every interesting case here is a *refusal*. Saying "appended" when something else happened
// leaves stale pixels on the layer with no symptom until someone notices their drawing is wrong,
// so the tests that matter are the ones that make sure it says no.

const stroke = (id, n = 4, over = {}) => ({
    id, tool: 'brush', bitmapId: null,
    points: Array.from({ length: n }, (_, i) => ({ x: i, y: i })),
    ...over,
});
const layer = (strokes, over = {}) => ({ id: 1, strokes, rev: 0, roughen: 0, ...over });

test('strokes added on the end are an append, starting where the canvas left off', () => {
    const before = layer([stroke(1), stroke(2)]);
    const after = layer([stroke(1), stroke(2), stroke(3), stroke(4)]);
    assert.equal(appendedAfter(layerSig(before), after), 2);
});

test('an unchanged layer is not an append - that is the caller\'s cache hit', () => {
    const l = layer([stroke(1), stroke(2)]);
    assert.equal(appendedAfter(layerSig(l), l), null);
});

test('a removed stroke is not an append', () => {
    const before = layer([stroke(1), stroke(2), stroke(3)]);
    assert.equal(appendedAfter(layerSig(before), layer([stroke(1), stroke(2)])), null);
});

test('the last stroke growing points - the eraser still drawing - is not an append', () => {
    // appendPoints extends the stroke in flight. Its pixels are already on the canvas and the
    // new ones are not a separate stroke, so the layer has to be redrawn.
    const before = layer([stroke(1), stroke(2, 4)]);
    assert.equal(appendedAfter(layerSig(before), layer([stroke(1), stroke(2, 9)])), null);
});

test('a bumped rev refuses the append even though the strokes only grew', () => {
    // This is the whole safety argument. offsetLayers moves every coordinate, which changes no
    // count and no identity, and bumps rev precisely so the cache notices. If a move and a new
    // stroke land together, the moved strokes must still be redrawn.
    const before = layer([stroke(1), stroke(2)]);
    const after = layer([stroke(1), stroke(2), stroke(3)], { rev: 1 });
    assert.equal(appendedAfter(layerSig(before), after), null);
});

test('a layer that started empty is redrawn in full, not appended onto', () => {
    assert.equal(appendedAfter(layerSig(layer([])), layer([stroke(1)])), null);
});

test('a missing or unparseable signature is refused', () => {
    const l = layer([stroke(1), stroke(2)]);
    for (const bad of [null, undefined, '', 'nonsense', '|1|2', 'NaN|x', '-1|x']) {
        assert.equal(appendedAfter(bad, l), null, String(bad));
    }
});

test('a signature claiming more strokes than the layer has is refused', () => {
    // A canvas from a longer version of this layer. Drawing "the rest" would draw nothing and
    // leave the extra strokes on screen.
    const before = layer([stroke(1), stroke(2), stroke(3), stroke(4)]);
    assert.equal(appendedAfter(layerSig(before), layer([stroke(1), stroke(2)])), null);
});

test('strokeSig with a count is the signature that list had when it was that long', () => {
    // The property appendedAfter is built on: the prefix of a grown list signs as the original.
    const first = [stroke(1), stroke(2)];
    const grown = [...first, stroke(3)];
    assert.equal(strokeSig(grown, 2), strokeSig(first));
    assert.equal(layerSig(layer(grown), null, 2), layerSig(layer(first)));
});

test('a count outside the list is clamped rather than reading past the end', () => {
    const l = [stroke(1), stroke(2)];
    assert.equal(strokeSig(l, 99), strokeSig(l));
    assert.equal(strokeSig(l, 0), '0');
    assert.equal(strokeSig(l, -5), '0');
});

test('a boiling layer signs per phase, so a different phase is not an append', () => {
    // Each phase keeps its own canvas and the bake path excludes boiling layers outright; this
    // pins the signature half of that, so the exclusion cannot be quietly dropped.
    const r1 = { roughPhase: 1, roughWave: 1, roughMinSize: 0 };
    const r2 = { roughPhase: 2, roughWave: 1, roughMinSize: 0 };
    const before = layer([stroke(1)], { roughen: 2 });
    const after = layer([stroke(1), stroke(2)], { roughen: 2 });
    assert.equal(appendedAfter(layerSig(before, r1), after, r2), null);
});
