import { useMemo, useRef } from 'react';
import type { PressurePoint } from '../core/types.ts';

/** The shared gesture refs and the two calls that bracket a press - what useGesture hands back. */
export type Gesture = ReturnType<typeof useGesture>;


// What is happening between the pen going down and coming back up.
//
// One pointer gesture at a time, and only one of these is ever in flight - a stroke, a lasso
// loop, a layer being dragged, a selection being transformed, a path being recorded. They were
// ten separate refs scattered through App's declaration block, which made that true by
// convention rather than by construction, and made the gesture handlers read like a list of
// storage locations rather than a list of things that can happen.
//
// They are refs and not state on purpose. A pointer move arrives far more often than a frame,
// and re-rendering React on each one is the difference between a pen that keeps up and one that
// does not. Nothing here should ever be read during render.

/**
 * Whether a pointer event belongs to the gesture in flight.
 *
 * A tablet has more than one pointer. A palm resting on the glass while the pen draws is a
 * second one, and while `startDraw` refused to *begin* a gesture from a touch, nothing stopped a
 * touch from feeding the gesture already running: the palm's moves were appended to the pen's
 * stroke as points, and the palm lifting ran stopDraw and committed the stroke early - after
 * which the pen kept moving over a gesture that had already ended. That is #338's "strokes break
 * up", and it cannot happen on a PC, where there is only ever one pointer.
 *
 * While nothing is in flight every pointer passes, so hovering still updates the cursor. A call
 * made from code rather than from an event passes too - `onPointerLeaveCanvas` ends a stroke
 * without having an event to name.
 *
 * @param {boolean} active whether a gesture is in flight
 * @param {number|null} ownerId the pointer that began it
 * @param {number|null} [eventId] the pointer the event came from; absent for a call from code
 * @returns {boolean}
 */
export function pointerIsOwner(active: boolean, ownerId: number | null, eventId?: number | null): boolean {
    if (!active || ownerId === null || eventId === null || eventId === undefined) return true;
    return eventId === ownerId;
}

/**
 * @param {object} opts
 * @param {{current: HTMLCanvasElement|null}} opts.canvasRef the element that captures the pointer
 */
export function useGesture({ canvasRef }: { canvasRef: { current: HTMLCanvasElement | null } }) {
    /** True between begin() and end(). Every handler checks it before treating a move as drawing. */
    const drawing = useRef(false);
    const pointerId = useRef<number | null>(null);

    const stroke = useRef<any>(null);                 // the stroke currently being drawn
    const lineStart = useRef<any>(null);              // where a line or shape was begun
    const lasso = useRef<any[] | null>(null);         // the loop as it is drawn
    const layerDrag = useRef<any>(null);              // layers being moved with the move tool
    const selectionDrag = useRef<any>(null);          // a floating selection being moved, resized or warped
    const pathPts = useRef<PressurePoint[] | null>(null); // a camera or motion path being recorded

    /** The layer this stroke commits to, fixed when it began in case the active layer changes under it. */
    const target = useRef<any>(null);

    /**
     * After a commit, clear the overlay only once the layer cache has drawn the new stroke.
     * Clearing it any sooner is a visible flicker, or a line that looks like it vanished.
     */
    const clearPending = useRef(false);

    const begin = (e: { pointerId: number }) => {
        // Drawing means the canvas is what is being worked on. Leaving focus in the size box - a
        // very ordinary place for it to be - sent the next keystroke there instead of to the
        // shortcut it was meant for.
        canvasRef.current?.focus({ preventScroll: true });
        pointerId.current = e.pointerId;
        try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }
        drawing.current = true;
    };

    /**
     * The other half of begin: give the pointer back and stop treating moves as drawing. Every
     * branch of the pointer-up handler ends this way. releasePointerCapture throws on a pointer
     * that is already gone, exactly as its counterpart does, so it needs the same guard.
     */
    const end = () => {
        drawing.current = false;
        try { if (pointerId.current !== null) canvasRef.current?.releasePointerCapture(pointerId.current); } catch { }
        pointerId.current = null;
    };

    /**
     * Whether an event is from the pointer that began what is in flight - the guard every
     * handler needs on a touchscreen. See pointerIsOwner for what it is protecting against.
     */
    const isOurs = (e?: { pointerId?: number } | null) => pointerIsOwner(drawing.current, pointerId.current, e?.pointerId);

    // One object, made once. Effects that read a gesture ref have to list this in their
    // dependencies, and a fresh object each render would make every one of them run every
    // render. Everything in here is a ref or closes over one, so there is nothing to refresh.
    return useMemo(
        () => ({ drawing, pointerId, stroke, lineStart, lasso, layerDrag, selectionDrag, pathPts, target, clearPending, begin, end, isOurs }),
        [],   // eslint-disable-line react-hooks/exhaustive-deps -- refs and functions over refs
    );
}
