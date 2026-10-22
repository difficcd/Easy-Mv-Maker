// Drawing a layer's strokes into the canvas that caches them.
//
// There were two places that did this - the effect that keeps the visible layers baked, and the
// synchronous path for a layer the effect has not reached - and they were two copies of the same
// rule. When committing a stroke was made to draw only the new stroke (appendedAfter), only one of
// the copies was changed. The other was the one that bakes what is on screen, so in the running
// app every commit still redrew the whole layer: the profiler found a pencil stroke's commit doing
// 14,600 2d calls, nearly all of them re-stamping dot-pen strokes drawn earlier on the same layer.
// One function now, called from both.

import { drawStrokesOnCtx, type BitmapLookup, type StrokeDrawOptions } from './strokes.ts';
import { sizeCanvas } from './scratch.ts';
import { appendedAfter } from '../core/layerTree.ts';
import type { LayerLike } from '../core/types.ts';

/**
 * Bring `cnv` up to date with `layer`'s strokes and stamp it with `signature`.
 *
 * When the strokes are the ones already on the canvas plus more on the end, only the new ones are
 * drawn - they paint on top, in the order they would have been drawn anyway. Anything else (a
 * stroke edited or removed, the layer moved, a merge, a resize) is drawn in full. Boiling layers
 * are always drawn in full: each phase has its own canvas, and an append would have to reach all of
 * them.
 *
 * @param {HTMLCanvasElement} cnv the cache canvas, reused
 * @param {LayerLike} layer
 * @param {string} signature what the canvas holds once this returns (layerSig)
 * @param {number} w canvas width
 * @param {number} h canvas height
 * @param {BitmapLookup|null} store pixels for fill, lasso and paste strokes
 * @param {StrokeDrawOptions & {roughPhase?: number, roughWave?: number, roughMinSize?: number}} opts
 * @returns {'appended' | 'full'} which it did, for the tests and the profiler
 */
export function bakeLayer(cnv: HTMLCanvasElement, layer: LayerLike, signature: string, w: number, h: number,
    store: BitmapLookup | null, opts: StrokeDrawOptions = {}): 'appended' | 'full' {
    // Read before sizing: resizing a canvas clears it, and then nothing is already drawn however
    // much the signature says is.
    const stored = cnv.dataset.strokes;
    const resized = sizeCanvas(cnv, w, h);
    const rough = opts.roughen ? { roughPhase: opts.roughPhase ?? 0, roughWave: opts.roughWave ?? 1, roughMinSize: opts.roughMinSize ?? 0 } : null;
    const from = (resized || layer.roughen) ? null : appendedAfter(stored, layer, rough);
    const ctx = cnv.getContext('2d')!;
    const strokes = (layer.strokes || []) as any[];
    if (from === null) drawStrokesOnCtx(ctx, strokes, true, store, opts);
    else drawStrokesOnCtx(ctx, strokes.slice(from), false, store, opts);
    cnv.dataset.strokes = signature;
    return from === null ? 'full' : 'appended';
}
