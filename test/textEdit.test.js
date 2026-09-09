import test from 'node:test';
import assert from 'node:assert/strict';
import { textFromEdit, editFromText, blankTextEdit } from '../src/core/textEdit.js';

const now = { color: '#123456', opacity: 0.7 };

const full = () => ({
    id: 9, x: 100, y: 200, text: 'hello',
    fontSize: 48, fontFamily: 'Nanum', color: '#ff0000', opacity: 0.5, visible: true,
    outline: true, outlineColor: '#00ff00', bold: true, italic: true, align: 'center',
    lineHeight: 1.5, letterSpacing: 3, shadow: true, shadowColor: '#000', shadowBlur: 12,
    gradient: true, color2: '#0000ff', bgColor: '#eeeeee', rotation: 15, curve: 30,
    flipX: true, flipY: true, anim: { inType: 'fade' },
});

// The test the inline version could not have. Opening a text and writing it straight back must
// give the text you started with - anything else means the editor quietly changes what it touches.
test('a text survives being opened and written straight back', () => {
    const t = full();
    assert.deepEqual(textFromEdit(editFromText(t, now), t.id), t);
});

test('and survives it again, so the second save does not differ from the first', () => {
    const t = full();
    const once = textFromEdit(editFromText(t, now), t.id);
    const twice = textFromEdit(editFromText(once, now), t.id);
    assert.deepEqual(twice, once);
});

// A text written by an older version, or by hand, may be missing anything at all.
test('a text with nothing but a position and words comes back complete', () => {
    const t = { id: 1, x: 10, y: 20, text: 'hi' };
    const out = textFromEdit(editFromText(t, now), 1);
    assert.equal(out.fontSize, 36);
    assert.equal(out.fontFamily, 'sans-serif');
    assert.equal(out.align, 'left');
    assert.equal(out.lineHeight, 1.25);
    assert.equal(out.shadowBlur, 6);
    assert.equal(out.outlineColor, '#ffffff');
    assert.equal(out.visible, true);
    assert.equal(out.anim, null);
});

test('a text with no colour of its own opens in the colour being drawn with', () => {
    const e = editFromText({ id: 1, x: 0, y: 0, text: 'x' }, now);
    assert.equal(e.color, '#123456');
    assert.equal(e.opacity, 0.7);
});

test('a hidden text stays hidden, and a null visible is not hidden', () => {
    assert.equal(editFromText({ visible: false }, now).visible, false);
    assert.equal(editFromText({ visible: null }, now).visible, true, 'an older file can hold null');
    assert.equal(editFromText({}, now).visible, true);
});

test('the position is whole pixels, because a fractional one only came from a pointer', () => {
    const out = textFromEdit({ ...editFromText(full(), now), x: 10.4, y: 20.6 }, 1);
    assert.equal(out.x, 10);
    assert.equal(out.y, 21);
});

// Ctrl+Enter commits without the size field losing focus, so the range that field would have
// applied on blur has to be applied on the way out too.
test('a font size out of range is brought back in on the way out', () => {
    assert.equal(textFromEdit({ ...editFromText(full(), now), fontSize: 9999 }, 1).fontSize, 400);
    assert.equal(textFromEdit({ ...editFromText(full(), now), fontSize: 1 }, 1).fontSize, 6);
    assert.equal(textFromEdit({ ...editFromText(full(), now), fontSize: 'abc' }, 1).fontSize, 36,
        'unreadable falls back rather than becoming NaN');
});

test('the id it is written under is the one it is given', () => {
    assert.equal(textFromEdit(editFromText(full(), now), 77).id, 77);
});

test('editor-only fields do not reach the stored text', () => {
    const out = textFromEdit({ ...editFromText(full(), now), cssX: 5, cssY: 6, cutId: 3, layerId: 2 }, 1);
    for (const k of ['cssX', 'cssY', 'cutId', 'layerId']) {
        assert.ok(!(k in out), `${k} is the editor's, not the document's`);
    }
});

// Short on purpose: what it leaves out, textFromEdit fills in. A third copy of the defaults here
// is the thing this file exists to stop.
test('a new text starts with what a new text needs and nothing else', () => {
    const e = blankTextEdit({ x: 40, y: 50 }, now);
    assert.equal(e.textId, null);
    assert.deepEqual([e.x, e.y, e.text], [40, 50, '']);
    assert.equal(e.color, '#123456');
    const out = textFromEdit(e, 5);
    assert.equal(out.align, 'left', 'and the rest is filled in when it is written');
    assert.equal(out.lineHeight, 1.25);
});

test('the two directions agree on every field they both name', () => {
    const written = Object.keys(textFromEdit(editFromText(full(), now), 1)).filter(k => k !== 'id');
    const opened = Object.keys(editFromText(full(), now));
    assert.deepEqual(written.sort(), opened.sort(),
        'a field on one side only is a field that does not survive editing');
});
