// Compositing the evaluated scene onto the frame: every cut's layers, bottom to top, each
// under its cut's and its part's transform, with a floating selection's hole cut out of the
// layer it was lifted from.
//
// This was the middle of paintFrame. What it needs from the app is handed in: the flattened
// canvas for a clip group (the cache's), which layers a gesture is drawing itself, and the
// selection whose mask applies. Nothing here reads state.

import { applyCutAnim } from './layerComposite.ts';
import { imageDataCanvas, scratchCanvas } from './scratch.ts';
import { applyPartTransform, drawMaskedLayer } from './layerComposite.ts';
import { drawSwayed } from './swayRender.ts';
import { pixelateCanvas, pixelateRegion, clampRegion, staticCanvas, type CanvasSlot } from './pixelEffects.ts';
import type { Id, TimeSpan } from '../core/types.ts';
import type { Rect } from '../core/lassoOps.ts';
import type { TextAnimAt } from '../core/textAnim.ts';
import type { Scene } from '../engine/evaluateFrame.ts';
import type { TextBox, TextObject } from './textRender.ts';

/** What drawScene needs from the app beyond the scene: the layer canvases, the gesture state, the selection, and scratch. */
export interface SceneDeps {
    cw: number;
    ch: number;
    flattenClipGroup: (cutId: Id, group: any) => HTMLCanvasElement | ImageBitmap | null;
    /** true for a layer the drag overlay is drawing instead */
    hiddenByGesture: (cutId: Id, layerId: Id) => boolean;
    selection: { cutId: Id, sourceLayerId: Id, maskBitmapId: string | null, x: number, y: number } | null;
    bitmapEntry: (id: string) => { imageBitmap?: any, imageData?: ImageData | null } | undefined;
    /** a scratch canvas slot for the mask */
    maskScratchRef: CanvasSlot;
    /** scratch slots for the mosaic: the full-size result and the small copy it reads */
    mosaicScratch: { full: CanvasSlot, small: CanvasSlot };
    staticScratch: { copy: CanvasSlot, out: CanvasSlot };
    /** the noise tile, built once by the caller */
    staticTile: HTMLCanvasElement | null;
}
/** What drawSceneTexts needs: the text renderer's three functions, and the static's scratch when texts can be noisy. */
export interface TextDeps {
    cw: number;
    ch: number;
    drawTextObject: (ctx: CanvasRenderingContext2D, text: any, opts: { anim: any, box: TextBox | null, alpha: number }) => void;
    textNeedsBox: (text: any, anim: any) => boolean;
    measureTextBox: (text: any) => TextBox;
    textNoise?: { scratch: { copy: CanvasSlot, out: CanvasSlot }, tile: HTMLCanvasElement, scratchFor: (id: Id) => CanvasSlot } | null;
}


