# Working with a lot of cuts

Past a certain number of cuts the app gets slow. If you are making something long, it is usually
easier to build it in pieces and join them at the end.

**This is advice, not a rule.** A short project should never be split. If what you are making is
running fine, keep going.

## Why it gets slow

Worth knowing, because it tells you how big a piece should be.

- **Frames are stored losslessly.** At the original-quality setting every imported frame is a PNG.
  That is genuinely a lot of data, not an inefficiency that could be tidied away.
- **The browser holds decoded bitmaps for whatever is near the playhead.** Decoded, not
  compressed — that is what makes scrubbing feel immediate, and it is also what fills memory.
- **It runs on your machine**, or on a free server tier. There is no big machine behind it.

So the limit is memory, and the thing that uses memory is *frames near the playhead*. A piece
should be small enough that the part you are working on fits comfortably; how many cuts that is
depends on your canvas size and whether your frames came from a video.

None of this is fixable by making the app cleverer. It is what the format costs.

## Splitting a project

**File → Split by part…**

Every part becomes its own `.emv`, packed into one zip. Each file opens on its own, so you can work
on one piece without the others being loaded at all.

If you have not grouped your cuts into parts yet: select the cuts you want together in the timeline
and use **Make a part from the selection**. A video import already arrives as its own part.

## Joining the pieces back up

**File → Export pieces as one…**

Pick the `.emv` files and they are painted, in order, into a single export.

Three things worth knowing about how it works, because they explain its limits:

- **Peak memory stays at one piece.** The queue opens each file in turn, paints its frames straight
  into the output, and closes it. That is the whole reason splitting helps — joining does not undo
  it by loading everything at once.
- **The frames come from the app's own paint path**, the same one playback uses. There is no second
  renderer that might disagree with what you saw.
- **The output is the size of the project you have open now.** It needs no lookahead, and it is a
  number you can see before you start. A piece made at a different size is fitted to it — so if
  your pieces are different shapes, open the one whose shape you want first.

Your current project is put back exactly as it was when the export finishes, undo history included.

## How big should a piece be?

There is no number, and anyone who gives you one is guessing. Judge it from the symptom: when
scrubbing starts to lag, or drawing stops feeling immediate, the piece you are in is too big.

A video import is a natural seam — it comes in as its own part, and the app suggests a part count
from the video's length when you import one.
