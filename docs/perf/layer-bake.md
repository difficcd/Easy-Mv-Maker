# Committing a stroke: drawing only the new one, in the running app

Measured 2026-10-22 with `scripts/profile-frame.mjs` (its stroke-scaling phase: 40 pencil strokes on
one layer, after two dot-pen strokes from its earlier phases).

## A correction to #362

#362 made a commit draw only the new stroke instead of redrawing the layer, and recorded a 17-20x
gain. That gain was measured in a simulation of the baking rule, **not in the app** - and in the app
it did not happen. The layer cache had two copies of its baking rule: `ensureLayerCanvas`, for a
layer the cache has not reached, and the effect that keeps the visible layers baked. #362 changed
only the first. The second, the one that bakes what is on screen, went on redrawing every stroke on
the layer at every commit.

The profiler showed it directly: one pencil stroke's commit made **14,602** 2d calls - nearly all
`fillRect`, the dot pen's stamps - because the two dot strokes drawn earlier were re-stamped each time.

## Change

One function, `canvas/layerBake.bakeLayer`, called from both paths. Tests pin that an append is drawn
on its own (stamps counted, equal to the new stroke drawn alone), that the result is the same pixels
as drawing the layer whole, and that anything else - a removal, a moved layer, a resize, a boiling
layer - is drawn whole.

## Effect, in the app

| pencil stroke commit | before | after |
|---|---|---|
| 2d calls | 14,602 | **34** |
| draw time, typical | 13-41ms | **0.8ms** |

The two copies were the bug; the lesson is the same one as the CI and the map: one rule, one place.
