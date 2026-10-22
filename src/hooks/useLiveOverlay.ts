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
import type { BitmapLookup } from '../canvas/strokes.ts';
import { dotPathRange, isV2, STROKE_RENDER_V3 } from '../canvas/strokes.ts';
import { lightenStroke } from '../core/simplifyStroke.ts';


/**
 * @param {object} opts
 * @param {{current: any}} opts.strokeRef the stroke being drawn, or null between gestures
 * @param {{current: Map<any, any>}} opts.bitmapStoreRef pixels a paste stroke refers to
 * @param {(ctx: any, strokes: any[], live: boolean, store: any) => void} opts.drawStrokes
 */
export function useLiveOverlay({ strokeRef, bitmapStoreRef, drawStrokes }: { strokeRef: { current: any }, bitmapStoreRef: { current: BitmapLookup }, drawStrokes: (ctx: CanvasRenderingContext2D, strokes: Stroke[], live: boolean, store: BitmapLookup) => void }) {
    const overlayRef = useRef<HTMLCanvasElement | null>(null);
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
        if (lc) lc.getContext('2d')!.clearRect(0, 0, lc.width, lc.height);
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
        // A curved dot stroke draws only spans whose shape is final - both neighbours known - so the
        // overlay ends up holding exactly what the commit will draw. A span's curve depends on the
        // sample after it, and drawing the newest span as a guess, then again once the next sample
        // came, left the guess underneath: 1.15px off on average on fast loops, a ghost edge that
        // settled when the pen lifted. The newest span now waits for the next sample, a frame at
        // most, and dotPathRange takes each span's neighbours from the whole stroke, so the pieces
        // join into the committed curve to the pixel.
        if (st.tool === 'pen' && isV2(st) && !full && n >= drawnRef.current) {
            if (drawnRef.current === 0) {
                // The press itself: one stamp, so a dot appears under the pen at once.
                clear();
                drawStrokes(c, [{ ...st, points: st.points.slice(0, 1), curved: false, v: 1 }], false, bitmapStoreRef.current);
                drawnRef.current = 1;
            }
            const last = n - 2, from = drawnRef.current - 1;
            if (last > from) {
                drawStrokes(c, [{ ...st, points: dotPathRange(st.points, from, last), curved: false, v: 1 }], false, bitmapStoreRef.current);
                drawnRef.current = last + 1;
            }
            return;
        }
        // The pen (renderer v3) is redrawn whole each frame, exactly as it will commit -
        // lightenStroke and all - so the line under the pen is the line that lands. Drawing only
        // the new tail left 5,168px of a fast stroke on the overlay that the committed stroke did
        // not have: its smoothing and its simplification both depend on samples still to come.
        // Redrawing whole was tried at v2 and stuttered (100ms frames at 400 samples), because
        // v2 still stroked every pixel of length separately; v3 is one fill.
        if (st.tool === 'brush' && (st.v ?? 1) >= STROKE_RENDER_V3) {
            clear();
            drawStrokes(c, [lightenStroke(st)], false, bitmapStoreRef.current);
            drawnRef.current = n;
            return;
        }
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
