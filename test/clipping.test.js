import test from 'node:test';
import assert from 'node:assert/strict';
import { clipGroups, canClip } from '../src/core/clipping.js';

/**
 * Layers in UI order, topmost first. A trailing `*` marks one as clipped.
 *
 * Anchored to the end rather than a bare replace, which removes the first `*` wherever it sits
 * and would quietly mangle an id that contained one. CodeQL flags the bare form as incomplete
 * sanitization, and it is right that the anchored version is what was meant.
 */
const layers = (...spec) => spec.map(s => ({ id: s.replace(/\*$/, ''), clipped: s.endsWith('*') }));
const shape = (groups) => groups.map(g => `${g.base.id}<${g.clipped.map(c => c.id).join(',')}`);

test('nothing clipped means one group per layer, in the same order', () => {
    assert.deepEqual(shape(clipGroups(layers('a', 'b', 'c'))), ['a<', 'b<', 'c<']);
});

test('a clipped layer attaches to the layer below it', () => {
    // b is below a in UI order, so a clipped to b is the everyday case: shading over flats.
    assert.deepEqual(shape(clipGroups(layers('a*', 'b', 'c'))), ['b<a', 'c<']);
});

test('a run of clipped layers all attach to the same base', () => {
    // Shadow, highlight and line-tint over one set of flats behave as one group, rather than
    // each clipping to the one beneath it.
    assert.deepEqual(shape(clipGroups(layers('a*', 'b*', 'c*', 'd', 'e'))), ['d<a,b,c', 'e<']);
});

test('the clipped list stays in UI order, so a caller can walk it the same way', () => {
    const [group] = clipGroups(layers('top*', 'mid*', 'base'));
    assert.deepEqual(group.clipped.map(l => l.id), ['top', 'mid']);
    assert.equal(group.base.id, 'base');
});

test('an unclipped layer ends the run', () => {
    assert.deepEqual(shape(clipGroups(layers('a*', 'b', 'c*', 'd'))), ['b<a', 'd<c']);
});

test('a clipped layer at the very bottom draws normally', () => {
    // Clipping to nothing is clipping to an empty shape, which would make it vanish. A layer that
    // disappears on reaching the bottom of the stack reads as a bug, not as a rule.
    assert.deepEqual(shape(clipGroups(layers('a', 'b*'))), ['a<', 'b<']);
    assert.deepEqual(shape(clipGroups(layers('a*'))), ['a<']);
});

test('every layer appears exactly once, whatever the arrangement', () => {
    // The property that matters for the renderer: grouping must not drop or duplicate a layer.
    for (const spec of [
        ['a', 'b', 'c'], ['a*', 'b*', 'c*'], ['a*', 'b', 'c*'], ['a', 'b*', 'c'],
        ['a*', 'b', 'c', 'd*', 'e*'], ['a'], [],
    ]) {
        const order = layers(...spec);
        const seen = clipGroups(order).flatMap(g => [g.base, ...g.clipped]).map(l => l.id);
        assert.deepEqual(seen.slice().sort(), order.map(l => l.id).sort(), spec.join(' '));
        assert.equal(seen.length, new Set(seen).size, `duplicate in ${spec.join(' ')}`);
    }
});

test('groups come back in UI order, topmost first', () => {
    // The renderer walks them backwards to draw bottom-to-top, the same as it walks the layers.
    assert.deepEqual(shape(clipGroups(layers('a', 'b*', 'c', 'd'))), ['a<', 'c<b', 'd<']);
});

test('junk in does not throw', () => {
    assert.deepEqual(clipGroups(null), []);
    assert.deepEqual(clipGroups(undefined), []);
    assert.deepEqual(clipGroups([]), []);
});

test('canClip: everything except the bottom layer', () => {
    const order = layers('a', 'b', 'c');
    assert.equal(canClip(order, 'a'), true);
    assert.equal(canClip(order, 'b'), true);
    assert.equal(canClip(order, 'c'), false);
    assert.equal(canClip(order, 'nope'), false);
    assert.equal(canClip([], 'a'), false);
});
