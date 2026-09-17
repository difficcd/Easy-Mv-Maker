# The camera

A camera move is a window onto the frame rather than something drawn into it. It has a centre —
the point on the canvas that lands in the middle of the picture — and a zoom, and everything
composited for the cut goes through that one transform. The video reference, the artwork and the
text all move together, which is what makes it a camera and not another per-layer effect.

**Where:** the camera icon on a cut row, then the *Camera* section. It only plays while the film
is playing, like every other animation here.

## Presets

Zoom in, zoom out, pan left / right / up / down, and Ken Burns (a slow push with drift). Pick one
and it is done; the zoom fields below show what the preset resolves to.

One thing that is not obvious: **a pan at zoom 1 shows the edge of the artwork.** There is nothing
outside the canvas, so moving the window sideways slides blank paper into frame. Every preset that
moves the centre therefore zooms in first, and by an amount chosen so the travel stays inside what
the zoom buys. If you set up a pan by hand and see the edge, that is why.

## A drawn path

**Draw path** — then draw on the canvas. The camera's centre follows the line you drew, evened out
so it moves at a constant speed rather than replaying how fast your pen was moving. A drawn path
overrides the preset's own path but keeps its zoom unless you set one.

This is for a move nobody can name — follow this arc, past that, settle here. Presets are for the
ones that come up constantly, where drawing a straight line by hand would only make it crooked.

## Zoom and tilt

Start and end values for each; the move is eased between them with the same curve as the
position, so the three stay in step. Easing them separately is what makes a move feel like two
moves.

Tilt is in degrees and meant for small values. It is a tilt, not a spin.

## Shake

A handheld wobble on the centre. **Amount** in pixels, **speed** in wobbles per second.

It is two sine waves per axis at ratios that never line up, so it does not visibly repeat over a
shot — one sine reads as a pendulum. It runs on real seconds rather than progress through the cut,
so the same setting wobbles at the same rate in a one-second cut and a ten-second one, and it is
not eased with the move, because a shake that slows to a stop reads as the camera being set down.

## Noise (static)

A broken-signal look over the whole frame: the picture wobbles, its colour channels come apart so
every edge fringes red on one side and cyan on the other, there is snow, and now and then a frame
tears sideways in bands. It flickers — most frames are a mild wobble, then one goes badly wrong.

It is drawn over the finished frame and outside the camera transform, because it is what happens
to the *signal*, not to the scene: it must not zoom or shake with the picture.

**It is skipped when exporting on a transparent background.** The blend it uses paints into
transparent pixels, so a PNG sequence meant as an overlay would come out opaque — which is the
whole reason that export mode exists.

It has the same timing controls the mosaic effect has — see *Effects over time* below.

## Effects over time

Shake is constant. Noise, like the mosaic effect on a layer, has a window:

- **Start / End** — where in the cut it happens, with the cut as 0 to 1. The gap is its duration.
- **Speed** — how quickly it arrives inside that window. Above 1 it gets there early and holds.
- **From** — start already this far applied, and deepen from there.

Outside the window it *holds* — nothing before, whatever it reached after. Coming back is what the
cut's "there and back" mode is for, and that still works.

## Everything is deterministic

Shake, noise, and every other animation here is a pure function of the time. Nothing is random.
That is not a stylistic choice: the export repaints the same frames through the same functions,
and anything random would shake or tear differently in the file than it did on screen.
