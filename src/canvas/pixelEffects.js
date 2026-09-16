// The two tools that change pixels already on the canvas rather than adding a stroke: the
// mosaic and the blur brush.
//
// Both follow the same three steps - work out which part of the canvas is affected, transform
// the pixels there, and hand back something to stamp into the layer - and both used to have all
// three steps inline in App, where the interesting part (the pixel maths) could not be tested
// and the boring part (clipping a rectangle to the canvas) was written twice, differently.
//
// The clipping and the mosaic are pure, and tested. The blur is not - it is canvas filters and
// compositing, which is the whole reason to use a canvas for it - so it takes the canvases it
// works on as arguments and touches nothing else.

/**
 * The part of the canvas a set of points can affect, clipped to the canvas.
 *
 * Returns null when the result would be too small to be worth processing - which is also the
 * degenerate case, a single-pixel drag or a rectangle dragged to nothing.
 *
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} pad how far the effect reaches past the points themselves
 * @param {number} cw
 * @param {number} ch
 * @returns {{x: number, y: number, w: number, h: number} | null}
 */
export function regionBounds(pts, pad, cw, ch) {
    if (!pts?.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(cw, Math.ceil(x1 + pad)); y1 = Math.min(ch, Math.ceil(y1 + pad));
    const w = x1 - x0, h = y1 - y0;
    return (w < 2 || h < 2) ? null : { x: x0, y: y0, w, h };
}

/**
 * A dragged rectangle as a region of the canvas, whichever corner it was dragged from.
 *
 * @param {{x0: number, y0: number, x1: number, y1: number}} rect
 * @param {number} cw
 * @param {number} ch
 * @returns {{x: number, y: number, w: number, h: number} | null}
 */
export function rectBounds(rect, cw, ch) {
    const x = Math.max(0, Math.floor(Math.min(rect.x0, rect.x1)));
    const y = Math.max(0, Math.floor(Math.min(rect.y0, rect.y1)));
    const w = Math.min(cw - x, Math.ceil(Math.abs(rect.x1 - rect.x0)));
    const h = Math.min(ch - y, Math.ceil(Math.abs(rect.y1 - rect.y0)));
    return (w < 2 || h < 2) ? null : { x, y, w, h };
}

/**
 * Average each block of pixels and write the average back over the block, in place.
 *
 * Alpha is averaged with the colour rather than left alone, so the mosaic of a region that is
 * partly transparent fades at its edge instead of stamping a hard square of colour onto nothing.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @param {number} block the block edge in pixels; anything under 2 would be a no-op
 * @returns {typeof img} the same object, changed in place
 */
export function mosaic(img, block) {
    const { data: d, width: w, height: h } = img;
    const size = Math.max(2, Math.round(block));
    for (let by = 0; by < h; by += size) {
        for (let bx = 0; bx < w; bx += size) {
            const xe = Math.min(w, bx + size), ye = Math.min(h, by + size);
            let r = 0, g = 0, b = 0, a = 0, cnt = 0;
            for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) {
                const i = (y * w + x) * 4;
                r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; cnt++;
            }
            r /= cnt; g /= cnt; b /= cnt; a /= cnt;
            for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) {
                const i = (y * w + x) * 4;
                d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
            }
        }
    }
    return img;
}

/**
 * A blurred copy of one region of a canvas, with everything the brush did not pass over erased.
 *
 * Two details that are easy to get wrong and invisible until they are:
 *
 * Several light blur passes rather than one heavy one, because repeated blurring approximates a
 * Gaussian and a single wide `blur()` does not - one pass at the full radius looks like a smear.
 *
 * The mask is blurred too. A hard mask leaves a visible line where the blurred area meets the
 * pixels around it, which reads as a second stroke rather than as a blur.
 *
 * @param {CanvasImageSource} src the layer as painted
 * @param {{x: number, y: number, w: number, h: number}} bounds from regionBounds
 * @param {Array<{x: number, y: number}>} pts the brush path, in canvas coordinates
 * @param {number} rad the brush size
 * @param {() => HTMLCanvasElement} makeCanvas
 * @returns {HTMLCanvasElement} a bounds-sized canvas, ready to read pixels out of
 */
export function blurMaskedRegion(src, bounds, pts, rad, makeCanvas) {
    const { x, y, w, h } = bounds;

    const blurred = makeCanvas(); blurred.width = w; blurred.height = h;
    const bctx = blurred.getContext('2d');
    bctx.drawImage(src, x, y, w, h, 0, 0, w, h);
    const step = Math.max(1, rad / 4);
    for (let i = 0; i < 3; i++) {
        bctx.filter = `blur(${step}px)`;
        bctx.drawImage(blurred, 0, 0);
    }
    bctx.filter = 'none';

    const mask = makeCanvas(); mask.width = w; mask.height = h;
    const mctx = mask.getContext('2d');
    mctx.filter = `blur(${Math.max(1, rad / 3)}px)`;
    mctx.strokeStyle = '#000'; mctx.fillStyle = '#000';
    mctx.lineCap = 'round'; mctx.lineJoin = 'round'; mctx.lineWidth = rad * 0.8;
    mctx.beginPath();
    pts.forEach((p, i) => i ? mctx.lineTo(p.x - x, p.y - y) : mctx.moveTo(p.x - x, p.y - y));
    mctx.stroke();
    // A single tap draws no line at all, so it gets a dot instead - otherwise the brush does
    // nothing when it is not dragged, which reads as a broken tool.
    if (pts.length === 1) { mctx.beginPath(); mctx.arc(pts[0].x - x, pts[0].y - y, rad / 2, 0, Math.PI * 2); mctx.fill(); }
    mctx.filter = 'none';

    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(mask, 0, 0);
    bctx.globalCompositeOperation = 'source-over';
    return blurred;
}
