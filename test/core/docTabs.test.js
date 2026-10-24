import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlankDocument, hasIdentity, BLANK_IDENTITY } from '../../src/core/docTabs.ts';

const doc = (cuts, more = {}) => ({ cuts, ...more });
const cut = (strokes = [], texts = []) => ({ layers: [{ strokes }], texts });

test('a new tab is blank', () => {
    assert.equal(isBlankDocument(doc([cut()])), true);
    assert.equal(isBlankDocument(null), true);
});

test('a stroke, a text, a second cut, audio or video make it worth keeping', () => {
    assert.equal(isBlankDocument(doc([cut([{}])])), false);
    assert.equal(isBlankDocument(doc([cut([], [{}])])), false);
    assert.equal(isBlankDocument(doc([cut(), cut()])), false);
    assert.equal(isBlankDocument(doc([cut()], { audio: { asset: true } })), false);
    assert.equal(isBlankDocument(doc([cut()], { video: {} })), false);
});

test('a document saves somewhere when any of its three homes is set', () => {
    assert.equal(hasIdentity(BLANK_IDENTITY), false);
    assert.equal(hasIdentity({ ...BLANK_IDENTITY, serverId: 'p_1' }), true);
    assert.equal(hasIdentity({ ...BLANK_IDENTITY, fileHandle: {} }), true);
});
