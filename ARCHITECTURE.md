# Architecture map (read this before editing — saves grep/read passes)

Frame-by-frame MV/animation app. Vite + React 18, single big component. Capacitor wraps it for Android.

## Files
- `src/App.jsx` — the whole `App()` component (state + handlers + JSX). Large; use the section map below to jump.
- `src/canvasUtils.js` — **pure** helpers (no React/state). Put new pure logic here, not in App.jsx:
  - constants `DEFAULT_CUT_DURATION, CANVAS_W=854, CANVAS_H=480, FONT_PRESETS`
  - geometry/colour: `pointInPolygon, dist, safeArray, hexToRgb, bucketFillTransparentRegion`
  - canvas: `drawStrokesOnCtx(ctx, strokes, clear, bitmapStore)` (handles tools: text/eraseBitmap/paste/fill/pen=dot/marker=temp-composite/eraser/default), `layerKey(cutId,layerId)`, `imageDataToDataURL`, `dataURLToImageData`, `flattenForCanvas`, `flattenLayersInUiOrder`
  - animation: `ANIM_DEFAULT`, `computeCutAnim(cut,time)`, `LAYER_ANIM_DEFAULT`, `computeLayerAnim(layer,cut,time)`, `applyEase(t,type,power)`, `triwave`, `samplePath`
- `src/AnimPanels.jsx` — `CutAnimPanel` / `LayerAnimPanel` (the animation control UI + option lists). Edit animation panel UI here, not in App.jsx.
- `src/db.js` — IndexedDB autosave (`saveAutosave`, `loadAutosave`, plus project CRUD).
- `server/index.js` — Express file-backed project DB on :8787, files under `server/data/`. Proxied at `/api` (vite.config). `npm run dev` runs api+web via concurrently.
- `src/main.jsx` — boot + service-worker register (PWA, skipped in Capacitor) + fatal-error overlay.
- `public/` — `manifest.webmanifest`, `icon.svg`, `sw.js` (caches app shell; `/api` excluded).
- `android/`, `capacitor.config.json` — Capacitor Android wrapper (`npm run android:sync|open|run`).

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
- Anim updaters: `updCutAnim`, `updLayerAnim`. Option lists: `DUR_OPTS/COUNT_OPTS/MOVE_OPTS/ROT_OPTS/SCALE_OPTS/EASE_OPTS`, `optionList`.
- Timeline: `seekToClientX`, `startTimelineScrub` (mouse), `onTimelinePointer*` (touch: 1=pan/tap-seek, 2=pinch zoom pps). Cut blocks: drag = long-press on touch (`cutDragArmedRef`), resize = absolute delta (`initialStart/initialEnd`). `splitter` for panel resize.
- Canvas nav: `onAreaPointer*` (1-finger pan / 2-finger pinch), `view={zoom,x,y}`.
- Playback: rAF effect; bounds `contentStart..contentEnd` (NOT maxTime); `loopPlay` repeats.
- Files: `buildData/restore/doSave/doOpen/doNew`; server `doServerSave/openServerList/doServerOpen/doServerDelete`; autosave effect + crash-recovery effect.
- History: `historyRef`/`historyIndexRef`, `globalUndo/globalRedo` (JSON snapshots of cuts).

## Run
- Web + API: `npm run dev` (web :5173 with LAN host + QR, api :8787). Build: `npm run build`. Android: `npm run android:sync` then `android:open`.

## Gotchas
- Bitmap store has no GC (would need to scan cuts+history+copiedCut+selection). Leak is non-fatal.
- Server `/api` only exists with the local Express server running; in a packaged APK it’s absent (calls fail with an alert — degrade gracefully).
