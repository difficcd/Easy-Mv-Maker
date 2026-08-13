// Keyboard shortcuts. Matching fails quietly - the key just does nothing - so the rules that make
// two spellings of the same chord compare equal are worth pinning down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, matchShortcut, loadKeymap, DEFAULT_KEYS, KEY_LABELS } from '../src/shortcuts.js';

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('keyOf: a plain key is itself, lowercased', () => {
    assert.equal(keyOf(ev('j')), 'j');
    assert.equal(keyOf(ev('J')), 'j', 'Shift-less capitals from some layouts still match');
    assert.equal(keyOf(ev('[')), '[');
});

test('keyOf: modifiers come in a fixed order, whatever order they were pressed', () => {
    const all = { ctrlKey: true, altKey: true, shiftKey: true };
    assert.equal(keyOf(ev('k', all)), 'ctrl+alt+shift+k');
    assert.equal(keyOf(ev('k', { shiftKey: true, ctrlKey: true })), 'ctrl+shift+k');
});

test('keyOf: Command counts as Ctrl, so a binding works on a Mac unchanged', () => {
    assert.equal(keyOf(ev('z', { metaKey: true })), keyOf(ev('z', { ctrlKey: true })));
    assert.equal(keyOf(ev('z', { metaKey: true })), 'ctrl+z');
});

test('keyOf: a named key keeps its spelling', () => {
    // Lowercasing these would merge distinct keys and break the Tab handling.
    for (const k of ['Tab', 'Escape', 'ArrowLeft', 'F5', 'Delete']) {
        assert.equal(keyOf(ev(k)), k);
    }
    assert.equal(keyOf(ev('ArrowLeft', { ctrlKey: true })), 'ctrl+ArrowLeft');
});

test('keyOf: a missing key does not produce "undefined"', () => {
    assert.equal(keyOf({ }), '');
    assert.equal(keyOf({ ctrlKey: true }), 'ctrl+');
});

test('matchShortcut: finds the action a combo is bound to', () => {
    assert.equal(matchShortcut(DEFAULT_KEYS, 'j'), 'undo');
    assert.equal(matchShortcut(DEFAULT_KEYS, 'ctrl+]'), 'zoomIn');
    assert.equal(matchShortcut(DEFAULT_KEYS, 'q'), null, 'unbound keys do nothing');
});

test('matchShortcut: comparison ignores case, for bindings saved by an older version', () => {
    assert.equal(matchShortcut({ zoomIn: 'Ctrl+]' }, 'ctrl+]'), 'zoomIn');
    assert.equal(matchShortcut({ undo: 'J' }, 'j'), 'undo');
});

test('matchShortcut: an unbound action is skipped rather than matching nothing', () => {
    assert.equal(matchShortcut({ undo: '', redo: 'k' }, 'k'), 'redo');
    assert.equal(matchShortcut({ undo: null }, ''), null);
    assert.equal(matchShortcut(null, 'j'), null);
});

test('matchShortcut: a key event round-trips to its action', () => {
    assert.equal(matchShortcut(DEFAULT_KEYS, keyOf(ev(']', { ctrlKey: true }))), 'zoomIn');
    assert.equal(matchShortcut(DEFAULT_KEYS, keyOf(ev('0', { metaKey: true }))), 'resetView', 'and on a Mac');
});

test('loadKeymap: a shortcut added since the user last saved is still reachable', () => {
    // Their file has only the bindings that existed then; the rest must come from the defaults.
    const storage = { getItem: () => JSON.stringify({ undo: 'z' }) };
    const km = loadKeymap(storage);
    assert.equal(km.undo, 'z', 'their change wins');
    assert.equal(km.zoomIn, DEFAULT_KEYS.zoomIn, 'and the newer binding is present');
});

test('loadKeymap: unreadable or absent storage falls back to the defaults', () => {
    assert.deepEqual(loadKeymap({ getItem: () => null }), DEFAULT_KEYS);
    assert.deepEqual(loadKeymap({ getItem: () => 'not json' }), DEFAULT_KEYS);
    assert.deepEqual(loadKeymap({ getItem: () => { throw new Error('blocked'); } }), DEFAULT_KEYS,
        'private mode can make localStorage throw');
    assert.deepEqual(loadKeymap({ getItem: () => '"a string"' }), DEFAULT_KEYS);
});

test('loadKeymap: returns a copy, so editing it cannot corrupt the defaults', () => {
    const km = loadKeymap({ getItem: () => null });
    km.undo = 'changed';
    assert.equal(DEFAULT_KEYS.undo, 'j');
});

test('every binding has a label, and every label a binding', () => {
    assert.deepEqual(Object.keys(DEFAULT_KEYS).sort(), Object.keys(KEY_LABELS).sort());
});
