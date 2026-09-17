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

// --- static ------------------------------------------------------------------------------
//
// The "noise" the user meant, and not the one that was first built. Film grain is a fine, even
// texture over a frame. This is a broken signal: the whole picture wobbles and its colour channels
// come apart so every edge fringes red one side and cyan the other, there is snow over all of it,
// and now and then a frame goes badly wrong and tears in bands. It crackles rather than shimmers.
//
// All of it outside the camera transform and over the finished frame, for the same reason the
// grain was: it is what happens to the signal, not to the scene.
//
// A pre-rendered noise tile is still used, for the snow. The tearing is a handful of band copies,
// and the fringing comes from the two halves of the colour split being added back together with
// a sideways offset between them - `lighter` of a red-only copy and a cyan-only copy of the same
// band is the band itself where they line up, and colour where they do not. That is what a real
// chroma tear looks like, and it works on a black-and-white drawing because the paper is white.

/** Edge of the noise tile. Larger means fewer blits per frame and a longer period before it repeats. */
const TILE = 512;
/** How often the static is re-rolled. Faster than this and it stops reading as flicker. */
const STATIC_FPS = 24;

/** A cheap integer hash, so every frame's tears are decided the same way on export as on screen. */
const hash = (a, b = 0) => {
    let h = Math.imul(a ^ 0x9E3779B1, 0x85EBCA6B) ^ Math.imul(b + 0x1b873593, 0xC2B2AE35);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
    return h >>> 0;
};
const unit = (a, b) => hash(a, b) / 0x100000000;   // 0..1

/**
 * A square of monochrome noise centred on mid grey.
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
        const v = 128 + ((Math.random() * 2 - 1) * 110);
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

/**
 * Broken-signal static over the finished frame.
 *
 * Three things, and the first two cover the *whole* frame - "it only does part of the picture"
 * was the report against the first version, which tore a few bands and left the rest clean.
 *
 *   split    the whole picture's colour channels pulled apart sideways, so every edge fringes
 *            red one side and cyan the other. Small on a quiet frame, wide on a bad one.
 *   jitter   the whole picture knocked sideways and down by a pixel or two, differently each
 *            frame. This is most of what reads as 지지직.
 *   tears    a few horizontal bands shoved further sideways than the rest, on the bad frames.
 *
 * Plus snow over all of it.
 *
 * "Bad frames" are rolled per frame from a hash, so it flickers: mostly a mild wobble, then a
 * frame that goes badly wrong. Deterministic in time, like the shake and the mosaic, so the
 * export gets the same bad frames the preview showed.
 *
 * Cost: the split is the whole frame drawn twice more with a colour multiply each, about six
 * full-frame operations. That is the price of doing it everywhere, and it is only paid on cuts
 * that have static turned on.
 *
 * @param {CanvasRenderingContext2D} ctx the frame, already painted
 * @param {HTMLCanvasElement} tile from grainTile, for the snow
 * @param {{cw: number, ch: number, amount: number, seconds: number,
 *   band: {current: any}, red: {current: any}, cyan: {current: any},
 *   scratch: (ref: any, w: number, h: number) => {canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}}} o
 *   three scratch slots: a copy of the frame, and its two colour halves
 */
