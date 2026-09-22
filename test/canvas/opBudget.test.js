// How much canvas work a frame of each effect costs, counted rather than timed.
//
// A timing budget in CI is noise: the runner's speed varies more than any regression would.
// What the perf work in docs/perf/static-effect.md actually changed was the number of
// full-frame canvas operations per frame - 18 down to 5 - and that number is exact and
// machine-independent. So this counts drawImage / fillRect / getImageData / putImageData
// through a proxy over the real (Skia) context and asserts a ceiling. A change that doubles
// the work of an effect fails here, whatever the machine.
//
// The ceilings are the measured counts with a little room, not aspirations: tighten them when
// the count drops, never loosen them without saying why in docs/perf/.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, ImageData, DOMMatrix } from '@napi-rs/canvas';
import { setCanvasFactory, makeCanvas } from '../../src/canvas/canvasFactory.ts';
import { pixelateCanvas, staticCanvas, grainTile } from '../../src/canvas/pixelEffects.ts';
import { drawStrokesOnCtx } from '../../src/canvas/strokes.ts';
import { scratchCanvas } from '../../src/canvas/scratch.ts';

if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = /** @type {any} */ (ImageData);
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = /** @type {any} */ (DOMMatrix);

const COUNTED = new Set(['drawImage', 'fillRect', 'getImageData', 'putImageData', 'clearRect']);
/** Every canvas made counts its context's draw calls into one ledger. */
const ledger = { calls: 0, by: /** @type {Record<string, number>} */ ({}) };
const reset = () => { ledger.calls = 0; ledger.by = {}; };
setCanvasFactory(() => {
    const c = /** @type {any} */ (createCanvas(1, 1));
    const real = c.getContext.bind(c);
    c.getContext = (kind, opts) => {
        const ctx = real(kind, opts);
        return new Proxy(ctx, {
            get(t, k) {
                const v = t[k];
                if (typeof v !== 'function') return v;
                if (!COUNTED.has(String(k))) return v.bind(t);
                return (...a) => { ledger.calls++; ledger.by[String(k)] = (ledger.by[String(k)] || 0) + 1; return v.apply(t, a); };
            },
            set(t, k, v) { t[k] = v; return true; },
        });
    };
    return c;
});

const W = 320, H = 180;
const inkLayer = () => {
    const c = makeCanvas(W, H); const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(40, 40, 200, 80);
    /** @type {any} */ (c).dataset = { strokes: 'sig-1' };   // what the layer cache stamps
    return c;
};

test('the static, steady state: about nine counted operations a frame, never more than ten', () => {
    const src = inkLayer();
    const tile = grainTile(makeCanvas);
    const refs = { copy: { current: null }, out: { current: null } };
    staticCanvas(src, tile, { cw: W, ch: H, amount: 0.5, seconds: 0 }, refs, scratchCanvas);   // warm: builds the halves
    reset();
    for (let i = 1; i <= 24; i++) staticCanvas(src, tile, { cw: W, ch: H, amount: 0.5, seconds: i / 24 }, refs, scratchCanvas);
    const perFrame = ledger.calls / 24;
    // Measured 8.9: copy clear+draw, out clear, two lighter draws, the snow fill, and on a bad
    // frame a clear+draw per torn band. Before docs/perf/static-effect.md it was about 18.
    assert.ok(perFrame <= 10, `${perFrame.toFixed(1)} counted ops a frame: ${JSON.stringify(ledger.by)}`);
});

test('the fringe adds one operation, not the eight it used to', () => {
    const src = inkLayer();
    const tile = grainTile(makeCanvas);
    const refs = { copy: { current: null }, out: { current: null } };
    staticCanvas(src, tile, { cw: W, ch: H, amount: 0.5, seconds: 0, colour: 0.8 }, refs, scratchCanvas);
    reset();
    for (let i = 1; i <= 24; i++) staticCanvas(src, tile, { cw: W, ch: H, amount: 0.5, seconds: i / 24, colour: 0.8 }, refs, scratchCanvas);
    // Measured 9.9: the two fringe draws, minus the channel split the fringe makes redundant.
    assert.ok(ledger.calls / 24 <= 11, `${(ledger.calls / 24).toFixed(1)} ops a frame with the fringe`);
});

test('the static rebuilds its halves only when the layer changes', () => {
    const src = inkLayer();
    const tile = grainTile(makeCanvas);
    const refs = { copy: { current: null }, out: { current: null } };
    staticCanvas(src, tile, { cw: W, ch: H, amount: 0.5, seconds: 0 }, refs, scratchCanvas);
    reset();
    staticCanvas(src, tile, { cw: W, ch: H, amount: 0.5, seconds: 1 / 24 }, refs, scratchCanvas);
    const hit = ledger.calls;
    /** @type {any} */ (src).dataset.strokes = 'sig-2';
    reset();
    staticCanvas(src, tile, { cw: W, ch: H, amount: 0.5, seconds: 2 / 24 }, refs, scratchCanvas);
    const miss = ledger.calls;
    assert.ok(miss > hit + 4, `a changed layer should rebuild the halves: hit ${hit}, miss ${miss}`);
    assert.ok(miss <= 20, `but not more than the old whole rebuild: ${miss}`);
});

test('the mosaic is two blits: shrink, and the caller blows it up', () => {
    const src = inkLayer();
    const small = { current: null };
    reset();
    pixelateCanvas(src, 12, small, scratchCanvas);
    assert.ok(ledger.calls <= 2, `${ledger.calls} ops to pixelate: ${JSON.stringify(ledger.by)}`);
});

test('a stroke is drawn with no per-point canvas operations', () => {
    // The brush is one path per stroke; a version that stamped every point would be N calls.
    const c = makeCanvas(W, H); const ctx = c.getContext('2d');
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: 20 + i * 1.4, y: 90 + Math.sin(i / 9) * 30, pressure: 0.5 }));
    reset();
    drawStrokesOnCtx(ctx, [{ id: 1, tool: 'brush', color: '#000', opacity: 1, size: 6, points: pts }], false, new Map());
    assert.ok(ledger.calls <= 4, `${ledger.calls} counted ops for a 200-point brush stroke: ${JSON.stringify(ledger.by)}`);
});
