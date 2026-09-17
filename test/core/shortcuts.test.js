// Keyboard shortcuts. Matching fails quietly - the key just does nothing - so the rules that make
// two spellings of the same chord compare equal are worth pinning down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, matchShortcut, keymapFrom, toolFromAction, findConflicts, DEFAULT_KEYS, KEY_LABELS } from '../../src/core/shortcuts.js';

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

test('keymapFrom: a shortcut added since the user last saved is still reachable', () => {
    // A binding the user removed should stay removed; one that never existed has to come from
    // the defaults or there would be no way to reach it.
    const km = keymapFrom({ undo: 'q' });
    assert.equal(km.undo, 'q', 'what was saved wins');
    assert.equal(km.redo, DEFAULT_KEYS.redo, 'what was not saved comes from the defaults');
});

test('keymapFrom: anything that is not an object is treated as absent', () => {
    // Reading and guarding storage is readStored's job now; this only has to survive what it
    // is handed, including what a hand-edited value might be.
    assert.deepEqual(keymapFrom(null), DEFAULT_KEYS);
    assert.deepEqual(keymapFrom(undefined), DEFAULT_KEYS);
    assert.deepEqual(keymapFrom('a string'), DEFAULT_KEYS);
    assert.deepEqual(keymapFrom(42), DEFAULT_KEYS);
    assert.deepEqual(keymapFrom(['q']), DEFAULT_KEYS, 'an array is not a keymap');
});

test('keymapFrom: an emptied binding stays empty rather than coming back', () => {
    assert.equal(keymapFrom({ undo: '' }).undo, '');
});

test('keymapFrom: returns a copy, so editing it cannot corrupt the defaults', () => {
    const km = keymapFrom(null);
    km.undo = 'zzz';
    assert.notEqual(DEFAULT_KEYS.undo, 'zzz');
});


test('every binding has a label, and every label a binding', () => {
    assert.deepEqual(Object.keys(DEFAULT_KEYS).sort(), Object.keys(KEY_LABELS).sort());
});

// ── tool bindings ──────────────────────────────────────────────────────────
// Selecting a tool is a binding like any other, marked by a prefix so the handler can route it
// without keeping a list of tool ids in step with the toolbar.

test('toolFromAction: recognises a tool binding and ignores the rest', () => {
    assert.equal(toolFromAction('tool.eraser'), 'eraser');
    assert.equal(toolFromAction('tool.brush'), 'brush');
    assert.equal(toolFromAction('undo'), null);
    assert.equal(toolFromAction(''), null);
    assert.equal(toolFromAction(undefined), null);
    assert.equal(toolFromAction(null), null);
});

test('toolFromAction: a tool id containing a dot survives', () => {
    assert.equal(toolFromAction('tool.a.b'), 'a.b', 'only the first prefix is stripped');
});

test('every tool binding routes to a tool, and nothing else does', () => {
    for (const action of Object.keys(DEFAULT_KEYS)) {
        const id = toolFromAction(action);
        if (action.startsWith('tool.')) assert.ok(id, `${action} should route`);
        else assert.equal(id, null, `${action} must not be treated as a tool`);
    }
});

test('the shipped defaults contain no duplicate keys', () => {
    // The whole point of adding twelve more bindings is that this stops being obvious by eye.
    assert.deepEqual(findConflicts(DEFAULT_KEYS), {});
});

test('tool keys are single presses, since the other hand is on the pen', () => {
    for (const [action, key] of Object.entries(DEFAULT_KEYS)) {
        if (!action.startsWith('tool.')) continue;
        assert.equal(key.includes('+'), false, `${action} is bound to a chord (${key})`);
        assert.equal(key.length, 1, `${action} should be one key, got "${key}"`);
    }
});

test('findConflicts: reports only the keys with more than one action', () => {
    const c = findConflicts({ undo: 'b', 'tool.brush': 'b', 'tool.eraser': 'e' });
    assert.deepEqual(Object.keys(c), ['b']);
    assert.deepEqual(c.b.sort(), ['tool.brush', 'undo']);
});

test('findConflicts: comparison is case-insensitive, like matching is', () => {
    // Otherwise a clash saved as "B" by an older version would be invisible and still broken.
    assert.deepEqual(Object.keys(findConflicts({ a: 'B', b: 'b' })), ['b']);
});

test('findConflicts: an unbound action is not a clash with another unbound one', () => {
    assert.deepEqual(findConflicts({ a: '', b: '', c: null }), {});
    assert.deepEqual(findConflicts({}), {});
    assert.deepEqual(findConflicts(null), {});
});

