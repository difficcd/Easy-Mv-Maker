// The selection chrome: a marquee outline and its handles, drawn so they can be seen on
// anything.
//
// One accent-coloured dashed line disappeared on artwork of a similar colour and on a light
// canvas, and got thinner with every zoom-out. The outline is two strokes now - a dark solid
// line underneath and a light dashed one on top - which reads on light and dark alike, the way
// every marquee in a paint program does. Everything is sized in screen pixels, divided by the
// zoom, so it is the same to the eye at any magnification.

/** A handle's half-size on screen, and the wider radius within which a press still takes it. */
export const HANDLE_PX = 6;
export const HANDLE_GRAB_PX = 12;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} zoom the view zoom, so screen sizes can be turned into canvas sizes
 * @param {boolean} [closed]
 */
export function drawMarquee(ctx, pts, zoom, closed = false) {
    if (!pts || pts.length < 2) return;
    const z = zoom || 1;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    if (closed) ctx.closePath();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = 3 / z;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([6 / z, 5 / z]);
    ctx.stroke();
    ctx.restore();
}

/**
 * A resize handle: a white square with a dark border, HANDLE_PX on screen either way.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} zoom
 */
export function drawHandle(ctx, x, y, zoom, round = false) {
    const z = zoom || 1;
    const hs = HANDLE_PX / z;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 1.5 / z;
    ctx.beginPath();
    // Round for the rotate knob, square for the resize handles. The shape is the only thing
    // saying they do different things, since both are white at the same size.
    if (round) ctx.arc(x, y, hs, 0, Math.PI * 2);
    else ctx.rect(x - hs, y - hs, hs * 2, hs * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}
