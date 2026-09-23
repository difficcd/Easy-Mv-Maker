// The canvas functions on real pixels, in Node.
//
// Until this file, everything under src/canvas that actually draws - strokes into pixels, the
// static, the mosaic, the bucket fill - was covered by one smoke test that drags a mouse across
// the built app. These run the same functions on @napi-rs/canvas (a Skia canvas with the 2D
// API, no browser) through the canvas factory, and assert on what the pixels came out as.
//
// The assertions are coarse on purpose: ink where a stroke went and none where it did not,
// alpha preserved, blocks the size asked for. Anti-aliasing and Skia-versus-Chrome differences
// are below what any of them look at.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, ImageData, DOMMatrix } from '@napi-rs/canvas';
import { setCanvasFactory, makeCanvas } from '../../src/canvas/canvasFactory.ts';
import { drawStrokesOnCtx } from '../../src/canvas/strokes.ts';
import { pixelateCanvas, staticCanvas, grainTile, mosaic } from '../../src/canvas/pixelEffects.ts';
import { bucketFillTransparentRegion } from '../../src/canvas/fill.ts';
import { scratchCanvas } from '../../src/canvas/scratch.ts';

setCanvasFactory(() => /** @type {any} */ (createCanvas(1, 1)));
// The fill and the morph build ImageData themselves; Node has no global for it.
if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = /** @type {any} */ (ImageData);
// The static lays its snow as a pattern with a DOMMatrix transform.
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = /** @type {any} */ (DOMMatrix);

const W = 200, H = 120;
const fresh = () => { const c = makeCanvas(W, H); return { c, ctx: c.getContext('2d') }; };

/** Pixels with any alpha, and the box they occupy. */
function ink(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        n++;
        const p = i / 4, x = p % c.width, y = (p - x) / c.width;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { n, box: n ? { x0, y0, x1, y1 } : null };
}

const stroke = (over = {}) => ({
    id: 1, tool: 'brush', color: '#000000', opacity: 1, size: 8,
    points: [{ x: 20, y: 60, pressure: 0.5 }, { x: 60, y: 40, pressure: 0.5 }, { x: 100, y: 60, pressure: 0.5 }, { x: 140, y: 40, pressure: 0.5 }, { x: 180, y: 60, pressure: 0.5 }],
    ...over,
});

test('a brush stroke lays ink along its points and nowhere else', () => {
    const { c, ctx } = fresh();
    drawStrokesOnCtx(ctx, [stroke()], false, new Map());
    const { n, box } = ink(c);
    assert.ok(n > 400, `only ${n} ink pixels`);
    // Within the points' extent plus half the brush, on every side.
    assert.ok(box.x0 >= 20 - 8 && box.x1 <= 180 + 8, `x ${box.x0}..${box.x1}`);
    assert.ok(box.y0 >= 40 - 8 && box.y1 <= 60 + 8, `y ${box.y0}..${box.y1}`);
});

test('an eraser stroke takes ink away where it crosses', () => {
    const { c, ctx } = fresh();
    drawStrokesOnCtx(ctx, [stroke()], false, new Map());
    const before = ink(c).n;
    drawStrokesOnCtx(ctx, [stroke({ id: 2, tool: 'eraser', size: 30, points: [{ x: 100, y: 20, pressure: 0.5 }, { x: 100, y: 100, pressure: 0.5 }] })], false, new Map());
    const after = ink(c).n;
    assert.ok(after < before, `eraser removed nothing: ${before} -> ${after}`);
    assert.ok(after > 0, 'the eraser took the whole stroke, not a band of it');
});

test('drawing is deterministic: the same stroke twice gives the same pixels', () => {
    const a = fresh(), b = fresh();
    drawStrokesOnCtx(a.ctx, [stroke()], false, new Map());
    drawStrokesOnCtx(b.ctx, [stroke()], false, new Map());
    assert.deepEqual([...a.ctx.getImageData(0, 0, W, H).data], [...b.ctx.getImageData(0, 0, W, H).data]);
});

test('the static keeps the alpha: empty canvas stays empty, the ink still tears', () => {
    // This is the whole point of the per-layer static (#271): it must work on a transparent
    // background, so nothing may be painted where the layer has no ink.
    const { c, ctx } = fresh();
    ctx.fillStyle = '#000'; ctx.fillRect(60, 40, 80, 40);
    const tile = grainTile(makeCanvas);
    const refs = { copy: { current: null }, out: { current: null } };
    let touched = 0;
    for (let i = 0; i < 30; i++) {
        const out = staticCanvas(c, tile, { cw: W, ch: H, amount: 1, seconds: i / 24, colour: 0.8 }, refs, scratchCanvas);
        assert.ok(out, 'a strength of 1 must produce a frame');
        const { n, box } = ink(out);
        assert.ok(n > 0);
        // Nothing far from the ink: the widest tear is 80px of band shift, the fringe a few px.
        assert.ok(box.y0 >= 40 - 8 && box.y1 <= 80 + 8, `frame ${i}: ink reached y ${box.y0}..${box.y1}`);
        if (box.x0 !== 60 || box.x1 !== 139) touched++;
    }
    assert.ok(touched > 0, 'thirty frames of full-strength static and the ink never moved');
    assert.equal(staticCanvas(c, tile, { cw: W, ch: H, amount: 0, seconds: 0 }, refs, scratchCanvas), null);
});

