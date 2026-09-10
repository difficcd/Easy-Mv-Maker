// A text object's fields, in one place instead of three.
//
// A text carries about twenty properties, and the app moved them across twice by hand: once
// opening an existing text into the editor, once writing the editor back out. A third, shorter
// list starts a brand-new one. Adding a property meant editing all three, and forgetting one is
// silent - the property simply does not survive being edited, which looks like the editor losing
// it rather than like a missing line.
//
// The two directions are here so the round trip can be tested: open a text, write it straight
// back, and it must be the text you started with. That test cannot exist while the lists are
// inline in a component.
//
// Deliberately not one shared list of field names with a loop over it. The two directions are not
// symmetrical - opening fills in the app's current colour where a text has none, writing out
// rounds the position and clamps the size - and a loop that had to carry those exceptions would
// say less than the two explicit lists do.

import { clampNum } from './numInput.js';

/** Font sizes the renderer will accept. Matches clampFontSize in textRender. */
const FONT_MIN = 6;
const FONT_MAX = 400;

/**
 * The text object to store, from what the editor holds.
 *
 * @param {any} edit the editor state
 * @param {any} id the id to store it under - the existing one, or a fresh one for a new text
 * @returns {any}
 */
export function textFromEdit(edit, id) {
    return {
        id,
        // Rounded because a text's position is a pixel on the canvas, and a fractional one only
        // ever came from a pointer.
        x: Math.round(edit.x),
        y: Math.round(edit.y),
        text: String(edit.text ?? ''),
        // Ctrl+Enter commits without the size field ever losing focus, so the range that field
        // would have applied on blur is applied here too.
        fontSize: clampNum(Number(edit.fontSize) || 36, FONT_MIN, FONT_MAX),
        fontFamily: edit.fontFamily,
        color: edit.color,
        opacity: edit.opacity,
        visible: edit.visible ?? true,
        outline: !!edit.outline,
        outlineColor: edit.outlineColor || '#ffffff',
        bold: !!edit.bold,
        italic: !!edit.italic,
        align: edit.align || 'left',
        lineHeight: edit.lineHeight ?? 1.25,
        letterSpacing: edit.letterSpacing ?? 0,
        shadow: !!edit.shadow,
        shadowColor: edit.shadowColor || 'rgba(0,0,0,0.5)',
        shadowBlur: edit.shadowBlur ?? 6,
        gradient: !!edit.gradient,
        color2: edit.color2 || '#ffffff',
        bgColor: edit.bgColor || '',
        rotation: edit.rotation ?? 0,
        curve: edit.curve ?? 0,
        flipX: !!edit.flipX,
        flipY: !!edit.flipY,
        anim: edit.anim || null,
    };
}

/**
 * What the editor should hold, from a stored text.
 *
 * A text written by an older version, or by hand, may be missing anything. Where a property has
 * no sensible fixed default the app's current one is used instead - a text with no colour opens
 * in the colour you are drawing with, which is what someone editing it expects.
 *
 * @param {any} t the stored text
 * @param {{color: string, opacity: number}} now what the app is currently set to
 * @returns {any}
 */
export function editFromText(t, now) {
    return {
        x: t.x ?? 0,
        y: t.y ?? 0,
        text: t.text ?? '',
        fontSize: t.fontSize ?? 36,
        fontFamily: t.fontFamily ?? 'sans-serif',
        color: t.color ?? now.color,
        opacity: t.opacity ?? now.opacity,
        // `!== false` rather than `?? true`: both mean "unless it says otherwise", and this one
        // also treats a stored null as visible, which is what an older file can hold.
        visible: t.visible !== false,
        outline: !!t.outline,
        outlineColor: t.outlineColor || '#ffffff',
        bold: !!t.bold,
        italic: !!t.italic,
        align: t.align || 'left',
        lineHeight: t.lineHeight ?? 1.25,
        letterSpacing: t.letterSpacing ?? 0,
        shadow: !!t.shadow,
        shadowColor: t.shadowColor || 'rgba(0,0,0,0.5)',
        shadowBlur: t.shadowBlur ?? 6,
        gradient: !!t.gradient,
        color2: t.color2 || '#ffffff',
        bgColor: t.bgColor || '',
        rotation: t.rotation ?? 0,
        curve: t.curve ?? 0,
        flipX: !!t.flipX,
        flipY: !!t.flipY,
        anim: t.anim || null,
    };
}

/**
 * The editor state for a text that does not exist yet.
 *
 * Short on purpose: everything it leaves out, `textFromEdit` fills in when it is written. Listing
 * them here as well would be a third copy of the defaults, which is the thing this file exists to
 * stop.
 *
 * @param {{x: number, y: number}} at where on the canvas it was placed
 * @param {{color: string, opacity: number}} now
 * @returns {any}
 */
export function blankTextEdit(at, now) {
    return {
        textId: null,
        x: at.x,
        y: at.y,
        text: '',
        fontSize: 36,
        fontFamily: 'sans-serif',
        color: now.color,
        opacity: now.opacity,
        visible: true,
    };
}
