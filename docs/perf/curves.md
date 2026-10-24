# Freehand curves: angular fast strokes, invented loops, and stored points

Measured 2026-10-21, after the report that a fast curve "looks angular", that bends look stiff
and unnatural, and the ask that curve data be lighter.

## Setup

- `smoothPoints` (src/canvas/strokes.ts) called directly in Node, before and after, on:
  - two synthetic strokes with no genuine corners, so any kink is the smoothing's: a circle drawn
    fast (samples 25px apart), and a slow start (2px samples) running into a fast sweep (30px);
  - every freehand stroke in the 21 saved projects on this machine - 4,681 strokes, 131,897
    points. These are mouse input, mostly made with the dot pen; they were rendered through the
    pen's (the `brush` tool's) smoothing, so they stand in for pen strokes drawn with the same
    device. Tablet strokes are saved on the tablet and were not available.
- Distances are the largest gap, in canvas pixels, between two polylines (both directions), on a
  4px grid search.

## What was wrong

**1. The fast stretch of a slow stroke was never interpolated.** Whether to fit a curve was
decided once per stroke, by its mean sample spacing. A stroke drawn slowly and then swept fast
averages out dense, so the sweep - samples 30px apart - was resampled along its straight chords
and Chaikin rounded each joint by a pixel or two.

| | before | after |
|---|---|---|
| slow then fast, worst kink | **7.1°** | 0.2° |
| fast circle, worst kink | 0.1° | 0.1° |
| real strokes with such a stretch | 409 of 4,681 (8.7%) | - |

**2. Where it did interpolate, it invented loops.** The uniform Catmull-Rom spline gives every
span the same parameter length, so a 2px span beside an 80px one inherits a tangent forty times
its size and swings out. Measured as how far the smoothed line strays from the polyline the hand
actually drew:

| stray from the drawn line | before | after |
|---|---|---|
| p90 | 1.45px | 0.93px |
| p99 | 8.80px | 3.26px |
| worst stroke | **38.72px** | 9.67px |
| strokes straying more than 2px | 345 | 138 |

**Change.** Interpolate span by span - every span over 4px - with the **centripetal** form
(`core/catmullRom.centripetalSpan`), which spaces the knots by the square root of each span's
length: no loops where spacing is uneven, and on even spacing exactly the uniform curve.

**Effect on existing drawings.** Strokes are re-smoothed from their points on every paint, so this
changes artwork already drawn. 35.6% of strokes are byte-identical; of the rest the median moved
0.30px. The large movements are the invented loops going away: only **10** strokes in 4,681 stray
further from what was drawn than before, by at most 0.98px.

Angularity at the joints of fast stretches on real strokes (sharpest single-vertex turn within
4px of a joint): strokes with a joint turning more than 8° at one vertex, 1,284 → 1,064; median
6.34° → 5.11°. A smaller gain than the synthetic case, and the measure is why: real strokes are
full of deliberate reversals - hatching, scribbles - which it cannot tell from an artefact.

## Lighter data

A stroke stored every pointer sample. `core/simplifyStroke` keeps a point only if dropping it
would move the line by more than a tolerance, or bend the pressure by more than 0.04 - pressure
is part of the test, or a taper on a straight run would flatten. Applied when a freehand pen,
pencil or marker stroke is committed; never to the dot pen (pixel art), the airbrush (it stamps
along raw points), the eraser, or ruler shapes. Existing strokes are not touched.

On a third of the real strokes (1,456), rendered through the smoothing:

| tolerance | points kept | rendered line moves (median / p99) | turning per 100px |
|---|---|---|---|
| 0.25px | 54.4% | 0.30 / 3.22px | -3% |
| **0.5px (chosen)** | **46.5%** | **0.46 / 4.68px** | **-11.5%** |
| 0.75px | 40.4% | 0.59 / 6.37px | -18% |
| 1.0px | 35.8% | 0.75 / 13.87px | -24% |

0.5px: about half the points, a sub-pixel median change, a calmer line - a mouse reports whole
pixels, so a slow line is a staircase and many of its steps go. 1.0px is lighter still but its
tail is a visible change of shape.

In the running app, one stroke drawn with the pen - 75 pointer moves, a slow wave into a fast
sweep - was stored as 35 points, and the sweep rendered round.

## Known cost

The live preview draws the unsimplified points; the committed stroke is the simplified one. At
0.5px the median difference is under half a pixel, but at the 99th percentile it is 4.7px, so on
roughly one stroke in a hundred the line may visibly settle when the pen lifts. Worth checking on
the tablet, where sampling is denser and pressure varies.

## The dot pen (2026-10-22)

