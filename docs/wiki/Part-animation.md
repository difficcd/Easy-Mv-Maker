# Part animation

Moving one layer on its own — a head turning, a hand waving, hair swinging — without redrawing
it frame by frame. The layer is drawn once and the animation moves the drawing.

**Where:** the film icon on a layer row. It only plays while the film is playing.

## Getting a part to animate

The usual way in: draw the thing that moves on its own layer, or draw it anywhere and then lasso
it and **Split into a part**, which lifts the selection out onto a new layer with its animation
panel open.

## Move, rotate, scale

Three numbers, each the *total* change over the cut. Move is in pixels; rotate in degrees; scale as
a percentage. They all follow one eased curve, so the part arrives at its final position, angle
and size together.

**Pivot** is where it rotates and scales about, as a percentage of the canvas. For a swinging arm
put it at the shoulder; for hair, at the roots.

## There and back

**Return** makes the animation go out and come back rather than ending where it went. With a
**count** it repeats — count 2 is out-back-out-back over the cut.

A detail that will look like a bug the first time: with no count, the out-and-back runs over the
*first half* of the cut and the part sits still for the second. Every effect on this panel — move,
scale, mosaic — shares that timing, so they stay in step with each other.

## A drawn path

**Draw path** — draw on the canvas, and the part follows it. The line is evened out before it is
stored so the part moves at a constant speed rather than replaying how fast your pen was moving.
Move and path add together, so a path can be combined with a rotation.

## Keyframes

For anything the numbers cannot say. Scrub to a moment, set the part how you want it, **Add key**;
scrub on, set it again, add another. The gaps are interpolated. With two or more keys the keyframes
take over from the move / rotate / scale fields above, and the speed field only changes how fast
they play.

## Sway (hair, cloth, ribbons)

A continuous side-to-side bend rather than a one-off move. **Amount** and **speed**, and it runs on
real time — it keeps swaying however long the cut is.

Put the pivot at the fixed end. The sway grows from the pivot outward, so hair should pivot at the
roots and a ribbon at where it is held.

**Lag** is what makes it hair rather than a flag. With lag at 0 every point along the part moves
together; with lag at 0.2 the tip is doing what the root did a fifth of a second ago. The trail is
what reads as weight.

**Shape** lets you draw the sway's waveform instead of using a plain sine — draw a wobbly line and
the part sways in that shape. And the **profile** lets you place points along the part and set how
much each bends, for an arm that bends at the elbow and not the wrist.

Why the sway is a wave and not a physics simulation: every frame here is a pure function of the
time, so scrubbing and exporting give exactly what playback gave. A spring simulation carries
state between frames and would answer differently. The lag gives the delay and the settle without
the state.

## Mosaic

The layer pixelates as the cut plays. **Block** is the size at its largest; **From** starts it
already this pixelated. **Start / End** say where in the cut it happens and **Speed** how fast it
gets there — see *Effects over time* on the [Camera](Camera) page, it is the same control.

**Area** — drag a rectangle on the canvas and only that part of the layer pixelates. Without one it
is the whole layer. The rectangle moves with the layer if you move the layer.

It is applied to the layer's own pixels, not laid over the frame, so the sway and the part's
movement act on the blocks. That is what makes it look like the drawing is pixelated rather than
like a filter over the shot.

## Noise (static)

A broken-signal look on the layer's own lines: the ink wobbles, its colour comes apart so every
edge fringes red on one side and cyan on the other, there is snow on the strokes, and now and
then a frame tears sideways in bands. It flickers — most frames are a mild wobble, then one goes
badly wrong.

**Strength** is 0 to 1 and it is a gate, not a ramp: the moment the window opens the static is at
that strength. **Start / End** are where in the cut it is on, as 0 to 1; an end of 1 keeps it on to
the end of the cut.

**Colour** is the chromatic fringe — the line splits, red to one side and blue to the other,
like a signal breaking up. It is a red and a blue silhouette of the ink laid behind the line and
shifted apart, so it works on black ink and on a white background, and it grows with the
tearing on a bad frame.

It is applied only where the layer has ink. Empty canvas stays empty, so it works on a transparent
background and in a PNG-sequence export, and the sway, the mask and the part's movement all act
on the glitched drawing. It began as an effect over the whole frame and was moved here for
exactly that reason: the noise should follow the lines, not shake the canvas.

## Boiling line

The wavy icon on a layer row, separate from the panel above. The strokes jitter in place, like a
hand-drawn line redrawn every frame — the traditional "boil". It is a per-layer setting rather
than an animation: it runs whether or not the film is playing, so you can see it while you draw.
