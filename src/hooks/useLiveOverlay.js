// The overlay the current gesture is drawn on.
//
// A second canvas sits over the document canvas and holds whatever the pointer is doing right
// now: the stroke being drawn, the lasso loop, a layer being dragged, the curve preview. It
// exists so that none of that has to go through layer state, which would mean re-evaluating and
// repainting the whole scene on every pointer move.
//
// Two things in here are easy to get wrong and both look like rendering bugs rather than
// mistakes, which is why they are in one place with their reasons:
//
// The stroke is drawn incrementally. Only the points that are new since the last frame are
// added, because redrawing a long stroke from the start on every move is what makes a pen feel
// heavy. The bookkeeping for that is `drawnRef`, and if it is ever ahead of the truth the tail
// is drawn from the wrong place.
//
// The overlay must be cleared by whoever finishes the gesture. A stroke that is committed to a
// layer while its copy is still on the overlay is not a crash - it is drawn twice, once live and
// once committed, which reads as a doubled or smeared line.

import { useCallback, useRef } from 'react';

/**
 * @param {object} opts
 * @param {{current: any}} opts.strokeRef the stroke being drawn, or null between gestures
 * @param {{current: Map<any, any>}} opts.bitmapStoreRef pixels a paste stroke refers to
 * @param {(ctx: any, strokes: any[], live: boolean, store: any) => void} opts.drawStrokes
 */
export function useLiveOverlay({ strokeRef, bitmapStoreRef, drawStrokes }) {
    const overlayRef = useRef(/** @type {HTMLCanvasElement|null} */(null));
    const drawnRef = useRef(0);   // how many points of the stroke are already on the overlay
    const rafRef = useRef(0);

    /** The overlay's 2D context, or null before the canvas has mounted. */
    const ctx = () => overlayRef.current?.getContext('2d') ?? null;

    /**
     * Wipe it. Safe to call when there is no overlay yet.
     *
     * Stable, because an effect depends on it: the overlay is cleared when the layer cache has
     * caught up, not on a timer, and that effect must run when the cache changes and not because
     * this function was rebuilt.
     */
    const clear = useCallback(() => {
        const lc = overlayRef.current;
        if (lc) lc.getContext('2d').clearRect(0, 0, lc.width, lc.height);
    }, []);

    /**
     * Draw the stroke as it stands. Normally only the new tail; `full` redraws all of it.
     *
     * The line and curve tools change the earlier part of the stroke as it is drawn - a line
     * follows the pointer from a fixed origin - so for those the tail alone would leave the
     * previous positions on screen.
     *
     * @param {boolean} [full]
     */
    const renderStroke = (full = false) => {
        const c = ctx(); if (!c) return;
        const st = strokeRef.current;
        if (!st) { clear(); drawnRef.current = 0; return; }
        const n = st.points.length;
        if (full || drawnRef.current === 0 || n < drawnRef.current) {
            clear();
            drawStrokes(c, [st], false, bitmapStoreRef.current);
            drawnRef.current = n;
            return;
        }
        if (n === drawnRef.current) return;
        // Tail only: starting slightly before the last drawn point hides the seam.
        const from = Math.max(0, drawnRef.current - 3);
        drawStrokes(c, [{ ...st, points: st.points.slice(from) }], false, bitmapStoreRef.current);
        drawnRef.current = n;
    };

    /** Coalesce to one draw per frame - pointer events arrive far more often than frames. */
    const schedule = () => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; renderStroke(); });
    };

    /**
     * Forget what is on the overlay and draw the whole stroke again.
     *
     * For the moment a tool changes what it has already drawn rather than extending it - the
     * shape tools rebuild their stroke from the two corners on every move.
     */
    const restart = () => { drawnRef.current = 0; renderStroke(true); };

    return { overlayRef, ctx, clear, renderStroke, schedule, restart };
}
