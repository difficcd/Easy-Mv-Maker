// Painting one frame of the film onto the main canvas.
//
// This was paintFrame inside App, a useCallback over a dozen refs. The function is the same;
// what moved is the scratch it needs - the mosaic's, the static's and the mask's slots, the
// snow tile, a canvas per noisy text, and the "have we painted once" flag - which now live in
// one object made by createFrameScratch rather than as eight refs among App's forty. App keeps
// a thin useCallback that reads its state and calls this.
//
// The order of the passes is the order things are seen: white or nothing, then everything
// under the camera - the reference video, the onion skin, the artwork with its effects, the
// texts - and the camera restored. Editing chrome (selection box, motion paths) is not here:
// it is drawn by App after this, so it never reaches an export.

import { evaluateFrame } from '../engine/evaluateFrame.js';
import { pendingBitmapIds } from '../engine/pendingBitmaps.js';
import { onionNeighbours } from '../engine/selectCuts.js';
import { applyCamera } from '../core/camera.ts';
import { flattenLayersInUiOrder } from '../core/layerTree.ts';
import { drawScene, drawVideoOverlay, drawOnionCut, drawSceneTexts } from './sceneRender.js';
import { drawTextObject, textNeedsBox } from './textRender.js';
import { grainTile } from './pixelEffects.js';
import { fitRect } from './videoFrames.js';
import { makeCanvas } from './canvasFactory.js';

/** How many times a second the boiling-line motion advances. */
export const BOIL_FPS = 10;

/**
 * The scratch a frame painter keeps between frames. One per canvas, made once.
 *
 * Every slot is a plain `{current}` ref because scratchCanvas insists on that shape - a slot
 * that held two canvases under one ref threw on the first mosaic frame (#263). The mosaic has
 * two because composing a region reads the small copy while writing the full one; the static
 * has two because its halves are read while its output is written.
 */
export function createFrameScratch() {
    return {
        /** the mask path in drawScene */
        mask: { current: null },
        mosaicFull: { current: null },
        mosaicSmall: { current: null },
        staticCopy: { current: null },
        staticOut: { current: null },
        /** the snow tile, built on first use: most projects never turn the static on */
        tile: /** @type {HTMLCanvasElement | null} */ (null),
        /** one canvas per noisy text, by text id, so the static's per-canvas cache holds */
        textStatic: /** @type {Map<any, {current: any}>} */ (new Map()),
        /** once a real frame has been painted, hold it rather than flash white */
        paintedOnce: false,
    };
}

/**
 * Paint the film at time `t` onto `ctx`.
 *
 * @param {CanvasRenderingContext2D} ctx the main canvas, `cw` by `ch`
 * @param {object} f everything the frame is made of
 * @param {number} f.t
 * @param {boolean} f.playing playback (animations on, decode holds) or editing (still)
 * @param {number} f.cw
 * @param {number} f.ch
 * @param {any[]} f.cuts
 * @param {any} f.currentCutId
 * @param {any} f.currentCut
 * @param {boolean} f.transparentBg no white fill under the frame
 * @param {any} f.selection the floating selection, for the hole it leaves in its layer
 * @param {boolean} f.onionPrev
 * @param {boolean} f.onionNext
 * @param {any} f.videoOverlay the reference video track, or null
 * @param {HTMLVideoElement | null} f.videoEl its element, kept at time t by the caller
 * @param {Map<any, any>} f.bitmapStore
 * @param {(ids: any[]) => void} f.requestFrameDecode
 * @param {(cutId: any, layer: any) => HTMLCanvasElement | null} f.ensureLayerCanvas
 * @param {(cutId: any, group: any) => HTMLCanvasElement | null} f.flattenClipGroup
 * @param {(cutId: any, layerId: any) => boolean} f.hiddenByGesture
 * @param {{current: number}} f.boilPhaseRef the boiling phase, read by the layer cache
 * @param {number} f.boilTick
 * @param {(text: any) => any} f.measureTextBox
 * @param {ReturnType<typeof createFrameScratch>} f.scratch
 */
