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
