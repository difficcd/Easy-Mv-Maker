import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingBitmapIds } from '../src/engine/pendingBitmaps.js';

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
