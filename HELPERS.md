# What already exists

An index of every shared helper, so the next person does not write one that is already here.

It exists because that kept happening. `clearLiveOverlay` was reimplemented by hand in four
places while the real one sat two hundred lines below them; the timeline gutter width had seven
copies; the current-cut lookup had thirteen, under five names. None of that was carelessness — a
four-thousand-line component does not announce what it already has.

`scripts/helper-index.mjs` runs in `npm run check` and fails when a shared export is missing from
this file, or when a row here names something that no longer exists. A document nobody updates is
worse than none: it teaches you to distrust it, and then you stop looking.

Each row says what the helper is **for** and, where it matters, **what goes wrong without it** —
that second part is usually the reason it exists.

## `src/core/bitmapRefs.js`

Which stored bitmaps are still reachable, for garbage collection.

| | |
|---|---|
| `collectUsedBitmapIds` | Every bitmap id still referenced by anything that can bring it back: the cuts, the undo history, the cut clipboard, the lasso clipboard and the live selection. Freeing something an undo still needs is not a leak, it is an undo that comes back blank. |
| `unusedBitmapIds` | Ids present in the store that nothing references any more. |

## `src/core/camera.js`

Camera moves: presets, drawn paths, and the transform they resolve to.

| | |
|---|---|
| `applyCamera` | Put the camera onto a 2D context. The caller owns the save/restore. Reads as: move the origin to the middle of the frame, scale and tilt about it, then shift so the camera's centre is the thing sitting there. |
| `CAMERA_DEFAULT` | No camera at all: the default, and what every existing project has. |
| `CAMERA_PRESETS` | The fixed moves. Each returns the same shape a hand-drawn camera produces, so nothing downstream has to know which one it came from. Keyed by id; the label is a translation key resolved by the UI. |
| `computeCamera` | Where the camera is at a normalised time through the cut. |
| `resolveCamera` | Resolve a camera setting into the path and zoom range actually used. A drawn path wins over the preset's own, so somebody can pick "ken burns" for its zoom and then replace the movement without losing the zoom. |
| `zoomForDrift` | The smallest zoom at which a camera may sit that far off centre without the frame running off the artwork. |

## `src/core/clipping.js`

Clipping: a layer that only shows where the layer beneath it has paint.

| | |
|---|---|
| `canClip` | Whether the clip toggle would do anything. False only for the bottom layer, which has nothing to clip to. |
| `clipGroups` | Which layers clip to which base. A run of clipped layers all attach to the same base, and a clipped layer with nothing below it draws normally rather than vanishing. |

## `src/core/viewZoom.js`

How far the canvas view may be zoomed. It was in three places and they disagreed: pinch and the
wheel clamped to 0.25-8 while the buttons clamped to 0.1-16, so a pinch stopped where a button did
not, and one notch of the wheel snapped a 16x view back to 8x.

| | |
|---|---|
| `clampZoom` | Constrain a canvas zoom to the usable range, and turn anything that is not a number into 1 - a pinch divides by the starting finger distance, which can be zero, and a NaN zoom propagates into the view transform and blanks the canvas. |
| `ZOOM_MIN` | Below this the artwork is too small to place a stroke on. |
| `ZOOM_MAX` | Above this a single pixel fills a large part of the screen and panning is the only control left. |

## `src/core/windowDrag.js`

Running a drag on window listeners, so it survives the pointer leaving the element.

| | |
|---|---|
| `dragOnWindow` | Listen for move until pointerup **or pointercancel**, then remove everything. Returns a stop function, which is also what a React effect wants as its cleanup. The cancel case is the one five hand-written copies all missed - a cancelled pointer never sends pointerup, so the move listener stayed for the session. |

## `src/core/cutClone.js`

Copying a cut, including the pixels its strokes point at.

| | |
|---|---|
| `cloneCutContents` | A cut's layers, texts and active layer, copied for a new cut. Takes the bitmap cloner so the pixels come with it, sharing one cache so a bitmap used twice becomes one copy rather than two. |

## `src/core/cutOps.js`

Dragging and resizing cuts on the timeline, with snapping.

| | |
|---|---|
| `dragCut` | Drag a whole cut to a new start time and track. `dt` is the time delta from where the drag began; `trackOff` the track delta. |
| `resizeCut` | Drag one edge of a cut. `edge` is 'left' or 'right'. `initialStart`/`initialEnd` are the cut's bounds when the resize began. |

## `src/core/cutsReducer.js`

