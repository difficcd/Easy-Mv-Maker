import { useRef } from 'react';
import { drawMosaicMarquee } from '../canvas/editChrome.ts';
import type { Point } from '../core/types.ts';

/** A rectangle as it is dragged out: from where the pointer went down to where it is now. */
export interface DragRect { x0: number; y0: number; x1: number; y1: number }


// The mosaic: drag a rectangle, and what is inside it is pixelated when the pen lifts.
//
// Only the rectangle lives here. What the mosaic is applied *to* is App's business, because the
// answer is not obvious - it reads the composited canvas, since a mosaic covers what is on
// screen, but it writes to a resolved drawing layer, which is a different thing entirely.

/**
 * @param {object} opts
 * @param {{clear: () => void, ctx: () => CanvasRenderingContext2D|null}} opts.overlay
 * @param {() => number} opts.zoom the outline is drawn in screen pixels, so it stays visible
 *   whatever the canvas is zoomed to
 * @param {() => string} opts.colour the marquee's colour, resolved at draw time - a canvas
 *   cannot read a CSS variable, and an unparseable value is ignored without a word (#218)
 * @param {(rect: {x0: number, y0: number, x1: number, y1: number}) => void} opts.apply
 */
export function useMosaicTool({ overlay, zoom, colour, apply }: { overlay: { clear: () => void, ctx: () => CanvasRenderingContext2D | null }, zoom: () => number, colour: () => string, apply: (rect: DragRect) => void }) {
    const ref = useRef<DragRect | null>(null);

    const renderMarquee = () => {
        const ctx = overlay.ctx(); if (!ctx) return;
        overlay.clear();
        const r = ref.current; if (!r) return;
        drawMosaicMarquee(ctx, r, zoom(), colour());
    };

    const begin = (pos: Point) => {
        ref.current = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
        renderMarquee();
    };

    /** @returns {boolean} whether a rectangle is being dragged, so the caller knows it was handled. */
    const to = (pos: Point): boolean => {
        if (!ref.current) return false;
        ref.current.x1 = pos.x; ref.current.y1 = pos.y;
        renderMarquee();
        return true;
    };

    const end = (): boolean => {
        const r = ref.current; ref.current = null;
        if (!r) return false;
        overlay.clear();
        apply(r);
        return true;
    };

    return { ref, begin, to, end };
}
