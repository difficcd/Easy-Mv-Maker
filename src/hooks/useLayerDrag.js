// The move tool on a layer: press, drag a shifted copy on the overlay while the original is
// hidden, lift to commit the offset into every stroke.
//
// The preview is drawn here rather than through layer state, because the state route means
// re-evaluating and repainting the whole scene on every pointer move. `hiddenByGesture` in App
// reads `gesture.layerDrag` to leave the original out of the composite; `setDragTick` is how
// the frame is asked to repaint with it hidden.

import { flattenLayersInUiOrder } from '../core/layerTree.ts';
import { moveLayers } from '../core/cutsReducer.ts';

/**
 * @param {object} deps
 * @param {any} deps.gesture the shared gesture refs; the drag in flight is `layerDrag`
 * @param {any[]} deps.cuts
 * @param {(action: any) => void} deps.dispatchCuts
 * @param {(f: (v: number) => number) => void} deps.setDragTick
 * @param {() => CanvasRenderingContext2D | null} deps.liveCtx the overlay's context
 * @param {() => void} deps.clearLiveOverlay
 * @param {(cutId: any, layer: any) => HTMLCanvasElement | null} deps.ensureLayerCanvas
 */
export function useLayerDrag({ gesture, cuts, dispatchCuts, setDragTick, liveCtx, clearLiveOverlay, ensureLayerCanvas }) {
    /**
     * The shifted result on the overlay while paintFrame hides the original. It has to draw
     * once on press too, or the screen flashes empty for a moment.
     */
    const renderPreview = () => {
        const d = gesture.layerDrag.current; if (!d) return;
        const c2 = liveCtx(); if (!c2) return;
        const cut = cuts.find(c => c.id === d.cutId); if (!cut) return;
        clearLiveOverlay();
        const ox = Math.round(d.dx), oy = Math.round(d.dy);
        const order = flattenLayersInUiOrder(cut.layers || []).filter(l => l.type === 'layer' && d.layerIds.includes(l.id));
        for (let i = order.length - 1; i >= 0; i--) {
            const src = ensureLayerCanvas(cut.id, order[i]); // create it on the spot if it is not cached
            if (src) c2.drawImage(src, ox, oy);
        }
    };

    /** The press, with the layers that will move. */
    const begin = (e, pos, cutId, layerIds) => {
        gesture.begin(e);
        gesture.layerDrag.current = { cutId, layerIds, startPos: { x: pos.x, y: pos.y }, dx: 0, dy: 0 };
        renderPreview();            // draw immediately on press so the screen does not flash empty
        setDragTick(v => v + 1);    // hide the original
        e.preventDefault();
    };

    /** A move during the drag. False when no layer drag is in flight. */
    const move = (pos) => {
        const d = gesture.layerDrag.current;
        if (!d) return false;
        d.dx = pos.x - d.startPos.x; d.dy = pos.y - d.startPos.y;
        renderPreview();
        setDragTick(v => v + 1); // redraw while keeping the original hidden
        return true;
    };

    /** The lift: the offset is added to every stroke coordinate. False when nothing was dragged. */
    const end = () => {
        const d = gesture.layerDrag.current;
        if (!d) return false;
        gesture.layerDrag.current = null;
        gesture.end();
        const dx = Math.round(d.dx), dy = Math.round(d.dy);
        clearLiveOverlay();
        if (dx || dy) dispatchCuts(moveLayers(d.cutId, d.layerIds, dx, dy));
        setDragTick(v => v + 1);
        return true;
    };

    return { renderPreview, begin, move, end };
}
