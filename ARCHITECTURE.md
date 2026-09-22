# Architecture map (read this before editing — saves grep/read passes)

> **Looking for a helper? [HELPERS.md](HELPERS.md) lists all of them.** Check there before
> writing one — `clearLiveOverlay` was reimplemented four times while the real one sat two
> hundred lines away, and the timeline gutter width had seven copies. `npm run check` fails when
> a shared export is missing from that index, so it cannot quietly go out of date.

Frame-by-frame MV/animation app. Vite + React 19. Capacitor wraps it for Android.

## Files

App.jsx is around 2,400 lines and shrinking; it is mostly wiring now — which hook owns what, and
which component gets which props. **Put new pure logic in a module, not in App.jsx** — anything
that is a function of its arguments belongs next to its tests. See [#234] for where the rest of
App is going and why.

The folders say what a file is allowed to touch, which is the quickest way to know where
something belongs:

```
src/
  App.jsx  main.jsx  i18n.js  db.js  *.css      the component, boot, strings, storage
  core/     pure logic — no React, no DOM, no canvas. Every file here has tests.
  engine/   what a frame *is* at time t. Pure; no canvas.
  canvas/   drawing. Pure apart from the 2D context it is handed.
  tools/    what each drawing tool does on pointer down and move.
  export/   turning the timeline into a file: zip, gif, the recorder.
  ui/       components.
  hooks/    React hooks that wire state to behaviour.
test/       one file per module, same name
```

Two of those are newer than the rest and worth knowing about before you go looking in App:

**`engine/` and `canvas/` are the two halves of drawing a frame.** `evaluateFrame(cuts, t, …)`
works out what the frame *is* — which cuts, their animation, their layer groups, texts, camera —
with no canvas involved and tests over it. `canvas/sceneRender.drawScene` then draws that answer.
`paintFrame` in App is the two calls plus the parts that genuinely need the live canvas.

**`tools/canvasTools.js` is one entry per drawing tool**, each `{down, move}` over a context
object App assembles per event (`toolCtx`). Adding a tool is adding an entry, and the context is
the list of what a tool may touch.

A file in `core/` importing React or reaching for `document` is the sign it is in the wrong
folder — or that the part which needs them should stay behind in the component and be passed in.
That is how `measureTextBox` takes a context and `cloneCutContents` takes a bitmap copier. The
keymap went one better: `keymapFrom` takes a value that has already been parsed and does not
know storage exists at all, because reading it is `useStored`'s decoder.

- `src/App.jsx` — the `App()` component: state, handlers, JSX. Use the section map below to jump.
- `src/i18n.js` — `tr()` plus the English dictionary. Korean source text is the lookup key, so
  write UI strings in Korean and add the English to the dictionary. Called `tr`, not `t` — `t` is
  a local variable in dozens of places.
- `src/db.js` — IndexedDB autosave (`saveAutosave`, `loadAutosave`, plus project CRUD).

**core/** — pure logic, all of it tested, all of it TypeScript (the first folder converted; the
shapes the modules share are in `types.ts`, and the document's own are declared in
`src/document.d.ts`).

- `cutsReducer.js` — **every change to the document goes through here.** `cuts` is a `useReducer`
  and the actions are built by exported creator functions (`updateCut`, `upsertText`,
  `moveLayers`, …) rather than object literals, so a mistyped action is a type error rather than
  a silent no-op. Adding a mutation means adding an action, not a lambda — `patchCut`/`patchCuts`
  exist only as "this has not been given a name yet". Invariants live here too: `moveLayers`
  bumps `rev` so the canvas cache cannot go stale.
- `layerOps.js` — layer tree and stroke placement: `moveLayer` (drag/drop, refuses cycles),
  `resolveDrawLayer` + `commitStroke` (**the rules behind "the line I drew disappeared"**),
  `insertFill` (paint goes under the ink), `offsetLayers` (move-everything commit, bumps `rev`).
- `cutOps.js` — `dragCut`, `resizeCut` on the timeline, with snapping.
- `partOps.js` — parts (scenes): `derivePartsFrom`, `deriveVideoBatches`, and the group/rename/
  ungroup operations. A part's time range is recomputed, never stored, or it drifts when a cut moves.
- `lassoOps.js` — `closeLassoPath`, `lassoBounds`, `applyResize` (selection handles).
- `cutClone.js` — copying a cut: renumbers layer ids and copies stroke pixels, or the duplicate
  aliases the original.
- `projectFormat.js` — opening a saved file: `migrateCuts` (**format history lives here**),
  `projectSettings`, `makeLoadProgress`.
- `historyOps.js` — undo/redo. `pushSnapshot` sizes how far back it reaches by memory rather than
  a step count, since a snapshot copies the whole document.
- `shortcuts.js` — `DEFAULT_KEYS`, `KEY_LABELS`, `keyOf`, `matchShortcut`, `keymapFrom`, `findConflicts`.
- `timeCode.ts` — `fmt` / `parseClock` for the timeline clock. The first module in TypeScript (#268).
  The leaf modules followed; the shapes they share (`Point`, `PressurePoint`, `Size`, `TimeSpan`)
  live in `types.ts`, grown only as a module needs them.
- `numInput.js` — the rules behind a number field that can be typed into.
- `bitmapRefs.js` — `collectUsedBitmapIds` / `unusedBitmapIds`. Every reference source is named in
  one place; miss one and the collector frees pixels undo or paste still needs.
- `playRange.js` — where the content starts and ends. Playback, the dimming and both exports use
  this one answer, so what you watch is what comes out.
- `frameExport.js` / `exportQueue.js` — the size, rate and frame count a frame export comes out
  at, and the per-piece range for the multi-file queue.
- `recordClock.js` — the fixed frame grid a video recording is painted on (#156).
- `catmullRom.js` — the spline behind the curve ruler; passes through every anchor.
- `colour.js` — `withAlpha`, which replaces an existing alpha rather than appending a second one.
- `liquify.js` — `pushAlong`, the forward warp the liquify brush applies.
- `document.js` / `cutSelection.js` / `keyframes.js` — making a cut, which cuts a click selects,
  and animation keys.
- Animation, in one place per kind (they used to share `canvas/canvasUtils.js`): `cutTime.js`
  (`cutDuration`, `cutProgress`), `easing.js` (`applyEase`, `SWING`/`swing`, `effectAt`,
  `samplePath`), `cutAnim.js` (`computeCutAnim`), `layerAnim.js` (`computeLayerAnim`,
  `LAYER_ANIM_DEFAULT`), `sway.js`, `textAnim.js` (`computeTextAnim`), `keyframes.js`
  (`sampleKeys`). `layerTree.js` reads a cut's layers: order, cache keys, signatures.
  `canvasSize.js` holds `CANVAS_W/H` and `targetCanvasFor`; `fonts.js` the text fonts;
  `geometry.js` and `colour.js` the small helpers.

**engine/** — what a frame *is*, with no canvas anywhere near it. TypeScript; `Scene`,
`EvaluatedCut` and `EvaluatedGroup` in `evaluateFrame.ts` are the renderer's whole input, named.

- `evaluateFrame.js` — `evaluateFrame(cuts, t, opts)` returns the resolved scene at time `t`:
  which cuts, their animation, their layer groups, their texts, the camera. This is the entry
  point the render path was aiming at; `paintFrame` and the frame export both call it.
- `selectCuts.js` — which cuts a frame is made of, and the onion-skin neighbours.
- `pendingBitmaps.js` — which bitmaps a frame needs that are not decoded yet.

**canvas/**

- `strokes.js` — strokes become pixels: `smoothPoints` (resample → Chaikin → Catmull-Rom, with a
  spline pass first for sparse input), the boiling line, and `drawStrokesOnCtx` for every brush.
- `scratch.js` — `sizeCanvas`, `scratchCanvas` (one canvas per plain `{current}` ref),
  `imageDataCanvas`, `resetCtx`.
- `fill.js` — `bucketFillTransparentRegion`, `dilateMask`. `imageCodec.js` — ImageData ⇄ data URL.
- `videoFrames.js` — `extractVideoFrames`, `detectSceneCuts`, `fitRect`. `morph.js` — the
  distance-field morph behind tweening.
- `textRender.js` — measuring and drawing text: `measureTextBox`, `textNeedsBox`, `revealLines`
  (typing), `drawTextObject`. Line breaking is `textLayout.js`.
- `framePaint.js` — `paintFrameOnto`: one frame of the film onto the main canvas, every pass in
  order, with the scratch it keeps between frames (`createFrameScratch`). App's `paintFrame` is a
  thin callback over it.
- `sceneRender.js` — `drawScene`, the other half of `engine/evaluateFrame`: it draws the answer
  and decides nothing. Also the video reference, the onion skin and the scene's texts.
- `layerComposite.js` — one layer onto the frame, with its clip group and opacity.
- `bitmapStore.js` — the pixels behind fill / lasso / paste strokes: store, decode, clone, trim.
  The Map is `bitmapStoreRef`; this owns it.
- `pixelEffects.js` — the mosaic and the blur brush: `regionBounds`, `rectBounds`, `mosaic`,
  `blurMaskedRegion`. The first three are pure and tested.
- `marquee.js` / `editChrome.js` — the lasso loop while it is drawn, and everything drawn *over*
  a frame to show what is selected: the selection box, the handles, the motion path, the curve
  anchors, the mosaic rectangle. All sized in screen pixels (divide by `view.zoom`), or they
  shrink until they cannot be grabbed.
- `warpRender.js` / `shearSlices.js` / `swayRender.js` — a selection's rotate/skew/bend outline,
  the slice stack that draws a sheared bitmap, and the sway deformation.

**styles/** — the stylesheets, one per area (top bar, toolbar, canvas, the cut/layer panel, the
timeline, the colour panel, touch, …), imported in their original cascade order by
`styles/index.css`. The order is load-bearing: some rules override others by position alone.

**ui/** — everything App used to return inline. Panels: `AnimPanels.jsx` (`CutAnimPanel`,
`LayerAnimPanel`, `JitterPanel`), `CutLayerPanel.jsx` + `LayerRows.jsx`, `ColorPanel.jsx`,
`ToolsPanel.jsx`, `Timeline.jsx`, `TopBar.jsx`, `TextEditor.jsx`, `SwaySpine.jsx`. Dialogs: one
file each under `ui/dialogs/` (settings, help, video import, scene detect, export range, link
prompt, tool keys, project picker, progress overlay), all over `Modal.jsx`. And the chrome:

- `CanvasStage.jsx` — the scrolling area, the zoomed stage, and the two canvases. There are two
  because the lower one is the document and the upper one is whatever the pointer is doing right
  now; drawing the second onto the first would repaint the scene at pointer rate. `canvasCursor`
  is here too, and the order of its checks is load-bearing.
- `PanelDock.jsx` — where a panel is, as against what it contains. App builds the three panels
  once and hands them over as `panelEls`, which is what lets one be dragged between the docks
  and a floating window without being rebuilt.
- `DocTabs.jsx` — the project tabs, and the mode bar that floats over them as a pill.
- `Notices.jsx` — the background chips, the frame-extraction chip, the failure banner. None of
  them stops the work underneath; that is the rule they share.
- `NumField.jsx` — **use NumField for any new numeric field.**

**hooks/** — state that belongs together, lifted out of App so its wiring is somewhere with a
name. Each takes what it cannot own as arguments, and the rule for what it cannot own is the same
every time: `buildData` reads most of App's state and `restore` writes most of it, so a hook that
needs a document takes those two functions rather than the document.

- `useTimelineGestures.js` — every way the timeline can be pointed at (ruler scrub, marquee,
  middle-click pan, one-finger pan/tap, two-finger pinch) in one place.
- `usePlayback.js` — the playback clock: the rAF loop, and the audio and video it drags along.
- `useHistory.js` — undo and redo. Snapshots the document on change; the arithmetic is in
  `core/historyOps`.
- `useAutosave.js` — saving to IndexedDB in the background, debounced, skipped mid-gesture.
- `useLocalDocuments.js` — the document on this machine: `.emv` files, IndexedDB projects, crash
  recovery, and the tabs that hold several at once.
- `useServerStorage.js` — projects on the local API server, and the rotating backups of them.
- `useServerProbe.js` — is that API there? Backs off rather than retrying forever.
- `usePanelLayout.js` — where the panels are docked and how wide they are. Pure geometry: it reads
  nothing about the document, which is why it could leave whole.
- `useStored.js` — state that remembers itself in localStorage, through `core/persist`.
- `useToolSettings.js` — which tool, colour, width, pressure; `etool` resolves the two-in-one tools.
- `useAudioTrack.js` — the audio element, its base64 copy, and putting a saved track back.
- `useCanvasView.js` — zoom and offset of the canvas: space/middle-button pan, wheel zoom about
  the cursor, one-finger pan, two-finger pinch. Maths in `core/viewZoom`.
- `useLayerCache.js` — the layer canvases the frame is composited from: the state cache rebuilt for
  the cuts on screen (`engine/selectCuts.cutsToCache`), the on-demand LRU `ensureLayerCanvas`
  fills during playback, clip-group flattening, lazy frame decoding ahead of the playhead
  (`core/decodeBudget.prefetchWindow`) and invalidation when a frame lands. Sits over
  `canvas/bitmapStore`, which owns the pixels themselves.
- `useLayerDnD.js` — dragging a layer row to reorder it or into a folder; moves in `core/layerOps`.
- `useTextDrag.js` — grabbing a text on the canvas and dragging it, one document write per frame.
- `useShortcuts.js` — the keydown listener; which key means what is `core/shortcuts.shortcutFor`.
- `useDropdown.js` — a menu that closes on a press outside it (the File and Media menus).
- `usePanelVisibility.js` — which panels are on screen, and the Tab that folds them away. Folding
  is not "close everything": the second press puts back exactly what was open, and it restores
  the timeline's scroll, because that container is unmounted while folded and comes back at zero.
- `useAppearance.js` — the accent colour, the chrome's saturation, and the recent-colour list.
- `useGesture.js` — **what is happening between the pen going down and coming back up:** the
  stroke, the lasso loop, the layers or selection being dragged, the path being recorded, the
  layer the stroke commits to, plus `begin`/`end` for pointer capture. Only one is ever live.
- `useSelectionGesture.js` / `useLayerDrag.js` / `usePathCapture.js` — the three drags that own
  themselves: the floating selection (hit test, move, resize, rotate, warp), a whole layer with
  the move tool (overlay preview, commit on lift), and recording a path (camera, part path, sway
  curve, mosaic rectangle). App's pointer handlers say which is happening; these say how.
- `useLiveOverlay.js` — the overlay canvas and the incremental drawing of a stroke on it. Only
  the new tail each frame; the count that tracks it must be exactly right or the tail is drawn
  from the wrong place.
- `useLiquifyTool.js` / `useCurveTool.js` / `useMosaicTool.js` — three tools that keep their own
  in-progress state, each `begin / to / end`.
- `useExport.js` — the three exports: a recorded video, a GIF or PNG sequence, and several `.emv`
  files painted into one. All paint through the app's own paint path.
- `useVideoImportState.js` — what bringing a video in remembers, and the two things done with it:
  `run` (the import: extract, store, lay out as cuts) and `restore` (a stored track back). Both
  take the document at call time, so the hook stays free of App state.
- `useNotices.js` — progress, toast, error banner, and the YouTube link prompt.
- `useDialogs.js` — which dialog is open, and the rebinding two of them share.

- `server/` — the Express file-backed project DB on :8787, files under `server/data/`. `index.js`
  is the wiring (body limit, rate-limit tiers, mount, listen); `projects.js`, `backups.js` and
  `youtube.js` are one route family each; `paths.js` builds every path, so `safeId` cannot be
  forgotten by a route.
  Proxied at `/api` (vite.config).
- `src/main.jsx` — boot + service-worker register (PWA, skipped in Capacitor) + fatal-error
  overlay. That overlay is how a render crash shows up — check the page text for "Unhandled".
- `public/` — `manifest.webmanifest`, `icon.svg`, `sw.js` (caches app shell; `/api` excluded).
- `android/`, `capacitor.config.json` — Capacitor Android wrapper. The APK build needs **JDK 21**.

## Data model
- `cuts`: `[{ id, name, startTime, endTime, track, layers, activeLayerId, texts, anim }]`
- `layer`: `{ id, name, type:'layer'|'folder', parentId, visible, strokes, redoStrokes, collapsed?, anim? }`
  - **layer ids are NOT unique across cuts** — always key per-cut with `layerKey(cutId, layerId)`.
- stroke tools: `pen`(dot), `marker`, `eraser`, `fill`, `paste`, `eraseBitmap`, `text`. Pixel data for fill/lasso/paste lives in `bitmapStoreRef` (Map id→{imageData,imageBitmap}), referenced by `stroke.bitmapId`. `buildData()` serialises referenced bitmaps as PNG dataURLs under `data.bitmaps`; `restore()` rebuilds the Map.
- `cut.anim` (see ANIM_DEFAULT): enter(`inType/inDur/inDir`), exit(`outType/outDur/outDir`), deform(`deformAxis/deformAmount/deformReturn/deformSpeed/deformCount`), move(`moveX/moveY/moveReturn/moveSpeed/moveCount`), `ease/easePower`.
- `layer.anim` (LAYER_ANIM_DEFAULT): `tx/ty/rot/scale/pivotX/pivotY/path` + `mode(progress|return)/speed/count/ease/easePower`.
- Animations apply **only while `isPlaying`** (editing is at rest); export captures them via playback.

## App.jsx key handlers (search these names)
- Drawing: `startDraw`/`onDraw`/`stopDraw`. Each does the cross-cutting part — palm rejection
  (ignore `pointerType==='touch'`), the eyedropper, a path being recorded, a floating selection,
  a text under the pointer — and then hands over to `TOOLS[etool]` in `tools/canvasTools.js`.
  Gesture state is `gesture.*` from `useGesture`; path capture is `usePathCapture` (over `gesture.pathPts`).
  **`stopDraw` is deliberately not a tool table.** The end of a gesture is decided by which
  gesture is in flight, not by which tool is selected, and the tool can be changed while the pen
  is down — dispatching the end on the current tool would finish the wrong thing.
- Selection (lasso): `liftLassoSelection`, `selectAllAsLasso` (Ctrl+T), `takeSelectionStrokes` →
  `commitSelectionImpl` / `extractSelectionToPart` (lasso → new layer). A selection carries `rot`,
  `skew`, `bend`; `canvas/warpRender` draws it and `canvas/editChrome` its marquee.
- Cuts: `handleAddCut` (`core/document.mkCut`), `handleDuplicateCut` (Ctrl+D), `handleCopyCut`/`handlePasteCut`
  (`core/cutSelection`, `core/cutClone.placeCopies`), `handleClearCut`, `handleCutClick`.
- Layers: `handleAddLayer/handleAddFolder/handleDeleteLayer` are one-liners over `core/layerOps`
  (`appendLayer`, `appendFolder`, `removeLayerTree`); drag-and-drop is `useLayerDnD`.
- Anim updaters: `updCutAnim`, `updLayerAnim`. The panels take free numeric input (`NumField`);
  the old fixed-value dropdowns and their option lists are gone.
- Gestures: `gesture.begin`/`gesture.end` (from `useGesture`) wrap pointer capture — **always
  use them.**
  `setPointerCapture` and `releasePointerCapture` *throw* on a pointer that has already gone, and
  optional chaining does not help (it guards a missing method, not a throw). An uncaught throw out
  of a pointer handler takes the whole app down; it has happened.
- Timeline: all in `useTimelineGestures` — `seekToClientX`, `startTimelineScrub` (mouse), touch as
  native capture-phase listeners (1=pan/tap-seek, 2=pinch zoom pps, works over cut blocks), wheel
  zoom about the cursor. Cut blocks: drag = long-press on touch (`cutDragArmedRef`), resize =
  absolute delta (`initialStart/initialEnd`). `splitter` for panel resize.
- Canvas nav: `useCanvasView` — `onAreaPointer*` (1-finger pan / 2-finger pinch), `view={zoom,x,y}`.
- Playback: `usePlayback`; bounds are `playStart..playEnd` from `core/playRange` (NOT maxTime) —
  the same range export uses, so what you watch is what comes out. `loopPlay` repeats.
- Files: `buildData` and `restore` are in App, because one reads most of its state and the other
  writes most of it. Everything around them is not: `doSave/doOpen/doNew` and the tabs are in
  `useLocalDocuments`, `doServerSave/openServerList/doServerOpen/doServerDelete` and the backups
  in `useServerStorage`, the debounced write in `useAutosave`.
- History: `useHistory`. It owns the stack and the refs; App passes the snapshot and a predicate
  for "not now, a gesture is in progress".
- Export: all three are `hooks/useExport.js`. `renderFrameRange` paints a range and hands each
  frame to a capture function, so the multi-piece export can run it once per piece into one
  writer; `captureFrame` decides what a format wants from a painted canvas. Video recording
  paints on a fixed frame grid (`core/recordClock`) into a stream that takes frames on request
  (`export/recorder`). The five refs that say an export is running stay in App, because
  `usePlayback` reads them every frame — recording and playback are one clock.
- Keys: `useShortcuts` with an actions table; `core/shortcuts.shortcutFor` is the rule set.

## The render path

This used to be a section about where the render path was *going*. It has arrived, so here is
what it is.

```
cuts, t
   ↓  engine/evaluateFrame(cuts, t, opts)
the scene at time t        ← pure, no canvas, tested
   ↓  canvas/sceneRender.drawScene(ctx, scene, …)
canvas
```

`paintFrame` in App is those two calls plus the parts that genuinely need the live canvas: the
boiling phase, holding the previous frame while a bitmap decodes rather than flashing white, the
camera transform, and the chrome drawn over the top (selection box, handles, motion path).

Export is the same two calls in a loop rather than a second renderer — `renderFrameRange` in
`useExport` paints through `paintFrameRef`, so nothing can drift from what the user watched. A
parallel renderer is a thing that agrees with the real one until it quietly does not, and the
first anyone hears of it is an export that looks wrong.

### What is deliberately staying put

`startDraw` / `onDraw` / `stopDraw` are not part of this and never were. They are pointer
handling and live-stroke state, and they have nothing to do with rendering a frame. What has
changed since that was first written is that the per-tool half *has* moved out, to
`tools/canvasTools.js`; what stays is the cross-cutting part, which is the part that has to
decide between modes before any tool sees the event.

## Run and verify
- Web + API: `npm run dev` (web with LAN host + QR, api :8787).
- `npm run check` — typecheck, tests, then five checks that each exist because something went
  wrong once, then the build. **Run this before reporting done.**
  - `hook-baseline` — hook-dependency warnings may not grow. Most of the remaining ones are
    deliberate; the baseline pins them rather than demanding zero.
  - `helper-index` — every shared export is in HELPERS.md, so a helper cannot quietly go missing
    from the index someone would have checked before writing a second one.
  - `unreachable` — App-level names nothing reaches. Catches a feature cut from the UI and left
    behind: a group that only refers to itself is dead however busy it looks.
  - `unused-imports` — a name imported and never used, or imported twice. The other checks
    cannot see these: `unreachable` asks what App's own names reach and an import is not one of
    them. Twenty-eight had piled up in App.jsx alone, left behind by the extractions.
  - `stroke-writes` — every write that adds a stroke to a layer goes through `commitStroke`,
    which refuses an id naming no layer and reveals the layer it writes to. Both failures are
    silent and both shipped, four times: the lasso paste and the mosaic evaporated, the bucket
    fill and the eraser landed invisibly. Its test drives it with all four bugs as they shipped.
  - `i18n-check` — every `tr()` string is translated, or the English UI shows Korean.
- `npm test` alone runs the suite (Node's built-in runner, no test framework dependency).
- Build: `npm run build`. Android: `npm run android:sync` then `android:open`.

**A green build proves very little here.** A component that returns `undefined` is legal React and
valid JS, so `tsc` and a build both pass while a modal renders nothing — that has happened. For a
structural change, confirm the affected screen actually mounts.

## Gotchas
- **Layer ids are not unique across cuts.** Always key per-cut with `layerKey(cutId, layerId)`.
- **Never do work inside a state updater.** React invokes updater and reducer functions twice
  under StrictMode, so a `setX(prev => { sideEffect(); return prev })` runs the effect twice —
  and using a setter to *read* current state is the usual reason someone writes one. `liveRef`
  holds the current document, audio and track count for exactly that read.
- **`canvas.width = n` reallocates the backing store even when n is unchanged** — 8MB at this
  canvas size. Use `sizeCanvas`, which only resizes when the size actually differs. Assigning it
  unconditionally on a canvas redrawn ten times a second is what once ran the tab out of memory.
- Boiling (`layer.roughen`) redraws a layer per phase, and phases cycle through `BOIL_PHASES` so
  the redraws are cached rather than endless. Its canvases are keyed `cut:layer#phase`; anything
  invalidating the layer cache has to account for the suffix.
- Pixel data for fill/lasso/paste lives in `bitmapStoreRef`, not in `cuts`. It *is* collected now
  (`gcBitmaps` → `bitmapRefs`), so a new place that holds a bitmap id must be added as a source
  there or its pixels will be freed while still referenced.
- Animations apply **only while `isPlaying`** (editing is at rest); export captures them via
  playback. Scrubbing renders like playback so the animation can be seen while dragging.
- Server `/api` only exists with the local Express server running; in a packaged APK it is absent
  (calls fail with an alert — degrade gracefully).
