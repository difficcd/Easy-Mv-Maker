// Running a drag on window listeners.
//
// A drag started on an element cannot listen on that element: the pointer leaves it constantly -
// off the canvas, past the edge of the window, over another panel - and a drag that stops when
// the pointer wanders is not a drag. So the listeners go on window, and the whole job is taking
// them off again afterwards.
//
// Five places did this by hand, one of them in a helper that four others did not know about, and
// every one of them missed the same case: `pointercancel`. A cancelled pointer - a system gesture
// on a tablet, a palm landing, the browser deciding it owns the gesture now - never sends
// pointerup, so the move listener stayed on window for the rest of the session. Nothing looks
// wrong when that happens; the next drag simply has two handlers, then three.
//
// Every listener is added and removed here, so there is one place for that to be right.

/**
 * Listen for a drag on window until the pointer is released or cancelled.
 *
 * @param {(e: PointerEvent) => void} onMove
 * @param {(e: PointerEvent) => void} [onEnd] called for a release and for a cancel alike - callers
 *   that need to distinguish can read `e.type`, but almost none should: an interrupted drag has to
 *   clean up the same way a finished one does
 * @param {{addEventListener: Function, removeEventListener: Function}} [target] the event target,
 *   for tests
 * @returns {() => void} ends the drag early and removes the listeners; safe to call twice
 */
export function dragOnWindow(onMove, onEnd, target = typeof window !== 'undefined' ? window : null) {
    if (!target) return () => { };

    let done = false;
    const stop = () => {
        // Idempotent, because a caller that ends a drag itself would otherwise leave the listeners
        // on until a pointerup that may never come.
        if (done) return;
        done = true;
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', end);
        target.removeEventListener('pointercancel', end);
    };

    const move = (e) => { if (!done) onMove(e); };
    const end = (e) => { stop(); onEnd?.(e); };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);

    return stop;
}
