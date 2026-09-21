<h1 align="center">Easy MV Maker</h1>

<p align="center">
  Timeline-based frame-animation and drawing studio with a built-in canvas.<br>
  Runs in the browser, on a PC or a tablet — a pen or a mouse draws, a finger navigates.
</p>

<p align="center">
  <a href="https://github.com/difficcd/Easy-Mv-Maker/actions/workflows/ci.yml"><img src="https://github.com/difficcd/Easy-Mv-Maker/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000" alt="React 19">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=fff" alt="Vite 8">
  <img src="https://img.shields.io/badge/TypeScript-checkJs-3178C6?logo=typescript&logoColor=fff" alt="TypeScript checkJs">
  <img src="https://img.shields.io/badge/HTML5%20Canvas-2D-E34F26?logo=html5&logoColor=fff" alt="HTML5 Canvas 2D">
  <img src="https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=fff" alt="Express API">
  <img src="https://img.shields.io/badge/Capacitor-Android-119EFF?logo=capacitor&logoColor=fff" alt="Capacitor Android">
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Easy MV Maker — tool panel, canvas, cut/layer tree and timeline" width="900">
</p>

<p align="center"><sub>The accent colour above is user-set — one colour drives the whole UI.</sub></p>

<p align="center">
  <a href="https://github.com/difficcd/Easy-Mv-Maker/wiki"><b>User guide (wiki)</b></a> — getting started, the camera, part animation and effects, importing video, exporting, working with a lot of cuts · <a href="https://github.com/difficcd/Easy-Mv-Maker/wiki/Home-ko">Korean wiki</a>
</p>

<p align="center">Korean README: <a href="README.ko.md">README.ko.md</a></p>

## Features

**Drawing**
- Dot pen, marker, airbrush (blur / boiling-line modes), eraser, bucket fill, lasso, text, liquify (pushes pixels along with the pen)
- Shape tool: straight line, curve, rectangle and ellipse. Each is stored as an ordinary stroke, so it takes the current brush, erases, and boils with its layer
- Lasso selection: move, resize, rotate (a handle above the selection, or a slider), tilt and bend (sliders, or Ctrl-drag inside the selection); Ctrl+T selects the whole layer
- Move tool moves what is selected — a tapped text, otherwise the active layer; texts never ride along with a layer
- Fill matches the clicked colour, so you can paint over an already-filled area
- Pen draws; finger pans and pinch-zooms (palm rejection)
- Stroke smoothing (resample → Chaikin → Catmull-Rom); in-progress strokes render incrementally on a separate overlay canvas

**Motion and effects**
- Boiling line — a shimmer applied to strokes you already drew, with amplitude, wavelength and minimum-width settings
- Camera per cut: pan, zoom, tilt, a drawn path, presets, and a handheld shake — the whole frame moves and every layer follows
- Layer effects with a start/end window inside the cut: mosaic (block size, speed, an optional region that moves with the layer) and static — the lines tear, fringe red and cyan and snow, only where there is ink, so it works on a transparent background; the static is available on texts too
- Cut animation (in/out, deform, move, easing) + part animation (lasso a region: move / rotate / scale / path)
- Keyframe tweening — shape morphing via a distance field, with centroid alignment
- Sway that follows a curve you draw, with a lag so the tips trail the root, plus a bend profile using per-slice shear
- Motion presets, text animation, rich text
- Every effect is a pure function of the time — nothing random — so the export repaints exactly what playback showed

**Timeline and structure**
- Multi-track timeline: drag, resize, snap, loop playback, part grouping
- Playback speed can be kept as the project default, or baked into the film so every cut length, easing and text speed is rescaled to match
- Cuts with layers and nestable folders; rename, collapse, multi-select
- Onion skin
- Numeric fields (speed, coordinates…) accept free input rather than being capped by the slider range

