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
| `collectUsedBitmapIds` | Ids referenced by the strokes of a list of cuts. */ |
| `unusedBitmapIds` | Ids referenced by the strokes of a list of cuts. */ |

## `src/core/camera.js`

Camera moves: presets, drawn paths, and the transform they resolve to.

| | |
|---|---|
| `applyCamera` | No camera at all: the default, and what every existing project has. */ |
| `CAMERA_DEFAULT` | No camera at all: the default, and what every existing project has. |
| `CAMERA_PRESETS` | No camera at all: the default, and what every existing project has. */ |
| `computeCamera` | No camera at all: the default, and what every existing project has. */ |
| `resolveCamera` | No camera at all: the default, and what every existing project has. */ |
| `zoomForDrift` | The smallest zoom at which a camera may sit that far off centre without the frame running off the artwork. |

## `src/core/windowDrag.js`

Running a drag on window listeners, so it survives the pointer leaving the element.

| | |
|---|---|
| `dragOnWindow` | Listen for move until pointerup **or pointercancel**, then remove everything. Returns a stop function, which is also what a React effect wants as its cleanup. The cancel case is the one five hand-written copies all missed - a cancelled pointer never sends pointerup, so the move listener stayed for the session. |

## `src/core/cutClone.js`

Copying a cut, including the pixels its strokes point at.

| | |
|---|---|
| `cloneCutContents` | id; given the shared cache so it can return the same new id for a repeated old one |

## `src/core/cutOps.js`

Dragging and resizing cuts on the timeline, with snapping.

| | |
|---|---|
| `dragCut` | Edges a cut can snap to on a given track: zero, plus every other cut's start and end. */ |
| `resizeCut` | Edges a cut can snap to on a given track: zero, plus every other cut's start and end. */ |

## `src/core/cutsReducer.js`

Every change the document can undergo, as named actions. Build them with these creators - a mistyped action is then a type error rather than a silent no-op.

| | |
|---|---|
| `addCuts` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `assignPartTo` | — |
| `clearCut` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `cutsReducer` | ── the reducer ──────────────────────────────────────────────────────────── |
| `deleteText` | — |
| `deleteTrack` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `insertCutsShifting` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `mergeLayerDown` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `moveCutGroup` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `moveLayers` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `moveText` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `patchCut` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `patchCuts` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `removeBatch` | — |
| `renamePart` | — |
| `replaceBatchCuts` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `replaceCuts` | Replace the whole document: opening a file, undo/redo, starting over. |
| `setCutAnim` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `setCutCamera` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `setLayerAnim` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `toggleTextVisible` | — |
| `ungroupPart` | — |
| `updateCut` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `updateLayer` | Replace the whole document: opening a file, undo/redo, starting over. */ |
| `upsertText` | Replace the whole document: opening a file, undo/redo, starting over. */ |

## `src/core/historyOps.js`

Undo and redo, and the memory budget that bounds them.

| | |
|---|---|
| `canRedo` | — |
| `canUndo` | Steps affordable at this snapshot size. Exported for the tests and for anyone tuning it. */ |
| `HISTORY_LIMIT` | Steps affordable at this snapshot size. Exported for the tests and for anyone tuning it. */ |
| `limitFor` | The undo memory budget. Raising it is a deliberate decision, not a tuning knob. |
| `pushSnapshot` | Steps affordable at this snapshot size. Exported for the tests and for anyone tuning it. */ |
| `step` | Steps affordable at this snapshot size. Exported for the tests and for anyone tuning it. */ |

## `src/core/lassoOps.js`

Lasso selection: closing the path, bounding it, lifting the pixels.

| | |
|---|---|
| `applyResize` | Close a freehand path into a polygon. |
| `closeLassoPath` | Close a freehand path into a polygon. |
| `lassoBounds` | Close a freehand path into a polygon. |
| `MIN_SELECTION_SIZE` | Close a freehand path into a polygon. |

## `src/core/layerOps.js`

Layers: moving, merging, resolving which one a stroke lands on.

| | |
|---|---|
| `commitStroke` | True when `folderId` is `maybeChildId` itself or an ancestor of it. */ |
| `insertFill` | True when `folderId` is `maybeChildId` itself or an ancestor of it. */ |
| `isDescendantOf` | True when `folderId` is `maybeChildId` itself or an ancestor of it. |
| `mergeDown` | True when `folderId` is `maybeChildId` itself or an ancestor of it. */ |
| `moveLayer` | True when `folderId` is `maybeChildId` itself or an ancestor of it. */ |
| `offsetLayers` | True when `folderId` is `maybeChildId` itself or an ancestor of it. */ |
| `resolveDrawLayer` | True when `folderId` is `maybeChildId` itself or an ancestor of it. */ |

## `src/core/mediaReducer.js`

The audio and video tracks, as named actions.

