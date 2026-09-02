import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingBitmapIds, scanLayerBitmaps, bitmapPending } from '../src/engine/pendingBitmaps.js';

const store = (obj) => ({ get: (id) => obj[id] });
const cut = (...layers) => ({ layers });
const layer = (...strokes) => ({ type: 'layer', strokes });
const paste = (bitmapId) => ({ tool: 'paste', bitmapId });

test('a blob with nothing decoded from it is pending', () => {
    assert.deepEqual(
        pendingBitmapIds([cut(layer(paste('a')))], store({ a: { blob: {} } })),
        ['a']);
});

test('an already decoded bitmap is not pending', () => {
    const s = store({ a: { blob: {}, imageBitmap: {} }, b: { blob: {}, imageData: {} } });
    assert.deepEqual(pendingBitmapIds([cut(layer(paste('a'), paste('b')))], s), []);
});

test('an entry with no blob is nothing to wait for', () => {
    assert.deepEqual(pendingBitmapIds([cut(layer(paste('a')))], store({ a: {} })), []);
});

test('an id the store has never heard of is skipped', () => {
    assert.deepEqual(pendingBitmapIds([cut(layer(paste('ghost')))], store({})), []);
});

test('hidden layers are not drawn, so they cannot stall a frame', () => {
    const l = { type: 'layer', visible: false, strokes: [paste('a')] };
    assert.deepEqual(pendingBitmapIds([cut(l)], store({ a: { blob: {} } })), []);
});

test('folders hold no pixels', () => {
    const f = { type: 'folder', strokes: [paste('a')] };
    assert.deepEqual(pendingBitmapIds([cut(f)], store({ a: { blob: {} } })), []);
});

test('non-paste strokes are ignored even when they carry a bitmapId', () => {
    const l = layer({ tool: 'pen', bitmapId: 'a' });
    assert.deepEqual(pendingBitmapIds([cut(l)], store({ a: { blob: {} } })), []);
});

test('the same bitmap used twice is reported once', () => {
    const s = store({ a: { blob: {} } });
    assert.deepEqual(pendingBitmapIds([cut(layer(paste('a'))), cut(layer(paste('a')))], s), ['a']);
});

test('order follows the cuts, so the visible frame decodes first', () => {
    const s = store({ a: { blob: {} }, b: { blob: {} }, c: { blob: {} } });
    const cuts = [cut(layer(paste('b'))), cut(layer(paste('a'), paste('c')))];
    assert.deepEqual(pendingBitmapIds(cuts, s), ['b', 'a', 'c']);
});

test('missing or malformed input is empty rather than a crash', () => {
    assert.deepEqual(pendingBitmapIds(null, store({})), []);
    assert.deepEqual(pendingBitmapIds([cut(layer(paste('a')))], null), []);
    assert.deepEqual(pendingBitmapIds([{}, { layers: null }], store({})), []);
    assert.deepEqual(pendingBitmapIds([cut({ type: 'layer' })], store({})), []);
});

// --- the shared predicate ----------------------------------------------------------------------

test('bitmapPending is only true for a blob with nothing decoded from it', () => {
    assert.equal(bitmapPending({ blob: {} }), true);
    assert.equal(bitmapPending({ blob: {}, imageBitmap: {} }), false);
    assert.equal(bitmapPending({ blob: {}, imageData: {} }), false);
    assert.equal(bitmapPending({}), false, 'no blob means nothing to wait for');
    assert.equal(bitmapPending(undefined), false);
    assert.equal(bitmapPending(null), false);
});

test('scanLayerBitmaps splits a layer into what it can and cannot draw', () => {
    const s = store({ a: { blob: {} }, b: { blob: {}, imageBitmap: {} }, c: { blob: {}, imageData: {} } });
    const out = scanLayerBitmaps(layer(paste('a'), paste('b'), paste('c')), s);
    assert.deepEqual(out.pending, ['a']);
    assert.deepEqual(out.decoded, ['b'], 'only ImageBitmaps are worth touching: they are what the LRU evicts');
});

test('scanLayerBitmaps reports each id once however often it is used', () => {
    const s = store({ a: { blob: {} }, b: { blob: {}, imageBitmap: {} } });
    const out = scanLayerBitmaps(layer(paste('a'), paste('a'), paste('b'), paste('b')), s);
    assert.deepEqual(out.pending, ['a']);
    assert.deepEqual(out.decoded, ['b']);
});

test('scanLayerBitmaps ignores strokes that are not pasted bitmaps', () => {
    const l = layer({ tool: 'pen', bitmapId: 'a' }, { tool: 'paste' }, paste('b'));
    const out = scanLayerBitmaps(l, store({ a: { blob: {} }, b: { blob: {} } }));
    assert.deepEqual(out.pending, ['b']);
});

test('scanLayerBitmaps survives a layer with nothing in it', () => {
    assert.deepEqual(scanLayerBitmaps({}, store({})), { pending: [], decoded: [] });
    assert.deepEqual(scanLayerBitmaps(null, store({})), { pending: [], decoded: [] });
    assert.deepEqual(scanLayerBitmaps(layer(paste('a')), null), { pending: [], decoded: [] });
});

test('pendingBitmapIds and scanLayerBitmaps agree, because one is built on the other', () => {
    // The point of the refactor: four copies of this predicate cannot drift if there is one.
    const s = store({ a: { blob: {} }, b: { blob: {}, imageBitmap: {} }, c: { blob: {} } });
    const l = layer(paste('a'), paste('b'), paste('c'));
    assert.deepEqual(pendingBitmapIds([cut(l)], s), scanLayerBitmaps(l, s).pending);
});
