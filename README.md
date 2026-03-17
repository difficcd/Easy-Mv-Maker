# Easy MV Maker

Timeline-based MV maker with a built-in drawing canvas optimized for Galaxy Tab (pen vs finger).

This repo contains:
- A Vite + React web app (single-page app)
- An Android wrapper via Capacitor for release builds (APK/AAB)

## Features
- Multi-track timeline with cuts (drag, resize, snap)
- Canvas drawing per-cut with layers and folders (order matters)
- Lasso selection move/resize with confirm UI (Clip Studio-like behavior)
- Text objects managed separately from paint layers (move, edit, font selection, in/out effects)
- Bucket fill that respects line boundaries (fill transparent region)
- Touch-first controls for Galaxy Tab:
  - Finger: pan canvas (1 finger), pinch zoom (2 fingers)
  - Pen: draw/erase/lasso/text interactions
- Project save/load (`.emv` JSON) with robustness against BOM/control chars

## Quick Start (Web)
Requirements: Node.js

```bash
npm install
npm run dev
```

Open the URL printed by Vite. For LAN testing on tablet:
```bash
npm run dev:host
```

Build:
```bash
npm run build
npm run preview
```

## Android (Galaxy Tab Release)
Requirements:
- Android Studio + Android SDK
- Java/Gradle that Android Studio installs

One-time setup:
```bash
npm install
npx cap add android
```

Sync web -> Android project:
```bash
npm run android:sync
```

Open Android Studio:
```bash
npm run android:open
```

Release build (AAB/APK):
- Android Studio: `Build > Generate Signed Bundle / APK`

Notes:
- Do not commit `android/**/build/` or `android/.gradle/` (already ignored).
- If you need device live-reload, you can temporarily configure Capacitor `server.url`, but do not ship with it.

## Usage Notes
- Cuts: `Add Cut` creates a new cut with the configured default duration (right panel).
- Save/Load: saves a single `.emv` file containing timeline + layers + text objects + palette.
- Gestures on tablet:
  - Finger drag: pan canvas
  - Pinch: zoom (anchored to the pinch midpoint)
  - Pen: draw and interact with tools

## Technical Architecture

### High Level
- **UI**: React components (mostly in `src/App.jsx`) render toolbars, layer list, timeline, and canvas overlays.
- **Rendering**: HTML Canvas 2D is the core drawing surface. Each cut has multiple paint layers; text objects are rendered separately.
- **Data Model**:
  - `cuts[]`: timeline segments with `startTime/endTime/track`
  - `cut.layers[]`: paint layers and folders, with parentId for nesting and `visible` flag
  - `cut.texts[]`: text objects (position, font, size, visibility, in/out effects)
- **Persistence**: `.emv` is JSON. Load path includes recovery for BOM/control chars and common malformed inputs.

### Drawing Pipeline (Paint Layers)
- Strokes are recorded as an array of sampled points with optional pressure.
- Tools include pen, marker (multiply-ish feel), calligraphy, eraser, dot pen (stamp).
- To avoid opacity blotching on pressure strokes, the app can render a uniform-alpha stroke shape to a temporary canvas and composite once.

### Selection (Lasso)
- Lasso produces a closed polygon; the app fills/normalizes the selection area and creates a draggable/resizeable bounding box.
- Confirm/Cancel UX is shown; clicking outside the handles commits by default (standard drawing-app behavior).

### Fill (Bucket)
- Bucket fill targets the connected transparent region under the click (flood fill mask).
- The resulting bitmap is pasted into the current layer; boundaries come from strokes above (so lines on upper layers can constrain fills on lower layers).

### Input Handling (Galaxy Tab)
- Uses Pointer Events to distinguish `pointerType`:
  - `touch`: pan/zoom and UI drag operations with hold thresholds to prevent accidental grabs
  - `pen`/`mouse`: drawing and precise interactions

### Android Wrapper
- Capacitor wraps the web build (`dist/`) into an Android project under `android/`.
- `npm run android:sync` builds web assets and syncs them into the Android project.

## Repo Layout
- `src/App.jsx`: main app logic (timeline, canvas tools, save/load, touch logic)
- `src/App.css`: app styles
- `android/`: Capacitor Android project
- `capacitor.config.json`: Capacitor settings

