// What is drawn over the frame while editing and never while playing: the selected text's box,
// the floating selection with its marquee and handles, and a part's recorded motion path.
//
// Out of App so the paint effect there says what is shown and not how each thing is stroked -
// and so the text box and the selection use the same marquee, which they did not: the text box
// was a one-pixel accent line that vanished on light artwork and shrank with the zoom.

import { drawMarquee, drawHandle } from './marquee.ts';
import { drawWarped, warpedOutline, warpedHandles, rotateKnob, type WarpBox } from './warpRender.ts';
import type { Point } from '../core/types.ts';
import type { Rect } from '../core/lassoOps.ts';


import { withAlpha } from '../core/colour.ts';

/** The rectangle around a selected text, as a marquee. */
export function drawTextSelection(ctx: CanvasRenderingContext2D, box: Rect, zoom: number): void {
    const { x, y, w, h } = box;
    drawMarquee(ctx, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], zoom, true);
}

/**
 * A floating selection: its pixels exactly as the committed paste will draw them, warp included
 * - the preview is the only feedback the sliders have - with the marquee and handles following
 * the warp, so what is dashed is the picture and not the rectangle it started as.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement | ImageBitmap | null} src the lifted pixels, or null if not yet available
 * @param {{x: number, y: number, w: number, h: number, rot?: number, skew?: number, bend?: number}} box
 * @param {number} zoom
 */
export function drawFloatingSelection(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement | ImageBitmap | null, box: WarpBox, zoom: number): void {
    if (src) drawWarped(ctx, src, src.width, src.height, box);
    drawMarquee(ctx, warpedOutline(box), zoom, true);

    // The rotate knob, on a stem from the top-middle handle. Drawn before the handles so the
    // stem passes under that handle rather than over it.
    const handles = warpedHandles(box);
    const top = handles.find(hd => hd.id === 'n');
    const knob = rotateKnob(box, zoom);
    if (top) {
        const z = zoom || 1;
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = 1.5 / z;
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(knob.x, knob.y);
        ctx.stroke();
        ctx.restore();
    }
    for (const hd of handles) drawHandle(ctx, hd.x, hd.y, zoom);
    drawHandle(ctx, knob.x, knob.y, zoom, true);
}

/**
 * A part's recorded motion path, dashed, with a dot at its start; brighter for the part whose
 * animation panel is open.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} path
 * @param {boolean} editing
 */
export function drawMotionPath(ctx: CanvasRenderingContext2D, path: readonly Point[] | null | undefined, editing: boolean): void {
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = editing ? accentSoft() : accentSoft(0.4);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = editing ? accentSoft() : accentSoft(0.5);
    ctx.beginPath(); ctx.arc(path[0].x, path[0].y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

/**
 * The rectangle the mosaic tool is dragging out: a faint tint with a marquee round it.
 *
 * The border used to be set to the string 'var(--accent-soft)'. A canvas cannot resolve a CSS
 * variable, and an unparseable colour leaves strokeStyle as it was - so the border was drawn in
 * whatever colour the last thing to touch the context had left, usually black. It also drew at a
 * fixed two pixels, which thinned with every zoom-out. The marquee is both fixed at once.
 *
 * The tint colour is passed in rather than read from the theme here, so this stays a function
 * of its arguments and can be checked without a browser.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x0: number, y0: number, x1: number, y1: number}} r the drag, in either direction
 * @param {number} zoom
 * @param {string} tint
 */
export function drawMosaicMarquee(ctx: CanvasRenderingContext2D, r: { x0: number, y0: number, x1: number, y1: number }, zoom: number, tint: string): void {
    const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1);
    const w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
    ctx.save();
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    drawMarquee(ctx, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], zoom, true);
}

/**
 * The curve ruler's anchors, over the curve they make. The first is marked, because that is the
 * end the curve is drawn from and the one a further tap extends.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} zoom
 */
export function drawCurveAnchors(ctx: CanvasRenderingContext2D, pts: readonly Point[], zoom: number): void {
    const z = zoom || 1;
    ctx.save();
    ctx.lineWidth = 1.5 / z;
    for (let i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 5 / z, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#4ea1ff' : '#fff';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fill(); ctx.stroke();
    }
    ctx.restore();
}

/**
 * The rectangle a mosaic effect is confined to, while that layer's panel is open.
 *
 * Only while the panel is open, like the motion path: it is a setting, not part of the picture,
 * and leaving it on screen would put a dashed box into every frame the user is looking at.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x: number, y: number, w: number, h: number} | null | undefined} rect
 * @param {number} zoom
 */
export function drawMosaicRegion(ctx: CanvasRenderingContext2D, rect: Rect | null | undefined, zoom: number): void {
    if (!rect) return;
    const { x, y, w, h } = rect;
    drawMarquee(ctx, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], zoom, true);
}

// A 2D canvas context cannot read CSS variables, so the computed value is read out instead.
// That keeps on-canvas furniture such as selection outlines and paths on the theme colour.
export const accentSoft = (alpha = 1): string => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || '#7c8cff';
    // The alpha is applied by core/colour, which knows the hex the stylesheet's default is
    // as well as the hsl the theme writes. This used to handle only hsl and drop the alpha
    // silently for anything else.
    return withAlpha(v, alpha);
};
