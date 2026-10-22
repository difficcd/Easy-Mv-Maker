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
