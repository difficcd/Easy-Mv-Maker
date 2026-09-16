import { useMemo, useRef } from 'react';

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
 * @param {object} opts
 * @param {{current: HTMLCanvasElement|null}} opts.canvasRef the element that captures the pointer
 */
export function useGesture({ canvasRef }) {
    /** True between begin() and end(). Every handler checks it before treating a move as drawing. */
    const drawing = useRef(false);
    const pointerId = useRef(/** @type {number|null} */(null));

    const stroke = useRef(/** @type {any} */(null));        // the stroke currently being drawn
    const lineStart = useRef(/** @type {any} */(null));     // where a line or shape was begun
    const lasso = useRef(/** @type {any[]|null} */(null));  // the loop as it is drawn
    const layerDrag = useRef(/** @type {any} */(null));     // layers being moved with the move tool
    const selectionDrag = useRef(/** @type {any} */(null)); // a floating selection being moved, resized or warped
    const pathPts = useRef(/** @type {any[]|null} */(null));// a camera or motion path being recorded

    /** The layer this stroke commits to, fixed when it began in case the active layer changes under it. */
    const target = useRef(/** @type {any} */(null));

    /**
     * After a commit, clear the overlay only once the layer cache has drawn the new stroke.
     * Clearing it any sooner is a visible flicker, or a line that looks like it vanished.
     */
    const clearPending = useRef(false);

    const begin = (e) => {
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

    // One object, made once. Effects that read a gesture ref have to list this in their
    // dependencies, and a fresh object each render would make every one of them run every
    // render. Everything in here is a ref or closes over one, so there is nothing to refresh.
    return useMemo(
        () => ({ drawing, pointerId, stroke, lineStart, lasso, layerDrag, selectionDrag, pathPts, target, clearPending, begin, end }),
        [],   // eslint-disable-line react-hooks/exhaustive-deps -- refs and functions over refs
    );
}
