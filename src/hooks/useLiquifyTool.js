import { useRef } from 'react';
import { sizeCanvas } from '../canvas/scratch.js';
import { pushAlong } from '../core/liquify.ts';
import { selectionStrokes } from '../core/lassoOps.js';
import { nextId } from '../core/ids.ts';

// Liquify: the layer's pixels are copied out when the pen goes down, pushed around in that copy
// on every move, and stamped back when it lifts.
//
// While the pen is down the overlay shows the copy and the composite hides the real layer, so
// what is on screen is exactly the buffer being edited - there is no moment where the two
// disagree. That is why App is told to re-render on begin and on end: it has to stop and start
// drawing the layer underneath.

/**
 * @param {object} opts
 * @param {{clear: () => void, ctx: () => CanvasRenderingContext2D|null}} opts.overlay
 * @param {(cutId: any, layer: any) => HTMLCanvasElement|null} opts.ensureLayerCanvas
 * @param {{cw: number, ch: number}} opts.size
 * @param {{size: number, strength: number}} opts.brush radius and how hard it pushes
 * @param {(img: ImageData) => any} opts.storeBitmap
 * @param {(cutId: any, layerId: any, strokes: any) => void} opts.commitStrokeToLayer
 * @param {() => void} opts.onHiddenChanged tell App the layer's visibility in the composite moved
 */
export function useLiquifyTool({ overlay, ensureLayerCanvas, size, brush, storeBitmap, commitStrokeToLayer, onHiddenChanged }) {
    const ref = useRef(/** @type {any} */(null));
    const { cw, ch } = size;

    const renderPreview = () => {
        const q = ref.current; if (!q) return;
        const ctx = overlay.ctx(); if (!ctx) return;
        overlay.clear();
        ctx.drawImage(q.canvas, 0, 0);
    };

    /** @returns {boolean} false when there is nothing to push around, so the caller can bail. */
    const begin = (cut, layer, pos) => {
        const src = ensureLayerCanvas(cut.id, layer); if (!src) return false;
        const canvas = document.createElement('canvas');
        sizeCanvas(canvas, cw, ch);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(src, 0, 0);
        const image = ctx.getImageData(0, 0, cw, ch);
        ref.current = { cutId: cut.id, layerId: layer.id, canvas, ctx, image, last: pos, box: null };
        renderPreview();
        onHiddenChanged();    // hide the original
        return true;
    };

    const to = (pos) => {
        const q = ref.current; if (!q) return;
        const b = pushAlong(q.image.data, cw, ch, q.last, pos, Math.max(2, brush.size), brush.strength);
        q.last = pos;
        if (!b) return;
        // Only the touched rectangle goes back to the canvas; the buffer is the whole layer.
        q.ctx.putImageData(q.image, 0, 0, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        q.box = q.box
            ? { x0: Math.min(q.box.x0, b.x0), y0: Math.min(q.box.y0, b.y0), x1: Math.max(q.box.x1, b.x1), y1: Math.max(q.box.y1, b.y1) }
            : b;
        renderPreview();
    };

    const end = () => {
        const q = ref.current; ref.current = null;
        overlay.clear();
        onHiddenChanged();    // show the layer again
        if (!q || !q.box) return;
        const { x0, y0, x1, y1 } = q.box;
        const w = x1 - x0, h = y1 - y0;
        if (w < 1 || h < 1) return;
        // The result replaces the rectangle rather than painting over it: pixels that flowed away
        // leave transparency behind, and a plain paste would let the original show through there.
        // So it is the same pair a selection commits with - a hole, then the pixels.
        const mask = new ImageData(w, h);
        mask.data.fill(255);
        const sel = {
            x: x0, y: y0, tx: x0, ty: y0, tw: w, th: h,
            bitmapId: storeBitmap(q.ctx.getImageData(x0, y0, w, h)),
            maskBitmapId: storeBitmap(mask),
        };
        const { erase, paste } = selectionStrokes(sel, nextId(), nextId());
        commitStrokeToLayer(q.cutId, q.layerId, [erase, paste]);
    };

    return { ref, begin, to, end };
}
