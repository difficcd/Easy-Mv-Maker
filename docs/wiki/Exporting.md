# Exporting

Three ways out, and which one you get is decided by the background setting on the timeline bar,
not by a menu.

## Video (opaque background)

**Export** in the top bar. The film is played back at 30 frames a second and recorded off the
canvas by the browser's own recorder, with the music mixed in if a track is loaded. MP4 where the
browser can make one, WebM otherwise — the file is named to match.

Two things worth knowing:

**It is a real-time recording.** The film plays while it records, so a two-minute film takes two
minutes to export. Frames are painted on a fixed grid rather than sampled off the screen refresh,
which is what stopped an earlier version stuttering, but it still cannot go faster than playback.

**The bitrate is set from the canvas size.** Left to the browser it picks the same ~2.5 Mbps
whatever the resolution, which starves a 1080p drawing — hard ink lines on flat colour are the
worst case for a starved encoder, and the edges grow noise. So it is asked for explicitly: about
7.5 Mbps at 1080p30, scaled by pixel count, less for VP9 which needs less. Files are roughly three
times the size of the old ones, and that is the trade.

**If the music is muted** while you draw, the export lifts the mute for the recording and puts it
back. The mute is for you, not for the film — a video with no music and nothing saying why would
be the worst way to find that out.

## GIF or PNG sequence (transparent background)

Switch the timeline's background to transparent and **Export** offers a GIF or a PNG sequence
instead of a video. Browsers cannot record a video with an alpha channel — the hardware encoder
they hand VP9 to above roughly 480p has no alpha, and the frames come back on black — so a
transparent project is exported a frame at a time rather than recorded.

That has an upside: every frame is painted deliberately and the export waits for anything still
decoding, so there are no dropped or duplicated frames.

- **GIF** — one file, capped at 720px on the long edge and 256 colours. That is what GIF is; it is
  not a limit of the app.
- **PNG sequence** — a zip of full-size lossless frames, numbered. This is what an editor wants for
  an overlay, and it is the only lossless path out.

The layer effects — mosaic and noise — come through on a transparent background: both work on
the layer's own pixels and leave empty canvas empty, so the overlay stays an overlay.

## Exporting several pieces as one

**File → Export pieces as one…** — for a project that was split to keep it fast. See
[Working with a lot of cuts](Working-with-a-lot-of-cuts) for what it does and why memory stays
flat.

## What is and is not in the export

- **Export** opens a small dialog with a start and an end. The defaults are the first cut to the
  end of the content — or, if the playhead is parked inside the film, from the playhead. Type
  a time as `mm:ss.cc` or use the buttons. Playback still starts where the content starts
  (which can be the music), so an intro before the first drawing plays while working but is not
  exported unless you ask for it.
- Cut animations, part animations, the camera, and every effect play in the export exactly as
  they do under ▶. If it looked right playing, it looks right exported; they go through the same
  paint path, on purpose.
- Onion skin is never exported. It is a drawing aid.
- The selection marquee, motion paths and other editing chrome are never exported.
- The reference video track *is* exported, at whatever opacity it is set to.
