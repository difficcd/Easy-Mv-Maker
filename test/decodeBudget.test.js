import test from 'node:test';
import assert from 'node:assert/strict';
import { framesToRelease, layerKeysUsingBitmaps, keysWithPhases, DECODED_CAP } from '../src/core/decodeBudget.js';

const ids = (n, prefix = 'f') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
/** Used in the order given: f0 oldest, last newest. */
const usedInOrder = (list) => new Map(list.map((id, i) => [id, i + 1]));

test('nothing is released while under the cap', () => {
    const list = ids(10);
    assert.deepEqual(framesToRelease({ decoded: list, order: usedInOrder(list), cap: 20 }), []);
    // Exactly at the cap is still under it - releasing here would thrash at the boundary.
    assert.deepEqual(framesToRelease({ decoded: list, order: usedInOrder(list), cap: 10 }), []);
});

test('the oldest go first, and only as many as the overflow', () => {
    const list = ids(13);
    const out = framesToRelease({ decoded: list, order: usedInOrder(list), cap: 10 });
    assert.deepEqual(out, ['f0', 'f1', 'f2']);
});

test('the prefetch window is never released, however old', () => {
    // The hazard this exists for: evicting a frame the prefetcher just decoded makes it decode
    // again, and the two spend playback fighting each other. It reads as stutter, not as memory.
    const list = ids(13);
    const hot = new Set(['f0', 'f1']);
    const out = framesToRelease({ decoded: list, order: usedInOrder(list), cap: 10, hot });
    assert.equal(out.includes('f0'), false);
    assert.equal(out.includes('f1'), false);
    assert.deepEqual(out, ['f2', 'f3', 'f4']);
});

test('a protected frame is skipped rather than counted, so the trim still frees enough', () => {
    // Counting a skipped id against the quota would stop the trim early and leave the store over
    // cap, quietly, for as long as those frames stay protected.
    const list = ids(13);
    const out = framesToRelease({ decoded: list, order: usedInOrder(list), cap: 10, protect: new Set(['f0', 'f1']) });
    assert.equal(out.length, 3);
    assert.deepEqual(out, ['f2', 'f3', 'f4']);
});

test('when everything is protected nothing is released rather than something being forced out', () => {
    const list = ids(13);
    const out = framesToRelease({ decoded: list, order: usedInOrder(list), cap: 10, hot: new Set(list) });
    assert.deepEqual(out, []);
});

test('a frame that was never touched sorts as oldest', () => {
    // No recorded use means nothing says it is wanted - it should go before one that was used.
    const order = new Map([['b', 5], ['c', 9]]);
    const out = framesToRelease({ decoded: ['a', 'b', 'c'], order, cap: 2 });
    assert.deepEqual(out, ['a']);
});

test('the cap is above the prefetch window, which is the whole reason it has a number', () => {
    const PREFETCH_WINDOW = 50;
    assert.ok(DECODED_CAP > PREFETCH_WINDOW, `${DECODED_CAP} must exceed the ~${PREFETCH_WINDOW} frame window`);
});

// ---------------------------------------------------------------------------------------------

const key = (cutId, layerId) => `${cutId}:${layerId}`;
const film = () => ([
    { id: 1, layers: [
        { id: 10, strokes: [{ tool: 'paste', bitmapId: 'A' }] },
        { id: 11, strokes: [{ tool: 'pen' }] },
    ] },
    { id: 2, layers: [
        { id: 20, strokes: [{ tool: 'brush' }, { tool: 'paste', bitmapId: 'B' }] },
    ] },
]);

test('only the layers holding those frames are named', () => {
    assert.deepEqual([...layerKeysUsingBitmaps(film(), ['A'], key)], ['1:10']);
    assert.deepEqual([...layerKeysUsingBitmaps(film(), ['B'], key)], ['2:20']);
    assert.deepEqual([...layerKeysUsingBitmaps(film(), ['A', 'B'], key)], ['1:10', '2:20']);
});

test('an unknown frame names nothing, so nothing is invalidated for it', () => {
    assert.equal(layerKeysUsingBitmaps(film(), ['Z'], key).size, 0);
    assert.equal(layerKeysUsingBitmaps(film(), [], key).size, 0);
});

test('a fill or a stroke is not a paste, and does not tie a layer to a frame', () => {
    const cuts = [{ id: 1, layers: [{ id: 10, strokes: [{ tool: 'fill', bitmapId: 'A' }] }] }];
    assert.equal(layerKeysUsingBitmaps(cuts, ['A'], key).size, 0);
});

test('a cut with no layers, or a layer with no strokes, is not a crash', () => {
    const cuts = [{ id: 1 }, { id: 2, layers: [{ id: 20 }] }, null];
    assert.equal(layerKeysUsingBitmaps(/** @type {any} */(cuts), ['A'], key).size, 0);
    assert.equal(layerKeysUsingBitmaps(/** @type {any} */(null), ['A'], key).size, 0);
});

test("a boiling layer's phase keys go with the plain one", () => {
    // Dropping `1:10` alone leaves `1:10#3` behind holding the bitmap that was just replaced -
    // a layer that updates when still and shows stale pixels the moment it boils.
    const all = ['1:10', '1:10#0', '1:10#3', '1:11', '2:20', '2:20#1'];
    assert.deepEqual(keysWithPhases(all, new Set(['1:10'])), ['1:10', '1:10#0', '1:10#3']);
});

test('a phase key does not drag in a different layer that shares a prefix', () => {
    // `1:1` must not match `1:10`, or invalidating one layer clears its neighbour every time.
    const all = ['1:1', '1:1#2', '1:10', '1:10#2'];
    assert.deepEqual(keysWithPhases(all, new Set(['1:1'])), ['1:1', '1:1#2']);
});

test('nothing to drop drops nothing', () => {
    assert.deepEqual(keysWithPhases(['1:10', '1:10#0'], new Set()), []);
});