export function paintFrameOnto(ctx, { t, playing, cw, ch, cuts, currentCutId, currentCut, transparentBg, selection, onionPrev, onionNext, videoOverlay, videoEl, bitmapStore, requestFrameDecode, ensureLayerCanvas, flattenClipGroup, hiddenByGesture, boilPhaseRef, boilTick, measureTextBox, scratch }) {
    // Boiling phase, quantised to about ten changes a second like a traditional boiling line.
    // Changing it every frame just reads as noise; this rate is what makes the drawing feel
    // alive.
    boilPhaseRef.current = t * BOIL_FPS + boilTick;
    const primary = currentCut;
    // Everything about *what* this frame is - which cuts, their animation, their layer
    // groups, their texts, the camera - is worked out once, before anything is drawn.
    // The two passes below then read the same answer instead of each recomputing it.
    const scene = evaluateFrame(cuts, t, { playing, currentCutId, cw, ch });
    const activeCuts = scene.cuts.map(e => e.cut);
    // Never flash white DURING PLAYBACK: if the frame we're about to show isn't decoded yet,
    // HOLD the last painted frame (skip this repaint) and kick a decode. The loop keeps advancing,
    // so it reads as a brief hold instead of a white flash. Paused/editing always paints normally
    // (the prefetch effect repaints once the frame is ready), so a still frame is never stuck.
    if (playing && scratch.paintedOnce) {
        const missing = pendingBitmapIds(activeCuts, bitmapStore);
        if (missing.length) { requestFrameDecode(missing); return; }
    }
    // Clear either way - the canvas holds the previous frame otherwise. The difference is
    // whether white is then painted over it, which is what makes an export opaque.
    ctx.clearRect(0, 0, cw, ch);
    if (!transparentBg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); }
    scratch.paintedOnce = true;
    // The camera is a window onto the frame, so it wraps everything drawn into it - the video
    // reference, the artwork and the text move together, which is the whole point of it being
    // a camera rather than another per-layer transform. The white fill above stays outside:
    // that is the viewport itself, and zooming it would leave the edges unpainted.
    //
    // Playback only, like cut and part animation. While editing, a moved canvas would put the
    // pen somewhere other than where the drawing appears, which is not a trade worth making
    // for a preview.
    //
    // A shot belongs to the cut on the lowest active track: that is the base scene, and the
    // tracks above it are parts of the same shot rather than shots of their own.
    const camAt = scene.camera;
    if (camAt) { ctx.save(); applyCamera(ctx, camAt, cw, ch); }
    // Video overlay track: drawn underneath everything. The <video> element is kept at time t by
    // the playback loop (playing) or a paused-seek effect.
    if (videoOverlay && t >= videoOverlay.startTime && t < videoOverlay.endTime) {
        drawVideoOverlay(ctx, videoEl, videoOverlay, cw, ch, fitRect);
    }

    // Onion skin: the neighbouring drawings, faint, so a new one can be lined up against
    // them. Paused only - during playback the next frame is about to be shown anyway.
    if (!playing && primary && (onionPrev || onionNext)) {
        const { prev, next } = onionNeighbours(cuts, primary);
        for (const cut of [onionPrev ? prev : null, onionNext ? next : null]) {
            if (cut) drawOnionCut(ctx, cut, ensureLayerCanvas, flattenLayersInUiOrder);
        }
    }

    // Every cut's layers, bottom to top, under the cut's and the part's transform, with the
    // floating selection's hole cut out of the layer it was lifted from: canvas/sceneRender.
    drawScene(ctx, scene, {
        cw, ch, flattenClipGroup, hiddenByGesture, selection,
        bitmapEntry: (id) => bitmapStore.get(id), maskScratchRef: scratch.mask,
        mosaicScratch: { full: scratch.mosaicFull, small: scratch.mosaicSmall },
        staticScratch: { copy: scratch.staticCopy, out: scratch.staticOut },
        // Built on first use, not at mount: most projects never turn the static on.
        staticTile: (scratch.tile ||= grainTile(makeCanvas)),
    });

    // Text objects live outside paint layers ("text layer").
    drawSceneTexts(ctx, scene, {
        cw, ch, drawTextObject, textNeedsBox, measureTextBox,
        textNoise: {
            scratch: { copy: scratch.staticCopy, out: scratch.staticOut },
            tile: (scratch.tile ||= grainTile(makeCanvas)),
            scratchFor: (id) => { const m = scratch.textStatic; if (!m.has(id)) m.set(id, { current: null }); return m.get(id); },
        },
    });
    if (camAt) ctx.restore();
}
