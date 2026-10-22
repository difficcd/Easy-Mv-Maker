import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, ImageData, DOMMatrix } from '@napi-rs/canvas';
import { setCanvasFactory, makeCanvas } from '../../src/canvas/canvasFactory.ts';
import { bakeLayer } from '../../src/canvas/layerBake.ts';
import { drawStrokesOnCtx } from '../../src/canvas/strokes.ts';
import { layerSig } from '../../src/core/layerTree.ts';

setCanvasFactory(() => /** @type {any} */ (createCanvas(1, 1)));
globalThis.ImageData ??= ImageData;
globalThis.DOMMatrix ??= DOMMatrix;

// The layer cache had two copies of its baking rule and only one of them drew just the new stroke;
// the other - the one that bakes what is on screen - redrew the whole layer on every commit. The
// profiler caught it: 14,600 2d calls for one pencil stroke's commit, nearly all re-stamping dot
// strokes drawn earlier. Both paths call bakeLayer now.

const W = 300, H = 160;
const stroke = (id, y, over = {}) => ({ id, tool: 'pen', color: '#000000', opacity: 1, size: 4,
    points: Array.from({ length: 40 }, (_, i) => ({ x: 10 + i * 7, y: y + Math.sin(i / 5) * 10, pressure: 0.5 })), ...over });
const layer = (strokes, over = {}) => ({ id: 1, type: 'layer', strokes, rev: 0, roughen: 0, ...over });
const bake = (cnv, l) => bakeLayer(cnv, l, layerSig(l), W, H, new Map());
/** A cache canvas: the DOM's has a dataset, which holds the signature; the Node canvas does not. */
const cacheCanvas = () => Object.assign(makeCanvas(1, 1), { dataset: {} });
const pixels = (c) => Buffer.from(c.getContext('2d').getImageData(0, 0, W, H).data);

test('a stroke added to a baked layer is drawn on its own', () => {
    const cnv = cacheCanvas();
    assert.equal(bake(cnv, layer([stroke(1, 40), stroke(2, 80)])), 'full');
    assert.equal(bake(cnv, layer([stroke(1, 40), stroke(2, 80), stroke(3, 120)])), 'appended');
});

test('drawn on its own, the result is the same pixels as drawing the layer whole', () => {
    const all = [stroke(1, 40), stroke(2, 80, { tool: 'brush' }), stroke(3, 120, { tool: 'eraser', size: 12 })];
    const incr = cacheCanvas();
    bake(incr, layer(all.slice(0, 1)));
    bake(incr, layer(all.slice(0, 2)));
    bake(incr, layer(all));
    const whole = makeCanvas(W, H);
    drawStrokesOnCtx(whole.getContext('2d'), all, true, new Map());
    assert.deepEqual(pixels(incr), pixels(whole));
});

test('it draws only the new stroke - counted, not inferred', () => {
    const cnv = cacheCanvas();
    bake(cnv, layer([stroke(1, 40), stroke(2, 80)]));
    // Dot strokes stamp with fillRect; count the stamps the second bake makes.
    const ctx = cnv.getContext('2d');
    let calls = 0; const real = ctx.fillRect.bind(ctx); ctx.fillRect = (...a) => { calls++; return real(...a); };
    bake(cnv, layer([stroke(1, 40), stroke(2, 80), stroke(3, 120)]));
    ctx.fillRect = real;
    const one = makeCanvas(W, H), octx = one.getContext('2d');
    let alone = 0; const r2 = octx.fillRect.bind(octx); octx.fillRect = (...a) => { alone++; return r2(...a); };
    drawStrokesOnCtx(octx, [stroke(3, 120)], true, new Map());
    assert.equal(calls, alone, `the append drew ${calls} stamps; the new stroke alone is ${alone}`);
});

test('anything other than an append is drawn whole', () => {
    const cnv = cacheCanvas();
    bake(cnv, layer([stroke(1, 40), stroke(2, 80)]));
    assert.equal(bake(cnv, layer([stroke(1, 40)])), 'full', 'a removal');
    bake(cnv, layer([stroke(1, 40), stroke(2, 80)]));
    assert.equal(bake(cnv, layer([stroke(1, 40), stroke(2, 80), stroke(3, 120)], { rev: 1 })), 'full', 'a moved layer (rev bumped)');
    assert.equal(bakeLayer(cnv, layer([stroke(1, 40)]), layerSig(layer([stroke(1, 40)])), W + 10, H, new Map()), 'full', 'a resize');
});

test('a boiling layer is always drawn whole', () => {
    const cnv = cacheCanvas();
    const l2 = layer([stroke(1, 40)], { roughen: 2 });
    bakeLayer(cnv, l2, layerSig(l2), W, H, new Map(), { roughen: 2 });
    const l3 = layer([stroke(1, 40), stroke(2, 80)], { roughen: 2 });
    assert.equal(bakeLayer(cnv, l3, layerSig(l3), W, H, new Map(), { roughen: 2 }), 'full');
});