The day after the above, a screenshot: fast loops still bending at every sample. The tool selected
was **Dot** - and Dot is the **default tool** (`useToolSettings`: `useState('pen')`), which is why
nearly every stroke in the saved projects is one. It stamped its squares along *straight chords*
between pointer samples and never went through the smoothing, so none of the work above reached
the strokes actually being drawn.

**Change.** `canvas/strokes.dotPath`: a dot stroke's spans over 4px are interpolated with the same
centripetal spline - through every sample, exactly (the spline's start is the drawn point itself,
not a re-evaluation of it, after `320` came back as `319.99999…`), so a pixel placed on purpose
stays put. Slow pixel work, where no gap exceeds 4px, comes back exactly as drawn; no resampling,
no corner-cutting, the stamps stay hard-edged.

**Existing dot drawings do not change.** Strokes are re-drawn from their points on every paint, so
changing how Dot draws would have changed every dot drawing already made. New dot strokes carry
`curved: true`, and only they are drawn this way.

**Verified** on a quick circle sampled 30px apart: the chords turned the full 14° at each sample;
the curve's worst kink is under 3°, staying within 0.7px of the circle. And in the running app,
fast loops drawn with Dot: before, a polygon with a corner at every sample - the screenshot; after,
round.

## The live preview (2026-10-22)

What is drawn while the pen is down should be what commits when it lifts. The preview adds only the
new part of a stroke each frame, but a curved span's shape depends on the sample *after* it - so the
newest span was drawn as a guess, then drawn again once the next sample came, with the guess left
on the overlay underneath. `scripts/live-ghost-check.mjs` draws the same fast loops with each tool
and counts overlay ink, just before pen-up, that is not in the committed stroke:

| tool | before | after |
|---|---|---|
| Dot | 5,197px (28%) | **0px** |
| pen (`brush`) | 4,994px (27%) | open |
| pencil | 5,999px (37%) | open |

**Dot, fixed.** The overlay draws only spans whose neighbours are all known; the newest waits for
the next sample, a frame at most. `canvas/strokes.dotPathRange` takes each span's neighbours from
the whole stroke rather than the slice being drawn, so the pieces join into exactly the committed
path - tested by drawing the same stroke in pieces of one, two and seven spans.

**The pen and pencil, open.** Their smoothing - resampling along the length, corner-cutting, the
taper at the end, and the simplification at commit - each depends on the whole stroke, so "draw
only the final part" does not carry over as it stands. Next.

## Renderer version 2 (2026-10-22)

Measuring what a full-redraw preview would cost turned up what *any* drawing of these tools cost.
Three corner-cutting passes double the points three times, so the smoothed path came out 0.25px
apart - 6,776 points for a 1,700px stroke - and the pen, pencil and marker stroke each segment
separately because the width changes along the line. In Chrome on the GPU (`scripts/stroke-cost.mjs`),
one stroke, simplified, smoothed and drawn:

| | before | v2 (1px points) |
|---|---|---|
| pen, 200 / 600 / 1,200 samples | 20.8 / 76.7 / 155ms | **6.3 / 10.6 / 15.1ms** |
| pencil, 200 / 600 | 124 / 393ms | **34 / 96ms** |
| marker, 200 / 600 | 104 / 332ms | **58 / 169ms** |

paid at every commit, not only in a preview. The pencil and marker are still heavy - what remains
is compositing a stroke-sized scratch, a separate problem.

**The same overdraw was a bug.** The pen applied its opacity per segment, so a quarter-pixel's worth
of overlapping round caps stacked it: **a pen set to 30% painted at 91%** (mean alpha), and 60% at
94% - the slider did almost nothing. The pencil and marker composite once and were right.

**But fixing it changes how strokes look.** Rendered with both renderers, real strokes' bodies
(alpha ≥ 128) came out 4.97% slimmer for the pen, 2.35% for the pencil, 2.05% for the marker: the
overdraw had been compounding every antialiased edge. Asked how to handle drawings already made,
the answer was *new strokes only*. So each new stroke records `v: 2`, and a stroke without it is drawn
by the old path: **byte-identical to the previous renderer on 292 of 292 real strokes, for each of
the pen, pencil and marker.** Version 2: smoothed points 1px apart, the taper kept at the same 1.5px
of length (it was six points, which at 1px would have quadrupled it), and a translucent pen drawn
opaque on a scratch and composited once - **30% now paints at 30%**.

The dot pen's `curved` flag from earlier the same day is folded in: `v: 2` implies it, and strokes
that carry `curved` keep it.

## Renderer version 3: the pen as one outline (2026-10-22)

With v2 the pen's preview could finally be *redrawn whole* each frame - the only way it can match the
commit exactly - and it did: ghost pixels 5,168 → 0. But it stuttered. Drawing in the running app,
frame gaps on the GPU:

