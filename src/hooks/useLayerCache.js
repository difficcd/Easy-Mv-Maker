import { useEffect, useRef, useState } from 'react';
import { sizeCanvas, scratchCanvas } from '../canvas/scratch.js';
import { drawStrokesOnCtx } from '../canvas/strokes.js';
import { safeArray } from '../core/geometry.js';
import { layerKey, layerSig } from '../core/layerTree.js';
import { scanLayerBitmaps } from '../engine/pendingBitmaps.js';
import { cutsToCache } from '../engine/selectCuts.js';
import { layerKeysUsingBitmaps, keysWithPhases, prefetchWindow } from '../core/decodeBudget.js';

// How many distinct wobbles the boiling line cycles through. A hand-drawn boiling line is a
// handful of drawings alternating, not a new one every frame, so this reads right - and it is
// what keeps the effect affordable, since each phase is rasterised once and then cached.
export const BOIL_PHASES = 3;
// Layer canvases held on demand during render. Each is a full canvas (8MB at 1920x1080), so this
// is a memory ceiling as much as a cache size: a boiling layer occupies BOIL_PHASES of them.
const LAYER_CANVAS_LRU = 24;

/**
 * The layer canvases the frame is composited from, and everything that keeps them current.
 *
 * A layer is rasterised once to its own canvas and that canvas is reused until the layer
 * changes - repaint is the cost in this app, not React. Two caches: the state one, rebuilt by
 * an effect for the cuts that can be on screen, and a ref-held LRU that ensureLayerCanvas
 * fills on demand when the paint loop reaches a layer the effect has not got to yet (every
 * frame during playback). Frame bitmaps are decoded lazily and ahead of the playhead, and the
 * cache entries that used a frame are dropped when it lands so they redraw with it.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../canvas/bitmapStore.js').createBitmapStore>} deps.store
 * @param {any[]} deps.cuts
 * @param {any} deps.currentCutId
 * @param {any} deps.currentCut
 * @param {number} deps.currentTime
 * @param {boolean} deps.onionPrev
 * @param {boolean} deps.onionNext
 * @param {any} deps.activePartId
 * @param {boolean} deps.isPlaying
 * @param {{current: boolean}} deps.isPlayingRef
 * @param {number} deps.canvasW
 * @param {number} deps.canvasH
 * @param {(cutId: any, layerId: any) => boolean} deps.hiddenByGesture layers a gesture draws itself
 * @param {{current: any}} deps.prefetchRef where the playback loop finds prefetchFramesAt
 * @param {{current: number}} deps.boilPhaseRef the boiling phase the paint loop sets
 */
