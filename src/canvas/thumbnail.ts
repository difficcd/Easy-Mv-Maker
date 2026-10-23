// A project's preview: the frame open when it was saved, small.
//
// Painted at the frame's own size and then scaled down, rather than painted small: the frame
// painter lays text, effects and the camera out in frame pixels, and a 320px frame would be a
// different picture, not a smaller one.

import { makeCanvas } from './canvasFactory.ts';

/** The longest side of a preview, in pixels. Cards show it at about half that. */
export const THUMB_MAX = 320;

/** The size a `fw`x`fh` frame's preview comes out at: the long side at most `max`, never enlarged. */
export function thumbSize(fw: number, fh: number, max = THUMB_MAX): { w: number, h: number } {
    const s = Math.min(1, max / Math.max(1, fw, fh));
    return { w: Math.max(1, Math.round(fw * s)), h: Math.max(1, Math.round(fh * s)) };
}

/**
 * Paint a frame with `paint` and return it as a small WebP, or null if the browser would not encode it.
 *
 * @param paint draws the frame onto a context of the frame's size
 */
export async function renderThumbnail(paint: (ctx: CanvasRenderingContext2D) => void, fw: number, fh: number): Promise<Blob | null> {
    const full = makeCanvas(fw, fh);
    paint(full.getContext('2d')!);
    const { w, h } = thumbSize(fw, fh);
    const small = makeCanvas(w, h), ctx = small.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, w, h);
    return new Promise(res => small.toBlob(res, 'image/webp', 0.82));
}