**I/O**
- Autosave, `.emv` save/open, server save
- Automatic server backup every 5 minutes, keeping the newest 12 — runs in the background without blocking the UI
- Video import from a local file or URL: frame extraction, scene-change detection, audio track (with a mute that lifts itself for the export)
- Imports match the source video's own size by default, so a vertical shorts clip fills the canvas instead of being letterboxed; landscape and portrait presets are there too
- WebM/MP4 export recorded on a fixed frame grid (no judder from sampling the paint loop), with a start/end range; PWA, Android packaging

**UI**
- English, Korean and Japanese, switchable in Settings
- The help dialog opens with a "where is it" list: each effect and the row, icon and panel it lives in
- Dockable panels: drag a panel by its header to the left or right edge to dock it there, or drop it in the middle to pull it out as a floating window. The arrangement is remembered
- Tab hides every panel to leave just the canvas, and restores exactly what was open
- Dragging the playhead scrubs with animation, so you see the motion rather than static artwork sliding past
- Custom theme colour — one colour derives an HSL ramp applied across the whole app (playback bar, panels, buttons included), with neutral saturation adjustable too
- User-definable keyboard shortcuts
- Long jobs report progress in a corner chip instead of a full-screen overlay

## Quick Start

```bash
npm install
npm run dev      # web (:5173, LAN + QR) + API (:8787)
npm run build
```

On a tablet, scan the QR printed by `npm run dev` (same Wi-Fi). If 5173 is taken, Vite moves to 5174, 5175… — check the address in the terminal.

**Requirements**: Node 18+. Importing video from a URL needs `yt-dlp`; merged formats such as 1080p additionally need `ffmpeg`. Everything else works without either.

### Checks

```bash
npm run check      # everything below, in order, then a production build
npm test           # node --test, no test framework dependency
npm run typecheck  # tsc --noEmit (allowJs/checkJs, files stay .jsx)
npm run lint       # eslint-plugin-react-hooks
npm run smoke      # boots the built app in a headless browser and draws a stroke
```

`npm run check` is the gate: typecheck, the unit tests, then six static guards, then the build.
The same steps run in CI on every push and pull request.

| Guard | What it fails on |
|---|---|
| `scripts/hook-baseline.mjs` | more React hook dependency warnings than the pinned baseline |
| `scripts/helper-index.mjs` | a shared export missing from `HELPERS.md` |
| `scripts/unreachable.mjs` | an App-level name nothing can reach |
| `scripts/unused-imports.mjs` | an import nothing in the file uses |
| `scripts/stroke-writes.mjs` | a write that adds a stroke to a layer without going through `commitStroke` |
| `scripts/i18n-check.mjs` | a `tr()` literal with no English entry, or a dictionary row whose key no longer appears in the source |

Around 1,150 unit tests cover the pure modules under `src/core`, `src/canvas`, `src/engine` and
`src/export` — geometry, easing, keyframe sampling, the cuts reducer, layer-tree moves, lasso
cut-out, timeline snapping, the time-scale bake, GIF and zip writers. They use Node's built-in
runner because none of it needs a DOM or a framework. The functions that draw - strokes into
pixels, the static, the mosaic, the bucket fill - run on `@napi-rs/canvas` (a Skia canvas with
the 2D API, no browser) through `canvas/canvasFactory.js`, and are asserted on real pixels. Frame
extraction needs a real video element and is left to the smoke test.

```bash
npm run bench      # measures the pure hot paths
```

Measurements of the canvas-side effects, with what was changed and why, live under
[docs/perf/](docs/perf/) — one file per investigation.

Worth knowing before adding memoisation: measured against a 16.7ms frame, the per-render derived
values are not where the time goes. Aggregating parts over 1,000 cuts costs 0.026ms, `strokeSig`
under a microsecond, flattening 100 layers 0.017ms. Wrapping those in `useMemo` would add more
dependency-checking than it saves. The cost in this app is canvas repaint and bitmap decoding,
which is why the caching that exists is a per-layer canvas cache, incremental tail rendering, a
rAF throttle, and a WeakMap for the boiling path — not `useMemo`.