export function useLayerCache({
    store: bitmaps, cuts, currentCutId, currentCut, currentTime, onionPrev, onionNext,
    activePartId, isPlaying, isPlayingRef, canvasW, canvasH, hiddenByGesture, prefetchRef, boilPhaseRef,
}) {
    const [layerCanvasCache, setLayerCanvasCache] = useState({});
    const fallbackCanvasRef = useRef(new Map()); // LRU of layer canvases built on demand during render
    const [frameDecodeTick, setFrameDecodeTick] = useState(0); // bumped when a frame finishes decoding, so the cache rebuilds
    const clipScratchRef = useRef(null);
    const clipPaintRef = useRef(null);

    /** Something outside the document changed what the frame looks like - a video seeked. */
    const requestRepaint = () => setFrameDecodeTick(t => t + 1);
    /** Everything cached is for another document, or another canvas size: start again. */
    const clearLayerCache = () => { fallbackCanvasRef.current.clear(); setLayerCanvasCache({}); };
    // Cached layer canvases hold the old dimensions - drop them when the size changes.
    useEffect(() => { clearLayerCache(); }, [canvasW, canvasH]);

    // Invalidate ONLY the cached layer canvases of cuts that use the given (just-decoded) frames,
    // instead of nuking the whole cache — nuking made on-screen frames flicker while playing.
    const invalidateCutsUsing = (ids) => {
        const affected = layerKeysUsingBitmaps(cuts, ids, layerKey);
        if (!affected.size) return;
        // The phase keys of a boiling layer go with the plain one; core/decodeBudget says why.
        for (const k of keysWithPhases([...fallbackCanvasRef.current.keys()], affected)) {
            fallbackCanvasRef.current.delete(k);
        }
        setLayerCanvasCache(prev => { const n = { ...prev }; for (const k of affected) delete n[k]; return n; });
    };

    useEffect(() => {
        const newCache = { ...layerCanvasCache };
        const validKeys = new Set();
        let changed = false;
        // Only the cuts that can be on screen - engine/selectCuts says which. Caching every cut
        // made hundreds of frames rebuild on each edit and stalled the app.
        const visible = cutsToCache(cuts, currentTime, currentCut, { prev: onionPrev, next: onionNext });
        for (const cut of cuts) {
            if (!visible.has(cut.id)) continue;
            for (const layer of cut.layers) {
                if (layer.type !== 'layer') continue;
                const key = layerKey(cut.id, layer.id);
                validKeys.add(key);
                const canvas = newCache[key];
                // Cheap change signature instead of JSON.stringify(strokes): strokes are only
                // appended/replaced in this app, so length + last-stroke id/points/tool is enough.
                // Avoids O(n) stringify of a growing stroke on every drawing frame.
                // A boiling layer changes phase constantly, so nothing is baked here;
                // ensureLayerCanvas redraws it per phase. Only a single still frame (phase 0) is
                // kept, for the thumbnail.
                const layerStrokes = layerSig(layer);
                if (!canvas || canvas.dataset.strokes !== layerStrokes) {
                    // Skip (don't cache a blank) if a frame isn't decoded yet — the prefetch effect
                    // decodes it and repaints. Do NOT request a decode here (would loop with tick).
                    if (scanLayerBitmaps(layer, bitmaps.map).pending.length) continue;
                    const newCanvas = canvas || document.createElement('canvas');
                    sizeCanvas(newCanvas, canvasW, canvasH);
                    drawStrokesOnCtx(newCanvas.getContext('2d'), layer.strokes, true, bitmaps.map, { roughen: layer.roughen || 0 });
                    newCanvas.dataset.strokes = layerStrokes;
                    newCache[key] = newCanvas;
                    changed = true;
                }
            }
        }
        // Drop cache entries for deleted cuts/layers so the cache doesn't grow unbounded.
        for (const key of Object.keys(newCache)) {
            if (!validKeys.has(key)) { delete newCache[key]; changed = true; }
        }
        if (changed) {
            setLayerCanvasCache(newCache);
        }
    }, [cuts, currentCutId, currentCut, currentTime, onionPrev, onionNext]);

    // Re-create released frame bitmaps (from their Blob) on demand, then repaint. Used both by the
    // render path (a released frame scrolled into view) and the part-scoped release below.
    const requestFrameDecode = (ids) => {
        const store = bitmaps.map;
        const todo = ids.filter(id => { const e = store.get(id); return e && e.blob && !e.imageBitmap && !bitmaps.decoding.has(id); });
        if (!todo.length) return;
        todo.forEach(id => bitmaps.decoding.add(id));
        const playing = isPlayingRef.current;
        (async () => {
            let cursor = 0, firstDone = false;
            const done = [];
            // Decode several frames concurrently (createImageBitmap runs off-thread) so the buffer
            // fills faster than playback consumes it.
            const worker = async () => {
                while (cursor < todo.length) {
                    const id = todo[cursor++];
                    const e = store.get(id); if (!e || !e.blob) { bitmaps.decoding.delete(id); continue; }
                    try { e.imageBitmap = await bitmaps.decodeFrame(e); bitmaps.touch(id); done.push(id); } catch { }
                    bitmaps.decoding.delete(id);
                    // Paused: repaint once as soon as the FIRST frame lands (so the current frame shows
                    // immediately), then once more for the rest at the end — NOT per frame (hundreds of
                    // setState in a big batch trip React's update-depth guard). Playing: the rAF loop paints.
                    if (!playing && !firstDone) { firstDone = true; invalidateCutsUsing([id]); setFrameDecodeTick(t => t + 1); }
                }
            };
            await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
            bitmaps.trim(new Set(todo)); // keep memory bounded; protect what we just decoded
            if (!playing && done.length) { invalidateCutsUsing(done); setFrameDecodeTick(t => t + 1); }
        })();
    };
    // Part-scoped memory: when a part is active, release frames that belong to OTHER parts (their
    // compact Blob stays, ready to re-decode). Decoding the active part's visible window is left to
    // the prefetch effect — don't bulk-decode the whole part here (hundreds of decodes = update storm).
    useEffect(() => {
        if (!activePartId) return; // all parts: leave decoded frames as-is; the LRU cap bounds memory
        const store = bitmaps.map;
        const keep = new Set(); // frame ids belonging to the active part
        cuts.forEach(c => { if (c.partId === activePartId) safeArray(c.layers).forEach(l => safeArray(l.strokes).forEach(s => { if (s.tool === 'paste' && s.bitmapId) keep.add(s.bitmapId); })); });
        let released = false;
        for (const [id, e] of store) { if (e.blob && e.imageBitmap && !keep.has(id) && !bitmaps.hot.has(id)) { try { e.imageBitmap.close?.(); } catch { } e.imageBitmap = null; released = true; } }
        if (released) { fallbackCanvasRef.current.clear(); setLayerCanvasCache({}); }
    }, [activePartId]);

    // Prefetch: decode the current frame first (shows immediately) and a window of frames ahead of
    // the playhead (and a few behind), so playback and scrubbing don't stall on lazy decoding.
    // The LRU cap releases frames outside this window, so memory stays bounded.
    const prefetchFramesAt = (time, playing) => {
        // Which frames, and in what order, is core/decodeBudget's answer; here they are marked
        // hot - protected from the LRU - and decoded.
        const ids = prefetchWindow(cuts, time, currentCutId, playing);
        if (!ids.length) return;
        bitmaps.setHot(ids);
        requestFrameDecode(ids);
    };
    prefetchRef.current = prefetchFramesAt;
    // While playing, the rAF loop drives prefetch from the REAL playhead — don't also run it on the
    // throttled currentTime (redundant work competing with the loop). Paused/seek uses this effect.
    useEffect(() => { if (!isPlaying) prefetchFramesAt(currentTime, false); }, [currentCutId, currentTime, isPlaying, cuts]);

    // The cache effect only precomputes visible cuts, and it commits one render late — so a cut
    // that just became visible (every frame during playback) would draw as a blank/white frame.
    // Build it synchronously here instead of skipping; the ref map keeps it bounded.
    const ensureLayerCanvas = (cutId, layer) => {
        const key = layerKey(cutId, layer.id);
        // A boiling layer folds the time phase into its signature, so it redraws each phase and
        // the strokes visibly shimmer. Layers with the effect off keep their old signature shape,
        // so their cache still hits and performance is unchanged.
        //
        // The phase cycles through BOIL_PHASES distinct wobbles rather than inventing a new one
        // every tick, which is both how a hand-drawn boiling line actually works - a few drawings
        // alternating, "on threes" - and what makes it affordable. Every phase being unique meant
        // the layer re-rasterised all of its strokes ten times a second for as long as it was on
        // screen, at a cost that grew with the drawing: 15 strokes already took the 95th-percentile
        // frame from 10ms to 28ms. Cycling means the layer is drawn BOIL_PHASES times and every
        // tick after that is a cache hit.
        //
        // The layer's speed multiplier still applies; a speed of 0 stops it.
        const phase = Math.floor(boilPhaseRef.current * (layer.roughSpeed ?? 1));
        const boil = layer.roughen ? ((phase % BOIL_PHASES) + BOIL_PHASES) % BOIL_PHASES : 0;
        const rOpts = { roughen: layer.roughen || 0, roughPhase: boil, roughWave: layer.roughWave ?? 1, roughMinSize: layer.roughMinSize ?? 0 };
        const sig = layerSig(layer, rOpts);
        // Each phase needs its own canvas, or they would evict one another every tick and the
        // cycling would buy nothing.
        const slotKey = layer.roughen ? `${key}#${boil}` : key;
        const cached = layerCanvasCache[key];
        if (cached && cached.dataset.strokes === sig) return cached;
        const map = fallbackCanvasRef.current;
        const hit = map.get(slotKey);
        if (hit && hit.dataset.strokes === sig) return hit;
        // A frame whose imageBitmap was released (part-scoped memory) needs re-decoding first.
        // Kick the decode and return the stale canvas (if any) rather than caching a blank one.
        // If a frame isn't decoded yet, show the stale canvas (or nothing). Requesting a decode from
        // the paint path is only safe WHILE PLAYING (requestFrameDecode does no setState then, so no
        // loop) — it's a safety net if the prefetch fell behind. When paused, decoding is driven only
        // by the prefetch effect (a paused decode fires setState, which would loop from here).
        const store = bitmaps.map;
        // Draw the layer into the cache under a signature. The complete and the incomplete paths
        // below were the same six lines twice, differing only in that signature - and two copies
        // of a caching rule are two chances for them to drift into disagreeing about what is
        // cached under what.
        //
        // Resize only when the size actually changed: this canvas is reused every boiling phase,
        // ten times a second, and re-assigning the same width reallocated 8MB each time - the
        // measured 79MB/s that ran the tab out of memory. drawStrokesOnCtx clears it either way,
        // which is why this does not go through scratchCanvas.
        const bake = (signature) => {
            const cnv = hit || document.createElement('canvas');
            sizeCanvas(cnv, canvasW, canvasH);
            drawStrokesOnCtx(cnv.getContext('2d'), layer.strokes, true, store, rOpts);
            cnv.dataset.strokes = signature;
            map.delete(slotKey); map.set(slotKey, cnv);   // re-insert = most recently used
            while (map.size > LAYER_CANVAS_LRU) map.delete(map.keys().next().value);
            return cnv;
        };
        const scan = scanLayerBitmaps(layer, store);
        const missing = scan.pending;
        // Anything this layer did draw from is now the most recently used, so the LRU keeps it.
        for (const id of scan.decoded) bitmaps.touch(id);
        if (missing.length) {
            if (isPlayingRef.current) requestFrameDecode(missing);
            if (cached || hit) return cached || hit;
            // If a bitmap (a video frame, say) has not decoded yet - or never will - the layer
            // is still not skipped wholesale. Skipping it would take the pen strokes on the same
            // layer with it and leave the screen blank, which is what happened when a server
            // asset was unavailable. Instead the strokes that can be drawn are drawn, and the
            // signature is marked incomplete so it redraws once the decode finishes.
            return bake(sig + '|miss' + missing.length);
        }
        return bake(sig);
    };


    // A clipping group, flattened into one canvas.
    //
    // Clipping is "show only where the layer below has paint", and the way to get that from a 2D
    // context is `destination-in`: stack the clipped layers, then keep only the pixels that
    // overlap the base's alpha.
    //
    // It has to happen before the per-layer transform rather than after. A clipped layer is paint
    // *on* the base - shading inside a shape - so it moves with the base; masking after each
    // layer had been transformed separately would let the shadow slide out of the thing it is
    // shading. The clipped layers' own part animations are therefore ignored, which is the same
    // choice every drawing app makes and the reason the group is composited as a unit.
    //
    // Two scratch canvases and one composite pass per group, and only for groups that actually
    // have something clipped to them - a stack with no clipping does not allocate anything.
    const flattenClipGroup = (cutId, group) => {
        const baseCanvas = ensureLayerCanvas(cutId, group.base);
        if (!baseCanvas || group.clipped.length === 0) return baseCanvas;

        // Every clipped layer has to be ready, or the group would flash without its shading while
        // one frame is still decoding.
        // A layer being dragged is drawn by the overlay with the original hidden, and a clipped
        // one is no different - leaving it in the group would draw it twice and trail a ghost.
        const dragging = (id) => hiddenByGesture(cutId, id);

        const parts = [];
        for (let k = group.clipped.length - 1; k >= 0; k--) {   // bottom-to-top within the group
            if (dragging(group.clipped[k].id)) continue;
            const c = ensureLayerCanvas(cutId, group.clipped[k]);
            if (!c) return baseCanvas;
            parts.push(c);
        }
        if (parts.length === 0) return baseCanvas;

        const { canvas: paint, ctx: pctx } = scratchCanvas(clipPaintRef, canvasW, canvasH);
        pctx.globalCompositeOperation = 'source-over';
        for (const c of parts) pctx.drawImage(c, 0, 0);

        // Keep only what lands on the base.
        pctx.globalCompositeOperation = 'destination-in';
        pctx.drawImage(baseCanvas, 0, 0);
        pctx.globalCompositeOperation = 'source-over';

        const { canvas: out, ctx: octx } = scratchCanvas(clipScratchRef, canvasW, canvasH);
        octx.drawImage(baseCanvas, 0, 0);
        octx.drawImage(paint, 0, 0);
        return out;
    };

    return { layerCanvasCache, clearLayerCache, ensureLayerCanvas, flattenClipGroup, invalidateCutsUsing, requestFrameDecode, frameDecodeTick, requestRepaint };
}