/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{time: number, cuts: Array<{cut: any, anim: any, groups: any[]}>}} scene from engine/evaluateFrame
 * @param {object} deps
 * @param {number} deps.cw
 * @param {number} deps.ch
 * @param {(cutId: any, group: any) => (HTMLCanvasElement | ImageBitmap | null)} deps.flattenClipGroup
 *   a clip group as one canvas, or null while a frame in it is still decoding
 * @param {(cutId: any, layerId: any) => boolean} deps.hiddenByGesture
 * @param {{cutId: any, sourceLayerId: any, maskBitmapId: any, x: number, y: number} | null} deps.selection
 * @param {(id: any) => {imageBitmap?: any, imageData?: any} | undefined} deps.bitmapEntry
 * @param {{current: any}} deps.maskScratchRef a scratch canvas slot for the mask
 * @param {{full: {current: any}, small: {current: any}}} deps.mosaicScratch scratch slots for
 *   the mosaic: the shrunken copy, and the composed layer when only a region is pixelated
 * @param {{copy: {current: any}, out: {current: any}}} deps.staticScratch
 *   two slots for the static: the copy of the source and the output
 * @param {HTMLCanvasElement | null} deps.staticTile the noise tile, built once by the caller
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, { cw, ch, flattenClipGroup, hiddenByGesture, selection, bitmapEntry, maskScratchRef, mosaicScratch, staticScratch, staticTile }: SceneDeps): void {
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
            const maskEntry = shouldMask ? bitmapEntry(selection!.maskBitmapId!) : null;
            const mask = maskEntry?.imageBitmap || (maskEntry?.imageData && imageDataCanvas(maskEntry.imageData)) || null;

            // A mosaic effect replaces the layer's own pixels with a pixelated copy, so it is
            // applied to the source rather than to the frame: everything below - the sway warp,
            // the selection mask, the part transform - then works on the blocks, which is what
            // makes the effect look like it belongs to the drawing and not like a filter laid
            // over the shot.
            // A region pixelates only part of the layer and keeps the rest; without one the
            // whole layer goes through the cheaper two-blit path.
            const region = la && la.mosaic >= 2 ? clampRegion(la.mosaicRect, cw, ch) : null;
            let src: HTMLCanvasElement | ImageBitmap = la && la.mosaic >= 2
                ? (region
                    ? (pixelateRegion(layerCanvas, la.mosaic, region, mosaicScratch, scratchCanvas, cw, ch) || layerCanvas)
                    : (pixelateCanvas(layerCanvas, la.mosaic, mosaicScratch.small, scratchCanvas) || layerCanvas))
                : layerCanvas;
            // Blown back up with smoothing off; on the way down it was on, which is what averages
            // each block rather than point-sampling one pixel out of it.
            // The whole-layer path hands back the shrunken canvas, which is then blown up here
            // with smoothing off. The region path has already composed a full-size image, so it
            // must be drawn 1:1 and smoothed like any other layer.
            let shrunk = src !== layerCanvas && !region;

            // Static after the mosaic, so the blocks tear too. It wants a full-size source, so a
            // shrunken mosaic is blown back up first - which is what the shrunk flag was for.
            let staticSrc = src;
            if (la && la.noise > 0 && staticTile) {
                if (shrunk) {
                    const { canvas: up, ctx: uctx } = scratchCanvas(staticScratch.copy, cw, ch);
                    uctx.imageSmoothingEnabled = false;
                    uctx.clearRect(0, 0, cw, ch);
                    uctx.drawImage(src, 0, 0, cw, ch);
                    uctx.imageSmoothingEnabled = true;
                    staticSrc = up;
                    shrunk = false;
                }
                const glitched = staticCanvas(staticSrc, staticTile, { cw, ch, amount: la.noise, seconds: scene.time - ac.startTime, colour: la.noiseColor || 0 }, staticScratch, scratchCanvas);
                if (glitched) staticSrc = glitched;
            }
            if (shrunk) ctx.imageSmoothingEnabled = false;

            src = staticSrc;
            if (la?.swayProfile && !mask) {
                drawSwayed(ctx, src, { profile: la.swayProfile, axis: la.swayAxis, disp: la.swayDisp, wave: la.swayWave, cw, ch });
            } else if (!mask) {
                ctx.drawImage(src, 0, 0, cw, ch);
            } else {
                // imageDataCanvas is a different shared canvas from the mask scratch, so nesting
                // them is safe - which is why they are separate helpers rather than two slots.
                drawMaskedLayer(ctx, src, mask, selection!, scratchCanvas(maskScratchRef, cw, ch));
            }
            if (shrunk) ctx.imageSmoothingEnabled = true;
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
export function drawVideoOverlay(ctx: CanvasRenderingContext2D, v: HTMLVideoElement | null, overlay: { w?: number, h?: number, opacity?: number }, cw: number, ch: number, fit: (sw: number, sh: number, dw: number, dh: number) => Rect): void {
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
export function drawOnionCut(ctx: CanvasRenderingContext2D, cut: Cut, layerCanvas: (cutId: Id, layer: Layer) => CanvasImageSource | null, inUiOrder: (layers: Layer[]) => Layer[]): void {
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
 * @param {{time: number, cuts: Array<{cut: any, anim: any, texts: Array<{text: any, anim: any}>}>}} scene
 * @param {object} deps
 * @param {number} deps.cw
 * @param {number} deps.ch
 * @param {(ctx: CanvasRenderingContext2D, text: any, opts: object) => void} deps.drawTextObject
 * @param {(text: any, anim: any) => boolean} deps.textNeedsBox
 * @param {(text: any) => any} deps.measureTextBox
 * @param {{scratch: {copy: {current: any}, out: {current: any}}, tile: HTMLCanvasElement | null, scratchFor: (id: any) => {current: any}} | null} [deps.textNoise]
 *   what the static needs: the two shared slots, the snow tile, and a canvas of each text's own
 */
export function drawSceneTexts(ctx: CanvasRenderingContext2D, scene: Scene, { cw, ch, drawTextObject, textNeedsBox, measureTextBox, textNoise = null }: TextDeps): void {
    for (const { cut, anim, texts } of scene.cuts) {
        ctx.save();
        applyCutAnim(ctx, anim, cw, ch);
        for (const { text, anim: ta } of texts) {
            const opts = { anim: ta, box: textNeedsBox(text, ta) ? measureTextBox(text) : null, alpha: anim ? anim.alpha : 1 };
            const gate = textNoise && textStaticGate(text, cut, scene.time);
            if (!gate) { drawTextObject(ctx, text, opts); continue; }
            // The static works on pixels, and a text is drawn straight onto the frame. So a
            // noisy text is drawn onto a canvas of its own first - transparent, so only the
            // glyphs tear - and that canvas goes through the same staticCanvas the layers use.
            // One canvas per text, not one shared: the static caches its colour halves per
            // source canvas, and two texts through one canvas would rebuild them every frame.
            const { canvas: own, ctx: octx } = scratchCanvas(textNoise.scratchFor(text.id), cw, ch);
            octx.clearRect(0, 0, cw, ch);
            drawTextObject(octx, text, { ...opts, alpha: 1 });
            // The static's cache key: whatever changes the glyphs changes this.
            own.dataset.strokes = textStaticSig(text, ta);
            const seconds = scene.time - cut.startTime;
            const glitched = staticCanvas(own, textNoise.tile, { cw, ch, amount: gate.amount, seconds, colour: gate.colour }, textNoise.scratch, scratchCanvas) || own;
            ctx.save();
            ctx.globalAlpha = opts.alpha;
            ctx.drawImage(glitched, 0, 0);
            ctx.restore();
        }
        ctx.restore();
    }
}

/**
 * Whether a text's static is on at this moment, and how strong: the same gate a layer has -
 * full strength inside the start/end window, nothing outside it.
 *
 * @param {{noise?: number, noiseFrom?: number, noiseTo?: number, noiseColor?: number}} text
 * @param {{startTime: number, endTime: number}} cut
 * @param {number} time
 * @returns {{amount: number, colour: number} | null}
 */
export function textStaticGate(text: CutText | Pick<TextObject, 'noise' | 'noiseFrom' | 'noiseTo' | 'noiseColor'>, cut: TimeSpan, time: number): { amount: number, colour: number } | null {
    const amount = Math.min(1, text.noise || 0);
    if (!(amount > 0)) return null;
    const len = cut.endTime - cut.startTime;
    const p = len > 0 ? (time - cut.startTime) / len : 0;
    const nf = Math.max(0, Math.min(1, text.noiseFrom ?? 0)), nt = Math.max(nf, Math.min(1, text.noiseTo ?? 1));
    if (p < nf || p > nt) return null;
    return { amount, colour: Math.max(0, Math.min(1, text.noiseColor || 0)) };
}

/** A signature of everything that changes how a text renders, for the static's per-canvas cache. */
const textStaticSig = (text: CutText, ta: TextAnimAt | null): string => {
    let sig = '';
    const fields = text as unknown as Record<string, unknown>;
    for (const k in fields) if (k !== 'noise' && k !== 'noiseFrom' && k !== 'noiseTo' && k !== 'noiseColor') sig += `${k}=${fields[k]};`;
    if (ta) sig += `|${ta.chars ?? ''},${ta.dx},${ta.dy},${ta.scale},${ta.rot},${ta.blur},${ta.perChar ? 'pc' : ''}`;
    return sig;
};
