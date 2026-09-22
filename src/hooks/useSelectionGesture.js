// Dragging a floating selection: which part of it the pointer is over, and what a drag from
// there does - move, resize by a handle, rotate by the knob, or warp (skew and bend) with Ctrl.
//
// Hit-testing and the drag were two blocks of App's pointer handlers that only made sense
// together: the hit decides the kind, the drag applies it. Here they are one thing.

import { applyResize, applyWarpDrag, applyRotateDrag } from '../core/lassoOps.ts';
import { warpedOutline, warpedHandles, rotateKnob } from '../canvas/warpRender.js';
import { HANDLE_GRAB_PX } from '../canvas/marquee.js';
import { pointInPolygon } from '../core/geometry.ts';

/**
 * @param {object} deps
 * @param {any} deps.gesture the shared gesture refs; the drag in flight is `selectionDrag`
 * @param {any} deps.selection the floating selection, or null
 * @param {(f: any) => void} deps.setSelection
 * @param {number} deps.zoom the view zoom, so the grab squares stay screen-sized
 */
export function useSelectionGesture({ gesture, selection, setSelection, zoom }) {
    /**
     * What is under the pointer: the rotate knob, a resize handle, the inside (move), or
     * nothing. Also used by the hover pass for the cursor.
     * @returns {{type: 'rotate'} | {type: 'resize', handle: string} | {type: 'move'} | null}
     */
    const hitTest = (pos) => {
        if (!selection) return null;
        const box = { x: selection.tx, y: selection.ty, w: selection.tw, h: selection.th, rot: selection.rot, skew: selection.skew, bend: selection.bend };
        const grab = HANDLE_GRAB_PX / zoom;
        const near = (p) => Math.abs(pos.x - p.x) <= grab && Math.abs(pos.y - p.y) <= grab;
        // The knob first. It sits on a stem above the top-middle handle, and at a small zoom the
        // two grab squares overlap - whichever is tested first wins, and rotate is the one with
        // nowhere else to go, while the top handle can still be reached from just inside it.
        if (near(rotateKnob(box, zoom))) return { type: 'rotate' };
        for (const hd of warpedHandles(box)) {
            if (near(hd)) return { type: 'resize', handle: hd.id };
        }
        return pointInPolygon([pos.x, pos.y], warpedOutline(box).map(p => [p.x, p.y])) ? { type: 'move' } : null;
    };

    /**
     * A press on the selection starts a drag of the kind the hit says. False when the press
     * was not on it - the caller then commits the selection, since a click outside commits.
     */
    const begin = (e, pos) => {
        const hit = hitTest(pos);
        if (!hit) return false;
        gesture.begin(e);
        // A drag adjusts skew and bend instead of moving or resizing when Ctrl is held (#175)
        // - wherever it starts, handles included. Letting the handles keep resizing under Ctrl
        // meant a drag begun on a corner resized and one begun a few pixels inward warped,
        // which read as Ctrl working only sometimes.
        const warp = e.ctrlKey || e.metaKey;
        const kind = warp ? { type: 'warp' } : hit;
        gesture.selectionDrag.current = { hit: kind, startPos: { x: pos.x, y: pos.y }, startSel: { ...selection } };
        e.preventDefault();
        return true;
    };

    /** A move during a drag. False when no selection drag is in flight. */
    const move = (pos) => {
        if (!gesture.selectionDrag.current || !selection) return false;
        const { hit, startPos, startSel } = gesture.selectionDrag.current;
        const dx = pos.x - startPos.x;
        const dy = pos.y - startPos.y;
        if (hit.type === 'move') {
            setSelection(s => s ? ({ ...s, tx: startSel.tx + dx, ty: startSel.ty + dy }) : s);
        } else if (hit.type === 'resize') {
            const next = applyResize(hit.handle, startSel, dx, dy);
            setSelection(s => s ? ({ ...s, ...next }) : s);
        } else if (hit.type === 'warp') {
            const next = applyWarpDrag(startSel, dx, dy);
            setSelection(s => s ? ({ ...s, ...next }) : s);
        } else if (hit.type === 'rotate') {
            const next = applyRotateDrag(startSel, startPos, pos);
            setSelection(s => s ? ({ ...s, ...next }) : s);
        }
        return true;
    };

    /** The lift. The selection stays floating; only the drag ends. */
    const end = () => { gesture.selectionDrag.current = null; };

    return { hitTest, begin, move, end };
}
