// Scratch canvases: sizing, one-per-ref reuse, and drawing an ImageData through a canvas.

import { makeCanvas } from './canvasFactory.js';

/**
 * Give a canvas these dimensions, reallocating only if it does not already have them.
 *
 * Assigning canvas.width reallocates the backing store even when the value is unchanged - the
 * spec says so, and at 1920x1080 that is 8.3MB thrown away and replaced per assignment. A
 * boiling layer is redrawn ten times a second, and `cnv.width = CANVAS_W` on the reused canvas
 * was measured churning 79MB a second per boiling layer, which is what ran the tab out of
 * memory. It was not even clearing anything the caller needed: drawStrokesOnCtx clears first.
 *
 * @returns {boolean} true if the canvas was resized, and so is already blank
 */
export function sizeCanvas(cnv, w, h) {
    if (cnv.width === w && cnv.height === h) return false;
    cnv.width = w;
    cnv.height = h;
    return true;
}

/**
 * A scratch canvas kept in a ref: allocated once, then sized and cleared for reuse.
 *
 * Three places in the composite path did this by hand, and the hand-written versions disagreed
 * about the clear. Two called clearRect unconditionally after sizing, which is wasted work
 * whenever the size did change - resizing a canvas clears it. Only one checked. They agree now,
 * and the check is here rather than at three call sites.
 *
 * The reuse is not a micro-optimisation. These run inside the per-frame composite loop, so a
 * fresh canvas is 8MB per masked layer per frame - the shape of allocation that took a tab out.
 *
 * @param {{current: HTMLCanvasElement|null}} ref
 * @param {number} w
 * @param {number} h
 * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }}
 */
export function scratchCanvas(ref, w, h) {
    // Named, because the mistake is always the same one and the error it used to give was
    // "Cannot read properties of undefined (reading 'current')" from inside the composite loop -
    // a stack four frames deep with nothing in it saying which slot was wrong. Passing an object
    // that holds refs instead of a ref is how the mosaic shipped broken.
    if (!ref || typeof ref !== 'object' || !('current' in ref)) {
        throw new TypeError('scratchCanvas needs a ref ({current}), got ' + (ref ? `{${Object.keys(ref)}}` : String(ref)));
    }
    const canvas = ref.current || (ref.current = makeCanvas());
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    if (!sizeCanvas(canvas, w, h)) ctx.clearRect(0, 0, w, h);
    return { canvas, ctx };
}

// Drawing an ImageData somewhere other than where it starts.
//
// putImageData ignores the transform, the composite mode and the alpha - it writes pixels at
// literal coordinates - so anything that needs to scale, blend or place ImageData has to go
// through a canvas first. That is four lines, and it appeared four times.
//
// The canvas is reused. Each of those sites ran per stroke or per frame, and one of them is a
// full video frame: allocating a canvas per call is the same trap sizeCanvas exists for.
//
// The contract is that the result is used immediately. It is valid until the next call, which is
// enough for "put it in a canvas, draw it, done" and is what all four sites do. Holding one
// across another call would hand you somebody else's pixels.
let _imgCanvas = null;

/**
 * A canvas holding this ImageData, ready to be drawn.
 *
 * @param {ImageData} img
 * @returns {HTMLCanvasElement} valid until the next call
 */
export function imageDataCanvas(img) {
    if (!_imgCanvas) _imgCanvas = makeCanvas();
    sizeCanvas(_imgCanvas, img.width, img.height);
    const cx = _imgCanvas.getContext('2d');
    resetCtx(cx);
    cx.putImageData(img, 0, 0);
    return _imgCanvas;
}

/**
 * A shared canvas's context put back to its default state.
 *
 * A resize resets these; a reuse does not, and the last user leaves them dirty. Marker in
 * particular sets no alpha of its own, so it would inherit whatever pencil left behind.
 *
 * @param {CanvasRenderingContext2D} cx
 * @returns {CanvasRenderingContext2D} the same context
 */
export function resetCtx(cx) {
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
    cx.filter = 'none';
    cx.shadowBlur = 0;
    cx.shadowColor = 'transparent';
    return cx;
}