`scripts/hook-baseline.mjs` fails only when hook dependency warnings **grow**. The remaining ones are mostly deliberate (per-frame canvas work and heavy caches), so zero isn't the target; the guard catches new stale-closure risk introduced by things like extracting custom hooks. Use `UPDATE=1 node scripts/hook-baseline.mjs` to move the baseline on purpose.

> Passing every static check does not prove a component mounts — a component returning `undefined` is legal in React. After a structural change, open the affected screen and look at it.

## Android (Capacitor)

An installable APK is built in CI, so you do not need an Android SDK to get one:

- **Tagged releases** — pushing a `v*` tag publishes the APK to
  [Releases](https://github.com/difficcd/Easy-Mv-Maker/releases).
- **Any commit** — run the *Android APK* workflow from the Actions tab and download the artifact
  from that run.

It is the debug variant, signed with the standard debug key, so Android will ask you to allow
installs from that source. A release build needs a real keystore, and keystores are kept out of
this repository on purpose.

Locally, if you do have the SDK:

```bash
npm run android:sync     # build web + sync into android/
npm run android:open     # open Android Studio -> run, or Build > Generate Signed Bundle / APK
```

`npx cap sync` copies `dist/` into `android/`. For live reload on a device, set Capacitor's
`server.url` temporarily — and do not ship with it.

## Layout

```
src/
  App.jsx          the component: state and wiring (~2,100 lines)
  tools/           the drawing tools as a dispatch table: what each one does on pointer down and move
  core/            pure logic - reducers, timeline geometry, lasso, shapes, persistence, export planning
  canvas/          anything that draws on a 2D context: strokes, text, sway slices, layer compositing
  engine/          evaluating one frame: which cuts are on, what each layer looks like at time t
  export/          byte writers for GIF and zip, video recording plumbing, download
  hooks/           App state that has been given its own home: the canvas view, the layer cache, playback,
                   audio, history, autosave, panels, tool settings, shortcuts, the drag gestures
  ui/              panels; ui/dialogs/ one file per dialog
  i18n.js          the English dictionary (~710 entries) and the tr() lookup; i18n.ja.js the Japanese one
  globals.d.ts     ambient declarations (EyeDropper, Capacitor, File System Access…)
server/            the API: index.js wires it; projects, backups and youtube are a route module each; paths.js builds every path
scripts/           the check guards above, the hot-path benchmark, font subsetting
test/              unit tests (node --test), mirroring src/ - test/core for src/core and so on - plus smoke/
```

Nothing under `core/`, `engine/` or `export/` touches a canvas or React, and `tools/` touches neither React nor a context it owns - where one of them
needs an `ImageData`, it takes a constructor as an argument. `canvas/` draws on a context it is
handed rather than one it owns. That split is what keeps the tests framework-free. [ARCHITECTURE.md](ARCHITECTURE.md)
is the map to read before editing `App.jsx`, and [HELPERS.md](HELPERS.md) lists every shared
export.

The Korean source text doubles as the translation key, gettext style, so a missing entry shows
Korean rather than an empty label. Japanese is allowed to be incomplete and falls back to English.
The lookup is named `tr`, not `t`, because `t` is already a local variable in dozens of places
here.

## Notes

**The server is for local use only.** It is a convenience for reaching your own machine from a
tablet on the same Wi-Fi, and it is not written to be exposed to anything wider:

- No authentication of any kind. Anyone who can reach :8787 can read, overwrite and delete every
  project, and trigger downloads.
- It listens on all interfaces, because the tablet has to reach it. On an untrusted network that
  means everyone on that network.
- Asset uploads accept up to 1GB of raw body per request, so an open port is also a way to fill
  your disk.
- Path traversal is handled — project ids are sanitised before touching the filesystem — but that
  is the only hostile input it defends against.

Run it behind your own firewall on a network you control. Do not port-forward it.

Video import is intended for local, personal use. Respect the source service's terms and copyright.

## License

Not decided yet — all rights reserved for the moment. This is a personal project that
may end up as a paid app, so I'm keeping the options open rather than picking a licence
I'd regret. Open an issue if you'd like to use or build on it and I'll sort it out.
