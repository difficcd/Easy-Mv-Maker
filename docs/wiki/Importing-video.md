# Importing video

Two different things, and the dialog offers both because they are wanted for different reasons.

**Where:** Media → import a video file, or paste a YouTube link (the link route needs the local
server running, since the browser cannot fetch YouTube itself).

## As frames — for rotoscoping

The video is chopped into frame cuts you draw over, then the video is thrown away. This is the
one to pick when you are tracing.

**Frames a second.** How many cuts you get per second of video. Four is plenty for tracing; the
higher you go, the more cuts and the more memory — see [Working with a lot of
cuts](Working-with-a-lot-of-cuts).

**Scale.** Frames are shrunk on the way in. Half size is usually enough to trace from, and it is a
quarter of the memory.

**Quality.** Compressed WebP is the default and is small. High-quality WebP is near-lossless at the
original resolution. Lossless PNG keeps every pixel and is large — only pick it if you are going
to use the frames as-is rather than draw over them.

**Only a range.** Start and end in `mm:ss`, so a three-minute video does not become nine hundred
cuts when you wanted eight seconds of it.

**Merge duplicates.** Video has a lot of frames that are the same as the one before — a held
shot, a title card — and each one would otherwise be its own cut.

- *Exact* merges only pixel-identical frames. It checks a small signature first and then compares
  every byte, so it never merges two frames that differ at all. On this setting the only mistake
  it can make is *not* merging two frames a person would call the same, because compression noise
  made them differ by a few bytes.
- *Nearly the same* and *Loose* merge frames whose signature is within a threshold. More merging,
  fewer cuts, and the risk goes the other way.

A merged run becomes one cut held for that long, so the timing is preserved.

**Split into parts.** A long video comes in already grouped into parts, one every thirty seconds
or so; the dialog suggests a count from the video's length. Parts are what the split-and-rejoin
workflow works on.

**Canvas size.** Match the video, use the standard landscape or the vertical shorts size, or keep
whatever the canvas is now. A frame that is a different shape is fitted, not stretched.

**With the audio.** The video's own sound comes in as the music track, aligned to the first
imported frame and clipped to the range you took.

## As a reference track — for drawing alongside

The whole video is laid *under* your layers, playing along with the film, and never becomes cuts.
This is for reference or for a shot where the video is part of the picture.

It has an opacity, in the same settings as the camera, and it goes through the camera transform —
so a camera move moves the video with the drawing, which is what you want if it is part of the
shot.

## Scene detection

On a reference track, the app can find the cuts in the video — the moments where one shot
becomes another — and put markers on the timeline so you can jump between them. The threshold is
how big a change counts as a cut; lower finds more.

It runs in the background and can be stopped. If you open another project while it is running
the result is thrown away, because it describes a video that is no longer loaded.

## While it is working

Extracting frames takes a while for a long video. **Send to background** closes the dialog and
carries on in a corner chip — you can keep drawing. Opening a project, on the other hand, cannot
be done in the background, because it replaces the document you would be drawing on.

Recently imported videos are remembered for the session, so re-importing the same one with
different settings does not download it again.
