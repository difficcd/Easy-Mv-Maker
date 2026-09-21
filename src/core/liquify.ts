// Pushing pixels around with a brush - the liquify tool.
//
// The whole tool is one operation: within a circle around the pen, every pixel is replaced by the
// pixel a little way *behind* the direction of travel, most strongly at the centre and not at
// all at the rim. Do that at each step of a drag and the drawing flows with the pen, the way wet
// paint follows a finger.
//
// It works on a plain RGBA buffer rather than a canvas, so it can be checked in Node with a
// handful of pixels, and so the live preview and the committed result are the same bytes.

import type { Point } from './types.ts';

/** The pixels a push touched, as a half-open box. */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * How strongly the push applies at a distance from the brush centre, 1 at the centre and 0 at
 * the rim. Quartic rather than linear so the edge of the brush blends into the untouched pixels
 * instead of leaving a ring.
 *
 * @param {number} d distance from the centre
 * @param {number} r brush radius
 */
export function falloffAt(d: number, r: number): number {
    if (!(r > 0) || d >= r) return 0;
    const t = 1 - (d * d) / (r * r);
    return t * t;
}

/**
 * Sample the buffer at a fractional position, bilinear. Outside the buffer is transparent, which
 * is what pulling from past the canvas edge should bring in.
 *
 * @param {Uint8ClampedArray} src
 * @param {number} w
 * @param {number} h
 * @param {number} x
 * @param {number} y
 * @param {number[]} out four channels, written in place
 */
export function sampleBilinear(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: number[] | Float32Array): void {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const at = (px: number, py: number, c: number) => (px < 0 || py < 0 || px >= w || py >= h) ? 0 : src[(py * w + px) * 4 + c];
    for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
        const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
        out[c] = top * (1 - fy) + bottom * fy;
    }
}

/**
 * One push: move the pixels inside the circle at (x, y) by (dx, dy), in place.
 *
 * Each destination pixel reads from `(x - dx*f, y - dy*f)` where f is the falloff there - so the
 * centre pixel comes from a full step back and the rim from where it already was. The reads are
 * from a copy of the circle's bounding box taken before any write, because a pixel written early
 * in the loop must not be what a later pixel reads.
 *
 * @param {Uint8ClampedArray} buf RGBA, w*h*4, modified in place
 * @param {number} w
 * @param {number} h
 * @param {{x: number, y: number, r: number, dx: number, dy: number, strength?: number}} push
 * @returns {{x0: number, y0: number, x1: number, y1: number} | null} the pixels touched, or null
 */
export function pushPixels(buf: Uint8ClampedArray, w: number, h: number, { x, y, r, dx, dy, strength = 1 }: { x: number, y: number, r: number, dx: number, dy: number, strength?: number }): Box | null {
    if (!(r > 0) || !(strength > 0) || (!dx && !dy)) return null;
    const x0 = Math.max(0, Math.floor(x - r)), y0 = Math.max(0, Math.floor(y - r));
    const x1 = Math.min(w, Math.ceil(x + r) + 1), y1 = Math.min(h, Math.ceil(y + r) + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    const bw = x1 - x0, bh = y1 - y0;
    // The read copy. Only the box, not the buffer - a brush is small and the layer is not.
    const copy = new Uint8ClampedArray(bw * bh * 4);
    for (let py = 0; py < bh; py++) copy.set(buf.subarray(((y0 + py) * w + x0) * 4, ((y0 + py) * w + x1) * 4), py * bw * 4);
    const px = [0, 0, 0, 0];
    for (let py = y0; py < y1; py++) {
        for (let pxx = x0; pxx < x1; pxx++) {
            const f = falloffAt(Math.hypot(pxx - x, py - y), r) * strength;
            if (!f) continue;
            sampleBilinear(copy, bw, bh, pxx - dx * f - x0, py - dy * f - y0, px);
            const i = (py * w + pxx) * 4;
            buf[i] = px[0]; buf[i + 1] = px[1]; buf[i + 2] = px[2]; buf[i + 3] = px[3];
        }
    }
    return { x0, y0, x1, y1 };
}

/**
 * A drag from one point to the next, as a series of pushes short enough not to tear.
 *
 * Pointer events arrive at whatever rate the pen moves; a fast flick is one event forty pixels
 * long, and a single push that far pulls a hole open behind the brush. So the segment is walked
 * in steps of at most a quarter of the radius, each pushing by its own length.
 *
 * @param {Uint8ClampedArray} buf
 * @param {number} w
 * @param {number} h
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {number} r
 * @param {number} [strength]
 * @returns {{x0: number, y0: number, x1: number, y1: number} | null} the union of what was touched
 */
export function pushAlong(buf: Uint8ClampedArray, w: number, h: number, from: Point, to: Point, r: number, strength = 1): Box | null {
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (!dist) return null;
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 4)));
    let box: Box | null = null;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const b = pushPixels(buf, w, h, { x: from.x + dx * t, y: from.y + dy * t, r, dx: dx / steps, dy: dy / steps, strength });
        if (!b) continue;
        box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    }
    return box;
}
