# Architecture map (read this before editing — saves grep/read passes)

> **Looking for a helper? [HELPERS.md](HELPERS.md) lists all of them.** Check there before
> writing one — `clearLiveOverlay` was reimplemented four times while the real one sat two
> hundred lines away, and the timeline gutter width had seven copies. `npm run check` fails when
> a shared export is missing from that index, so it cannot quietly go out of date.

Frame-by-frame MV/animation app. Vite + React 18, single big component. Capacitor wraps it for Android.

## Files

`App.jsx` is still the component, but the logic worth testing has been moved out of it. **Put new
pure logic in a module, not in App.jsx** — anything that is a function of its arguments belongs
next to its tests.

The folders say what a file is allowed to touch, which is the quickest way to know where
something belongs:

```
src/
  App.jsx  main.jsx  i18n.js  db.js  *.css      the component, boot, strings, storage
  core/     pure logic — no React, no DOM, no canvas. Every file here has tests.
  canvas/   drawing. Pure apart from the 2D context it is handed.
  ui/       components.
  hooks/    React hooks that wire state to behaviour.
test/       one file per module, same name
```

A file in `core/` importing React or reaching for `document` is the sign it is in the wrong
folder — or that the part which needs them should stay behind in the component and be passed in.
That is how `measureTextBox` takes a context, `cloneCutContents` takes a bitmap copier, and
`loadKeymap` takes its storage.

- `src/App.jsx` — the `App()` component: state, handlers, JSX. Use the section map below to jump.
- `src/i18n.js` — `tr()` plus the English dictionary. Korean source text is the lookup key, so
  write UI strings in Korean and add the English to the dictionary. Called `tr`, not `t` — `t` is
  a local variable in dozens of places.
- `src/db.js` — IndexedDB autosave (`saveAutosave`, `loadAutosave`, plus project CRUD).

**core/** — pure logic, all of it tested.

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
- `shortcuts.js` — `DEFAULT_KEYS`, `keyOf`, `matchShortcut`, `loadKeymap`.
- `timeCode.js` — `fmt` / `parseClock` for the timeline clock.
- `numInput.js` — the rules behind a number field that can be typed into.
- `bitmapRefs.js` — `collectUsedBitmapIds` / `unusedBitmapIds`. Every reference source is named in
  one place; miss one and the collector frees pixels undo or paste still needs.

**canvas/**

- `canvasUtils.js` — the big one. Geometry (`pointInPolygon`, `dist`, `fitRect`), colour
  (`hexToRgb`), fill (`bucketFillTransparentRegion`, `dilateMask`), canvas (`drawStrokesOnCtx`,
  `sizeCanvas`, `layerKey`, `imageDataToDataURL`, `flattenLayersInUiOrder`), animation
  (`ANIM_DEFAULT`/`computeCutAnim`, `LAYER_ANIM_DEFAULT`/`computeLayerAnim`,
  `TEXT_ANIM_DEFAULT`/`computeTextAnim`, `applyEase`, `triwave`, `samplePath`, `sampleKeys`),
  video import sizing (`targetCanvasFor`, `extractVideoFrames`). Constants: `CANVAS_W=1920`,
  `CANVAS_H=1080`, `DEFAULT_CUT_DURATION`, `FONT_PRESETS`.
- `textRender.js` — measuring and drawing text: `measureTextBox`, `textNeedsBox`, `revealLines`
  (typing), `drawTextObject`.

**ui/** — panels split out of App.jsx: `AnimPanels.jsx` (`CutAnimPanel`, `LayerAnimPanel`,
`JitterPanel`), `CutLayerPanel.jsx`, `ColorPanel.jsx`, `ToolsPanel.jsx`, `Timeline.jsx`,
`TopBar.jsx`, `Modals.jsx`, and `NumField.jsx` — **use NumField for any new numeric field.**

**hooks/** — `useTimelineGestures.js`: every way the timeline can be pointed at (ruler scrub,
marquee, middle-click pan, one-finger pan/tap, two-finger pinch) in one place.

- `server/index.js` — Express file-backed project DB on :8787, files under `server/data/`.
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
- Drawing: `startDraw`/`onDraw`/`stopDraw` (palm rejection: ignore `pointerType==='touch'`; path capture via `pathCapture`/`pathPtsRef`).
- Selection (lasso): `commitSelectionImpl`, `extractSelectionToPart` (lasso → new layer).
- Cuts: `handleAddCut`, `handleDuplicateCut` (Ctrl+D), `handleCopyCut`/`handlePasteCut`, `handleClearCut`, `cloneCutContents`.
- Layers: `handleAddLayer/handleAddFolder/handleDeleteLayer`, drag `onLayerDrag*`, `renderLayers`.
- Anim updaters: `updCutAnim`, `updLayerAnim`. The panels take free numeric input (`NumField`);
  the old fixed-value dropdowns and their option lists are gone.
- Gestures: `beginGesture`/`endGesture` wrap pointer capture — **always use them.**
  `setPointerCapture` and `releasePointerCapture` *throw* on a pointer that has already gone, and
  optional chaining does not help (it guards a missing method, not a throw). An uncaught throw out
  of a pointer handler takes the whole app down; it has happened.
- Timeline: `seekToClientX`, `startTimelineScrub` (mouse), `onTimelinePointer*` (touch: 1=pan/tap-seek, 2=pinch zoom pps). Cut blocks: drag = long-press on touch (`cutDragArmedRef`), resize = absolute delta (`initialStart/initialEnd`). `splitter` for panel resize.
- Canvas nav: `onAreaPointer*` (1-finger pan / 2-finger pinch), `view={zoom,x,y}`.
- Playback: rAF effect; bounds `contentStart..contentEnd` (NOT maxTime); `loopPlay` repeats.
- Files: `buildData/restore/doSave/doOpen/doNew`; server `doServerSave/openServerList/doServerOpen/doServerDelete`; autosave effect + crash-recovery effect.
- History: `historyRef`/`historyIndexRef` + `recordHistoryRef`; the arithmetic is in `core/historyOps`.

## Run and verify
- Web + API: `npm run dev` (web :5173 with LAN host + QR, api :8787).
- `npm run check` — typecheck, tests, hook-lint baseline, build. **Run this before reporting done.**
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