Every change the document can undergo, as named actions. Build them with these creators - a mistyped action is then a type error rather than a silent no-op.

| | |
|---|---|
| `addCuts` | Append cuts: a new cut, a tween, an imported video's frames. |
| `assignPartTo` | Action: put these cuts in a part, creating it with this name if it is new. |
| `clearCut` | Empty a cut's drawing and text, keeping its layers. |
| `cutsReducer` | ── the reducer ──────────────────────────────────────────────────────────── |
| `deleteText` | Action: remove one text object from a cut. |
| `deleteTrack` | Delete a track, closing the gap by pulling every track below it up one. |
| `insertCutsShifting` | Insert cuts at a point on a track, pushing everything later on that track along to make room. Duplicating a cut and filling a gap with tweened frames are the same operation. |
| `mergeLayerDown` | Flatten a layer into the one below it. |
| `moveCutGroup` | Move several cuts together, keeping their relative layout and staying in bounds. |
| `moveLayers` | Shift whole layers (and optionally the cut's texts) by a pixel offset. Bumps rev. |
| `moveText` | Move a text to an absolute position. |
| `patchCut` | Escape hatch: run a function over one cut. Prefer a named action. |
| `patchCuts` | Escape hatch: run a function over the whole list. Prefer a named action. |
| `removeBatch` | Action: delete every cut that came from one video import. |
| `renamePart` | Action: rename a part. |
| `replaceBatchCuts` | Replace the cuts imported from one video source with a fresh set. |
| `replaceCuts` | Replace the whole document: opening a file, undo/redo, starting over. |
| `setCutAnim` | Merge into a cut's animation, over the defaults. |
| `setCutCamera` | Merge into a cut's camera move. Passing null clears it, which is not the same as setting every field back to its default: the renderer skips the transform entirely when there is no camera object at all, and that is the state every existing… |
| `setLayerAnim` | Merge into a layer's animation, over the defaults. |
| `setLayerClipped` | Clip a layer to the one below, or stop. No rev bump - it changes how the layer is composited, not what is drawn on it. |
| `toggleTextVisible` | Action: show or hide one text object without deleting it. |
| `ungroupPart` | Action: dissolve a part, leaving its cuts where they are. |
| `updateCut` | Change fields on one cut (name, start/end time, track, activeLayerId). |
| `updateLayer` | Change fields on one layer. |
| `upsertText` | Add a text if it is new, otherwise update it in place. |

## `src/core/historyOps.js`

Undo and redo, and the memory budget that bounds them.

| | |
|---|---|
| `canRedo` | True when there is a step ahead of the current index to move to. |
| `canUndo` | Whether there is anything to step to. Index 0 is the original state, so undo needs 1 or more. |
| `HISTORY_LIMIT` | The old fixed cap, kept as the default when no size is known. |
| `limitFor` | The undo memory budget. Raising it is a deliberate decision, not a tuning knob. |
| `pushSnapshot` | Record a snapshot, returning the new list and position. The input is never modified, so the caller can keep the old pair if it wants to. |
| `step` | Step one snapshot back or forward. |

## `src/core/ids.js`

Ids for the things a document is made of. These were `Date.now()`, written out nineteen times, and
two of those sites had already worked the collision around by hand with `Date.now() + 1`.

| | |
|---|---|
| `nextId` | The clock, or one past the last id when the clock has not moved. Monotonic within a session, which is all that is needed, and still roughly the clock so ids keep sorting by when they were made. |
| `resetIds` | Reset the counter. For tests only, so one test's calls cannot change what another sees. |

## `src/core/lassoOps.js`

Lasso selection: closing the path, bounding it, lifting the pixels.

| | |
|---|---|
| `applyResize` | Resize a selection by dragging one of its handles. The handle names read as compass points, so which edges move falls out of the letters: 'nw' moves the top and left, 'e' moves the right edge alone. |
| `closeLassoPath` | Close a freehand path into a polygon. If the ends are far apart the path is left as drawn and joined back to the start, adding an edge. |
| `lassoBounds` | The pixel rectangle a lasso covers, clamped to the canvas. Returned as integers because it indexes into image data: the left and top round down and the right and bottom round up, so a region is never clipped by a fraction of a pixel. |
| `MIN_SELECTION_SIZE` | Smallest a selection may be dragged to, in pixels. Below this it is impossible to grab again. |

## `src/core/layerOps.js`

Layers: moving, merging, resolving which one a stroke lands on.

| | |
|---|---|
| `commitStroke` | Add a stroke to a layer and make sure it will be seen: the layer itself and every folder above it are forced visible. Returns { activeLayerId, layers }, or null if the layer is gone. The reveal is the point. |
| `insertFill` | Where a bucket fill belongs in a layer's stroke list. Paint goes *under* the ink. |
| `isDescendantOf` | True when `folderId` is `maybeChildId` itself or an ancestor of it. |
| `mergeDown` | Flatten a layer into the one below it. "Below" means the next drawable layer in UI order — folders are containers, not surfaces, so they are skipped as a target and refused as a source. |
| `patchLayer` | Replace one layer with a patched copy, leaving the rest alone. Eight call sites wrote the map out by hand; the guard inside it is not noise, because layer ids are unique within a cut and not across cuts, so it must only ever be handed one cut layer list. |
| `moveLayer` | Move `layerId` relative to `targetId`. `position` is 'before', 'after', or 'inside' (only meaningful when the target is a folder). Returns a new array, or null when the move is refused and the caller should change nothing. |
| `offsetLayers` | Shift whole layers, and optionally the cut's texts, by a pixel offset. This is what a move-everything drag commits. |
| `resolveDrawLayer` | Which layer a stroke should actually go into. The active layer is not always usable: it can be a folder, or point at something that no longer exists. |

## `src/core/mediaReducer.js`

The audio and video tracks, as named actions.

| | |
|---|---|
| `clearAudio` | Action: forget the audio track — the file, the url, the clip range, all of it. |
| `clearMedia` | Everything gone: a new project. |
| `clearVideo` | Action: forget the video overlay track. |
| `clearVideoCuts` | Throw away the detected scene markers without touching the video itself. |
| `EMPTY_MEDIA` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. |
| `loadAudio` | A piece of audio arrived. Its length is not known yet — the element reports that later. |
| `loadVideo` | Action: a video overlay arrived, with its position on the timeline already worked out. |
| `mediaReducer` | The reducer itself. Audio and video were five pieces of state that only ever moved together, and forgetting one left the app in a state it has no name for — a clip range pointing at audio that is gone. |
| `moveTrack` | Drag a track along the timeline, keeping its length. |
| `resizeAudio` | Drag one edge of the audio clip. The left edge also moves into the source. |
| `restoreMedia` | Restore both tracks at once, opening a project. |
| `setAudioClip` | Where the clip sits on the timeline, and which part of the source it plays. |
| `setAudioDuration` | The audio element has read the source and knows how long it is. |
| `setVideoCuts` | Scene-cut markers found by the detector, in video time. |
| `setVideoOpacity` | How strongly the overlay shows through, 0..1. A reference layer is usually wanted faint. |

## `src/core/numInput.js`

Typing into a number field without the value fighting the cursor.

| | |
|---|---|
| `clampNum` | Constrain n to the range, ignoring bounds that were not given. |
| `commitNumber` | The value to settle on when the field is left: unreadable text falls back to the old value. |
| `liveNumber` | The value to report while typing; null means "not a number yet, hold on". Intermediate states like "", "-", "." and "1e" hold rather than snapping to zero. |

## `src/core/partOps.js`

Parts: groups of cuts made from an import or a selection.

| | |
|---|---|
| `assignPart` | Put the given cuts in a part, taking them out of whichever one they were in. |
| `derivePartsFrom` | Group cuts into parts, in timeline order. |
| `deriveVideoBatches` | The same grouping for imported frame sets, which predate parts and are keyed separately. Kept apart from derivePartsFrom because an old project can have batches and no parts. |
| `removeVideoBatch` | Remove every cut of an imported frame set. This one really does delete. |
| `renamePartIn` | Rename a part, which means renaming it on every cut that belongs to it. |
| `ungroupPartIn` | Ungroup a part. The cuts stay exactly where they are and only lose their membership - this is not a delete, and confusing the two would be expensive. |

## `src/core/persist.js`

The small preferences that live in localStorage: which panels are open, the theme, recent colours.

| | |
|---|---|
| `readStored` | A stored preference, or the fallback. Returns the fallback for a key never written, for one that will not parse, and for a decoder that rejects what it found - so bad stored data cannot take the app down. |
| `writeStored` | Write a preference, or quietly do nothing. Failing to save which panel was open is not worth interrupting anybody over, and localStorage throws for reasons the user chose. |
| `jsonCodec` | JSON, for preferences that are objects or arrays. |
| `arrayCodec` | JSON that must decode to an array. A stored value of the wrong shape is treated as absent rather than handed to code that will index into it. |
| `onOffCodec` | A flag that defaults to on: only the literal `off` turns it off. |
| `oneZeroCodec` | A flag that defaults to off: only the literal `1` turns it on. Kept separate from onOffCodec because migrating either spelling would silently reset the preference for everyone who had set it. |
| `numberCodec` | A number, treating anything unparseable as absent. |

## `src/hooks/useStored.js`

| | |
|---|---|
| `useStored` | State that remembers itself in localStorage: reads once on first render, writes when it changes. Replaces nine hand-written read/write pairs, one of which had no try/catch at all. |

## `src/core/pathMotion.js`

Turning a drawn line into something that can be moved along smoothly.

| | |
|---|---|
| `pathLength` | Total length along a polyline. @param {{x:number,y:number}[]} pts @returns {number} |
| `preparePath` | Even out a drawn path before storing it. Pen points bunch up where the hand slowed, so animating along raw capture data replays the drawing speed instead of the drawn shape. |
| `resampleByLength` | Re-space a polyline so consecutive points are an equal distance apart. This is the whole trick. Afterwards, walking the array at a constant rate moves at a constant speed, which is what the animation loop already does. |
| `smoothPath` | Chaikin corner cutting: replace each point with two points a quarter in from its neighbours. |
| `spacingRatio` | How evenly spaced a path is: the longest gap between consecutive points divided by the mean. 1 is perfect. A raw hand-drawn path is usually somewhere past 5, which is the same thing as saying it would stutter. |

## `src/core/playbackStart.js`

Where playback begins when play is pressed.

| | |
|---|---|
| `playbackStartFrom` | Where pressing play should start from: the playhead if it is inside the range, otherwise the start of the range. The anchor lets a part play from its own beginning rather than the timeline's. |

## `src/core/probeBackoff.js`

How often to re-check whether the API server is up.

| | |
|---|---|
| `nextProbeDelay` | Delay before the next probe, given how many have failed in a row. |
| `PROBE_BASE_MS` | The delay between the first few probes, before the backoff starts doubling. Exported so the tests and the caller agree on the schedule. |
| `PROBE_MAX_MS` | The ceiling the doubling stops at, so a long outage does not become a probe an hour. |
| `PROBE_QUICK_TRIES` | How many probes go out at the base delay before doubling begins — a server restarting should be noticed quickly. |

## `src/core/projectAssets.js`

How each piece of a project is stored, and how it comes back.

| | |
|---|---|
| `audioExt` | The file extension for the audio track, from its dataURL. |
| `frameLoad` | How a bitmap read back from a saved project has to be loaded. Only drawing layers are decoded to ImageData up front, because those are the ones the user can still edit pixel by pixel. |
| `frameStorage` | Which of the three ways a frame is saved. A legacy entry with no Blob still embeds rather than being dropped. |
| `collectBitmaps` | Every bitmap the cuts reference, packed the way this kind of save wants them. The loop around frameStorage, which used to live in App.jsx where it could be read but never run. Encoders are injected because one needs FileReader and the other a canvas. |
| `imageExt` | The file extension for a frame bitmap. |
| `imageExtFromType` | The file extension for an image, from a Blob MIME type. |
| `STORE_ASSET` | A frame or media item goes out as a separate binary asset alongside a small JSON. |
| `STORE_BLOB` | Stored as a Blob in the object itself - only IndexedDB can persist that. |
| `STORE_DATAURL` | Embedded as a base64 dataURL, so the JSON is self-contained. |
| `videoExt` | The file extension for the video overlay, from its Blob MIME type. |

## `src/core/projectFormat.js`

Reading a saved project, including ones written by older versions.

| | |
|---|---|
| `makeLoadProgress` | Throttled progress for a load: no bar for a small project, at most a hundred repaints for a large one. |
| `migrateCuts` | Bring saved cuts up to the current shape. Written as spread-then-override so a field the file already has always wins, and adding a new default here can never overwrite real data in an existing project. |
| `projectSettings` | What the app should look like after opening this project, with defaults for anything absent. |

## `src/core/shortcuts.js`

Key bindings, and what a key event means.

| | |
|---|---|
| `DEFAULT_KEYS` | Bindings a user has not changed. Single keys, no modifiers: the other hand is on the pen. |
| `findConflicts` | Actions sharing a key, as { key: [action, ...] } — only the keys with more than one. With a binding per tool this stopped being hypothetical. |
| `KEY_LABELS` | What each binding is called in the settings panel. |
| `keyOf` | Render a key event as a string such as "ctrl+shift+k". |
| `keymapFrom` | A stored keymap with anything missing filled in from the defaults: a binding the user removed stays removed, one that never existed comes from the defaults or it would be unreachable. It no longer reads storage itself - that is readStored's job, and a second reader meant a second try/catch to keep in step. |
| `matchShortcut` | Which binding, if any, a combo triggers. Compared case-insensitively so a binding stored as "Ctrl+[" still matches; they are written lowercase now, but a shortcut saved by an older version is not going to be rewritten. |
| `TOOL_PREFIX` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can route it without a list of tool ids to keep in step with the toolbar. |
| `toolFromAction` | The tool a binding selects, or null if it is not a tool binding. |

## `src/core/timeCode.js`

Formatting and parsing times.

| | |
|---|---|
| `fmt` | Seconds as mm:ss.cc, which is what the timeline shows and what parseClock reads back. |
| `parseClock` | Read a typed time back into seconds. Accepts what a person is likely to type: "1:30", "1:02:03", or a plain number of seconds. |

## `src/core/timelineZoom.js`

Timeline pixels to time, and zooming without the content sliding.

| | |
|---|---|
| `clampPps` | Pixels per second, clamped to the usable range. Not a number field: an unclamped value from a pinch is a timeline nobody can grab. |
| `pinchZoom` | The same thing for a pinch, which scales from where the fingers started rather than from the current value - accumulating a factor per move event would drift. |
| `PPS_MAX` | Above three hundred pixels a second a few seconds fill the screen and scrolling is the only way to see anything. |
| `PPS_MIN` | Below ten pixels a second the cuts are too small to grab. |
| `scrollToHold` | Scroll position that puts a time back under a point on screen. Never negative: scrolling before the start is not a place the timeline can be, and asking for it once left the first track label overlapping the ruler. |
| `timeAtX` | The time under a point, given where the timeline is scrolled to. |
| `TRACK_GUTTER` | Width of the sticky track-label column. Time zero is one of these in from the left edge, so every screen-x-to-time conversion needs it. Must match `.tl-track-label` in App.css. |
| `xAtTime` | Where a time sits, as a content x - what the playhead's `left` is set to. |
| `zoomAnchored` | Zoom about a point. Returns null at the scale limits, so the caller leaves the scroll alone rather than recomputing from an unchanged scale. |

## `src/canvas/canvasUtils.js`

The drawing engine: strokes, canvases, animation, video frames. The big one.

| | |
|---|---|
| `accentSoft` | That keeps on-canvas furniture such as selection outlines and paths on the theme colour. |
| `ANIM_DEFAULT` | A cut animation with nothing turned on. Every field is present, so a stored animation never has to be merged against a shape that might be missing keys. |
| `applyEase` | The easing curves. Everything animated should go through this rather than its own. |
| `bucketFillTransparentRegion` | Flood fill across the transparent region under a point, with a tolerance and an optional spread so the fill creeps under the anti-aliased edge of a line instead of leaving a halo. |
| `CANVAS_W` | The document's pixel size, 1920x1080. The canvas element is scaled by CSS; drawing coordinates are always these. |
| `applyCutAnim` | Put a cut animation onto a context; the caller owns the save/restore. Written out at both places that draw a cut - the artwork and the text over it - and if the two disagreed about the pivot, an animation would slide a text off its own drawing. |
| `computeCutAnim` | A cut's animation at a given absolute time. Returns null when the cut is at rest, so callers can skip the save/transform entirely rather than applying an identity one. |
| `computeLayerAnim` | A layer (part) animation resolved to one instant: the offset, rotation, scale, alpha and sway to draw it with. |
| `computeTextAnim` | A text animation resolved to one instant. Returns the entrance, exit and emphasis values, how much of the string is revealed, and — when the characters own the entrance — the progress they divide between them. |
| `textAnimStep` | What one entrance or exit contributes at eased presence `e`. Shared so a staggered character cannot move differently from the block it belongs to. `dir` is +1 entering, -1 leaving, and only the vertical motions read it. |
| `charAnimAt` | One character's share of a staggered entrance. The whole of that character's entrance, not something added on top of the block's - `computeTextAnim` leaves the block at rest when a stagger is set. |
| `charFxAt` | Where one character is coming from, on top of whatever entrance is playing: scatter, drop, zigzag, spin, pop. This is what makes typing read as characters arriving separately rather than a line sliding in as one, and it is an entrance in its own right - no block entrance need be chosen. |
| `charNoise` | A stable pseudo-random value for one character. Stable is the point: Math.random would give a character a new direction every frame and the text would boil. |
| `cutDuration` | A cut's length in seconds, never zero - a cut can be dragged to zero length and everything that animates divides by it. |
| `cutProgress` | How far through a cut a moment is, 0 to 1, clamped. Animations are evaluated for cuts merely near the playhead, so times outside the cut are routine and extrapolating would overshoot. |
| `curveToWave` | The returned amp (px) is how far that curve actually swung, and is used as the default strength. |
| `dataURLToImageData` | Decode a dataURL back to pixels. The synchronous counterpart of imageDataToDataURL, for the stored bitmaps a project restores. |
| `DEFAULT_CUT_DURATION` | How long a new cut lasts, in seconds. |
| `detectSceneCuts` | Find where a video changes scene, by stepping through it and comparing frames. Refines each hit to the exact boundary, reports progress, and can be stopped part way. |
| `dilateMask` | Grow a bitmask outwards by r pixels (square structuring element, done separably so it stays O(w*h) whatever r is). Used to bleed a bucket fill under the line that bounds it. |
| `dist` | Distance between two points. |
| `drawStrokesOnCtx` | Draw a list of strokes onto a context: the one place that knows what each tool looks like. Clears first unless told not to, and takes the boiling options so a roughened layer draws its own phase. |
| `openVideoFile` | Open a video file for frame-by-frame reading: the element, its duration, a clamped seek and a release. Both readers set one up the same way and tore it down the same way, and two copies of an object URL's lifetime is two chances to leak one. |
| `seekTarget` | Where a seek should land. Never the very last frame: seeking to exactly the duration fires no `seeked` event in some browsers, so the promise waiting for one never settles and the import stops halfway with no error. |
| `extractVideoFrames` | Pull frames out of a video file at a given rate, optionally over a range, scaled, encoded as WebP or PNG, with near-duplicate frames merged. Reports progress and can be stopped part way. |
| `fitRect` | Letterbox rect: fit source into destination preserving aspect ratio. |
| `flattenForCanvas` | The layers to draw, bottom first, with folders resolved and hidden branches dropped. |
| `flattenLayersInUiOrder` | The layer tree flattened the way the panel shows it, so an index in the list means the same thing to the UI and to the renderer. |
| `FONT_PRESETS` | the app with no Japanese on screen downloads no Japanese. |
| `fontGroups` | The presets in the order they should appear, as [group, fonts] pairs. |
| `hexToRgb` | A #rrggbb string as {r, g, b}. |
| `imageDataCanvas` | A canvas holding an ImageData, ready to draw. `putImageData` ignores the transform, composite mode and alpha, so anything that scales or blends ImageData needs this. Reused - valid until the next call. |
| `imageDataToDataURL` | Encode pixels as a dataURL, through a reused canvas — allocating one per call is the trap sizeCanvas exists for. |
| `LAYER_ANIM_DEFAULT` | A part animation with nothing turned on, every field present for the same reason ANIM_DEFAULT has them. |
| `layerKey` | The cache key for one baked layer. Keyed per (cut, layer) because layer ids are **not** unique across cuts - each cut numbers from 1 - and keying by layer id alone caused cross-cut collisions and an infinite cache-rebuild loop. |
| `morphPrepare` | Morph the pixel distribution of one frame into another by interpolating signed distance fields, so the shape moves and grows rather than one crossfading into the other. Computes the fields once and returns a function that makes a single in-between frame, which is what lets the tweening dialog show progress and yield between frames. |
| `pointInPolygon` | Whether a point is inside a polygon, by ray casting. What decides if a lasso caught something. |
| `safeArray` | Anything-to-array, for fields that older projects may not have at all. |
| `sampleKeys` | This is tweening in the original animation sense of the word. |
| `samplePath` | Sample a polyline path at normalized position s in [0,1]. |
| `sampleWave` | Samples the waveform cyclically over 0..1 with linear interpolation. |
| `sizeCanvas` | Resizes only when the size differs. Assigning `canvas.width` reallocates the backing store even when the value is unchanged - 8MB at 1920x1080, and the measured 79MB/s that ran the tab out of memory. |
| `scratchCanvas` | A full-size scratch canvas kept in a ref: allocated once, then sized and cleared for reuse. Three places in the composite path did this by hand and disagreed about the clear - two cleared after a resize, which the resize had already done. Reuse is not a micro-optimisation here: a fresh canvas is 8MB per masked layer per frame. |
| `strokeSig` | A cheap change signature for a layer's strokes, used to invalidate the layer canvas cache without stringifying the whole array. Sound because strokes here are only ever appended or replaced. |
| `layerSig` | The cache key for one baked layer canvas. Two caches use it and compare their keys against each other, so for a layer that is not boiling both forms must come out byte-identical - otherwise every such layer misses the cache and is redrawn every frame, with no visible symptom. |
| `swayWeightAt` | How much a point along the axis sways, interpolated smoothly between the control weights. Zero holds a point still; a negative weight bends it the other way, so one stretch can bend one direction while the next bends back. |
| `targetCanvasFor` | Which canvas a video import should land in. A vertical clip dropped into a landscape canvas is mostly empty margin, so the import can match the source instead, or be pinned to one of the two shapes people actually publish. |
| `TEXT_ANIM_DEFAULT` | - emphasis: a looping accent (pulse/shake/wave) |
| `triwave` | Triangle wave 0->1->0 (period 2); used for ping-pong path following. |

## `src/canvas/textLayout.js`

Where each character of a line goes, for curving and for animating characters separately.

| | |
|---|---|
| `layoutLine` | Per-character position and angle along an arc. The straight path is left alone on purpose: drawing character by character gives up the font's kerning and shaping, so this is the cost of curving rather than something every text pays. |
| `charProgress` | One character's own 0..1 when they are staggered. `spread` is capped below 1, because spending the whole duration on starts leaves the last character no time to move. |

## `src/canvas/textRender.js`

Measuring and drawing text objects.

| | |
|---|---|
| `clampFontSize` | Font size, clamped to what the editor allows. Three call sites relied on the same clamp. |
| `drawTextObject` | Draw one text object. The order matters and is not arbitrary: the animation transform has to be established before the static rotation so the two compose about the same centre; the background box is painted before the glyphs so it sits behi… |
| `measureTextBox` | The rectangle a text occupies, in canvas coordinates. |
| `revealLines` | Split text into the lines to draw, revealing only the first `chars` characters. `chars` of null means no typing effect and the whole string is drawn. |
| `textFontOf` | The CSS font string, in the order the canvas shorthand requires: style, weight, size, family. |
| `textLineHeight` | Baseline-to-baseline distance for stacked lines. |
| `textNeedsBox` | Whether this text has to be measured before it can be drawn. Measuring costs a measureText per line, so it is skipped for plain text. |

## `src/hooks/useHistory.js`

Undo and redo: the wiring around `historyOps`, kept out of App.

| | |
|---|---|
| `useHistory` | Records the document when it changes, unless `shouldSkip()` says a gesture is in progress. Returns `undo`, `redo`, a stable `record` for callers that choose their own moment, and `entries()` for the bitmap GC - a snapshot keeps pixels reachable, and freeing those is an undo that comes back blank. |

## `src/hooks/usePlayback.js`

The playback clock: one rAF loop driving canvas, playhead, audio, video and the prefetcher.

| | |
|---|---|
| `usePlayback` | Owns `isPlaying`, `currentTime` and the four refs the loop reads instead of state. Returns those plus `playPause` and `stop`. Export runs through the same loop, at real time whatever speed is selected. |

## `src/engine/evaluateFrame.js`

What the frame looks like at time t, before anything is drawn.

| | |
|---|---|
| `evaluateFrame` | Resolves the document to a scene: which cuts, their animation, their layer groups, their texts, and the camera. Pure and canvas-free. The renderer walks the result instead of working it out mid-draw, which is what removed `computeCutAnim` being called twice per cut per frame. |

## `src/engine/pendingBitmaps.js`

Which pasted bitmaps a frame needs but does not have decoded yet.

| | |
|---|---|
| `bitmapPending` | Whether a bitmap is known but not yet drawable. The four-term predicate four places wrote out separately; the cost of them disagreeing is a blank layer cached under a signature that says it is complete. |
| `scanLayerBitmaps` | One layer split into what it can and cannot draw yet. The decoded half is only the ImageBitmaps, because that is the form the LRU evicts and so the only one worth touching. |
| `pendingBitmapIds` | Playback asks so it can hold the last frame instead of flashing a half-drawn one; the frame exporter asks so it can wait for the decode. Both used to be the same nested loop written twice. |

## `src/engine/selectCuts.js`

Which cuts a frame is made of. The first piece of the scene engine: playback, scrubbing, export,
thumbnails and onion skin should all describe a frame the same way.

| | |
|---|---|
| `cutsAt` | The cuts playing at a moment, bottom track first. Half-open, so two cuts that touch never both claim the instant between them. |
| `visibleCutsAt` | What to draw, which is not the same question: while paused it also includes the cut being edited, or clicking a cut and finding a blank canvas becomes normal. |
| `onionNeighbours` | The cuts either side on the **same** track. `next` starts at `endTime`, because cuts abut and a strict comparison would find nothing in the common case. |
| `topCutAt` | The cut the playhead selects: topmost of those it is over, since the upper tracks are what a click would land on. |

## `src/hooks/useAutosave.js`

Debounced background saving, so a refresh or a crash never costs work.

| | |
|---|---|
| `useAutosave` | Saves `doc` after a quiet period. Waits for `ready()` - crash recovery has to decide first, or a new empty document overwrites the autosave the user is about to be offered - and skips while `busy()`. Failures come back as `error` rather than being swallowed. |

## `src/hooks/useServerProbe.js`

Whether the project-storage API is reachable, re-checked with a backoff.

| | |
|---|---|
| `useServerProbe` | Polls with `nextProbeDelay` backoff and resets on window focus. Checking only once was the original bug: a server that was down at load stayed "down" all session, so the menus never rendered and clicking did nothing. |

## `src/hooks/useTimelineGestures.js`

Every way the timeline can be pointed at, in one place.

| | |
|---|---|
| `useTimelineGestures` | Pointer handling for the timeline: dragging cuts, resizing them, panning, and pinch zoom. One place, because seven copies of the gutter maths is where the dead wheel zoom came from. |

## `server/rateLimit.js`

A token bucket, so one caller cannot use the whole server.

| | |
|---|---|
| `createRateLimiter` | Bucket rather than fixed window - a window lets a caller spend the whole allowance at the end of one and again at the start of the next. Evicts least-recently-seen callers, so the table is not itself a way to exhaust memory. |
| `rateLimit` | Express middleware around a limiter. Keyed by IP, which is a brake on accidents and casual abuse, not access control. |

## `server/youtubeUrl.js`

Which addresses the importer will hand to yt-dlp.

| | |
|---|---|
| `isYouTubeUrl` | Parses rather than pattern-matches, because both obvious string checks are wrong in opposite directions. |
| `YOUTUBE_HOSTS` | Hosts yt-dlp is allowed to be pointed at. |

## `src/export/download.js`

Handing a finished file to the browser. Written three times over - the project save's fallback,
the frame/GIF export and the screen recording - and two of the three never revoked the object URL,
which pins the whole Blob for the life of the page.

| | |
|---|---|
| `downloadBlob` | Save a Blob to the user's downloads under a given name. Revokes the URL on a delay, because the click only starts the download and revoking mid-read cancels it. |

## `src/export/gif.js`

A GIF89a encoder, because a transparent animation is what was asked for and no browser API makes
one: MediaRecorder loses the alpha channel above about 480p, and WebCodecs reports `alpha: 'keep'`
unsupported for every codec it offers.

| | |
|---|---|
| `encodeGif` | Assemble an animated GIF. Each frame carries its own palette, and disposal 2 is what stops a transparent animation smearing the previous frame through the gaps. |
| `buildPalette` | Colours actually used, exact while they fit in 255. Past that the least-used fold into their nearest neighbour, which suits a drawing of flat colour plus anti-aliasing. |
| `toIndices` | One frame as palette indices, with slot 0 for anything under the alpha cutoff. |
| `lzwEncode` | GIF's variable-width LZW, including the clear code when the table fills - a decoder that did not expect it would read garbage from the first full table on. |
| `paletteBits` | The bit width for a colour table of a given size, never below the 2 GIF requires. |

## `src/export/zip.js`

A store-only ZIP writer, for the PNG frame sequence a transparent project exports as.

| | |
|---|---|
| `makeZip` | Builds the archive in memory. Store-only because PNGs are already deflated, which keeps this pure arithmetic that unit tests can check without a browser. Refuses zip64-sized input rather than writing a wrong header. |
| `crc32` | The checksum ZIP entries carry. Table built on first use. |
| `dosDateTime` | Packs a `Date` into the two 16-bit fields the format stores. Clamps below 1980 instead of writing a negative year. |
| `frameName` | `frame_0007.png`, padded so alphabetical order is also frame order - which is how editors import a sequence. |
