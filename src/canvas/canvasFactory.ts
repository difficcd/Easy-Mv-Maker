// Where the canvas modules get a canvas from.
//
// In the browser it is document.createElement('canvas'), and that used to be written in seven
// places. The one reason to route it through here is the tests: the functions that turn
// strokes into pixels, tear a layer into static or pixelate it could only be exercised by the
// smoke test, because they made their own canvases from `document` and Node has none. With the
// factory swappable, a test hands in @napi-rs/canvas and asserts on real pixels.
//
// Nothing else changes: the browser never calls setCanvasFactory.

let factory: () => HTMLCanvasElement = () => document.createElement('canvas');

/**
 * A fresh canvas, sized when a size is given.
 * @param {number} [w]
 * @param {number} [h]
 * @returns {HTMLCanvasElement}
 */
export function makeCanvas(w?: number | null, h?: number | null): HTMLCanvasElement {
    const c = factory();
    if (w != null && h != null) { c.width = w; c.height = h; }
    return c;
}

/**
 * Swap the source of canvases - for tests, which have no document.
 * @param {() => HTMLCanvasElement} fn
 */
export function setCanvasFactory(fn: () => HTMLCanvasElement): void { factory = fn; }
