# The static effect: what it costs, and what was done about it

Measured 2026-09-17, after the static moved from the whole frame to the layer (#271) and the
colour fringe was added (#275–#278).

## Setup

- Chromium, ANGLE on Intel Iris Xe (an integrated GPU — the laptop, not the tablet, and not a
  discrete card; a slower target than most desktops and about what the Galaxy Tab has).
- Canvas 1920×1080, one layer with sixty 4px black bezier strokes across the frame.
- `staticCanvas` called directly through `page.evaluate` on the dev server, 90 calls per row
  after 8 warm-up calls, `getImageData(0,0,1,1)` before and after to drain the GPU queue so the
  clock covers the work and not just the command submission. `seconds` advanced by 1/30 per
  call, so the bad-frame mix is the real one.
- Numbers are ms per call for **one layer**. A frame with N noisy layers pays N times.

## Before

| case | ms / frame |
|---|---|
| plain `drawImage` of the layer (the floor) | 1.1 |
| static 0.5 | 10.4 |
| static 1.0 | 9.2 |
| static 0.5 + colour 0.8 | 13.7 |
| static 0.5, no snow | 8.9 |

Ten milliseconds of a 16.7ms frame for one layer, fourteen with the fringe. Two noisy layers
and playback drops frames on this GPU.

Where it went, counted in full-frame canvas operations per call:

- **the two colour halves** — copy, multiply fill, `destination-in` mask, each: 6 ops;
- **the two silhouettes** for the fringe — copy and `source-in` fill, each: 4 ops;
- the output: clear + 2 `lighter` draws (+ 2 fringe draws): 3–5 ops;
- **the snow**: 4 `source-atop` blits of a 1536px tile, resampled from 512px with smoothing
  off: 4 ops;
- the copy of the source: 1 op.

About 18 full-frame operations, of which 10 rebuilt something that had not changed.

## What changed

1. **The halves and silhouettes are cached per layer.** They are functions of the layer's
   pixels only. The layer cache already stamps a signature (`dataset.strokes`) on a canvas when
   it re-rasterises, so the four derived canvases are kept in a `WeakMap` keyed by the source
   canvas and rebuilt only when that signature moves. A source with no signature — the mosaic's
   blown-up scratch — is rebuilt every frame, as before. The boiling line cycles through a few
   phase canvases, each with its own stable signature, so it caches per phase.
2. **The snow is one pattern fill**, not four blits. The tile is blown up to screen scale once
   at build time (a pattern cannot be told not to smooth, so it cannot be scaled at draw time
   without blurring the specks), and each frame re-rolls it by moving the pattern's origin.
3. **With the fringe on, the channel split is skipped.** The red and cyan silhouettes behind
   the line *are* the colour; on dark ink the multiply split never showed anyway (black × red is
   black). One draw of the copy instead of two `lighter` draws of two derived canvases.

Per frame, steady state: copy (1) + output draw (1–2) + snow (1) + fringe draws (0–2) ≈ 4–6
full-frame operations, and nothing derived is rebuilt.

## After

| case | before | after |
|---|---|---|
| plain `drawImage` (floor) | 1.1 | 0.6 |
| static 0.5 | 10.4 | **2.2** |
| static 1.0 | 9.2 | **2.6** |
| static 0.5 + colour 0.8 | 13.7 | **2.6** |
| static 0.5, no snow | 8.9 | 2.1 |
| static 0.5, layer changing every frame (cache miss) | 8.5 | 8.9 |

Four to five times cheaper in the steady state, and the fringe now costs nothing extra. The
cache-miss row is the same as before, by construction: a layer that really does change every
frame — being drawn on, or a mosaic ramping — pays the old price on those frames only.

The floor moved too (1.1 → 0.6): the second run was warmer. Read the ratios, not the last
decimal.

## Cost of the cache

Two 1080p canvases per noisy layer without the fringe, four with it — 8MB each. A project with
ten layers all on static would hold 160–320MB of halves. That is not the normal case (the effect
is a moment, on one or two layers), and the map is weak, so dropping the layer drops them.

## What was not done

- **Skipping the split on black ink.** It contributes nothing there, but knowing the ink is
  black means reading pixels back, which costs more than the two draws it would save.
- **A smaller working size.** Building the static at half resolution and drawing it up would
  halve every op again, but the whole effect is hard edges tearing, and a blurred tear reads as
  a blur, not a fault.
- **Moving it to WebGL.** Everything else here is Canvas 2D on a context the renderer is
  handed; a second pipeline for one effect is not worth its weight until something else needs it.

## How to re-measure

Open the app, then in the console (or `page.evaluate`):

```js
const m = await import('/src/canvas/pixelEffects.js');
// build a 1920x1080 canvas `src` with strokes, `src.dataset.strokes = 'x'`,
// tile = m.grainTile(() => document.createElement('canvas')),
// refs = { copy: {current:null}, out: {current:null} }, scratch = (ref,w,h) => …
// then time m.staticCanvas(src, tile, { cw, ch, amount: 0.5, seconds: i/30 }, refs, scratch)
```

The numbers above will not match on a different GPU, but the ratio should.

## Guarded since 2026-09-21

`test/canvas/opBudget.test.js` counts the canvas operations (drawImage, fillRect, clearRect,
getImageData, putImageData) a frame of the static costs, through a proxy over a real Skia
context, and fails above a ceiling: 10 in the steady state (measured 8.9), 11 with the fringe
(9.9), 20 on a cache miss. Counts, not times - a timing budget on a CI runner is noise, and what
this page changed was the count. Tighten the ceilings when the count drops; do not loosen them
without a paragraph here.
