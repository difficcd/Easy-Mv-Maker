# Getting started

The whole loop, once through: draw a frame, make the next one, play it, save it, export it. Ten
minutes. Everything else in this wiki assumes you have done this once.

## 1. Open it

`npm run dev` prints an address and a QR code. On a PC open the address; on a tablet on the same
Wi-Fi, scan the code. The app runs in the browser either way — a PC with a mouse is a perfectly
good place to work, and a tablet with a pen is the other one.

The screen is four areas: **tools and colour** on the left, the **canvas** in the middle, the
**cut / layer** panel on the right, and the **timeline** along the bottom. Press **Tab** to hide
every panel and leave just the canvas; Tab again brings them back exactly as they were.

## 2. Draw

Pick a tool on the left — the dot pen is the default — and draw.

- **Pen or mouse draws. A finger does not.** On a tablet one finger pans the canvas and two pinch
  to zoom; the palm resting on the screen is ignored. The ⟲ at the top right of the canvas resets
  the view.
- **Ctrl+Z** undoes, **Ctrl+Y** redoes — or **J** and **K**, single keys for the hand that is not
  holding the pen. Every stroke, fill and move is a step.
- The colour panel picks a colour; the recently used ones sit under it. The eyedropper takes one
  from the canvas.

Drawing goes onto the *active layer* of the *current cut*. A new project starts with one cut and
one layer, so at first you do not have to think about either.

## 3. Layers

**+ Layer** on the right adds one; drawing goes onto whichever is highlighted. A layer is for a
thing you want to move or hide on its own — a character on one, the background on another — and
for things you want to animate later (see [Part animation](Part-animation)).

The eye hides a layer. Drag rows to reorder them; a folder groups them.

## 4. The next frame

Two ways to get frame two:

- **Duplicate to next frame** (**Ctrl+D**) — a copy of this cut placed after it. Draw the change
  on the copy. This is how most frame-by-frame work goes: copy, adjust, copy, adjust.
- **Add cut** — an empty cut after this one.

Turn on **onion skin** — the ◀cut and cut▶ buttons on the timeline bar — to see the previous frame
in pale purple and the next in its own colours under what you are drawing. It is only ever a
drawing aid; it is never in the export.

Each cut has a length on the timeline. Drag its right edge to hold a frame longer; drag the cut to
move it. Two frames a second is a slow, readable animation; twelve is smooth.

**Tweening** fills the gap between this cut and the next with in-between frames, morphing one
drawing into the other. It works best when the two drawings are similar.

## 5. Play

▶ plays from the playhead; the loop button repeats. Drag the playhead to scrub — animations play
while you scrub, so you see the motion rather than static frames sliding by.

The speed control changes playback only; the export is always at normal speed. If you decide the
whole film should actually be faster or slower, the gear next to it bakes the speed in.

**Cut, part and camera animation only play while the film is playing.** While you draw, everything
sits still, so the pen lands where you aimed.

## 6. Save

The project is autosaved in the browser as you work — the top bar says so. That survives a
reload, but not clearing the browser's data, so save a file too:

**File → Save locally** writes a `.emv` file. **Ctrl+S** saves to wherever you saved last. With
the server running, **Save to the server** keeps projects in one place and backs them up every five
minutes; **File → Restore from a backup…** lists the backups.

## 7. Export

**Export** in the top bar. With a white background you get a video — MP4 or WebM, at 30 frames a
second, with the music if you loaded any. It is recorded in real time, so a one-minute film takes
one minute.

Switch the background to transparent (the button on the timeline bar) and the same button offers
a GIF or a PNG sequence instead. [Exporting](Exporting) says why.

## Where to next

- **[Part animation](Part-animation)** — moving a layer without redrawing it: the film icon on a
  layer row.
- **[Camera](Camera)** — pan, zoom, shake: the camera icon on a cut row.
- **[Importing video](Importing-video)** — frames to trace over, or a reference underneath.
- **Media → Load audio** for the music; the mute button on the timeline is for you, the export
  always has the sound.
- The **?** button in the top bar lists every shortcut and where each feature lives.