| stroke | tail only (before) | whole redraw, v2 | whole redraw, **v3** |
|---|---|---|---|
| 150 samples, p95 / worst | 10.2 / 11.9ms | 20 / 20ms | **10.1 / 10.5ms** |
| 400 samples | 10.2 / 30ms | 50 / 100ms | **10.3 / 28ms** |
| 850 samples | 10.2 / 20ms | 70 / 140ms | **10.2 / 30ms** |

v2 still stroked the line one pixel of length at a time. Version 3 builds the outline - the centre
line offset half its width each way along the local normal, with round caps - and fills it once
(`canvas/strokes.fillOutline`), the approach of the outline-based ink libraries web drawing tools
use. One call whatever the length, and the opacity applied once by construction, so translucent
pens need no scratch. Turns tighter than the width fold the inner edge over itself; the nonzero
fill rule covers the fold.

One stroke, simplified, smoothed and drawn (`scripts/stroke-cost.mjs`, GPU):

| pen | 200 | 600 | 1,200 | 2,400 samples |
|---|---|---|---|---|
| v1 | 20.8 | 76.7 | 155 | 341ms |
| v2 | 6.4 | 7.6 | 13.4 | 81ms |
| **v3** | **3.6** | **3.3** | **6.3** | **11.8ms** |

Its body is within 6% of v2's. As before, only new strokes: v1 and v2 strokes keep their paths.

The simplification the preview runs each frame is **windowed** (`simplifyWindowed`, 64 samples a
window): simplifying the whole stroke each frame would let a new sample change which earlier points
survive, and the line already drawn would shift as the pen went on. A finished window is final -
tested by simplifying prefixes of a stroke and comparing.

**Found on the way: a tap left a quarter-size dot.** The taper narrows a stroke towards both ends,
so on one or two points it shrank the whole stroke to 25% - in every version so far. v3 leaves strokes
too short to taper at full width.

**Ghosts now:** Dot 0, pen 0, pencil still 6,003px - the pencil varies its alpha with pressure along
the line, which one fill cannot do as it stands.

## v3 for the marker, and where the pencil stands (2026-10-22)

The marker's opacity is applied once in its multiply composite, so drawing its scratch as one
outline instead of a stroke per pixel changes the cost and nothing else (body within 8% of v2):

| marker, one stroke | 200 | 600 | 1,200 | 2,400 samples |
|---|---|---|---|---|
| v2 | 32.7 | 108.8 | 155.9 | 310.7ms |
| **v3** | **3.5** | **8.0** | **11.2** | **35.0ms** |

Cheap enough for the preview to redraw it whole each frame, as the pen does, up to 1,200 samples
(beyond that the composite over a large box grows): ghost pixels 0, frame gaps p95 10.1-10.2ms. One
gap of 180ms was seen once at 400 samples, probably the previous stroke's commit landing inside the
measured window; not investigated further.

**The pencil is only partly done.** It expresses light pressure as darkness along the line, and
that works - mean alpha 0.42 in the body at pressure 0.1, 0.72 at 0.5, in proportion to what it
aims for. One fill cannot vary alpha along a path. So v3 fills the outline only when the darkness is
even all the way - a mouse, or a pen pressed at least halfway - and a stroke with varying darkness is
drawn exactly as v2 draws it (byte-identical, tested). That leaves the slow case slow: a tablet
pencil stroke, 34ms at 200 samples, still ghosting in the preview (5,991px). Fixing it needs the
darkness drawn as a separate map and applied as alpha, not another fill - a design of its own.

## 2026-10-24: pencil renderer v4

The owner: the pencil's grain appears only after the stroke is drawn, and pressure makes it slow.

Both had one cause. Wherever its darkness varied with pressure (any pen stroke lighter than half
pressure), the pencil was stroked a pixel of length at a time, each piece at its own alpha with
round caps. That was the cost, and it was why the live preview drew only the newest tail - whose
pieces overlapped at the seams and filled the grain in until the pen lifted. The stacked caps also
made a light touch nearly as dark as a firm one.

v4 fills the stroke as runs of equal darkness (48 steps over the range), meeting edge to edge
(`fillOutlineRange`), and the preview redraws the whole stroke each frame up to 800 samples.

`scripts/stroke-cost.mjs`, pressure 0.5 ± 0.3, full redraw per frame:

| samples | v3 pencil | v4 pencil | pen (for scale) |
|---|---|---|---|
| 200 | 39.7 ms | 7.3 ms | 5.4 ms |
| 600 | 131.0 ms | 16.0 ms | 9.3 ms |
| 1,200 | 248.6 ms | 23.3 ms | 17.0 ms |
| 2,400 | 838.6 ms | 43.3 ms | 36.2 ms |

`scripts/live-ghost-check.mjs`: pencil overlay ink not in the committed stroke, 5,999 px -> 0.
New strokes only; a pencil stroke drawn before keeps its look.
