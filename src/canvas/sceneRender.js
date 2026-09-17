// Compositing the evaluated scene onto the frame: every cut's layers, bottom to top, each
// under its cut's and its part's transform, with a floating selection's hole cut out of the
// layer it was lifted from.
//
// This was the middle of paintFrame. What it needs from the app is handed in: the flattened
// canvas for a clip group (the cache's), which layers a gesture is drawing itself, and the
// selection whose mask applies. Nothing here reads state.

import { applyCutAnim, imageDataCanvas, scratchCanvas } from './canvasUtils.js';
import { applyPartTransform, drawMaskedLayer } from './layerComposite.js';
import { drawSwayed } from './swayRender.js';
import { pixelateCanvas } from './pixelEffects.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{cuts: Array<{cut: any, anim: any, groups: any[]}>}} scene from engine/evaluateFrame
 * @param {object} deps
 * @param {number} deps.cw
 * @param {number} deps.ch
 * @param {(cutId: any, group: any) => (HTMLCanvasElement | ImageBitmap | null)} deps.flattenClipGroup
 *   a clip group as one canvas, or null while a frame in it is still decoding
 * @param {(cutId: any, layerId: any) => boolean} deps.hiddenByGesture
 * @param {{cutId: any, sourceLayerId: any, maskBitmapId: any, x: number, y: number} | null} deps.selection
 * @param {(id: any) => {imageBitmap?: any, imageData?: any} | undefined} deps.bitmapEntry
 * @param {{current: any}} deps.maskScratchRef a scratch canvas slot for the mask
 * @param {{current: any}} deps.mosaicScratchRef the small canvas a mosaic effect shrinks a layer into
 */
export function drawScene(ctx, scene, { cw, ch, flattenClipGroup, hiddenByGesture, selection, bitmapEntry, maskScratchRef, mosaicScratchRef }) {
    for (const { cut: ac, anim, groups } of scene.cuts) {
        ctx.save();
        if (anim) {
            ctx.globalAlpha = anim.alpha;
            applyCutAnim(ctx, anim, cw, ch);
        }
        // Bottom to top, so the topmost layer in the panel is on top on the frame.
        for (let i = groups.length - 1; i >= 0; i--) {
            const group = groups[i];
            const l = group.base;
            const layerCanvas = flattenClipGroup(ac.id, group);
            if (!layerCanvas) continue;   // a frame still decoding; the next repaint has it

            // A layer being dragged or liquified is drawn by the overlay instead, with the
            // original hidden, which prevents a ghost trailing behind it.
            if (hiddenByGesture(ac.id, l.id)) continue;

            // The part transform nests inside the cut transform; the composition order - and why
            // rotation is about the pivot, not the origin - is a matrix in layerComposite.
            const la = group.anim;
            ctx.save();
            applyPartTransform(ctx, la);

            const shouldMask = !!selection?.maskBitmapId && selection.cutId === ac.id && selection.sourceLayerId === l.id;
            const maskEntry = shouldMask ? bitmapEntry(selection.maskBitmapId) : null;
            const mask = maskEntry?.imageBitmap || (maskEntry?.imageData && imageDataCanvas(maskEntry.imageData)) || null;

            // A mosaic effect replaces the layer's own pixels with a pixelated copy, so it is
            // applied to the source rather than to the frame: everything below - the sway warp,
            // the selection mask, the part transform - then works on the blocks, which is what
            // makes the effect look like it belongs to the drawing and not like a filter laid
            // over the shot.
            const src = la?.mosaic >= 2
                ? (pixelateCanvas(layerCanvas, la.mosaic, mosaicScratchRef, scratchCanvas) || layerCanvas)
                : layerCanvas;
            // Blown back up with smoothing off; on the way down it was on, which is what averages
            // each block rather than point-sampling one pixel out of it.
            const blocky = src !== layerCanvas;
            if (blocky) ctx.imageSmoothingEnabled = false;

            if (la?.swayProfile && !mask) {
                drawSwayed(ctx, src, { profile: la.swayProfile, axis: la.swayAxis, disp: la.swayDisp, cw, ch });
            } else if (!mask) {
                ctx.drawImage(src, 0, 0, cw, ch);
            } else {
                // imageDataCanvas is a different shared canvas from the mask scratch, so nesting
                // them is safe - which is why they are separate helpers rather than two slots.
                drawMaskedLayer(ctx, src, mask, selection, scratchCanvas(maskScratchRef, cw, ch));
            }
            if (blocky) ctx.imageSmoothingEnabled = true;
            ctx.restore();
        }
        ctx.restore();
    }
}

/** How faint a neighbouring drawing is under the one being worked on. */
export const ONION_ALPHA = 0.35;

/**
 * The reference video, fitted to the canvas and faded by the track's opacity, drawn under
 * everything else. Nothing is drawn while the element has no frame to give.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement | null} v
 * @param {{w?: number, h?: number, opacity?: number}} overlay
 * @param {number} cw
 * @param {number} ch
 * @param {(sw: number, sh: number, dw: number, dh: number) => {x: number, y: number, w: number, h: number}} fit
 */
export function drawVideoOverlay(ctx, v, overlay, cw, ch, fit) {
    if (!v || v.readyState < 2) return;
    const r = fit(overlay.w || v.videoWidth || cw, overlay.h || v.videoHeight || ch, cw, ch);
    // Restored rather than left set: everything drawn after this - the artwork, the text -
    // would otherwise inherit the reference layer's fade.
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = overlay.opacity ?? 1;
    try { ctx.drawImage(v, r.x, r.y, r.w, r.h); } catch { }
    ctx.globalAlpha = prevAlpha;
}

/**
 * The onion skin: a neighbouring cut's visible layers, faint, bottom to top, so a new drawing
 * can be lined up against it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} cut
 * @param {(cutId: any, layer: any) => CanvasImageSource | null} layerCanvas
 * @param {(layers: any[]) => any[]} inUiOrder
 */
export function drawOnionCut(ctx, cut, layerCanvas, inUiOrder) {
    const order = inUiOrder(cut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
    for (let i = order.length - 1; i >= 0; i--) {
        const lc = layerCanvas(cut.id, order[i]);
        if (lc) { ctx.globalAlpha = ONION_ALPHA; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
    }
}

/**
 * Every cut's text objects, under the cut's transform. The alpha is not set on the context the
 * way it is for the artwork: a text has its own opacity, so drawTextObject multiplies the two
 * rather than being handed a context that already has one applied.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{cuts: Array<{anim: any, texts: Array<{text: any, anim: any}>}>}} scene
 * @param {object} deps
 * @param {number} deps.cw
 * @param {number} deps.ch
 * @param {(ctx: CanvasRenderingContext2D, text: any, opts: object) => void} deps.drawTextObject
 * @param {(text: any, anim: any) => boolean} deps.textNeedsBox
 * @param {(text: any) => any} deps.measureTextBox
 */
export function drawSceneTexts(ctx, scene, { cw, ch, drawTextObject, textNeedsBox, measureTextBox }) {
    for (const { anim, texts } of scene.cuts) {
        ctx.save();
        applyCutAnim(ctx, anim, cw, ch);
        for (const { text, anim: ta } of texts) {
            drawTextObject(ctx, text, { anim: ta, box: textNeedsBox(text, ta) ? measureTextBox(text) : null, alpha: anim ? anim.alpha : 1 });
        }
        ctx.restore();
    }
}