test('the mosaic makes blocks of the size asked for', () => {
    const { c, ctx } = fresh();
    // A sharp vertical edge: black left half, transparent right.
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 100, H);
    const small = { current: null };
    const shrunk = pixelateCanvas(c, 20, small, scratchCanvas);
    assert.ok(shrunk, 'a block of 20 is a real mosaic');
    assert.equal(shrunk.width, Math.max(1, Math.round(W / 20)));
    assert.equal(shrunk.height, Math.max(1, Math.round(H / 20)));
    // Blown back up, the edge lands on a block boundary (x = 100 is 5 blocks in).
    const up = makeCanvas(W, H); const uctx = up.getContext('2d');
    uctx.imageSmoothingEnabled = false; uctx.drawImage(shrunk, 0, 0, W, H);
    const row = uctx.getImageData(0, 60, W, 1).data;
    assert.ok(row[3 + 4 * 90] > 200, 'inside the black half');
    assert.ok(row[3 + 4 * 110] < 60, 'outside it');
});

test('mosaic() in place averages each block over itself', () => {
    const img = new ImageData(8, 8);
    // Left 4 columns black opaque, right 4 transparent.
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { const i = (y * 8 + x) * 4; img.data[i + 3] = 255; }
    mosaic(img, 4);
    // Each 4x4 block is uniform: the left one opaque, the right one empty.
    assert.equal(img.data[3], 255); assert.equal(img.data[(3 * 8 + 3) * 4 + 3], 255);
    assert.equal(img.data[(0 * 8 + 4) * 4 + 3], 0); assert.equal(img.data[(3 * 8 + 7) * 4 + 3], 0);
});

test('the bucket fill stays inside the closed region', () => {
    // A 200x120 transparent sheet with a black ring; filling inside the ring must not leak.
    const { c, ctx } = fresh();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(100, 60, 40, 0, Math.PI * 2); ctx.stroke();
    const base = ctx.getImageData(0, 0, W, H);
    const region = bucketFillTransparentRegion(base, 100, 60, { r: 255, g: 0, b: 0 }, 255, 24, 0);
    assert.ok(region, 'a fill at the centre of a ring fills something');
    // The result is cropped to the region's box, placed at (x, y) on the sheet.
    const { imageData: filled, x, y } = region;
    const at = (sx, sy) => {
        const lx = sx - x, ly = sy - y;
        if (lx < 0 || ly < 0 || lx >= filled.width || ly >= filled.height) return 0;
        return filled.data[(ly * filled.width + lx) * 4 + 3];
    };
    assert.ok(at(100, 60) > 0, 'centre filled');
    assert.ok(at(100, 30) > 0, 'up to the ring');
    assert.equal(at(10, 10), 0, 'outside the ring untouched');
    assert.equal(at(190, 110), 0, 'far corner untouched');
    // And the box itself is the inside of the ring, not the sheet.
    assert.ok(x >= 60 && x + filled.width <= 141 && y >= 20 && y + filled.height <= 101, `box ${x},${y} ${filled.width}x${filled.height}`);
});

// --- a ruler shape is drawn where it was dragged (#342) ---------------------------------------
//
// The unit tests in core/shapeStroke show what smoothing does to a rectangle's points. These
// check the thing that matters: that the renderer honours `straight` and the ink lands on the
// box. Without the exemption the same drag paints thirty to fifty pixels outside it on every
// side, which is what "the rectangle is wonky" looked like.

const RECT = [
    { x: 40, y: 30 }, { x: 160, y: 30 }, { x: 160, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 30 },
];

test('a straight shape paints inside the box it was dragged, with the corners sharp', () => {
    const { c, ctx } = fresh();
    drawStrokesOnCtx(ctx, [stroke({ points: RECT, straight: true, size: 4 })], false, new Map());
    const { n, box } = ink(c);
    assert.ok(n > 200, `only ${n} ink pixels`);
    // The box, plus half the brush and a pixel for anti-aliasing. Nothing beyond it.
    const slack = 4;
    assert.ok(box.x0 >= 40 - slack && box.x1 <= 160 + slack, `x ${box.x0}..${box.x1}`);
    assert.ok(box.y0 >= 30 - slack && box.y1 <= 90 + slack, `y ${box.y0}..${box.y1}`);
});

test('the same shape without the flag spills outside it - the bug the flag exists for', () => {
    const { c, ctx } = fresh();
    drawStrokesOnCtx(ctx, [stroke({ points: RECT, size: 4 })], false, new Map());
    const { box } = ink(c);
    const slack = 4;
    const spilled = box.x0 < 40 - slack || box.x1 > 160 + slack || box.y0 < 30 - slack || box.y1 > 90 + slack;
    assert.ok(spilled, `smoothing should push the ink outside the box, got x ${box.x0}..${box.x1} y ${box.y0}..${box.y1}`);
});

test('a straight shape still boils with the layer, rather than being left stiff', () => {
    // The exemption is from smoothing, not from the boiling line. A shape on a boiling layer
    // has to wobble with everything around it or it reads as pasted on.
    const still = fresh(), boiling = fresh();
    const s = stroke({ points: RECT, straight: true, size: 4 });
    drawStrokesOnCtx(still.ctx, [s], false, new Map());
    drawStrokesOnCtx(boiling.ctx, [s], false, new Map(), { roughen: 3 });
    // The bounding box barely moves for a three-pixel wobble, so count the ink instead: a
    // displaced outline covers a different set of pixels even when it spans the same box.
    assert.notEqual(ink(boiling.c).n, ink(still.c).n, 'the boiling shape is identical to the still one');
});
