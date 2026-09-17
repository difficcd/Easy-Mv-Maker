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

// --- film grain ---------------------------------------------------------------------------
//
// Grain sits on the film, not in the scene, so it is drawn over the finished frame and outside
// the camera transform. Inside it, the grain would zoom and shake with the picture, which reads
// as dirt on the artwork rather than as film.
//
// A pre-rendered tile, blitted a few times with a moving offset. The obvious implementation -
// walk the frame's ImageData and perturb every pixel - is two million pixels a frame in
// JavaScript, which is not affordable on a repaint.
//
// Measured in Chrome at 1920x1080, per frame, after warm-up:
//
//   15 blits, overlay       4.9 ms      what this does
//    1 blit,  overlay       3.3 ms      a tile big enough to cover the frame in one go
//   15 blits, source-over   1.6 ms
//
// So the composite mode is the cost, not the number of blits: `overlay` over the frame is ~3 ms
// whatever it is made of. That rules out buying much by growing the tile, and growing it is not
// free anyway - building one is a 31 ms stall at 512 and scales with its area, so a 1024 tile
// trades a 93 ms hitch the first time grain is switched on for 0.7 ms a frame. Not worth it.
//
// ~5 ms is affordable here because paintFrame does not run per pointer move: a stroke in progress
// goes to the live overlay (hooks/useLiveOverlay), and this repaints on document changes and on
// playback frames. At 30fps it is a sixth of the budget.

/** Edge of the noise tile. See the measurements above before changing it. */
const TILE = 512;
/** How often the grain is re-seeded. Film grain changes per frame; faster than this is just noise. */
const GRAIN_FPS = 24;

/**
 * A square of monochrome noise centred on mid grey, for compositing in `overlay`.
 *
 * Centred rather than starting at black because `overlay` leaves mid grey alone: the average
 * pixel then comes out unchanged and only the variation shows, so turning the grain up adds
 * texture instead of fogging the picture.
 *
 * @param {() => HTMLCanvasElement} makeCanvas
 * @returns {HTMLCanvasElement}
 */
export function grainTile(makeCanvas) {
    const c = makeCanvas();
    c.width = TILE; c.height = TILE;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(TILE, TILE);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        // One value for all three channels: coloured grain reads as sensor noise, not film.
        const v = 128 + ((Math.random() * 2 - 1) * 110);
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

/**
 * Lay the tile over the whole frame, offset by an amount that changes with time.
 *
 * The offset is a hash of the quantised time rather than a random number, for the same reason
 * the camera shake is: the export repaints these frames, and grain that differed between the
 * preview and the file would be a difference nobody could explain.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} tile from grainTile
 * @param {{cw: number, ch: number, amount: number, seconds: number}} o
 *   `amount` is 0..1, the opacity of the grain
 */
export function drawGrain(ctx, tile, { cw, ch, amount, seconds }) {
    if (!tile || !(amount > 0)) return;
    const step = Math.floor((Number.isFinite(seconds) ? seconds : 0) * GRAIN_FPS);
    const ox = Math.imul(step, 0x9E3779B1) >>> 0;
    const oy = Math.imul(step ^ 0x5bf03635, 0x85EBCA6B) >>> 0;
    const sx = -(ox % TILE), sy = -(oy % TILE);

    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(1, amount);
    ctx.imageSmoothingEnabled = false;
    for (let y = sy; y < ch; y += TILE) {
        for (let x = sx; x < cw; x += TILE) ctx.drawImage(tile, x, y);
    }
    ctx.restore();
}

/**
 * The size a canvas is shrunk to so that drawing it back up gives blocks of `block` pixels.
 *
 * Pixelating a whole layer per frame cannot be the per-pixel `mosaic` above: that is fine for a
 * one-off stamp and far too slow for something the renderer does every frame. Shrinking and
 * blowing back up with smoothing off is the same result in two blits.
 *
 * Never smaller than 1x1, or the shrink produces a zero-sized canvas and the draw throws.
 *
 * @param {number} w @param {number} h @param {number} block
 * @returns {{w: number, h: number} | null} null when the block is too small to change anything
 */
export function pixelateSize(w, h, block) {
    const b = Math.round(block);
    if (!(b >= 2) || !(w > 0) || !(h > 0)) return null;
    return { w: Math.max(1, Math.round(w / b)), h: Math.max(1, Math.round(h / b)) };
}

/**
 * A pixelated copy of a canvas, as blocks of roughly `block` pixels.
 *
 * Two blits: down into a scratch, then back up with smoothing off. Alpha comes along, so a layer
 * with transparent areas pixelates its edges rather than growing a square of colour.
 *
 * @param {HTMLCanvasElement | ImageBitmap} src
 * @param {number} block
 * @param {{current: any}} scratchRef a slot to keep the small canvas in between frames
 * @param {(ref: any, w: number, h: number) => {canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}} scratch
 * @returns {HTMLCanvasElement | null} null when there is nothing to do
 */
export function pixelateCanvas(src, block, scratchRef, scratch) {
    const size = pixelateSize(src.width, src.height, block);
    if (!size) return null;
    const { canvas, ctx } = scratch(scratchRef, size.w, size.h);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.imageSmoothingEnabled = true;   // averaging on the way down is what makes a block a block
    ctx.drawImage(src, 0, 0, size.w, size.h);
    return canvas;
}