| | |
|---|---|
| `clearAudio` | — |
| `clearMedia` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `clearVideo` | — |
| `clearVideoCuts` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `EMPTY_MEDIA` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. |
| `loadAudio` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `loadVideo` | — |
| `mediaReducer` | — |
| `moveTrack` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `resizeAudio` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `restoreMedia` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `setAudioClip` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `setAudioDuration` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `setVideoCuts` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |
| `setVideoOpacity` | Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */ |

## `src/core/numInput.js`

Typing into a number field without the value fighting the cursor.

| | |
|---|---|
| `clampNum` | Constrain n to the range, ignoring bounds that were not given. |
| `commitNumber` | Constrain n to the range, ignoring bounds that were not given. |
| `liveNumber` | Constrain n to the range, ignoring bounds that were not given. |

## `src/core/partOps.js`

Parts: groups of cuts made from an import or a selection.

| | |
|---|---|
| `assignPart` | Group cuts into parts, in timeline order. |
| `derivePartsFrom` | Group cuts into parts, in timeline order. |
| `deriveVideoBatches` | Group cuts into parts, in timeline order. |
| `removeVideoBatch` | Group cuts into parts, in timeline order. |
| `renamePartIn` | Group cuts into parts, in timeline order. |
| `ungroupPartIn` | Group cuts into parts, in timeline order. |

## `src/core/pathMotion.js`

Turning a drawn line into something that can be moved along smoothly.

| | |
|---|---|
| `pathLength` | Total length along a polyline. @param {{x:number,y:number}[]} pts @returns {number} |
| `preparePath` | Even out a drawn path before storing it. Pen points bunch up where the hand slowed, so animating along raw capture data replays the drawing speed instead of the drawn shape. |
| `resampleByLength` | Total length along a polyline. @param {{x:number,y:number}[]} pts @returns {number} */ |
| `smoothPath` | Total length along a polyline. @param {{x:number,y:number}[]} pts @returns {number} */ |
| `spacingRatio` | Total length along a polyline. @param {{x:number,y:number}[]} pts @returns {number} */ |

## `src/core/playbackStart.js`

Where playback begins when play is pressed.

| | |
|---|---|
| `playbackStartFrom` | — |

## `src/core/probeBackoff.js`

How often to re-check whether the API server is up.

| | |
|---|---|
| `nextProbeDelay` | Delay before the next probe, given how many have failed in a row. |
| `PROBE_BASE_MS` | — |
| `PROBE_MAX_MS` | — |
| `PROBE_QUICK_TRIES` | — |

## `src/core/projectAssets.js`

How each piece of a project is stored, and how it comes back.

| | |
|---|---|
| `audioExt` | A frame or media item goes out as a separate binary asset alongside a small JSON. */ |
| `frameLoad` | A frame or media item goes out as a separate binary asset alongside a small JSON. */ |
| `frameStorage` | Which of the three ways a frame is saved. A legacy entry with no Blob still embeds rather than being dropped. |
| `imageExt` | A frame or media item goes out as a separate binary asset alongside a small JSON. */ |
| `imageExtFromType` | A frame or media item goes out as a separate binary asset alongside a small JSON. */ |
| `STORE_ASSET` | A frame or media item goes out as a separate binary asset alongside a small JSON. |
| `STORE_BLOB` | A frame or media item goes out as a separate binary asset alongside a small JSON. */ |
| `STORE_DATAURL` | A frame or media item goes out as a separate binary asset alongside a small JSON. */ |
| `videoExt` | A frame or media item goes out as a separate binary asset alongside a small JSON. */ |

## `src/core/projectFormat.js`

Reading a saved project, including ones written by older versions.

| | |
|---|---|
| `makeLoadProgress` | Throttled progress for a load: no bar for a small project, at most a hundred repaints for a large one. |
| `migrateCuts` | What the app should look like after opening this project, with defaults for anything absent. */ |
| `projectSettings` | What the app should look like after opening this project, with defaults for anything absent. |

## `src/core/shortcuts.js`

Key bindings, and what a key event means.

| | |
|---|---|
| `DEFAULT_KEYS` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |
| `findConflicts` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |
| `KEY_LABELS` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |
| `keyOf` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |
| `loadKeymap` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |
| `matchShortcut` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |
| `TOOL_PREFIX` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |
| `toolFromAction` | Selecting a tool is a binding like any other, distinguished by this prefix so the handler can |

## `src/core/timeCode.js`

Formatting and parsing times.

| | |
|---|---|
| `fmt` | Seconds as mm:ss.cc, which is what the timeline shows and what parseClock reads back. |
| `parseClock` | Seconds as mm:ss.cc, which is what the timeline shows and what parseClock reads back. */ |

## `src/core/timelineZoom.js`

Timeline pixels to time, and zooming without the content sliding.