export function drawStatic(ctx, tile, { cw, ch, amount, seconds, band, red, cyan, scratch }) {
    if (!(amount > 0)) return;
    const a = Math.min(1, amount);
    const step = Math.floor((Number.isFinite(seconds) ? seconds : 0) * STATIC_FPS);
    const frame = ctx.canvas;

    // How bad this frame is: a quiet wobble most of the time, a real fault now and then.
    const bad = unit(step, 1) < a * 0.45;
    const split = Math.max(1, Math.round((bad ? 6 : 1.5) * a + (bad ? unit(step, 2) * 10 * a : 0)));
    const jx = Math.round((unit(step, 5) * 2 - 1) * (bad ? 14 : 3) * a);
    const jy = Math.round((unit(step, 6) * 2 - 1) * (bad ? 4 : 1) * a);

    // The frame lifted out whole, then rebuilt from its two colour halves with the halves pulled
    // apart. multiply by a solid colour keeps one channel; `lighter` of the two is the picture
    // where they overlap and colour where they do not.
    const { canvas: copy, ctx: cctx } = scratch(band, cw, ch);
    cctx.globalCompositeOperation = 'source-over';
    cctx.clearRect(0, 0, cw, ch);
    cctx.drawImage(frame, 0, 0);
    const half = (ref, colour) => {
        const { canvas, ctx: hctx } = scratch(ref, cw, ch);
        hctx.globalCompositeOperation = 'source-over';
        hctx.clearRect(0, 0, cw, ch);
        hctx.drawImage(copy, 0, 0);
        hctx.globalCompositeOperation = 'multiply';
        hctx.fillStyle = colour;
        hctx.fillRect(0, 0, cw, ch);
        hctx.globalCompositeOperation = 'source-over';
        return canvas;
    };
    const r = half(red, '#ff0000');
    const c = half(cyan, '#00ffff');

    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(r, jx - split, jy);
    ctx.drawImage(c, jx + split, jy);
    ctx.restore();

    // On a bad frame, a few bands shoved further than the rest. Read from the copy, not the
    // frame, since the frame has just been rewritten.
    if (bad) {
        const bands = 1 + Math.floor(unit(step, 3) * 3);
        for (let k = 0; k < bands; k++) {
            const y = Math.floor(unit(step, 10 + k * 3) * ch);
            const h = Math.max(4, Math.floor(6 + unit(step, 11 + k * 3) * 60));
            const dx = Math.round((unit(step, 12 + k * 3) * 2 - 1) * 80 * a);
            const bh = Math.min(h, ch - y);
            if (bh > 0) ctx.drawImage(copy, 0, y, cw, bh, dx, y, cw, bh);
        }
    }

    // Snow over everything: coarse bright specks, heavier on a bad frame.
    if (tile) {
        const ox = hash(step, 7) % TILE, oy = hash(step, 8) % TILE;
        const scale = 3;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = a * (bad ? 0.45 : 0.2);
        ctx.imageSmoothingEnabled = false;
        const size = TILE * scale;
        for (let yy = -(oy * scale) % size; yy < ch; yy += size) {
            for (let xx = -(ox * scale) % size; xx < cw; xx += size) ctx.drawImage(tile, xx, yy, size, size);
        }
        ctx.restore();
    }
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

/**
 * The part of a rectangle that is actually on the canvas, rounded to whole pixels.
 *
 * A region is dragged out by hand, so it routinely starts off the edge or is dragged backwards.
 * Both have to come back as something the drawing code can use or not at all - never as a
 * negative width, which silently draws nothing.
 *
 * @param {{x: number, y: number, w: number, h: number} | null | undefined} rect
 * @param {number} cw @param {number} ch
 * @returns {{x: number, y: number, w: number, h: number} | null}
 */
export function clampRegion(rect, cw, ch) {
    if (!rect) return null;
    const x0 = Math.max(0, Math.min(cw, Math.floor(Math.min(rect.x, rect.x + rect.w))));
    const y0 = Math.max(0, Math.min(ch, Math.floor(Math.min(rect.y, rect.y + rect.h))));
    const x1 = Math.max(0, Math.min(cw, Math.ceil(Math.max(rect.x, rect.x + rect.w))));
    const y1 = Math.max(0, Math.min(ch, Math.ceil(Math.max(rect.y, rect.y + rect.h))));
    const w = x1 - x0, h = y1 - y0;
    return (w < 2 || h < 2) ? null : { x: x0, y: y0, w, h };
}

/**
 * A copy of a layer with one rectangle of it pixelated, the rest untouched.
 *
 * Built as a whole-size canvas rather than handed back as "original plus a patch", because
 * everything downstream - the sway warp, the selection mask, the part transform - takes one
 * image. Giving them two would mean teaching each of them about the region.
 *
 * The small canvas is a *second* scratch. Reusing the full-size one would mean reading and
 * writing the same canvas in one operation.
 *
 * @param {HTMLCanvasElement | ImageBitmap} src
 * @param {number} block
 * @param {{x: number, y: number, w: number, h: number}} rect already clamped
 * @param {{full: {current: any}, small: {current: any}}} refs
 * @param {(ref: any, w: number, h: number) => {canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}} scratch
 * @param {number} cw @param {number} ch
 * @returns {HTMLCanvasElement | null}
 */
export function pixelateRegion(src, block, rect, refs, scratch, cw, ch) {
    const size = pixelateSize(rect.w, rect.h, block);
    if (!size) return null;

    const { canvas: small, ctx: sctx } = scratch(refs.small, size.w, size.h);
    sctx.clearRect(0, 0, size.w, size.h);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, size.w, size.h);

    const { canvas: full, ctx: fctx } = scratch(refs.full, cw, ch);
    fctx.clearRect(0, 0, cw, ch);
    fctx.imageSmoothingEnabled = true;
    fctx.drawImage(src, 0, 0);
    // Cleared first: the blocks replace what was there rather than sitting over it, or a
    // half-transparent drawing shows its own unpixelated edges through them.
    fctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(small, 0, 0, size.w, size.h, rect.x, rect.y, rect.w, rect.h);
    fctx.imageSmoothingEnabled = true;
    return full;
}