test('a tool key round-trips from a key event to the tool it selects', () => {
    const action = matchShortcut(DEFAULT_KEYS, keyOf(ev('e')));
    assert.equal(toolFromAction(action), 'eraser');
});

test('every binding still has a label', () => {
    // The settings panel builds its list from DEFAULT_KEYS, so a missing label renders blank.
    assert.deepEqual(Object.keys(DEFAULT_KEYS).sort(), Object.keys(KEY_LABELS).sort());
});

// ── what a key press does ──────────────────────────────────────────────────
import { shortcutFor } from '../../src/core/shortcuts.js';
const press = (key, o = {}) => ({ key, combo: keyOf({ key, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt }), ctrl: !!o.ctrl, shift: !!o.shift, alt: !!o.alt, inField: !!o.inField });
const idle = { selection: false, textEdit: false, currentCut: true, clipboard: false };

test('shortcutFor: Ctrl+S saves even inside a text field; nothing else is claimed there', () => {
    assert.deepEqual(shortcutFor(press('s', { ctrl: true, inField: true }), DEFAULT_KEYS, idle), { action: 'save' });
    assert.equal(shortcutFor(press('z', { ctrl: true, inField: true }), DEFAULT_KEYS, idle), null, 'undo in a field is the field\'s');
    assert.equal(shortcutFor(press('b', { inField: true }), DEFAULT_KEYS, idle), null, 'a tool key while typing is typing');
});

test('shortcutFor: plain Tab folds the panels; a modified Tab stays with the browser', () => {
    assert.deepEqual(shortcutFor(press('Tab'), DEFAULT_KEYS, idle), { action: 'togglePanels' });
    assert.equal(shortcutFor(press('Tab', { shift: true }), DEFAULT_KEYS, idle), null);
});

test('shortcutFor: the bindings win, tools by prefix', () => {
    assert.deepEqual(shortcutFor(press('b'), DEFAULT_KEYS, idle), { action: 'tool', arg: 'brush' });
    assert.deepEqual(shortcutFor(press('j'), DEFAULT_KEYS, idle), { action: 'undo' });
    assert.deepEqual(shortcutFor(press('t', { ctrl: true }), DEFAULT_KEYS, idle), { action: 'selectAll' });
    // A rebound key is honoured and its old meaning is gone.
    const km = { ...DEFAULT_KEYS, undo: 'u' };
    assert.deepEqual(shortcutFor(press('u'), km, idle), { action: 'undo' });
    assert.equal(shortcutFor(press('j'), km, idle), null);
});

test('shortcutFor: the conventional combinations depend on what there is to act on', () => {
    assert.deepEqual(shortcutFor(press('z', { ctrl: true }), DEFAULT_KEYS, idle), { action: 'undo' });
    assert.deepEqual(shortcutFor(press('y', { ctrl: true }), DEFAULT_KEYS, idle), { action: 'redo' });
    assert.deepEqual(shortcutFor(press('z', { ctrl: true, shift: true }), DEFAULT_KEYS, idle), { action: 'redo' });
    assert.deepEqual(shortcutFor(press('c', { ctrl: true }), DEFAULT_KEYS, idle), { action: 'copyCut' });
    assert.equal(shortcutFor(press('v', { ctrl: true }), DEFAULT_KEYS, idle), null, 'nothing copied yet');
    assert.deepEqual(shortcutFor(press('v', { ctrl: true }), DEFAULT_KEYS, { ...idle, clipboard: true }), { action: 'pasteCut' });
    assert.equal(shortcutFor(press('c', { ctrl: true }), DEFAULT_KEYS, { ...idle, currentCut: false }), null);
});

test('shortcutFor: Escape and Enter belong to a selection; Delete to the cut when nothing else claims it', () => {
    const sel = { ...idle, selection: true };
    assert.deepEqual(shortcutFor(press('Escape'), DEFAULT_KEYS, sel), { action: 'cancelSelection' });
    assert.deepEqual(shortcutFor(press('Enter'), DEFAULT_KEYS, sel), { action: 'commitSelection' });
    assert.equal(shortcutFor(press('Escape'), DEFAULT_KEYS, idle), null);
    assert.deepEqual(shortcutFor(press('Delete'), DEFAULT_KEYS, idle), { action: 'deleteCut' });
    assert.equal(shortcutFor(press('Delete'), DEFAULT_KEYS, sel), null, 'a selection is on screen - not the cut');
    assert.equal(shortcutFor(press('Backspace'), DEFAULT_KEYS, { ...idle, textEdit: true }), null, 'editing text - not the cut');
});
