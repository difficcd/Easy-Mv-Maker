import { useRef, useState } from 'react';
import { catmullThrough } from '../core/catmullRom.ts';
import { drawStrokesOnCtx } from '../canvas/strokes.ts';
import { drawCurveAnchors } from '../canvas/editChrome.ts';
import { nextId } from '../core/ids.ts';

// The curve ruler: tap out anchors, and a smooth line is fitted through them.
//
// What it produces is an ordinary brush stroke - it takes the brush, it boils with the layer, it
// erases and saves like any other line. Nothing downstream has to learn that a curve exists,
// which is the same trick the shape tools use.
//
// An anchor can be fine-tuned while the pen is still down: the tap places it, the drag moves the
// one just placed. That is what `dragging` tracks, and it is why the last anchor is overwritten
// rather than appended to while a drag is in progress.

/**
 * @param {object} opts
 * @param {{clear: () => void, ctx: () => CanvasRenderingContext2D|null}} opts.overlay
 * @param {() => {color: string, opacity: number, size: number}} opts.brush read at draw time,
 *   so changing the colour mid-curve shows immediately
 * @param {{current: Map<any, any>}} opts.bitmapStoreRef
 * @param {() => number} opts.zoom anchors are drawn in screen pixels, so they stay grabbable
 * @param {(stroke: any) => void} opts.commitLiveStroke
 */
export function useCurveTool({ overlay, brush, bitmapStoreRef, zoom, commitLiveStroke }) {
    const anchorsRef = useRef(/** @type {any[]|null} */(null));
    const draggingRef = useRef(false);
    const [count, setCount] = useState(0);   // anchor count, for the done/cancel bar

    const strokeFrom = (pts) => {
        const { color, opacity, size } = brush();
        return { id: nextId(), tool: 'brush', color, opacity, size, points: catmullThrough(pts) };
    };

    const renderPreview = () => {
        const ctx = overlay.ctx(); if (!ctx) return;
        overlay.clear();
        const pts = anchorsRef.current || [];
        if (pts.length >= 2) drawStrokesOnCtx(ctx, [strokeFrom(pts)], false, bitmapStoreRef.current);
        drawCurveAnchors(ctx, pts, zoom());
    };

    /** A tap: place an anchor, and hold it so a drag can move it. */
    const addAnchor = (pos) => {
        if (!anchorsRef.current) anchorsRef.current = [];
        anchorsRef.current.push({ x: pos.x, y: pos.y, pressure: pos.pressure });
        draggingRef.current = true;
        setCount(anchorsRef.current.length);
        renderPreview();
    };

    /** A move while the anchor just placed is still held. */
    const dragTo = (pos) => {
        if (!draggingRef.current || !anchorsRef.current) return false;
        const a = anchorsRef.current;
        a[a.length - 1] = { x: pos.x, y: pos.y, pressure: pos.pressure };
        renderPreview();
        return true;
    };

    const endDrag = () => {
        if (!draggingRef.current) return false;
        draggingRef.current = false;
        renderPreview();
        return true;
    };

    const reset = () => {
        anchorsRef.current = null;
        draggingRef.current = false;
        setCount(0);
    };

    /** Finish: fewer than two anchors is not a line, so it leaves nothing behind. */
    const commit = () => {
        const pts = anchorsRef.current;
        reset();
        if (pts && pts.length >= 2) commitLiveStroke(strokeFrom(pts));
        else overlay.clear();
    };

    const cancel = () => { reset(); overlay.clear(); };

    return { anchorsRef, draggingRef, count, addAnchor, dragTo, endDrag, commit, cancel };
}