| | |
|---|---|
| `clampPps` | Width of the sticky track-label column, in px. Must match `.tl-track-label` in App.css. */ |
| `pinchZoom` | Width of the sticky track-label column, in px. Must match `.tl-track-label` in App.css. */ |
| `PPS_MAX` | — |
| `PPS_MIN` | fill the screen and scrolling becomes the only way to see anything. |
| `scrollToHold` | Width of the sticky track-label column, in px. Must match `.tl-track-label` in App.css. */ |
| `timeAtX` | Width of the sticky track-label column, in px. Must match `.tl-track-label` in App.css. */ |
| `TRACK_GUTTER` | Width of the sticky track-label column. Time zero is one of these in from the left edge, so every screen-x-to-time conversion needs it. Must match `.tl-track-label` in App.css. |
| `xAtTime` | Width of the sticky track-label column, in px. Must match `.tl-track-label` in App.css. */ |
| `zoomAnchored` | Zoom about a point. Returns null at the scale limits, so the caller leaves the scroll alone rather than recomputing from an unchanged scale. |

## `src/canvas/canvasUtils.js`

The drawing engine: strokes, canvases, animation, video frames. The big one.

| | |
|---|---|
| `accentSoft` | That keeps on-canvas furniture such as selection outlines and paths on the theme colour. |
| `ANIM_DEFAULT` | — |
| `applyEase` | The easing curves. Everything animated should go through this rather than its own. |
| `bucketFillTransparentRegion` | — |
| `CANVAS_W` | — |
| `computeCutAnim` | at rest (no transform), so callers can skip the save/transform fast-path. |
| `computeLayerAnim` | — |
| `computeTextAnim` | — |
| `cutDuration` | A cut's length in seconds, never zero - a cut can be dragged to zero length and everything that animates divides by it. |
| `cutProgress` | How far through a cut a moment is, 0 to 1, clamped. Animations are evaluated for cuts merely near the playhead, so times outside the cut are routine and extrapolating would overshoot. |
| `curveToWave` | The returned amp (px) is how far that curve actually swung, and is used as the default strength. |
| `dataURLToImageData` | — |
| `DEFAULT_CUT_DURATION` | — |
| `detectSceneCuts` | The presets in the order they should appear, as [group, fonts] pairs. |
| `dilateMask` | The presets in the order they should appear, as [group, fonts] pairs. |
| `dist` | — |
| `drawStrokesOnCtx` | — |
| `extractVideoFrames` | The presets in the order they should appear, as [group, fonts] pairs. |
| `fitRect` | Letterbox rect: fit source into destination preserving aspect ratio. |
| `flattenForCanvas` | — |
| `flattenLayersInUiOrder` | — |
| `FONT_PRESETS` | the app with no Japanese on screen downloads no Japanese. |
| `fontGroups` | The presets in the order they should appear, as [group, fonts] pairs. |
| `hexToRgb` | — |
| `imageDataCanvas` | A canvas holding an ImageData, ready to draw. `putImageData` ignores the transform, composite mode and alpha, so anything that scales or blends ImageData needs this. Reused - valid until the next call. |
| `imageDataToDataURL` | — |
| `LAYER_ANIM_DEFAULT` | — |
| `layerKey` | cross-cut collisions and an infinite cache-rebuild loop. |
| `morphFrames` | Filled with the A->B average ink colour; soft 1px edge. |
| `morphPrepare` | so the caller can update progress or yield to the UI between frames. |
| `morphSequence` | frame would be N times slower. |
| `pointInPolygon` | — |
| `safeArray` | Anything-to-array, for fields that older projects may not have at all. |
| `sampleKeys` | This is tweening in the original animation sense of the word. |
| `samplePath` | Sample a polyline path at normalized position s in [0,1]. |
| `sampleWave` | Samples the waveform cyclically over 0..1 with linear interpolation. |
| `sizeCanvas` | Resizes only when the size differs. Assigning `canvas.width` reallocates the backing store even when the value is unchanged - 8MB at 1920x1080, and the measured 79MB/s that ran the tab out of memory. |
| `strokeSig` | used to invalidate the layer canvas cache without stringifying the whole array. |
| `swayWeightAt` | bend one direction while the next bends back. |
| `targetCanvasFor` | two shapes people actually publish. |
| `TEXT_ANIM_DEFAULT` | - emphasis: a looping accent (pulse/shake/wave) |
| `triwave` | Triangle wave 0->1->0 (period 2); used for ping-pong path following. |

## `src/canvas/textRender.js`

Measuring and drawing text objects.

| | |
|---|---|
| `clampFontSize` | A text object as the document stores it. |
| `drawTextObject` | A text object as the document stores it. |
| `measureTextBox` | A text object as the document stores it. |
| `revealLines` | A text object as the document stores it. |
| `textFontOf` | A text object as the document stores it. |
| `textLineHeight` | A text object as the document stores it. |
| `textNeedsBox` | A text object as the document stores it. |

## `src/hooks/useTimelineGestures.js`

Every way the timeline can be pointed at, in one place.

| | |
|---|---|
| `useTimelineGestures` | — |

## `server/youtubeUrl.js`

Which addresses the importer will hand to yt-dlp.

| | |
|---|---|
| `isYouTubeUrl` | Parses rather than pattern-matches, because both obvious string checks are wrong in opposite directions. |
| `YOUTUBE_HOSTS` | Hosts yt-dlp is allowed to be pointed at. |
