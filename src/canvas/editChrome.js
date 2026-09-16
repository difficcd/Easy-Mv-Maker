// What is drawn over the frame while editing and never while playing: the selected text's box,
// the floating selection with its marquee and handles, and a part's recorded motion path.
//
// Out of App so the paint effect there says what is shown and not how each thing is stroked -
// and so the text box and the selection use the same marquee, which they did not: the text box
// was a one-pixel accent line that vanished on light artwork and shrank with the zoom.

import { drawMarquee, drawHandle } from './marquee.js';
import { drawWarped, warpedOutline, warpedHandles } from './warpRender.js';
import { accentSoft } from './canvasUtils.js';

/** The rectangle around a selected text, as a marquee. */
export function drawTextSelection(ctx, box, zoom) {
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
export function drawFloatingSelection(ctx, src, box, zoom) {
    if (src) drawWarped(ctx, src, src.width, src.height, box);
    drawMarquee(ctx, warpedOutline(box), zoom, true);
    for (const hd of warpedHandles(box)) drawHandle(ctx, hd.x, hd.y, zoom);
}

/**
 * A part's recorded motion path, dashed, with a dot at its start; brighter for the part whose
 * animation panel is open.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} path
 * @param {boolean} editing
 */
export function drawMotionPath(ctx, path, editing) {
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
export function drawMosaicMarquee(ctx, r, zoom, tint) {
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
export function drawCurveAnchors(ctx, pts, zoom) {
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
