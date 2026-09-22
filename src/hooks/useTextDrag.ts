import { useRef } from 'react';
import { moveText } from '../core/cutsReducer.ts';
import { measureTextBox as measureTextBoxPure } from '../canvas/textRender.ts';
import { safeArray } from '../core/geometry.ts';
import type { Point } from '../core/types.ts';
import type { CutsAction } from '../core/cutsReducer.ts';
import type { TextObject, TextBox } from '../canvas/textRender.ts';
import type { PressEvent } from './useLayerDrag.ts';

/** A text under the pointer, with the box it was found by. */
export interface TextHit { text: CutText; box: TextBox }
/** A text drag in flight: where it started, whether it has moved, and the position waiting for the next frame. */
interface TextDrag { cutId: DocId; textId: DocId; startPos: Point; startText: Point; moved: boolean; clickToEdit: boolean; pending?: { cutId: DocId, textId: DocId, x: number, y: number } | null }


/**
 * Grabbing a text object on the canvas and dragging it.
 *
 * What this owns: the scratch context text is measured with, hit-testing a point against the
 * texts of a cut, and the drag itself - which text, where it started, and the one-per-frame
 * write of its new position. App still decides *when* a press is a text drag (the text tool and
 * the move tool both do it and differ in one flag) and what happens when one ends without
 * moving, which is opening the editor.
 *
 * The drag is coalesced to one document update per frame. A pen reports well over a hundred
 * moves a second and each write to the document is a React render plus a full repaint, so most
 * of that work would be thrown away before it could be seen - and the drag would lag the pointer
 * rather than follow it. The last position wins, and nothing is lost by dropping the ones in
 * between: each is absolute, computed from where the drag started plus the total delta.
 *
 * @param {object} deps
 * @param {(action: any) => void} deps.dispatchCuts
 * @param {number} deps.currentCutId
 * @param {(sel: {cutId: number, textId: number} | null) => void} deps.setSelectedText
 * @param {(e: PointerEvent) => void} deps.beginGesture claims the pointer for the canvas
 */
export function useTextDrag({ dispatchCuts, currentCutId, setSelectedText, beginGesture }: { dispatchCuts: (action: CutsAction) => void, currentCutId: DocId | null, setSelectedText: (sel: { cutId: DocId, textId: DocId } | null) => void, beginGesture: (e: PressEvent) => void }) {
    const dragRef = useRef<TextDrag | null>(null);
    const rafRef = useRef(0);
    const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);

    // A 16px canvas is enough: measureText does not care how big the surface is.
    const getMeasureCtx = () => {
        if (!measureCtxRef.current) {
            const c = document.createElement('canvas');
            c.width = 16;
            c.height = 16;
            measureCtxRef.current = c.getContext('2d');
        }
        return measureCtxRef.current!;
    };
    // Measuring and drawing text live in textRender; this only supplies the scratch context that
    // measureText needs.
    const measureTextBox = (t: TextObject | null | undefined): TextBox => measureTextBoxPure(t, getMeasureCtx());

    /** The topmost visible text under a point, or null. */
    const hitTestText = (pos: Point, cut: Cut | null | undefined): TextHit | null => {
        const texts = safeArray<CutText>(cut?.texts);
        for (let i = texts.length - 1; i >= 0; i--) {
            const t = texts[i];
            if (t.visible === false) continue;
            const b = measureTextBox(t);
            if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) return { text: t, box: b };
        }
        return null;
    };

    const flush = () => {
        rafRef.current = 0;
        const p = dragRef.current?.pending;
        if (!p) return;
        dragRef.current!.pending = null;
        dispatchCuts(moveText(p.cutId, p.textId, p.x, p.y));
    };
    const schedule = () => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(flush);
    };

    /**
     * Take hold of a text. With `clickToEdit`, a press that then does not move is a request to
     * edit rather than a zero-length drag - endTextDrag reports it so App can open the editor.
     */
    const startTextDrag = (e: PressEvent, pos: Point, hit: { text: CutText }, clickToEdit: boolean) => {
        // No cut, nothing to drag a text in: the last one was deleted.
        if (currentCutId == null) return;
        setSelectedText({ cutId: currentCutId, textId: hit.text.id });
        beginGesture(e);
        dragRef.current = {
            cutId: currentCutId,
            textId: hit.text.id,
            startPos: { x: pos.x, y: pos.y },
            startText: { x: hit.text.x ?? 0, y: hit.text.y ?? 0 },
            moved: !clickToEdit,
            clickToEdit,
        };
        e.preventDefault();
    };

    /** A pointer move. Returns true if a text drag consumed it. */
    const moveTextDrag = (pos: Point): boolean => {
        const d = dragRef.current;
        if (!d) return false;
        const dx = pos.x - d.startPos.x;
        const dy = pos.y - d.startPos.y;
        // A few pixels of wobble under a press meant to edit is not a drag.
        if (d.clickToEdit && !d.moved && Math.hypot(dx, dy) <= 4) return true;
        d.moved = true;
        d.pending = { cutId: d.cutId, textId: d.textId, x: Math.round(d.startText.x + dx), y: Math.round(d.startText.y + dy) };
        schedule();
        return true;
    };

    /**
     * The pointer lifted. Any move still queued is written now - a drag can end between frames,
     * and without this the text snaps back to wherever the last painted frame left it. Returns
     * the drag that ended, or null if there was none.
     */
    const endTextDrag = () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); flush(); }
        const ended = dragRef.current;
        dragRef.current = null;
        return ended;
    };

    return { measureTextBox, hitTestText, startTextDrag, moveTextDrag, endTextDrag };
}
