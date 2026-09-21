import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PenLine, Pen, Feather, Eraser, Undo, Layers, GitBranch, Move, Type, Cloud, Minus, Grid3x3, PaintBucket, Waves } from 'lucide-react';
import './styles/index.css';
import { saveAutosave } from './db';
import ColorPanel from './ui/ColorPanel';
import { TopBar } from './ui/TopBar';
import { CutLayerPanel } from './ui/CutLayerPanel';
import { useStored } from './hooks/useStored.js';
import { nextId } from './core/ids.ts';
import { onOffCodec, oneZeroCodec } from './core/persist.js';
import { TextEditor } from './ui/TextEditor';
import { ToolsPanel } from './ui/ToolsPanel';
import { Timeline } from './ui/Timeline';
import { ProjectPicker } from './ui/dialogs/ProjectPicker.jsx';
import { ProgressOverlay } from './ui/dialogs/ProgressOverlay.jsx';
import { SettingsModal } from './ui/dialogs/SettingsModal.jsx';
import { HelpModal } from './ui/dialogs/HelpModal.jsx';
import { VideoImportModal } from './ui/dialogs/VideoImportModal.jsx';
import { SceneDetectModal } from './ui/dialogs/SceneDetectModal.jsx';
import { LinkPromptModal } from './ui/dialogs/LinkPromptModal.jsx';
import { ToolKeysModal } from './ui/dialogs/ToolKeysModal.jsx';
import { ExportRangeModal } from './ui/dialogs/ExportRangeModal.jsx';
import { Notices } from './ui/Notices.jsx';
import { DocTabs } from './ui/DocTabs.jsx';
import { CanvasStage, canvasCursor } from './ui/CanvasStage.jsx';
import { DockRail, DockSlot, FloatingPanels, DockHint, ReopenRight } from './ui/PanelDock.jsx';
import { tr, loadLang, saveLang, setLangValue } from './i18n';
import { resolveDrawLayer as resolveDrawLayerPure, commitStroke, insertFill, patchLayer, nextLayerId, appendLayer, appendFolder, removeLayerTree } from './core/layerOps.js';
import { mkCut, firstCut } from './core/document.js';
import { selectionAfterClick, cutsToCopy } from './core/cutSelection.ts';
import { closeLassoPath, lassoBounds, cutOutPolygon, cropImageData, selectionStrokes, paintedBounds } from './core/lassoOps.js';
import { TOOLS } from './tools/canvasTools.js';
import { useTimelineGestures } from './hooks/useTimelineGestures.js';
import { useTextDrag } from './hooks/useTextDrag.js';
import { useLayerDnD } from './hooks/useLayerDnD.js';
import { useCanvasView } from './hooks/useCanvasView.js';
import { fmt, parseClock } from './core/timeCode.ts';
import { textFromEdit, editFromText, blankTextEdit } from './core/textEdit.js';
import { useHistory } from './hooks/useHistory.js';
import { usePlayback } from './hooks/usePlayback.js';
import { useExport } from './hooks/useExport.js';
import { useServerProbe } from './hooks/useServerProbe.js';
import { useServerStorage } from './hooks/useServerStorage.js';
import { usePanelLayout } from './hooks/usePanelLayout.js';
import { useLocalDocuments } from './hooks/useLocalDocuments.js';
import { fetchAsset } from './core/api.ts';
import { PLAYBACK_RATES, RATE_DEFAULT, playbackRateCodec } from './core/playbackRate.ts';
import { scaleProjectTimes, bakePlan } from './core/timeScale.js';
import { paintFrameOnto, createFrameScratch, BOIL_FPS } from './canvas/framePaint.js';
import { drawMarquee } from './canvas/marquee.js';
import { drawTextSelection, drawFloatingSelection, drawMotionPath, drawMosaicRegion } from './canvas/editChrome.js';
import { createBitmapStore } from './canvas/bitmapStore.js';
import { regionBounds, rectBounds, mosaic, blurMaskedRegion } from './canvas/pixelEffects.js';
import { useLayerCache } from './hooks/useLayerCache.js';
import { useTimelineView } from './hooks/useTimelineView.js';
import { useCutListUi } from './hooks/useCutListUi.js';
import { useNotices } from './hooks/useNotices.js';
import { useDialogs } from './hooks/useDialogs.js';
import { useSelectionGesture } from './hooks/useSelectionGesture.js';
import { useLayerDrag } from './hooks/useLayerDrag.js';
import { usePathCapture } from './hooks/usePathCapture.js';
import { useVideoImportState } from './hooks/useVideoImportState.js';
import { useGesture } from './hooks/useGesture.js';
import { useLiveOverlay } from './hooks/useLiveOverlay.js';
import { useLiquifyTool } from './hooks/useLiquifyTool.js';
import { useCurveTool } from './hooks/useCurveTool.js';
import { useMosaicTool } from './hooks/useMosaicTool.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { usePanelVisibility } from './hooks/usePanelVisibility.js';
import { useAppearance } from './hooks/useAppearance.js';
import { detachMedia } from './core/mediaEl.ts';
import { useAutosave } from './hooks/useAutosave.js';
import { useAudioTrack } from './hooks/useAudioTrack.js';
import { useToolSettings } from './hooks/useToolSettings.js';
import {
    mediaReducer, EMPTY_MEDIA, setAudioClip, clearAudio,
    loadVideo, clearVideo, setVideoCuts, setVideoOpacity, clearVideoCuts, moveTrack, resizeAudio,
} from './core/mediaReducer.js';
import { cloneCutContents as cloneCutContentsPure, placeCopies } from './core/cutClone.js';
import { DEFAULT_KEYS, KEY_LABELS, keyOf, keymapFrom, findConflicts } from './core/shortcuts.js';
import { derivePartsFrom, deriveVideoBatches } from './core/partOps.js';
import { playRange, exportRange } from './core/playRange.js';
import { brushUp, brushDown } from './core/brushSize.ts';
import {
    cutsReducer, replaceCuts, addCuts, updateCut, setCutAnim, setCutCamera, clearCut,
    updateLayer, setLayerAnim, upsertText, deleteText, toggleTextVisible as toggleTextVisibleAction,
    assignPartTo, renamePart as renamePartAction, ungroupPart as ungroupPartAction, removeBatch,
    insertCutsShifting, deleteTrack, moveCutGroup, patchCut, patchCuts,
} from './core/cutsReducer.js';
import { migrateCuts, projectSettings, makeLoadProgress } from './core/projectFormat.js';
import { audioExt, videoExt, collectBitmaps, blobToDataURL, packMedia, fillBitmapStore, bitmapLoadCount } from './core/projectAssets.js';
import { xAtTime } from './core/timelineZoom.js';
import { dragOnWindow } from './core/windowDrag.ts';
// Recording a camera path reuses the pen the way a part's motion path does; the two cannot be
// active at once, and startDraw checks this one first because a camera is a property of the cut
// rather than of whichever layer happens to be selected.

import { topCutAt } from './engine/selectCuts.js';
import { unusedBitmapIds } from './core/bitmapRefs.js';
import { dragCut, resizeCut } from './core/cutOps.js';
import { accentSoft } from './canvas/editChrome.js';
import { bucketFillTransparentRegion } from './canvas/fill.js';
import { imageDataToDataURL, dataURLToImageData } from './canvas/imageCodec.js';
import { morphPrepare } from './canvas/morph.js';
import { sizeCanvas, imageDataCanvas } from './canvas/scratch.js';
import { drawStrokesOnCtx } from './canvas/strokes.js';
import { detectSceneCuts, seekTarget } from './canvas/videoFrames.js';
import { DEFAULT_CUT_DURATION, CANVAS_W as CANVAS_W_DEFAULT, CANVAS_H as CANVAS_H_DEFAULT } from './core/canvasSize.ts';
import { hexToRgb } from './core/colour.ts';
import { pointInPolygon, safeArray } from './core/geometry.ts';
import { flattenLayersInUiOrder } from './core/layerTree.ts';



const PEN_TYPES = [
    { id: 'pen', label: 'Dot', Icon: PenLine },
    { id: 'brush', label: '펜', Icon: Feather },
    { id: 'pencil', label: '연필', Icon: PenLine },
    { id: 'soft', label: '에어', Icon: Cloud },
    { id: 'marker', label: 'Marker', Icon: Pen },
    // Line and curve share one Ruler slot rather than taking two, and split into modes below.
    { id: 'ruler', label: '도형', Icon: Minus },
    { id: 'mosaic', label: '모자이크', Icon: Grid3x3 },
    { id: 'liquify', label: '유동화', Icon: Waves },
    { id: 'eraser', label: 'Eraser', Icon: Eraser },
    { id: 'fill', label: 'Fill', Icon: PaintBucket },
];
const TIMELINE_MIN_SPAN = 240; // seconds of ruler even with nothing in the project
const TIMELINE_TAIL_PAD = 60;  // empty room past the end, to drag into

// Shortcuts: the defaults plus whatever the user rebound, kept in the browser.
// Written as lowercase combinations such as "ctrl+[".
// Theme colour: one picked colour is varied in lightness and saturation to derive the rest,
// which are planted as CSS variables. That is what makes buttons, the active tab and the glow
// all follow at once.
const hexToHsl = (hex) => {
    const h = String(hex).replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d) {
        if (mx === r) hh = ((g - b) / d) % 6;
        else if (mx === g) hh = (b - r) / d + 2;
        else hh = (r - g) / d + 4;
    }
    hh = (hh * 60 + 360) % 360;
    const l = (mx + mn) / 2;
    const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return { h: hh, s: sat, l };
};
const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${Math.max(0, Math.min(100, s * 100)).toFixed(0)}% ${Math.max(0, Math.min(100, l * 100)).toFixed(0)}%)`;
const applyTheme = (base, uiSat = 3) => {
    // A bad value yields hsl(NaN ...), which CSS ignores, silently reverting to the default.
    // Guard against it up front.
    if (!/^#[0-9a-fA-F]{6}$/.test(String(base))) base = DEFAULT_THEME;
    const { h, s, l } = hexToHsl(base);
    const S = Math.max(0.35, Math.min(0.95, s || 0.6));
    const root = document.documentElement.style;
    root.setProperty('--accent', hsl(h, S, Math.min(0.55, Math.max(0.36, l))));
    root.setProperty('--accent-lo', hsl(h, S, 0.30));
    root.setProperty('--accent-hi', hsl(h, S, 0.52));
    root.setProperty('--accent-deep', hsl(h, S, 0.24));
    root.setProperty('--accent-deeper', hsl(h, S, 0.18));
    root.setProperty('--accent-mut', hsl(h, S * 0.6, 0.39));
    root.setProperty('--accent-mut2', hsl(h, S * 0.6, 0.31));
    root.setProperty('--accent-soft', hsl(h + 6, Math.min(1, S + 0.15), 0.74));
    root.setProperty('--accent-soft2', hsl(h + 6, Math.min(1, S + 0.10), 0.72));
    root.setProperty('--accent-bright', hsl(h - 8, Math.min(1, S + 0.20), 0.75));
    root.setProperty('--accent-pale', hsl(h, Math.min(1, S + 0.10), 0.85));
    root.setProperty('--accent-pale2', hsl(h, Math.min(1, S + 0.10), 0.90));
    root.setProperty('--accent-pale3', hsl(h, Math.min(1, S + 0.10), 0.88));
    root.setProperty('--accent-glow', `hsl(${h.toFixed(0)} ${(S * 100).toFixed(0)}% 45% / .55)`);
    // Neutral backgrounds (panels, buttons) share the hue, but the user sets the saturation;
    // 0 is fully achromatic.
    root.setProperty('--ui-h', h.toFixed(0));
    root.setProperty('--ui-s', `${Math.max(0, Math.min(60, uiSat)).toFixed(0)}%`);
};
// A muted indigo. The raw colour is hsl(243 17% 25%) - dark and desaturated - but the floors
// in applyTheme (0.35 saturation, 0.36 lightness) mean the accent actually paints as
// hsl(243 35% 36%).
// How wide each side panel may be dragged, per panel rather than per side - a panel keeps its
// limits when it is docked to the other edge.
//
// These numbers were already written down, in three branches of the splitter handler that nothing
// could reach any more: every drag now arrives as type 'panel'. The live branch clamped all three
// panels to one shared 120..640 instead, which let the tool strip - 96px by default, and a strip
// of icons at any width - be dragged out to 640, and let the colour panel down to 120, where the
// wheel hits its own 96px floor and the layout breaks. That is what moving it out of a 96px strip
// was meant to fix in the first place.
const PANEL_W = {
    color: [150, 520],
    tools: [56, 420],
    cut: [150, 640],
};
// Derived, so the panels and their widths cannot drift apart.
const PANEL_IDS = Object.keys(PANEL_W);

const DEFAULT_THEME = '#36354b';
// The language lives in a module variable rather than a hook: over forty of these strings sit
// in alert, confirm and thrown errors, which no hook can reach. Set before the first render.
setLangValue(loadLang());
// Turns a hue (0-360) into a theme base colour, holding saturation and lightness at values
// that suit the UI.
const hueToHex = (h) => {
    const s = 0.7, l = 0.45;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + t.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};

const TOOL_TYPES = [
    { id: 'lasso', label: 'Lasso', Icon: GitBranch },
    { id: 'move', label: 'Move', Icon: Move },
    { id: 'text', label: 'Text', Icon: Type },
    ...PEN_TYPES,
];



export default function App() {
    // The document. Changes go through cutsReducer's named actions - see that file for why, and
    // prefer a named action to patchCut/patchCuts when adding one.
    const [cuts, dispatchCuts] = React.useReducer(cutsReducer, [firstCut()]);
    // What the app is telling the user - a running job, a passing message, a failure that stays.
    const notices = useNotices();
    // Which dialog is open, and the dialogs.rebinding two of them share.
    const dialogs = useDialogs();
    const [numTracks, setNumTracks] = useState(2);
    const [onionPrev, setOnionPrev] = useState(false);
    const [onionNext, setOnionNext] = useState(false);
    const [resizingData, setResizingData] = useState(null);
    const [draggingCutData, setDraggingCutData] = useState(null);
    const [currentCutId, setCurrentCutId] = useState(1);
    /**
     * The cut being edited. Derived rather than stored, so it cannot drift from currentCutId.
     *
     * This lookup was written out thirteen times under five different names - cut, cc, src, A,
     * primary - which is thirteen chances to search the wrong list and five names for one thing
     * when reading. Undefined when the id names a cut that is gone, which every reader already
     * handles.
     */
    const currentCut = cuts.find(c => c.id === currentCutId);
    const [loopPlay, setLoopPlay] = useState(false);
    // Remembered, not per-session: someone working at half speed had to re-choose it on every
    // reload. The codec is what makes a stored value safe - see core/playbackRate.
    const [playbackRate, setPlaybackRate] = useStored('mv_playback_rate', RATE_DEFAULT, playbackRateCodec);
    // Which tab the cut panel is showing. It follows the editor rather than being chosen: a text
    // you have just opened is the thing you want to see.
    const [rightTab, setRightTab] = useState('cut');
    // Panel geometry: where each panel is docked, how wide it is, and the drags that change
    // either. It reads nothing about the document, which is why it could leave whole.
    const {
        leftW, rightW, colorW, toolW, timelineH,
        setLeftW, setRightW, setColorW, setTimelineH,
        panelWidth, docks, floatPos, panelDrag,
        onDockPointerDown, startPanelResize, startBottomResize,
    } = usePanelLayout({ panelIds: PANEL_IDS, widthRange: PANEL_W });

    // True while the playhead is being dragged. Rendering treats it as playback (see paintFrame).

    // The editor opens at the text's position, so clicking near an edge used to put half of it

    // Where each panel lives: 'left', 'right' or 'float'. Panels are drawn from these rather than
    // from fixed positions in the layout, so dragging one only has to change this value.

    // The audio and video tracks move together - loading audio sets four of these at once - so
    // they are one reducer. Destructured here so every read site keeps the name it always had;
    // only the writes go through an action. See core/mediaReducer.
    const [media, dispatchMedia] = React.useReducer(mediaReducer, EMPTY_MEDIA);
    const { audioFile, audioUrl, audioDuration, audioData } = media;
    // Video overlay track: play the original video underneath the drawing layers (no per-frame
    // cuts) - for drawing over a video. Like audio, but painted onto the canvas each frame.
    const { videoOverlay } = media; // { name, startTime, endTime, offset, duration, w, h, cuts? }
    // Which media rows are folded away in the timeline. Purely a view setting - the audio still
    // plays and the video still draws; this is only about giving the cut tracks the height back.
    const [hiddenTracks, setHiddenTracks] = useStored('mv_hidden_tracks', { audio: false, video: false }, {
        // Spread over the defaults, so a stored value from before a track existed still names it.
        decode: (raw) => ({ audio: false, video: false, ...JSON.parse(raw) }),
        encode: JSON.stringify,
    });
    const toggleTrackHidden = (which) => setHiddenTracks(h => ({ ...h, [which]: !h[which] }));
    // Everything bringing a video into the project remembers. The logic stays here; what it
    // keeps does not.
    const vid = useVideoImportState();
    const [autoSceneDetect, setAutoSceneDetect] = useStored('mv_auto_scene', true, onOffCodec);
    // YouTube link input. A native prompt fails silently once blocked, so this asks in-app.

    const audio = useAudioTrack({ audioUrl, dispatchMedia, setLinkPrompt: notices.setLinkPrompt });
    const {
        audioRef, audioB64Ref, audioCtxRef, audioSourceRef, audioDestRef,
        audioAsBlob, restoreAudio, loadAudioUrl, handleAudioUpload, handleDeleteAudio, loadYoutubeAudio,
        muted: audioMuted, setMuted: setAudioMuted,
    } = audio;
    // Make failures visible. Once the browser blocks dialogs, alert is swallowed and the app
    // looks like it simply did nothing - which is exactly why one bug here took so long to find.
    const isExporting = useRef(false);
    const mediaRecorderRef = useRef(null);
    const exportEndRef = useRef(0);
    const exportStartRef = useRef(0);
    // How the playback loop asks the recorder for a frame; null means the stream samples itself.
    const requestFrameRef = useRef(null);

    const {
        tool, setTool, etool, rulerMode, setRulerMode, softMode, setSoftMode, handleSetTool,
        color, setColor, applyColor, recentColors, noteColorUsed, pickColor, pickingColor, setPickingColor,
        brushSize, setBrushSize, eraserSize, setEraserSize, toolSize, setToolSize,
        opacity, setOpacity, pressureOn, setPressureOn, mosaicBlock, setMosaicBlock,
    } = useToolSettings({
        // A tool change is refused outright while a selection is floating or a text is being
        // edited: both are modes of their own, and leaving them by picking up another tool
        // would silently discard what is in them.
        busy: () => !!selection || !!textEdit,
        leaveCurve: () => { if (curve.anchorsRef.current) curve.commit(); },
    });
    const lassoClipRef = useRef(null); // copied lasso pixels: { bitmapId, w, h }
    // What is picked in the cut list, and how much of it is unfolded. Cleared together.
    const cutList = useCutListUi();
    const [hasLassoClip, setHasLassoClip] = useState(false);
    const fileHandleRef = useRef(null);
    // Shared by both document hooks: the server backup falls back to it for a name, and the
    // local save writes it. Owned here because the two hooks cannot both create it.
    const localNameRef = useRef('');
    const canvasRef = useRef(null);
    // One pointer gesture at a time: the stroke being drawn, the lasso loop, the layers or the
    // selection being dragged, the path being recorded. All refs - a pointer move arrives far
    // more often than a frame, and re-rendering on each one is what made the lasso miss the pen.
    const gesture = useGesture({ canvasRef });
    // While the liquify brush is down: the layer's pixels being pushed around, and the canvas
    // the overlay shows them from. The layer itself is hidden until the pen lifts.
    /** Layers a gesture is drawing on the overlay instead, so the composite must skip them. */
    const hiddenByGesture = (cutId, layerId) => {
        const d = gesture.layerDrag.current;
        if (d && d.cutId === cutId && d.layerIds.includes(layerId)) return true;
        const q = liquify.ref.current;
        return !!q && q.cutId === cutId && q.layerId === layerId;
    };
    const [dragTick, setDragTick] = useState(0); // signal to redraw with the original hidden while dragging
    const boilPhaseRef = useRef(0);       // boiling-motion phase; advancing it over time makes the strokes shimmer in place
    const [boilTick, setBoilTick] = useState(0); // phase ticker so the boiling motion previews even while paused for editing
    const timelineRef = useRef(null);

    // Which panels are on screen, and the Tab that folds them all away and puts them back.
    const {
        showLeft, setShowLeft, showRight, setShowRight, showBottom, setShowBottom,
        leftDock, setLeftDock, toggleAllPanelsRef, panelOpen,
    } = usePanelVisibility({ timelineRef });
    // User-adjustable canvas resolution. Shadows the imported defaults for the whole component.
    const [canvasSize, setCanvasSize] = useState({ w: CANVAS_W_DEFAULT, h: CANVAS_H_DEFAULT });
    const CANVAS_W = canvasSize.w, CANVAS_H = canvasSize.h;
    const [copiedCut, setCopiedCut] = useState(null);
    const [selection, setSelection] = useState(null);
    const [textEdit, setTextEdit] = useState(null);
    const [selectedText, setSelectedText] = useState(null);
    // The pixels strokes point at - fills, pastes, video frames - and the rules for decoding and
    // releasing them: canvas/bitmapStore. Made once; the canvas size is read when a frame is
    // decoded, since it can change after the store exists.
    const canvasSizeRef = useRef([CANVAS_W, CANVAS_H]);
    canvasSizeRef.current = [CANVAS_W, CANVAS_H];
    const bitmapStore = useRef(null);
    if (!bitmapStore.current) bitmapStore.current = createBitmapStore({ canvasSize: () => canvasSizeRef.current });
    const { store: storeBitmap, storeBlob: storeBitmapBlob, decodeFrame: decodeFrameBitmap, touch: touchDecoded, trim: trimDecodedFrames, clone: cloneBitmapId } = bitmapStore.current;
    const bitmapStoreRef = useRef(bitmapStore.current.map);
    const paintFrameRef = useRef(/** @type {((t: number, playing: boolean) => void) | null} */(null)); // set below, beside paintFrame
    const renderStateRef = useRef(/** @type {{cuts: any[], currentCutId: any, cw: number, ch: number}} */({ cuts: [], currentCutId: null, cw: 1920, ch: 1080 })); // set below, beside liveRef
    const prefetchRef = useRef(null); // prefetchFramesAt, called by the rAF loop with the real playhead
    const canvasAreaRef = useRef(null);
    const videoFileRef = useRef(null);
    const playheadRef = useRef(null);        // moved imperatively during playback
    // What paintFrame keeps between frames - the effects' scratch canvases, the snow tile, the
    // painted-once flag. One object, made once; see canvas/framePaint.
    const frameScratch = useRef(createFrameScratch());
    const dataUrlCacheRef = useRef(new Map()); // id -> {imageData, url}; avoids re-encoding bitmaps each autosave
    const liveRef = useRef({}); // latest {cuts, copiedCut, selection} for safe bitmap GC from effects
    const textAreaRef = useRef(null);
    // Which document is loaded, as a number that changes whenever the whole thing is replaced.
    //
    // Long jobs - extracting frames from a video, detecting scenes - can be sent to the
    // background and finish minutes later, by which time another project may be open. They
    // captured no notion of *which* project they were started for, so the result landed in
    // whatever was on screen: frames from project 1 appearing in project 2. Each job takes a copy
    // of this when it starts and drops its result if it no longer matches.
    const docEpochRef = useRef(0);
    const cutDragMovedRef = useRef(false); // distinguishes a click (select) from a real drag (move)
    const cutDragArmedRef = useRef(false); // long-press must arm before a touch can drag a cut
    const cutDragTimerRef = useRef(null);
    const [animLayer, setAnimLayer] = useState(null); // {cutId, layerId} whose part-anim panel is open
    const [jitterLayer, setJitterLayer] = useState(null); // {cutId, layerId} whose boiling-settings panel is open
    // A transparent canvas is a different document, not a different view: the frame really has
    // no background, and the checkerboard behind it is CSS on the element rather than pixels.
    // Painting the checkerboard in would put it in every export.
    const [transparentBg, setTransparentBg] = useStored('mv_transparent_bg', false, oneZeroCodec);
    // What a transparent project exports as. GIF is one file that plays, at the price of one-bit
    // transparency; a PNG sequence keeps the soft edges and goes into an editor.
    const [transparentFormat, setTransparentFormat] = useStored('mv_transparent_format', 'gif');
    // Whether the project API is reachable. Re-checked with a backoff rather than once, because
    // an app that decided at load time is an app that never notices the server starting.
    const serverAvailable = useServerProbe();

    // The lang state exists only to trigger a redraw; lookups read the module variable.
    // Nothing here is memoised, so changing it re-renders the whole tree in the new language.
    const [lang, setLang] = useState(loadLang);
    const changeLang = (l) => { setLangValue(l); saveLang(l); setLang(l); };
    // What the app looks like: the accent, the chrome's saturation, and the recent colours.
    const { themeColor, setThemeColor, themeRecent, uiSat, setUiSat } = useAppearance({ applyTheme, defaultTheme: DEFAULT_THEME });
    // One place writes the keymap. It used to be written in three: here, and again inside each
    // of the two modals that edit it.
    const [keymap, setKeymap] = useStored('mv_keymap', { ...DEFAULT_KEYS }, {
        decode: (raw) => keymapFrom(JSON.parse(raw)),
        encode: JSON.stringify,
    });
    // The view - zoom and offset - and every gesture that changes it, from a hook. It only needs
    // the element the wheel listens on.
    const { view, setView, zoomCanvas, resetView, spaceDown, spaceDownRef, panningRef, lastInteractRef,
        onAreaPointerDown, onAreaPointerMove, onAreaPointerUp } = useCanvasView({ canvasAreaRef });
    // {cutId, layerId} while the sway profile is being dragged on the canvas rather than typed.
    const [spineEdit, setSpineEdit] = useState(null);


    const isDraggingOrResizingRef = useRef(false);

    const updLayers = (cutId, fn) => dispatchCuts(patchCut(cutId, fn));

    // Work out which layer to actually draw into: if the active one is a folder or missing,
    // fall back to the topmost visible drawing layer. A hidden active layer is kept, but made
    // visible again on commit, so a stroke never disappears.
    const resolveDrawLayer = (cut) => resolveDrawLayerPure(cut, flattenLayersInUiOrder);
    // Commit the stroke to its target layer and force that layer and its parent folders
    // visible, so the result is always on screen.
    const commitStrokeToLayer = (cutId, layerId, st, place) => {
        // A missing layer yields null; an empty patch then leaves the cut alone rather than
        // writing a half-formed one.
        updLayers(cutId, c => commitStroke(c.layers, layerId, st, place) || {});
    };

    const cancelSelection = () => {
        setSelection(null);
        gesture.lasso.current = null;
        clearLiveOverlay();
        gesture.selectionDrag.current = null;
    };

    // The strokes that put a selection back, or null - with the selection cancelled - if either
    // of its bitmaps is gone. Both commits start this way; a selection whose pixels have been
    // evicted has nothing to commit and must not leave a half-made pair behind.
    const takeSelectionStrokes = (sel) => {
        if (!sel) return null;
        const store = bitmapStoreRef.current;
        const has = (id) => { const e = store.get(id); return !!(e?.imageData || e?.imageBitmap); };
        if (!has(sel.bitmapId) || !has(sel.maskBitmapId)) { cancelSelection(); return null; }
        return selectionStrokes(sel, nextId(), nextId());
    };

    const commitSelectionImpl = (sel) => {
        const strokes = takeSelectionStrokes(sel);
        if (!strokes) return;
        const { erase, paste } = strokes;
        updLayers(sel.cutId, c => ({
            layers: c.layers.map(l => l.id !== sel.sourceLayerId ? l : { ...l, strokes: [...l.strokes, erase, paste] }),
        }));
        cancelSelection();
    };

    const commitSelection = () => commitSelectionImpl(selection);

    // Lasso to part: lift the selected region out of its source layer into a NEW layer,
    // so that region can be animated on its own (via the layer/part animation panel).
    const extractSelectionToPart = () => {
        const sel = selection;
        const strokes = takeSelectionStrokes(sel);
        if (!strokes) return;
        const { erase, paste } = strokes;
        const newId = nextLayerId(cuts.find(c => c.id === sel.cutId)?.layers);
        updLayers(sel.cutId, c => {
            const layers = patchLayer(c.layers, sel.sourceLayerId, l => ({ strokes: [...l.strokes, erase] }));
            const partLayer = { id: newId, name: tr('파츠 {0}', newId), type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [paste] };
            return { layers: [...layers, partLayer], activeLayerId: newId };
        });
        cancelSelection();
        setAnimLayer({ cutId: sel.cutId, layerId: newId }); // open its anim panel
    };

    // Ctrl+T: the whole active layer as a floating selection (#176) - the drawing's painted
    // bounds, not the canvas, so a small drawing does not get a screen-sized box around it.
    const selectAllAsLasso = () => {
        if (selection) commitSelectionImpl(selection);
        const source = renderLassoSource();
        if (!source) return;
        const b = paintedBounds(source.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data, CANVAS_W, CANVAS_H);
        if (!b) { notices.setToast(tr('이 레이어에는 아직 그린 것이 없습니다')); return; }
        handleSetTool('lasso');
        liftLassoSelection([{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }], source);
    };

    // Lasso copy: clone the selected pixels to a clipboard. Paste: drop them as a paste
    // stroke on the current active layer (offset slightly so it's visible).
    const copyLassoSelection = () => {
        const sel = selection;
        if (!sel) return;
        const cache = new Map();
        const bitmapId = cloneBitmapId(sel.bitmapId, cache);
        lassoClipRef.current = { bitmapId, w: Math.max(1, Math.round(sel.tw)), h: Math.max(1, Math.round(sel.th)) };
        setHasLassoClip(true);
        commitSelectionImpl(sel); // keep the original in place
    };
    const pasteLassoSelection = () => {
        const clip = lassoClipRef.current;
        const cut = currentCut;
        if (!clip || !cut) return;
        // Through the same two guards a stroke goes through, because paste had neither and so
        // had two ways to do nothing at all while reporting success:
        //
        //   - `cut.activeLayerId` can be a folder, or an id whose layer is gone. patchLayer then
        //     matches nothing and the paste evaporates.
        //   - the target layer, or a folder above it, can be hidden. The paste lands and is
        //     invisible, which reads exactly the same from the outside.
        //
        // resolveDrawLayer answers the first, commitStroke reveals for the second - the pair
        // drawing has used all along.
        const layer = resolveDrawLayer(cut);
        if (!layer) return;
        const bmpCache = new Map();
        const bitmapId = cloneBitmapId(clip.bitmapId, bmpCache); // independent copy per paste
        const x = Math.round(CANVAS_W / 2 - clip.w / 2), y = Math.round(CANVAS_H / 2 - clip.h / 2);
        commitStrokeToLayer(currentCutId, layer.id, { id: nextId(), tool: 'paste', bitmapId, x, y, w: clip.w, h: clip.h });
        notices.setToast(tr('붙여넣었습니다 — 캔버스 가운데'));
    };


    // Undo/redo lives in useHistory. What stays here is the two things only this component can
    // answer: what the document currently is, and whether a gesture is in progress - drawing,
    // dragging a cut, moving a selection - during which a snapshot would capture a half-finished
    // state.
    const historySnapshot = useMemo(() => ({ cuts, audioData, numTracks }), [cuts, audioData, numTracks]);
    const { undo: globalUndo, redo: globalRedo, record: recordHistory, entries: historyEntries } = useHistory({
        snapshot: historySnapshot,
        shouldSkip: () => gesture.drawing.current || isDraggingOrResizingRef.current || !!gesture.selectionDrag.current,
        apply: (snap) => {
            dispatchCuts(replaceCuts(snap.cuts));
            dispatchMedia(setAudioClip(snap.audioData ?? null));
            setNumTracks(snap.numTracks ?? 2);
        },
    });
    // Record from liveRef rather than from state: the callers are inside effects and event
    // handlers whose closures may be a render old, and the ref keeps their dependency lists
    // honest. useCallback so the timeline-drag effect that depends on it does not re-subscribe
    // every render.
    const recordLiveHistory = useCallback(() => {
        const lv = liveRef.current;
        recordHistory({ cuts: lv.cuts, audioData: lv.audioData, numTracks: lv.numTracks });
    }, [recordHistory]);

    // The ruler runs to the content plus a tail of empty room to drag into, and never less than
    // TIMELINE_MIN_SPAN - a music video is three to five minutes, so a timeline that stops at two
    // leaves nowhere to place anything before the audio is loaded.
    // The layer whose sway profile is on the canvas, or null. Resolved from ids rather than held
    // as an object, so deleting the layer or switching cut simply ends the edit instead of leaving
    // handles floating over something else.
    const spineLayer = (() => {
        if (!spineEdit) return null;
        const cut = cuts.find(c => c.id === spineEdit.cutId);
        const layer = cut?.layers?.find(l => l.id === spineEdit.layerId);
        return Array.isArray(layer?.anim?.swayProfile) && layer.anim.swayProfile.length > 1 ? layer : null;
    })();

    const maxTime = Math.max(TIMELINE_MIN_SPAN, audioData?.endTime ?? audioDuration, videoOverlay?.endTime ?? 0, ...cuts.map(c => c.endTime)) + TIMELINE_TAIL_PAD;

    // How the timeline is being looked at: the zoom, the visible slice of it that is actually
    // rendered, and the two things drawn over it during a drag.
    const tl = useTimelineView({ timelineRef, mounted: showBottom, height: timelineH, maxTime, numTracks });

    // Content bounds - playback and loop run between these, not out to maxTime, which has empty
    // padding for the timeline ruler.
    // Parts (scenes): cuts grouped by partId. Each video import is one part; cuts can also be
    // grouped manually. Selecting a part scopes playback (and dims the rest) to it.
    const parts = derivePartsFrom(cuts, tr('파트'));
    const activePart = cutList.activePartId ? parts.find(p => p.id === cutList.activePartId) : null;
    // Playback runs within the active part when one is selected, else across all content. The
    // exports use the same two numbers - see playRange.js for what that fixed.
    const { start: playStart, end: playEnd } = playRange({ cuts, audio: audioData, video: videoOverlay, part: activePart });
    // The export starts at the first cut, not at the music: an intro before any drawing is
    // wanted while working and not in the file.
    const { start: exportStart } = exportRange({ cuts, audio: audioData, video: videoOverlay, part: activePart });

    // Playback owns the clock: isPlaying, currentTime, and the refs the rAF loop reads instead
    // of state so it never runs on a stale closure. Everything passed in is an input - playback
    // is a function of the timeline, the media and where to paint - and the groups say which is
    // which rather than leaving seventeen arguments in a row.
    const playback = usePlayback({
        media: { audioRef, videoElRef: vid.elRef, audioUrl, audioData, videoOverlay },
        range: { playStart, playEnd, maxTime, loopPlay, playbackRate, anchorTime: currentCut?.startTime },
        paint: { pps: tl.pps, playheadRef, paintFrameRef, prefetchRef },
        recording: { isExporting, exportEndRef, exportStartRef, requestFrameRef, mediaRecorderRef },
    });
    const {
        isPlaying, setIsPlaying, currentTime, setCurrentTime,
        currentTimeRef, seekRef, isPlayingRef,
        playPause: handlePlayPause, stop: handleStop,
    } = playback;

    // The layer canvases: which cuts are rendered to one, when they are rebuilt, the frames
    // decoded ahead of the playhead, and the clip groups flattened on top. hooks/useLayerCache
    // owns all of it over the bitmap store; App reads the cache for its rows and paints from
    // ensureLayerCanvas and flattenClipGroup.
    const {
        layerCanvasCache, clearLayerCache, ensureLayerCanvas, flattenClipGroup,
        invalidateCutsUsing, requestFrameDecode, frameDecodeTick, requestRepaint,
    } = useLayerCache({
        store: bitmapStore.current, cuts, currentCutId, currentCut, currentTime, onionPrev, onionNext,
        activePartId: cutList.activePartId, isPlaying, isPlayingRef, canvasW: CANVAS_W, canvasH: CANVAS_H, hiddenByGesture,
        prefetchRef, boilPhaseRef,
    });



    // Keys. Which key means what is core/shortcuts, tested; this is only what each does.
    useShortcuts(keymap, {
        state: () => ({ selection: !!selection, textEdit: !!textEdit, currentCut: !!currentCutId, clipboard: !!copiedCut }),
        save: () => doSave(false),
        togglePanels: () => {
            toggleAllPanelsRef.current?.();
            // Folding unmounts whatever held focus, and focus then falls back to <body> - which
            // is why the next Tab started from the top of the page. Put it on the canvas
            // instead, where the shortcuts are aimed.
            requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }));
        },
        // handleSetTool does the tidying a switch needs (committing a curve in progress,
        // refusing while the text editor is open).
        tool: (id) => handleSetTool(id),
        // Arrows throughout: several of these are declared further down, and the object is
        // built at render time.
        undo: () => globalUndo(), redo: () => globalRedo(),
        zoomIn: () => zoomCanvas(1.25), zoomOut: () => zoomCanvas(1 / 1.25), resetView: () => resetView(),
        brushUp: () => setToolSize(brushUp(toolSize)), brushDown: () => setToolSize(brushDown(toolSize)),
        selectAll: () => selectAllAsLasso(),
        copyCut: () => handleCopyCut(currentCutId), pasteCut: () => handlePasteCut(),
        duplicateCut: () => handleDuplicateCut(currentCutId), deleteCut: () => handleDeleteCut(currentCutId),
        cancelSelection: () => cancelSelection(), commitSelection: () => commitSelection(),
    });

    useEffect(() => {
        if (selection && selection.cutId !== currentCutId) cancelSelection();
    }, [currentCutId, selection]);

    useEffect(() => {
        if (selectedText && selectedText.cutId !== currentCutId) setSelectedText(null);
    }, [currentCutId, selectedText]);

    // Put the cursor in the textarea when the editor opens - once, when it opens.
    //
    // Depending on `textEdit` itself meant this ran on every keystroke in every other field of
    // the editor, because they all patch the same object. Typing a size then jumped the cursor
    // back into the textarea and the remaining digits were typed into the text.
    //
    // The session key is which text is being edited, so switching straight from one text to
    // another still focuses, while editing the current one never steals the cursor back.
    const textEditSession = textEdit ? `${textEdit.cutId}:${textEdit.textId ?? 'new'}` : null;
    useEffect(() => {
        if (!textEditSession) return;
        // After the overlay has rendered, or there is nothing to focus yet.
        queueMicrotask(() => textAreaRef.current?.focus());
    }, [textEditSession]);

    useEffect(() => {
        if (isPlaying) {
            const top = topCutAt(cuts, currentTime);
            if (top && top.id !== currentCutId) setCurrentCutId(top.id);
        }
    }, [currentTime, isPlaying]);


    useEffect(() => {
        if (!isPlaying && audioRef.current && audioUrl && Math.abs(audioRef.current.currentTime - currentTime) > 0.1)
            audioRef.current.currentTime = currentTime;
        // audioRef is listed because the linter can no longer see it is a ref: it comes from
        // useAudioTrack now, and a ref object's identity never changes, so this costs nothing.
    }, [currentTime, isPlaying, audioUrl, audioRef]);
    // Paused: seek the overlay video to the scrubbed time so the canvas shows that frame (onseeked repaints).
    useEffect(() => {
        if (isPlaying) return;
        const v = vid.elRef.current; if (!v || !videoOverlay) return;
        if (currentTime >= videoOverlay.startTime && currentTime < videoOverlay.endTime) {
            const exp = (currentTime - videoOverlay.startTime) + videoOverlay.offset;
            const want = seekTarget(exp, v.duration);
            if (Math.abs(v.currentTime - want) > 0.03) { try { v.currentTime = want; } catch { } }
        }
        // vid.elRef is a ref and never changes identity; listed because the linter can no
        // longer tell that from the name, now that it belongs to the video import's own state.
    }, [currentTime, isPlaying, videoOverlay, vid.elRef]);


    // Make the speed being previewed at the film's real speed.
    //
    // The selector slows the preview; the export comes out at whatever the cuts say. So a project
    // that only reads right at 0.25x is a project whose cuts are four times too short, and
    // watching it slowly is a workaround rather than a setting. This writes the workaround into
    // the cuts and puts the selector back to normal, so what is exported is what was on screen.
    //
    // No confirmation dialog: it is one dispatch, the history entry is recorded first, and Ctrl+Z
    // puts it back. A dialog before an undoable action buys nothing and gets clicked through.
    const bakeInfo = bakePlan(cuts, playbackRate, { audio: !!audioUrl, video: !!videoOverlay });
    const bakePlaybackSpeed = () => {
        const plan = bakeInfo;
        if (plan.noop) return;
        recordLiveHistory();
        dispatchCuts(replaceCuts(scaleProjectTimes(cuts, plan.factor)));
        setPlaybackRate(RATE_DEFAULT);
        notices.setToast(plan.stranded.length
            ? tr('{0}배 길이로 굳혔습니다 · 음원/영상 트랙은 늘어나지 않으니 위치를 다시 맞춰주세요 · Ctrl+Z로 취소', plan.factor.toFixed(2).replace(/\.?0+$/, ''))
            : tr('{0}배 길이로 굳혔습니다 · Ctrl+Z로 취소', plan.factor.toFixed(2).replace(/\.?0+$/, '')));
    };



    // Named out of the bundle so the dependency list is the two things this uses. Depending on
    // `tl` would re-subscribe the window drag every time the timeline scrolled.
    const { pps, setSnapLinePos } = tl;
    useEffect(() => {
        if (!resizingData && !draggingCutData) return;
        isDraggingOrResizingRef.current = true;
        const mv = (e) => {
            if (resizingData) {
                // Absolute drag: offset from the fixed start point applied to the edge's
                // initial value. (The old incremental form drifted/jumped against snapping.)
                const dt = (e.clientX - resizingData.startX) / pps;
                const i0 = resizingData.initialStart, i1 = resizingData.initialEnd;
                if (resizingData.cutId === 'audio') {
                    // Both edges are computed from where the drag began plus the delta, so the
                    // result does not depend on the previous value and the reducer stays pure.
                    if (resizingData.edge === 'left') {
                        const ns = Math.max(0, Math.min(i1 - 0.1, i0 + dt));
                        dispatchMedia(resizeAudio('left', ns, null, (resizingData.initialOffset ?? 0) + (ns - i0)));
                    } else {
                        dispatchMedia(resizeAudio('right', null, Math.max(i0 + 0.1, i1 + dt), null));
                    }
                    return;
                }
                // The geometry is in cutOps and unit tested; only the guide line is a side
                // effect, and it is done out here. Setting state from inside an updater looks
                // harmless but React invokes updaters twice in StrictMode, and a reducer that is
                // not pure is a reducer that cannot be reasoned about or replayed. resizeCut
                // works from the edges the drag started at plus the delta, so reading the
                // document from liveRef gives the same answer as the updater's argument would.
                const r = resizeCut(liveRef.current.cuts, { cutId: resizingData.cutId, edge: resizingData.edge, initialStart: i0, initialEnd: i1 }, dt, pps);
                setSnapLinePos(r.snapAt == null ? null : xAtTime(r.snapAt, pps));
                dispatchCuts(replaceCuts(r.cuts));
            } else if (draggingCutData) {
                // A cut only moves once the press is "armed" (long-press on touch, immediate
                // for mouse/pen). Before arming, a small move cancels the long-press so a
                // tap/scrub never accidentally drags the cut.
                if (!cutDragArmedRef.current) {
                    if (Math.abs(e.clientX - draggingCutData.startX) > 6 || Math.abs(e.clientY - draggingCutData.startY) > 6) {
                        clearTimeout(cutDragTimerRef.current);
                    }
                    return;
                }
                cutDragMovedRef.current = true;
                const dt = (e.clientX - draggingCutData.startX) / pps, trackOff = Math.round((e.clientY - draggingCutData.startY) / 60);
                if (draggingCutData.cutId === 'audio') {
                    dispatchMedia(moveTrack('audio', draggingCutData.initialStart + dt)); return;
                }
                if (draggingCutData.cutId === 'video') {
                    dispatchMedia(moveTrack('video', draggingCutData.initialStart + dt)); return;
                }
                // Multi-cut drag: move the whole selected group by the same delta (keeps their
                // relative layout), clamped so none crosses t=0 or the track range.
                const grp = draggingCutData.group;
                if (grp && grp.length > 1) {
                    setSnapLinePos(null);
                    dispatchCuts(moveCutGroup(grp, dt, trackOff, numTracks));
                    return;
                }
                // Same as the resize above: the guide line is set out here so the state change
                // stays pure. dragCut places the cut at initialStart + dt, reading the others
                // only to snap against them, and they do not move during the drag.
                const r = dragCut(liveRef.current.cuts, draggingCutData, dt, trackOff, numTracks, pps);
                setSnapLinePos(r.snapAt == null ? null : xAtTime(r.snapAt, pps));
                dispatchCuts(replaceCuts(r.cuts));
            }
        };
        const up = () => {
            isDraggingOrResizingRef.current = false;
            clearTimeout(cutDragTimerRef.current);
            cutDragArmedRef.current = false;
            setResizingData(null); setDraggingCutData(null); setSnapLinePos(null);
            recordLiveHistory();
        };
        return dragOnWindow(mv, up);
    }, [recordLiveHistory, resizingData, draggingCutData, pps, setSnapLinePos, numTracks]);

    // Record an undo point for whatever is on screen now.
    //
    // This used to be written as setCuts(prev => { ...push...; return prev; }) - a state setter
    // abused to read the current state, doing its real work as a side effect and returning the
    // document unchanged. React invokes updater functions twice in StrictMode, so the push ran
    // twice and only the duplicate check below stopped a doubled history entry. liveRef already
    // holds the current document for exactly this kind of read, so nothing needs to pretend to
    // be a state update.
    // Free bitmaps no longer referenced by any cut, history snapshot, clipboard, or selection.
    // Scans ALL reference sources so undo/paste never lose their pixels.
    const gcBitmaps = () => {
        const live = liveRef.current;
        // Every reference source is named in bitmapRefs, where it is unit tested; missing one
        // here would free pixels that undo, paste or the current selection still need.
        const dead = unusedBitmapIds(bitmapStoreRef.current.keys(), {
            cuts: live.cuts,
            history: historyEntries(),
            copiedCut: live.copiedCut,
            lassoClip: lassoClipRef.current,
            selection: live.selection,
        });
        for (const id of dead) { bitmapStoreRef.current.delete(id); dataUrlCacheRef.current.delete(id); }
    };
    // assetSink: when provided (server save), whole-image frame bitmaps are NOT inlined as base64
    // in the JSON; they're collected here to upload as separate binary assets. This keeps the JSON
    // small so huge/original-quality projects don't OOM building one giant base64 string.
    // buildData(includeAudio, assetSink, blobsOk):
    //  - assetSink (server save): video frames/audio go out as separate binary assets (no base64).
    //  - blobsOk (IndexedDB autosave): frames stored as Blob objects (IDB persists them natively,
    //    so autosave stays cheap and low-memory even for a huge import).
    //  - neither (local .emv file): frames embedded as base64 dataURLs so the file is self-contained.
    const buildData = async (includeAudio = true, assetSink = null, blobsOk = false) => {
        const { bitmaps, compressed, assets } = await collectBitmaps(cuts, {
            store: bitmapStoreRef.current, cache: dataUrlCacheRef.current,
            assetSink, blobsOk, blobToDataURL, imageDataToDataURL,
        });
        const out = {
            version: '1.5', appName: 'EasyMVMaker', savedAt: new Date().toISOString(), numTracks, onionPrev, onionNext, pps: tl.pps, bitmaps, compressedBitmaps: compressed,
            canvas: { w: CANVAS_W, h: CANVAS_H },
            cuts: cuts.map(c => ({ ...c, layers: c.layers.map(l => ({ ...l, redoStrokes: [] })) }))
        };
        if (assetSink && assets.length) out.assets = assets;
        // Save the audio "with the music". For server save (assetSink) the audio goes out as a
        // separate binary asset — embedding it as base64 (often tens of MB) is the main remaining
        // OOM source. For local/autosave it's embedded so the file stays self-contained.
        // The three shapes a track can take - asset, Blob, dataURL - are packMedia's decision.
        // The audio is held as a dataURL and can make a Blob; the video is the reverse.
        if (includeAudio && audioB64Ref.current && audioData) {
            const meta = { name: audioFile?.name || tr('오디오'), startTime: audioData.startTime, endTime: audioData.endTime, offset: audioData.offset, duration: audioDuration };
            out.audio = await packMedia(meta, { id: '__audio__', ext: audioExt(audioB64Ref.current), assetSink, blobsOk, dataUrl: audioB64Ref.current, toBlob: audioAsBlob });
        }
        if (videoOverlay && vid.blobRef.current) {
            const meta = { name: videoOverlay.name, startTime: videoOverlay.startTime, endTime: videoOverlay.endTime, offset: videoOverlay.offset, duration: videoOverlay.duration, w: videoOverlay.w, h: videoOverlay.h, opacity: videoOverlay.opacity ?? 1, cuts: videoOverlay.cuts, cutStart: videoOverlay.cutStart, cutOffset: videoOverlay.cutOffset };
            out.video = await packMedia(meta, { id: '__video__', ext: videoExt(vid.blobRef.current.type), assetSink, blobsOk, blob: vid.blobRef.current, toDataUrl: blobToDataURL });
        }
        return out;
    };
    // Opening a project is not re-entrant. The first thing restore does is clear the bitmap
    // store, and then it awaits - fetching assets, decoding frames. A second open starting in
    // that window wipes the pixels the first one has already fetched, both write into the same
    // store, and whichever finishes last swaps in its cuts on top of a store holding a mixture:
    // a project that opens with artwork missing. Two clicks on a row of the server or local list
    // is enough, and nothing disabled the list while it worked.
    const restoreBusyRef = useRef(false);
    /**
     * Load a document into the app. False means it did not happen - the file was not ours, or
     * another open was already running - so a caller must not record the project's identity.
     */
    const restore = async (data, assetBase = null, label = tr('프로젝트 여는 중')) => {
        if (data.appName !== 'EasyMVMaker') { alert(tr('올바른 .emv 파일이 아닙니다.')); return false; }
        if (restoreBusyRef.current) return false;
        // Set inside the try, so that nothing between here and the finally can leave the flag up.
        // A flag that never comes down means no project can be opened again for the rest of the
        // session, which is a worse failure than the one being prevented.
        try {
        restoreBusyRef.current = true;
        // Progress: a project with many frames takes a while to open, so it gets a bar.
        // Only past a certain count, to stop small projects flashing one up for an instant.
        const total = bitmapLoadCount(data, assetBase);
        const { heavy, tick } = makeLoadProgress(total, p => notices.setProgress({ label, ...p }));
        if (heavy) notices.setProgress({ label, done: 0, total });
        // The pixels first, so fill/lasso/paste render correctly the moment the cuts swap in.
        let missingAssets = await fillBitmapStore(bitmapStoreRef.current, data, {
            assetBase, fetchAsset, tick, dataURLToImageData, createBitmap: (img) => createImageBitmap(img),
        });
        // Older files are brought up to the current shape in projectFormat, where the renames and
        // added fields are written down and tested.
        docEpochRef.current++;   // opening a project: anything still running belongs to the old one
        dispatchCuts(replaceCuts(migrateCuts(data.cuts)));
        cutList.reset();   // none of it names anything in the document being opened (#241)
        const s = projectSettings(data);
        if (s.canvas) setCanvasSize(s.canvas);
        setNumTracks(s.numTracks); setCurrentCutId(s.currentCutId); setCurrentTime(0);
        setOnionPrev(s.onionPrev); setOnionNext(s.onionNext); tl.setPps(s.pps);
        setCopiedCut(null); // clipboard may reference bitmaps from the old project
        clearLayerCache(); // Clear cache on new project
        // The audio lives in useAudioTrack, and so does putting it back: the element, the
        // base64 copy a local save needs, and the three shapes a stored track can arrive in.
        missingAssets += await restoreAudio(data, assetBase);
        missingAssets += await vid.restore(data.video, { assetBase, dispatchMedia, requestRepaint });
            // Said once, after everything that could be loaded has been. A project that opens
            // with holes in it should say so - the alternative is blank frames that look like the
            // work was lost. Deliberately not "not found on the server": this counts a missing
            // server asset and a frame that would not decode out of a local file, and only one of
            // those has a server in it.
            if (missingAssets) notices.setError(tr('{0}개의 파일을 불러오지 못해 비어 있습니다.', missingAssets));
        } finally { notices.setProgress(null); restoreBusyRef.current = false; }
        return true;
    };

    // Server projects and their rotating backups. Called here rather than beside the other hooks
    // because it needs buildData and restore, and both are defined above this point - a hook may
    // be called anywhere in the body as long as it is called unconditionally and in the same
    // order every render, and this is the first place both exist.
    const {
        serverProjects, setServerProjects,
        backupAt, backupBusy, backupList, setBackupList, backupProg,
        serverIdRef, serverNameRef, forgetProject,
        doServerSave, openServerList, doServerOpen, doServerDelete,
        doServerBackup, openBackupList, doBackupRestore, doBackupDelete,
    } = useServerStorage({
        serverAvailable, buildData, restore,
        setLoadProgress: notices.setProgress, setAppError: notices.setError, setToast: notices.setToast,
        liveRef, localNameRef,
    });

    const resetToEmpty = () => {
        fileHandleRef.current = null;
        bitmapStoreRef.current.clear();
        docEpochRef.current++;   // starting over
        dispatchCuts(replaceCuts([firstCut()]));
        setNumTracks(2); setCurrentCutId(1); setCurrentTime(0);
        setCopiedCut(null); cutList.reset();
        clearLayerCache();
        forgetProject();
        detachMedia(audioRef.current);
        audioB64Ref.current = null; dispatchMedia(clearAudio());
        vid.blobRef.current = null; dispatchMedia(clearVideo()); vid.setSceneCfg(null);
        detachMedia(vid.elRef.current);
    };
    // Files, browser storage and the tabs that hold several documents at once. Called here
    // because it needs buildData, restore and resetToEmpty, and this is the first point at which
    // all three exist.
    const {
        doSave, doOpen, doNew, readAndRestore, doSplitSave,
        localProjects, setLocalProjects, localIdRef,
        doLocalSave, openLocalList, doLocalOpen, doLocalDelete,
        tabs, activeTabId, switchTab, newTab, closeTab, renameTab,
        storageInfo, didRecoverRef,
    } = useLocalDocuments({
        buildData, restore, resetToEmpty,
        setAppError: notices.setError, setToast: notices.setToast, setLoadProgress: notices.setProgress, fileHandleRef, localNameRef,
    });

    // Debounced autosave to IndexedDB, so a refresh or a crash never costs work. It waits for
    // crash recovery to finish deciding - otherwise a new empty document overwrites the autosave
    // the user is about to be offered - and skips mid-gesture, where a half-drawn stroke is not
    // worth keeping and encoding one costs frames.
    // audioData and videoOverlay are in here because trimming either one is a change worth
    // keeping - and without them nothing about the media reached the autosave until the next
    // stroke happened to trigger one.
    const autosaveDoc = useMemo(() => ({ cuts, numTracks, onionPrev, onionNext, pps: tl.pps, audioData, videoOverlay }),
        [cuts, numTracks, onionPrev, onionNext, tl.pps, audioData, videoOverlay]);
    const { savedAt: autoSavedAt, error: autosaveErr } = useAutosave({
        doc: autosaveDoc,
        ready: () => didRecoverRef.current,
        busy: () => gesture.drawing.current || isDraggingOrResizingRef.current,
        build: () => {
            gcBitmaps();                       // reclaim orphaned bitmaps before encoding
            return buildData(true, null, true); // IDB stores frames and audio as Blobs natively
        },
        save: saveAutosave,
    });

    const handleAddCut = () => {
        const last = cuts[cuts.length - 1];
        const ns = last?.endTime ?? 0, trk = last?.track ?? 0;
        if (trk >= numTracks) setNumTracks(trk + 1);
        const nc = mkCut({ id: nextId(), name: `Cut ${cuts.length + 1}`, startTime: ns, endTime: ns + DEFAULT_CUT_DURATION, track: trk });
        dispatchCuts(addCuts([nc])); setCurrentCutId(nc.id); setCurrentTime(ns);
    };
    const handleDeleteCut = (id) => {
        const ids = (cutList.selectedCutIds.size > 1 && cutList.selectedCutIds.has(id)) ? new Set(cutList.selectedCutIds) : new Set([id]);
        const nc = cuts.filter(c => !ids.has(c.id));
        dispatchCuts(replaceCuts(nc));
        if (ids.has(currentCutId)) setCurrentCutId(nc.length > 0 ? nc[0].id : null);
        cutList.setSelectedCutIds(new Set());
    };
    // Clear all drawing + text in the current cut (every layer's strokes), keeping the layers.
    const handleClearCut = () => {
        if (!currentCutId) return;
        if (!window.confirm(tr('현재 컷의 모든 그림과 텍스트를 지울까요?'))) return;
        dispatchCuts(clearCut(currentCutId));
        cancelSelection();
        setSelectedText(null);
    };
    const updCutTime = (id, field, val) => { let v = Math.max(0, parseFloat(val) || 0); if (field === 'track') { v = Math.round(v); if (v >= numTracks) setNumTracks(v + 1); } dispatchCuts(updateCut(id, { [field]: v })); };
    const renameCut = (id, name) => dispatchCuts(updateCut(id, { name }));
    const updCutAnim = (id, patch) => dispatchCuts(setCutAnim(id, patch));
    const updCutCamera = (id, patch) => dispatchCuts(setCutCamera(id, patch));
    const updLayerAnim = (cutId, layerId, patch) => dispatchCuts(setLayerAnim(cutId, layerId, patch));
    const handleAddTrack = () => setNumTracks(p => p + 1);
    const handleDeleteTrack = (i) => { if (numTracks <= 1) return; if (!window.confirm(tr('Track {0} 삭제?', i))) return; dispatchCuts(deleteTrack(i)); setNumTracks(p => p - 1); };
    // Click a cut in the list: plain = select one, Ctrl/Cmd = toggle, Shift = range (timeline order).
    // Plain, Ctrl and Shift clicks are three selection rules; core/cutSelection has them.
    const handleCutClick = (e, id) => {
        cutList.setSelectedCutIds(p => selectionAfterClick(p, cuts, currentCutId, id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
        setCurrentCutId(id);
    };
    const handleCopyCut = (id) => {
        // The whole multi-selection when this cut is in it, else just this one. Deep-copied,
        // so later edits to the originals do not reach the clipboard.
        const arr = cutsToCopy(cuts, cutList.selectedCutIds, id).map(c => JSON.parse(JSON.stringify(c)));
        if (arr.length) setCopiedCut(arr);
    };
    // Deep-clone a cut's contents: remap layer ids to 1..N (rewriting parentId so
    // folder hierarchy survives), clone referenced bitmaps to fresh ids, copy texts.
    // Layer ids are renumbered and stroke pixels are copied - see cutClone for why both are
    // necessary. cloneBitmapId is passed in because it is the one part that touches the store.
    const cloneCutContents = (srcCut) => cloneCutContentsPure(srcCut, cloneBitmapId);

    // Paste goes right after the current cut, on its track, and pushes whatever follows on
    // that track aside by the pasted span - the same insertion duplicate uses. It used to add
    // the copies without shifting, so with a cut already after the current one the paste
    // landed on top of it, which the timeline otherwise refuses to let happen.
    const handlePasteCut = () => {
        if (!copiedCut) return;
        const arr = Array.isArray(copiedCut) ? copiedCut : [copiedCut];
        if (!arr.length) return;
        const src = currentCut;
        const at = src ? src.endTime : (cuts.length ? Math.max(...cuts.map(c => c.endTime)) : 0);
        const trk = src ? src.track : (arr[0]?.track ?? 0);
        const { cuts: made, span } = placeCopies(arr, at, trk, cloneCutContents, nextId);
        dispatchCuts(insertCutsShifting(trk, at, span, made, null));
        const last = made[made.length - 1];
        setCurrentCutId(last.id);
        setCurrentTime(last.startTime);
    };
    // Duplicate a cut as the *next frame*: clone it right after itself and push any
    // later cuts on the same track to make room. This is the core frame-by-frame flow.
    // Tweening: fills the gap between this cut and the next with generated in-between frames.
    // Not a crossfade - distance-field morphing, so the shapes themselves move and deform.
    const flattenCutToImageData = (cut) => {
        const cnv = document.createElement('canvas'); cnv.width = CANVAS_W; cnv.height = CANVAS_H;
        const c2 = cnv.getContext('2d');
        const order = flattenLayersInUiOrder(cut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
        for (let i = order.length - 1; i >= 0; i--) { const lc = ensureLayerCanvas(cut.id, order[i]); if (lc) c2.drawImage(lc, 0, 0); }
        return c2.getImageData(0, 0, CANVAS_W, CANVAS_H);
    };
    const doTween = async () => {
        const A = currentCut;
        if (!A) return;
        const B = cuts.filter(c => c.track === A.track && c.startTime > A.startTime).sort((a, b) => a.startTime - b.startTime)[0];
        if (!B) { alert(tr('다음 컷이 없습니다. 트위닝은 현재 컷과 다음 컷 사이를 채웁니다.')); return; }
        const s = window.prompt(tr('"{0}" → "{1}" 사이에 넣을 중간 프레임 개수 (1~12)', A.name, B.name), '3');
        if (!s) return;
        const n = Math.max(1, Math.min(12, Math.round(+s) || 3));
        notices.setProgress({ label: tr('중간 프레임 만드는 중'), done: 0, total: n });
        await new Promise(r => setTimeout(r, 30)); // paint the bar once before starting
        try {
            const make = morphPrepare(flattenCutToImageData(A), flattenCutToImageData(B));
            const dur = A.endTime - A.startTime;
            const newCuts = [];
            for (let i = 0; i < n; i++) {
                const img = make((i + 1) / (n + 1));
                const bitmapId = storeBitmap(img);
                const st = A.endTime + i * dur;
                const nc = mkCut({ id: nextId(), name: `${A.name}~${i + 1}`, startTime: st, endTime: st + dur, track: A.track });
                nc.layers[0].strokes.push({ id: nextId(), tool: 'paste', bitmapId, x: 0, y: 0 });
                newCuts.push(nc);
                notices.setProgress({ label: tr('중간 프레임 만드는 중'), done: i + 1, total: n });
                await new Promise(r => setTimeout(r, 0)); // yield to the UI between frames so it does not look frozen
            }
            dispatchCuts(insertCutsShifting(A.track, A.endTime, n * dur, newCuts));
        } catch (e) { alert(tr('트위닝 실패: ') + e.message); }
        finally { notices.setProgress(null); }
    };

    const handleDuplicateCut = (id) => {
        const cut = cuts.find(c => c.id === (id ?? currentCutId));
        if (!cut) return;
        const dur = cut.endTime - cut.startTime;
        const insertAt = cut.endTime;
        const newId = nextId();
        const { layers, activeLayerId, texts } = cloneCutContents(cut);
        const nc = { id: newId, name: `${cut.name}+`, startTime: insertAt, endTime: insertAt + dur, track: cut.track, layers, activeLayerId, texts };
        dispatchCuts(insertCutsShifting(cut.track, insertAt, dur, [nc], cut.id));
        setCurrentCutId(newId);
        setCurrentTime(insertAt);
    };

    // What each does to the layer stack lives in core/layerOps; these only stop the click from
    // also selecting the cut row underneath.
    const handleAddLayer = (e, cutId) => { e.stopPropagation(); updLayers(cutId, appendLayer); };
    const handleAddFolder = (e, cutId) => { e.stopPropagation(); updLayers(cutId, appendFolder); };
    const handleDeleteLayer = (e, cutId, layerId) => { e.stopPropagation(); updLayers(cutId, c => removeLayerTree(c, layerId)); };
    const handleToggleVisible = (e, cutId, layerId) => { e.stopPropagation(); updLayers(cutId, c => ({ layers: patchLayer(c.layers, layerId, l => ({ visible: !l.visible })) })); };
    const handleSetActive = (e, cutId, layerId) => {
        e.stopPropagation();
        const cut = cuts.find(c => c.id === cutId); if (!cut) return;
        const layer = cut.layers.find(l => l.id === layerId); if (!layer || layer.type === 'folder') return;
        dispatchCuts(updateCut(cutId, { activeLayerId: layerId }));
        // One thing is selected at a time. Picking a layer is what makes the move tool move that
        // layer rather than a text picked earlier.
        setSelectedText(null);
    };
    const handleToggleFolder = (e, cutId, fid) => { e.stopPropagation(); updLayers(cutId, c => ({ layers: patchLayer(c.layers, fid, l => ({ collapsed: !l.collapsed })) })); };
    // Boiling: wobbles the strokes already on the layer. Each click cycles off, light, strong,
    // and it never alters the stored strokes.
    // Opens and closes the boiling settings, where strength, wavelength, speed and the minimum
    // width are entered directly.
    const updLayerProps = (cutId, layerId, obj) => dispatchCuts(updateLayer(cutId, layerId, obj));
    const toggleJitterPanel = (e, cutId, layerId) => { e.stopPropagation(); setJitterLayer(j => (j && j.cutId === cutId && j.layerId === layerId) ? null : { cutId, layerId }); };

    // Reordering layers by drag: the state and handlers are the hook's, the moves are layerOps.
    const { dragLayerInfo, dropInfo, onLayerDragStart, onLayerDragOver, onLayerDrop, onListDrop, onLayerDragEnd } = useLayerDnD({ updLayers });

    // Pressure is flattened here rather than at render time, so it is baked into the stroke and
    // the drawing keeps the shape it had when it was made. Turning the preference off later does
    // not go back and change work that is already on the canvas.
    // 0.5 is the neutral value the renderer treats as "no pressure information".
    const getPos = (e) => {
        const c = canvasRef.current, r = c.getBoundingClientRect();
        const pressure = pressureOn && e.pressure > 0 ? e.pressure : 0.5;
        return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), pressure };
    };
    // Fast strokes get coalesced by the browser into one event; this recovers every
    // intermediate sample so quick curves stay curved instead of going polygonal.
    const samplesOf = (e, pos) => {
        const raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        return raw && raw.length > 1 ? raw.map(getPos) : [pos];
    };
    // A stroke as it begins, with the pen's current settings. The eraser keeps its own width;
    // `pen` records whether pressure was on and the pointer a stylus, which the renderer reads.
    const newStroke = (tool, points, e) => ({
        id: nextId(), tool, color, opacity, size: tool === 'eraser' ? eraserSize : brushSize, points,
        pen: pressureOn && e.pointerType === 'pen',
    });
    // Render only the in-progress stroke on the overlay canvas — one stroke, no full-layer rebuild.
    // Live preview while drawing. This used to re-smooth and redraw the entire stroke on every
    // pointer move: the cost of one redraw grew with the length of the line and the total grew
    // quadratically, so drawing fast fell behind the input and the curve came out kinked.
    // Now it (1) draws at most once per frame via rAF and (2) leaves what is already drawn
    // alone, appending only the new tail - which makes the cost per movement independent of
    // The live overlay: a transparent canvas above the main one, holding the stroke being drawn
    // before it is committed to a layer. Everything that touches it goes through these two, so
    // there is one answer to "is it there yet" and one to "how do I wipe it".
    //
    // Both matter more than they look. Four places wrote the clear out by hand, and forgetting it
    // is not a crash - the stroke is simply drawn twice, once live and once committed, which
    // reads as a doubled or smeared line and looks like a rendering bug rather than a missing
    // call.

    // The overlay canvas and the incremental drawing of the stroke on it - see the hook for
    // what makes that incremental part delicate.
    const {
        overlayRef: liveCanvasRef, ctx: liveCtx, clear: clearLiveOverlay,
        renderStroke: renderLiveStroke, schedule: scheduleLiveRender, restart: restartLiveStroke,
    } = useLiveOverlay({ strokeRef: gesture.stroke, bitmapStoreRef, drawStrokes: drawStrokesOnCtx });
    // The loop as it is drawn, on the overlay. Line width in screen pixels, so it is as visible
    // zoomed out as zoomed in.
    const renderLassoPreview = () => {
        const ctx = liveCtx(); if (!ctx) return;
        clearLiveOverlay();
        const pts = gesture.lasso.current; if (!pts || pts.length === 0) return;
        drawMarquee(ctx, pts, view.zoom);
    };
    // A finished stroke leaves the overlay and enters the document. Baked straight onto the
    // main canvas at the same coordinates first, and the overlay cleared at once, so the line
    // cannot disappear no matter how state updates and repaints are timed - the next normal
    // repaint replaces it with an identical result. The curve ruler and every drag stroke end
    // this way; it was two copies, and the curve's had grown a different idea of which layer
    // to fall back to.
    const commitLiveStroke = (st) => {
        const mc = canvasRef.current; if (mc) drawStrokesOnCtx(mc.getContext('2d'), [st], false, bitmapStoreRef.current);
        clearLiveOverlay();
        // The target was fixed when the gesture began. If somehow it was not, resolve one the
        // way startDraw does rather than trusting activeLayerId, which can name a folder.
        const layerId = gesture.target.current || resolveDrawLayer(currentCut)?.id;
        if (layerId == null) return;
        commitStrokeToLayer(currentCutId, layerId, st);
        if (st.tool !== 'eraser') noteColorUsed(st.color);
    };
    // Blur brush: uses the path it travels as a mask and blurs the layer pixels beneath it.
    // This spreads what is already drawn rather than adding a vector stroke, so it works on
    // raster data.
    const applyBlurStroke = (st) => {
        const cut = currentCut;
        const layer = cut?.layers.find(l => l.id === gesture.target.current);
        if (!cut || !layer) return;
        const src = ensureLayerCanvas(cut.id, layer); if (!src) return;
        const rad = Math.max(2, st.size);
        // Only the affected region is processed, which keeps large canvases cheap.
        const box = regionBounds(st.points, rad + 4, CANVAS_W, CANVAS_H);
        if (!box) return;
        const blurred = blurMaskedRegion(src, box, st.points, rad, () => document.createElement('canvas'));
        const bitmapId = storeBitmap(blurred.getContext('2d').getImageData(0, 0, box.w, box.h));
        commitStrokeToLayer(currentCutId, layer.id, { id: nextId(), tool: 'paste', bitmapId, x: box.x, y: box.y, w: box.w, h: box.h });
    };

    // Reads the rectangle from the composited canvas, pixelates it in blocks, and stamps the
    // result onto the active layer.
    const applyMosaic = (rect) => {
        const box = rectBounds(rect, CANVAS_W, CANVAS_H);
        if (!box) return;
        // Off the composited canvas, not one layer: a mosaic covers what is on screen.
        const pixels = mosaic(canvasRef.current.getContext('2d').getImageData(box.x, box.y, box.w, box.h), mosaicBlock);
        const bitmapId = storeBitmap(pixels);
        // Through the same two guards a stroke goes through. Addressing c.activeLayerId
        // directly had the two silent failures the lasso paste had: a folder or a stale id
        // matches no layer and the mosaic evaporates, and a hidden layer takes it and shows
        // nothing. resolveDrawLayer answers the first, commitStroke reveals for the second.
        const layer = resolveDrawLayer(currentCut);
        if (!layer) return;
        commitStrokeToLayer(currentCutId, layer.id, { id: nextId(), tool: 'paste', bitmapId, x: box.x, y: box.y, w: box.w, h: box.h });
    };

    // Three tools that own themselves. Each keeps its own in-progress state and exposes the
    // same shape - begin, to, end - so the gesture handlers below say what happened rather
    // than how it is stored. The overlay is shared: only one of them can be running at a time.
    const overlay = { clear: clearLiveOverlay, ctx: liveCtx };
    const liquify = useLiquifyTool({
        overlay, ensureLayerCanvas, size: { cw: CANVAS_W, ch: CANVAS_H },
        brush: { size: brushSize, strength: opacity },
        storeBitmap, commitStrokeToLayer,
        onHiddenChanged: () => setDragTick(v => v + 1),
    });
    const curve = useCurveTool({
        overlay, bitmapStoreRef,
        brush: () => ({ color, opacity, size: brushSize }),
        zoom: () => view.zoom,
        commitLiveStroke: (st) => commitLiveStroke(st),
    });
    const mosaicTool = useMosaicTool({
        overlay, zoom: () => view.zoom, colour: () => accentSoft(0.18), apply: applyMosaic,
    });

    // Rebinding: while waiting, whatever combination is pressed is captured verbatim, ahead of
    // any other handling.
    // Named out of the bundle so the dependency list can be the two things this actually uses.
    // Listing `dialogs` instead would re-subscribe the window listener every time any dialog
    // opened or closed.
    const { rebinding, setRebinding } = dialogs;
    useEffect(() => {
        if (!rebinding) return;
        const h = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Escape') { setRebinding(null); return; }
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // ignore a modifier pressed on its own
            const combo = keyOf(e);
            setKeymap(prev => {
                // Clear any other entry using the same combination, to avoid a conflict.
                const next = { ...prev };
                for (const k of Object.keys(next)) if (next[k] === combo) next[k] = '';
                next[rebinding] = combo;
                return next;
            });
            setRebinding(null);
        };
        window.addEventListener('keydown', h, true);
        return () => window.removeEventListener('keydown', h, true);
    }, [rebinding, setRebinding, setKeymap]);


    // The handles and the outline are where paintFrame draws them - on the warped box - and the
    // grab radius is in screen pixels, like their size. Measured in canvas pixels it shrank with
    // every zoom-out until a corner could not be caught at all.
    // Three gestures that own themselves, like the tools above: a drag of the floating
    // selection, a drag of a whole layer with the move tool, and recording a path with the
    // pen. Each is begin / move / end over the shared gesture refs; the pointer handlers below
    // say which one is happening rather than how each is done.
    const selGesture = useSelectionGesture({ gesture, selection, setSelection, zoom: view.zoom });
    const layerDrag = useLayerDrag({ gesture, cuts, dispatchCuts, setDragTick, liveCtx, clearLiveOverlay, ensureLayerCanvas });
    const pathCap = usePathCapture({ gesture, dispatchCuts, updLayerAnim, notices, cw: CANVAS_W, ch: CANVAS_H });
    const { pathCapture, setPathCapture, cameraCapture, setCameraCapture } = pathCap;



    // A press that claims the canvas. Every branch of startDraw that takes over the pointer does
    // these three things together: remember which pointer owns the gesture, capture it so moves
    // keep arriving even once it leaves the canvas, and mark a drag in progress.
    //
    // setPointerCapture needs the try/catch. It throws when the pointer id is already gone -
    // optional chaining does not help, that guards a missing method, not a throw - and an
    // uncaught throw out of a pointerdown handler takes the whole app down. That happened.


    // Grabbing a text and dragging it, plus the measuring that hit-testing needs. The text tool
    // and the move tool both start one and differ in one flag: under the text tool, releasing
    // without having moved opens the editor, which is why endTextDrag reports what ended.
    const { measureTextBox, hitTestText, startTextDrag, moveTextDrag, endTextDrag } = useTextDrag({
        dispatchCuts, currentCutId, setSelectedText, beginGesture: gesture.begin,
    });

    // Open the text editor for a new text at this point. The editor is a docked panel, so the
    // point is only where the text will sit on the canvas; it no longer positions anything on
    // screen.
    const openTextEditorAt = (pos, currentCut) => {
        setTextEdit({
            cutId: currentCutId,
            layerId: currentCut.activeLayerId,
            ...blankTextEdit(pos, { color, opacity }),
        });
    };

    // Bucket fill. The region is worked out against what is actually visible at and above the
    // active layer, so a line drawn on a layer above still acts as a boundary, and the result
    // lands as a pasted bitmap rather than a stroke - a filled region has no path to store.
    const floodFillAt = (pos, currentCut, activeLayer) => {
        const tmpCanvas = document.createElement('canvas');
        sizeCanvas(tmpCanvas, CANVAS_W, CANVAS_H);
        const tctx = tmpCanvas.getContext('2d');

        // Through ensureLayerCanvas, not layerCanvasCache directly. The cache is keyed by layer
        // id alone, so an entry can hold pixels from before the last stroke; ensureLayerCanvas
        // compares the layer's signature and redraws when it does not match. Reading the map
        // raw meant a line drawn and then immediately filled inside was invisible to the fill,
        // which leaked straight across it.
        const activeCanvas = ensureLayerCanvas(currentCut.id, activeLayer);
        if (activeCanvas) tctx.drawImage(activeCanvas, 0, 0);
        else drawStrokesOnCtx(tctx, activeLayer.strokes, false, bitmapStoreRef.current);

        const stack = flattenLayersInUiOrder(currentCut?.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
        const activeIndex = stack.findIndex(l => l.id === activeLayer.id);
        for (let i = 0; i < activeIndex; i++) {
            // Same for the layers above: they are boundaries for the fill, so a stale one is a
            // boundary that is not there.
            const lc = ensureLayerCanvas(currentCut.id, stack[i]);
            if (lc) tctx.drawImage(lc, 0, 0);
        }

        const base = tctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
        const fillRgb = hexToRgb(color);
        const fillAlpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
        // Bleed the paint under the line by a little more than the line can wobble. A fill is a
        // bitmap and cannot boil with the strokes around it, so on a boiling layer the ink walks
        // off a fill that stops exactly at its edge and the shape reads as hollow. Even with
        // boiling off the bleed costs nothing, because the paint goes beneath the ink.
        const spread = Math.min(8, Math.max(3, Math.ceil((activeLayer.roughen || 0) * 1.5)));
        const region = bucketFillTransparentRegion(base, Math.round(pos.x), Math.round(pos.y), fillRgb, fillAlpha, 24, spread);
        if (!region) return;

        const bitmapId = storeBitmap(region.imageData);
        const stroke = { id: nextId(), tool: 'paste', bitmapId, x: region.x, y: region.y };
        noteColorUsed(color);
        // Through commitStrokeToLayer for the reveal - a fill into a hidden layer landed and
        // showed nothing - with insertFill as the placement, since paint goes under the ink.
        commitStrokeToLayer(currentCutId, activeLayer.id, stroke, (strokes, st) => insertFill(strokes, st, region.overPaint));
    };

    /**
     * Everything a tool is allowed to touch, assembled per pointer event.
     *
     * The list is the point: a tool cannot reach past this into App, and what a new tool may
     * need is a question with a written answer rather than a scroll through two thousand lines.
     *
     * `layer` is only resolved on the way down. A move does not need it - by then the stroke
     * already knows which layer it belongs to, in gesture.target, fixed when it began in case
     * the active layer changed underneath it.
     */
    const toolCtx = (e, pos, layer) => ({
        e, pos, layer, tool, etool,
        cut: currentCut, cutId: currentCutId,
        gesture,
        overlay: {
            renderStroke: renderLiveStroke, scheduleStroke: scheduleLiveRender,
            restartStroke: restartLiveStroke, renderLasso: renderLassoPreview,
        },
        tools: { curve, liquify, mosaic: mosaicTool },
        newStroke, samplesOf,
        commitStrokeToLayer, updLayers, floodFillAt,
    });

    const startDraw = (e) => {
        // No drawing while panning with space or the middle button - canvas-area handles that.
        if (spaceDownRef.current || e.button === 1 || panningRef.current) return;
        // Palm rejection: only a stylus (S Pen) or mouse may draw — ignore finger/touch.
        if (e.pointerType === 'touch') return;
        const pos = getPos(e);
        // Eyedropper fallback: sample the composited canvas pixel under the click.
        if (pickingColor) {
            try { const d = canvasRef.current.getContext('2d').getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data; if (d[3] > 0) applyColor('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')); } catch { }
            setPickingColor(false); return;
        }
        // Recording a camera path. Checked before the part path because a camera belongs to the
        // cut, not to whichever layer is selected - and before the layer is resolved at all, so
        // it works on a cut whose active layer is a folder or hidden.
        // Same for a part's motion path, sway curve or mosaic rectangle.
        if (pathCap.active) { pathCap.begin(e, pos); return; }
        // Even if the active layer is a folder, hidden or invalid, this substitutes a real
        // drawable layer, so the stroke always survives and stays visible.
        const activeLayer = resolveDrawLayer(currentCut);
        if (!activeLayer) return;
        gesture.target.current = activeLayer.id;

        if (textEdit) return;

        // Selection has priority over other interactions to avoid tool conflicts.
        if (selection) {
            if (selGesture.begin(e, pos)) return;
            // Click outside selection commits by default (standard behavior).
            commitSelectionImpl(selection);
        }

        if (tool === 'text') {
            const hit = hitTestText(pos, currentCut);
            if (hit) { startTextDrag(e, pos, hit, true); return; }
            openTextEditorAt(pos, currentCut);
            gesture.drawing.current = false;
            e.preventDefault();
            return;
        }

        if (tool === 'move') {
            // A move applies to what is selected (#177). A text under the pen selects itself;
            // a text already selected moves even from a press beside it, so a small caption can
            // be dragged without landing on it; otherwise the active layer moves, and every
            // layer while Alt is held. Texts never move as a side effect of a layer move.
            const hit = hitTestText(pos, currentCut);
            if (hit) { startTextDrag(e, pos, hit, false); return; }
            const sel = selectedText?.cutId === currentCutId ? safeArray(currentCut?.texts).find(t => t.id === selectedText.textId && t.visible !== false) : null;
            if (sel) { startTextDrag(e, pos, { text: sel }, false); return; }
            const drawable = flattenLayersInUiOrder(currentCut?.layers || []).filter(l => l.type === 'layer');
            const act = resolveDrawLayer(currentCut);
            const ids = e.altKey ? drawable.map(l => l.id) : (act ? [act.id] : []);
            if (ids.length) { layerDrag.begin(e, pos, currentCutId, ids); return; }
        }

        if (etool === 'curve') {
            // Curve ruler: tap to place anchors (hold and drag to fine-tune), then confirm with
            // the done button.
            gesture.begin(e);
            curve.addAnchor(pos);
            e.preventDefault();
            return;
        }

        gesture.begin(e);
        if (tool !== 'move' && tool !== 'text' && selectedText) setSelectedText(null);
        TOOLS[etool]?.down?.(toolCtx(e, pos, activeLayer));
    };

    // Which resize handle the pointer is over, or null. Only used for the cursor, so it is set
    // from the hover pass below and never read by anything that draws.
    const [hoverHandle, setHoverHandle] = useState(/** @type {string|null} */(null));

    const onDraw = (e) => {
        // Hovering, not drawing: the only thing to work out is what the cursor should say. A
        // selection has eight handles and hitTestSelection already knows which one a point is
        // over; without this the cursor said "move" over all of them, so the one gesture that
        // resizes looked like the one that moves.
        if (!gesture.drawing.current) {
            if (!selection) { if (hoverHandle) setHoverHandle(null); return; }
            const hit = selGesture.hitTest(getPos(e));
            const next = hit?.type === 'resize' ? hit.handle : hit?.type === 'rotate' ? 'rotate' : null;
            if (next !== hoverHandle) setHoverHandle(next);   // guarded: this runs on every move
            return;
        }
        const pos = getPos(e);

        if (pathCap.move(pos)) return;
        if (layerDrag.move(pos)) return;

        if (etool === 'curve' && curve.dragTo(pos)) return;

        if (moveTextDrag(pos)) return;

        if (selGesture.move(pos)) return;

        TOOLS[etool]?.move?.(toolCtx(e, pos, null));
    };

    const stopDraw = () => {
        // A whole-layer move commits its offset into every stroke.
        if (layerDrag.end()) return;
        // Curve ruler: one anchor placed or fine-tuned; the done button commits it.
        if (etool === 'curve' && curve.endDrag()) { gesture.end(); return; }
        // Liquify: the pushed pixels go back into the layer.
        if (liquify.ref.current) {
            gesture.end();
            liquify.end();
            return;
        }
        // Mosaic: pixelates the dragged rectangle and stamps it down.
        if (mosaicTool.ref.current) {
            gesture.end();
            mosaicTool.end();
            gesture.clearPending.current = true;
            return;
        }
        // A recorded path becomes the camera's, or the part's path, sway curve or region.
        if (pathCap.end()) return;
        // Commit the live overlay stroke into the layer data (one write), then clear the overlay
        // after the layer has repainted so there's no flicker.
        if (gesture.stroke.current) {
            const st = gesture.stroke.current; gesture.stroke.current = null;
            gesture.end();
            if (st.tool === 'blur') {
                // Blur does not lay down ink; it spreads what is already there, blurring the
                // layer pixels under the path and stamping the result back over them.
                clearLiveOverlay();
                applyBlurStroke(st);
                return;
            }
            if (st.points.length) commitLiveStroke(st);
            else clearLiveOverlay();
            return;
        }
        selGesture.end();
        const endedTextDrag = endTextDrag();
        if (!gesture.drawing.current) return;
        gesture.end();

        if (endedTextDrag?.clickToEdit && !endedTextDrag.moved) {
            openEditText(endedTextDrag.cutId, endedTextDrag.textId);
            return;
        }

        if (tool === 'lasso' && gesture.lasso.current) {
            const pts = gesture.lasso.current; gesture.lasso.current = null;
            clearLiveOverlay();
            if (pts.length > 1) liftLassoSelection(pts);
        }
    };

    // Lift what the lasso encloses into a floating selection: the enclosed pixels, plus a mask
    // of exactly which ones, so committing the move knows what to erase from the source layer.
    // The layer a lasso lifts from, rendered from its strokes. Deliberately NOT
    // ensureLayerCanvas, which is what everything else on screen uses: that canvas holds one
    // boil phase, and the mask taken from it outlives the phase it was cut from - it is applied
    // to whichever phase is on screen when the selection is committed, so it would fit at the
    // moment of the lasso and drift afterwards. The un-boiled strokes sit at the middle of the
    // wobble instead, which is the closest one mask can be to every phase. (The cache is
    // signature-checked and never stale; that is not the reason.)
    //
    // Through resolveDrawLayer, so an active folder or hidden layer resolves to something a
    // lasso can lift from rather than to nothing.
    const renderLassoSource = () => {
        const activeLayer = resolveDrawLayer(currentCut);
        if (!activeLayer) return null;
        const tmpCanvas = document.createElement('canvas');
        sizeCanvas(tmpCanvas, CANVAS_W, CANVAS_H);
        const ctx = tmpCanvas.getContext('2d');
        drawStrokesOnCtx(ctx, activeLayer.strokes, true, bitmapStoreRef.current);
        return { activeLayer, ctx };
    };

    const liftLassoSelection = (points, source = renderLassoSource()) => {
        if (!source) return;
        const { activeLayer, ctx } = source;

        const poly = closeLassoPath(points).map(p => [p.x, p.y]);
        const { x: minX, y: minY, w, h } = lassoBounds(points, CANVAS_W, CANVAS_H);
        if (w <= 0 || h <= 0) return;

        // Which pixels come along, and the hole they leave, are worked out in core/lassoOps -
        // both from one pass, because a mask that drifts from its selection leaves a ghost of
        // the lifted artwork behind in the layer.
        const mk = (iw, ih) => new ImageData(iw, ih);
        const { selection: sel, eraseMask, hasContent, painted } = cutOutPolygon({
            layer: ctx.getImageData(minX, minY, w, h),
            poly, minX, minY, w, h,
            makeImageData: mk,
            inside: pointInPolygon,
        });
        if (!hasContent || !painted) return;

        // The floating selection is the artwork, not the loop that was drawn round it (#231).
        // A generous lasso round a small drawing used to put the handles out in empty space and
        // rotate about a centre nowhere near the picture.
        //
        // The hole is deliberately left at the full loop: x/y and the mask are untouched, and
        // only the floating box moves. Cropping the hole as well would leave a ring of the
        // original artwork behind, which is the one thing a lift must not do.
        const pixels = (painted.w === w && painted.h === h) ? sel : cropImageData(sel, painted, mk);
        const tx = minX + painted.x, ty = minY + painted.y;

        setSelection({
            cutId: currentCutId,
            sourceLayerId: activeLayer.id,
            bitmapId: storeBitmap(pixels),
            maskBitmapId: storeBitmap(eraseMask),
            x: minX, y: minY, w: painted.w, h: painted.h,
            tx, ty, tw: painted.w, th: painted.h,
        });
    };

    const onPointerLeaveCanvas = () => {
        setHoverHandle(null);   // the pointer is gone; the cursor it implied should go too

        // With pointer capture, we still receive move/up events outside the canvas.
        // Avoid auto-stopping lasso/selection transforms just because the pointer left the element.
        if (gesture.drawing.current && (tool === 'lasso' || gesture.selectionDrag.current)) return;
        stopDraw();
    };

    const cancelText = () => setTextEdit(null);
    const commitText = () => {
        if (!textEdit) return;
        if (!String(textEdit.text ?? '').trim()) { setTextEdit(null); return; }
        const id = textEdit.textId ?? nextId();
        const obj = textFromEdit(textEdit, id);
        dispatchCuts(upsertText(textEdit.cutId, obj));
        setSelectedText({ cutId: textEdit.cutId, textId: id });
        setTextEdit(null);
    };

    const openEditText = (cutId, textId) => {
        const cut = cuts.find(c => c.id === cutId);
        const t = safeArray(cut?.texts).find(tt => tt.id === textId);
        if (!t) return;
        setSelectedText({ cutId, textId });
        setTextEdit({ cutId, textId, ...editFromText(t, { color, opacity }) });
    };

    const deleteTextObject = (cutId, textId) => {
        dispatchCuts(deleteText(cutId, textId));
        if (selectedText?.cutId === cutId && selectedText?.textId === textId) setSelectedText(null);
    };

    const toggleTextVisible = (cutId, textId) => {
        dispatchCuts(toggleTextVisibleAction(cutId, textId));
    };


    const paintFrame = useCallback((t, playing) => {
        const canvas = canvasRef.current; if (!canvas) return;
        paintFrameOnto(canvas.getContext('2d'), {
            t, playing, cw: CANVAS_W, ch: CANVAS_H, cuts, currentCutId, currentCut, transparentBg, selection,
            onionPrev, onionNext, videoOverlay, videoEl: vid.elRef.current,
            bitmapStore: bitmapStoreRef.current, requestFrameDecode, ensureLayerCanvas, flattenClipGroup, hiddenByGesture,
            boilPhaseRef, boilTick, measureTextBox, scratch: frameScratch.current,
        });
    }, [cuts, currentCutId, currentCut, onionPrev, onionNext, selection, layerCanvasCache, frameDecodeTick, videoOverlay, boilTick, dragTick, transparentBg]);

    paintFrameRef.current = paintFrame;

    // Editing render: full frame + editing-only overlays. During playback the rAF loop
    // paints imperatively (see below), so this effect just draws overlays at rest.
    useEffect(() => {
        if (isPlaying) return;              // rAF loop owns the canvas during playback
        paintFrame(currentTime, tl.scrubbing); // tl.scrubbing renders like playback so animation shows
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');

                if (selectedText?.cutId === currentCutId) {
            const c = cuts.find(cc => cc.id === selectedText.cutId);
            const t = safeArray(c?.texts).find(tt => tt.id === selectedText.textId && tt.visible !== false);
            if (t) drawTextSelection(ctx, measureTextBox(t), view.zoom);
        }

        if (selection?.bitmapId) {
            const entry = bitmapStoreRef.current.get(selection.bitmapId);
            const bmp = entry?.imageBitmap;
            const img = entry?.imageData;
            const tx = Math.round(selection.tx);
            const ty = Math.round(selection.ty);
            const tw = Math.max(1, Math.round(selection.tw));
            const th = Math.max(1, Math.round(selection.th));

            const box = { x: tx, y: ty, w: tw, h: th, rot: selection.rot, skew: selection.skew, bend: selection.bend };
            drawFloatingSelection(ctx, bmp || (img && imageDataCanvas(img)), box, view.zoom);
        }

        // Recorded motion paths (per layer) shown while editing so they're visible/redrawable.
        if (!isPlaying) {
            const cc = currentCut;
            for (const l of (cc?.layers || [])) {
                const open = !!animLayer && animLayer.cutId === cc.id && animLayer.layerId === l.id;
                drawMotionPath(ctx, l.anim?.path, open);
                if (open) drawMosaicRegion(ctx, l.anim?.mosaicRect, view.zoom);
            }
        }

    }, [paintFrame, cuts, currentCutId, currentCut, isPlaying, tl.scrubbing, currentTime, selection, selectedText, animLayer, view.zoom]);

    // Boiling is motion, so it is invisible on a still frame; the phase is advanced slowly
    // while editing to preview it. That preview redraws the whole layer, though, so it stops
    // whenever the user is actually doing something - letting it run while drawing or right
    // after a pan or zoom makes the interaction stutter badly.
    useEffect(() => {
        if (isPlaying) return;
        const cut = currentCut;
        if (!cut || !safeArray(cut.layers).some(l => l.roughen && l.visible !== false)) return;
        const id = setInterval(() => {
            if (document.hidden) return;                      // pointless while the tab is hidden
            if (gesture.drawing.current || panningRef.current) return; // mid-stroke or mid-pan
            if (Date.now() - lastInteractRef.current < 400) return; // yield briefly right after a zoom
            setBoilTick(v => (v + 1) % 100000);
        }, Math.round(1000 / BOIL_FPS));
        return () => clearInterval(id);
        // The two refs come from useCanvasView and never change identity; listed so the linter
        // can see them rather than left out of a list it cannot check.
    }, [isPlaying, cuts, currentCutId, currentCut, panningRef, lastInteractRef, gesture]);

    // The live overlay is cleared once the layer cache has updated, not on a timer, so the
    // committed stroke is already on the main canvas before the overlay goes. That makes it
    // independent of how fast the machine is - the line cannot vanish in between.
    useEffect(() => {
        if (gesture.clearPending.current && !gesture.drawing.current && !gesture.stroke.current) {
            gesture.clearPending.current = false;
            clearLiveOverlay();
        }
    }, [layerCanvasCache, clearLiveOverlay, gesture]);

    // Every way the timeline can be pointed at - scrub, cutList.marquee, middle-click pan, one-finger
    // pan/tap, two-finger pinch - lives in useTimelineGestures, where the overlaps between them
    // are visible.
    const tlGestures = useTimelineGestures({
        timelineRef, timelineMounted: showBottom,
        cuts, currentCutId, setCurrentCutId, maxTime,
        pps: tl.pps, setPps: tl.setPps,
        setCurrentTime, currentTimeRef, isPlayingRef, seekRef,
        audioRef, audioUrl, audioData,
        setScrubbing: tl.setScrubbing, setMarquee: cutList.setMarquee, selectedCutIds: cutList.selectedCutIds, setSelectedCutIds: cutList.setSelectedCutIds,
        videoOverlay,
    });

    // Lay a whole video under the drawing layers (overlay/rotoscope use). No frame cuts.
    const loadVideoOverlay = (blob, name, startAt = 0, offset = 0, clipDur = null) => {
        vid.blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        const v = vid.elRef.current || document.createElement('video');
        v.muted = true; v.playsInline = true; v.src = url;
        v.onloadedmetadata = () => {
            const dur = clipDur != null ? Math.min(clipDur, Math.max(0, v.duration - offset)) : Math.max(0, v.duration - offset);
            dispatchMedia(loadVideo({ name: name || tr('영상'), startTime: startAt, endTime: startAt + dur, offset, duration: v.duration, w: v.videoWidth, h: v.videoHeight }));
            // Prime the first frame so a paused canvas shows something immediately.
            try { v.currentTime = offset; } catch { }
        };
        v.onseeked = () => { requestRepaint(); }; // repaint the (paused) overlay frame
        // Auto-detect scene cuts in the background so the timeline can mark where the video changes.
        // Detection is a scan of the whole video; it is useful for a cut-heavy clip and pure cost
        // for a single continuous take, so it is a preference rather than something that always
        // happens. It can still be run by hand from the track's settings.
        if (autoSceneDetect) runSceneDetect({ cutStart: startAt, cutOffset: offset });
    };
    // Detect scene cuts (precise, with optional range + sensitivity) and store the markers. Runs on
    // the stored video blob so it can be re-run with different settings without re-importing.
    const runSceneDetect = ({ threshold = 14, rangeOn = false, startText = '0:00', endText = '', cutStart = null, cutOffset = null } = {}) => {
        const blob = vid.blobRef.current; if (!blob) return;
        const cs = cutStart != null ? cutStart : (videoOverlay?.startTime ?? 0);
        const co = cutOffset != null ? cutOffset : (videoOverlay?.offset ?? 0);
        const rStart = rangeOn ? parseClock(startText) : 0;
        const rEndRaw = rangeOn ? parseClock(endText) : 0;
        const rEnd = rangeOn && rEndRaw > rStart ? rEndRaw : null;
        // detectSceneCuts polls shouldStop between frames, so cancelling takes effect within one
        // seek rather than running the scan to the end and throwing the answer away.
        vid.sceneStopRef.current = false;
        const startedFor = docEpochRef.current;
        vid.setScene({ done: 0, total: 0 });
        detectSceneCuts(blob, {
            start: rStart, end: rEnd, threshold,
            onProgress: (d, t) => vid.setScene({ done: d, total: t }),
            shouldStop: () => vid.sceneStopRef.current,
        })
            // A cancelled scan returns what it found so far; keeping a partial set of markers
            // would look like a finished detection that missed most of the cuts.
            // Same reasoning as the frame import: a scan of a long video outlives a project
            // switch, and its markers describe a video that is no longer loaded.
            .then(cuts => { if (!vid.sceneStopRef.current && docEpochRef.current === startedFor) dispatchMedia(setVideoCuts(cuts, cs, co)); })
            .catch(() => { })
            .finally(() => { vid.setScene(null); vid.sceneStopRef.current = false; });
    };
    const removeVideoOverlay = () => {
        dispatchMedia(clearVideo()); vid.blobRef.current = null; vid.setSceneCfg(null);
        detachMedia(vid.elRef.current);
    };
    // Remember fetched/opened videos so they can be re-imported with different settings
    // without downloading again (session only — keeps at most 3 to bound memory).
    // Recents keep only the source key/link, never the video data — the downloaded file is
    // dropped right after extraction, so re-importing the same link re-downloads it.
    const openVideoImport = (file, name, src) => {
        // A new import must always raise the settings dialog. That dialog only shows while
        // vid.cfg && !vid.busyBg, so if an earlier extraction was sent to the background and
        // then failed to finish cleanly, the flag stays true and no later import ever opens the
        // dialog again. Clearing it here at the start prevents that.
        vid.setBusyBg(false);
        const label = (name || file.name).replace(/\.[^.]+$/, '').slice(0, 24);
        const srcKey = src?.key || `f:${file.name}:${file.size}`;
        vid.setRecent(p => [{ id: 'rv_' + nextId().toString(36), name: label, srcKey, url: src?.url || null },
        ...p.filter(v => v.srcKey !== srcKey)].slice(0, 3));
        vid.setCfg({ file, srcKey, label, fps: 4, maxFrames: 60, scale: 0.5, whole: true, withAudio: false, dedupe: 'exact', quality: 'compressed', rangeOn: false, startText: '0:00', endText: '', parts: 1, canvasMode: 'source', srcW: 0, srcH: 0 });
        // Auto-suggest a part count from the video length (~1 part per 30s) so a long video comes
        // in already split. The user can still change it in the dialog.
        try {
            const v = document.createElement('video'); v.preload = 'metadata'; const u = URL.createObjectURL(file);
            v.onloadedmetadata = () => {
                const dur = v.duration || 0;
                // The source size decides the import canvas, so it is read here rather than in a
                // second probe. Without it 'match the video' has nothing to match and falls back.
                const sw = v.videoWidth || 0, sh = v.videoHeight || 0;
                URL.revokeObjectURL(u);
                const parts = Math.max(1, Math.min(30, Math.round(dur / 30)));
                vid.setCfg(vi => (vi && vi.file === file) ? { ...vi, durationSec: dur, parts, srcW: sw, srcH: sh } : vi);
            };
            v.src = u;
        } catch { }
    };
    const reimportRecent = (v) => {
        if (v.url) loadYoutubeVideo(v.url);        // same link → download again
        else videoFileRef.current?.click();        // local file: the browser can't reopen it for us
    };

    // Imported frame sets, derived from the cuts themselves (so they survive save/load).
    const videoBatches = deriveVideoBatches(cuts, tr('영상'));
    const deleteVideoBatch = (batchId) => {
        const b = videoBatches.find(x => x.id === batchId);
        if (!b || !window.confirm(tr('"{0}" 프레임 {1}컷을 삭제할까요?', b.label, b.count))) return;
        const left = cuts.filter(c => c.videoBatch !== batchId);
        dispatchCuts(removeBatch(batchId));
        if (!left.some(c => c.id === currentCutId)) setCurrentCutId(left[0]?.id ?? null);
        cutList.setSelectedCutIds(new Set());
        setTimeout(gcBitmaps, 0); // free the frame bitmaps right away
    };

    // Select a part: scope playback to it and jump the playhead to its start.
    const selectPart = (partId) => {
        cutList.setActivePartId(partId);
        const p = partId ? parts.find(x => x.id === partId) : null;
        if (p) {
            const first = cuts.filter(c => c.partId === partId).sort((a, b) => a.startTime - b.startTime)[0];
            if (first) setCurrentCutId(first.id);
            setCurrentTime(p.start); currentTimeRef.current = p.start;
            if (audioRef.current && audioUrl) { try { audioRef.current.currentTime = audioData ? Math.max(0, (p.start - audioData.startTime) + audioData.offset) : p.start; } catch { } }
        }
    };
    // Group the currently-selected cuts into a new part.
    const makePartFromSelection = () => {
        if (!cutList.selectedCutIds.size) { alert(tr('먼저 컷을 선택하세요 (타임라인에서 드래그 또는 Ctrl+클릭).')); return; }
        const name = window.prompt(tr('새 파트 이름:'), tr('파트 {0}', parts.length + 1));
        if (name == null) return;
        const pid = 'part_' + nextId().toString(36);
        dispatchCuts(assignPartTo(cutList.selectedCutIds, pid, name));
        cutList.setActivePartId(pid);
    };
    const renamePart = (partId) => {
        const p = parts.find(x => x.id === partId); if (!p) return;
        const name = window.prompt(tr('파트 이름 변경:'), p.name);
        if (name == null) return;
        dispatchCuts(renamePartAction(partId, name));
    };
    // Ungroup a part (cuts stay, just lose their part membership).
    const ungroupPart = (partId) => {
        dispatchCuts(ungroupPartAction(partId));
        if (cutList.activePartId === partId) cutList.setActivePartId(null);
    };

    // Local-only: pull a video by URL through the API, then reuse the frame-import dialog.
    const loadYoutubeVideo = async (presetUrl) => {
        const url = typeof presetUrl === 'string' ? presetUrl : null;
        if (!url) { notices.setLinkPrompt({ kind: 'video' }); return; } // raise the input dialog and stop here
        vid.setBusy({ done: 0, total: 0, fetching: true });
        try {
            const res = await fetch('/api/youtube-video?url=' + encodeURIComponent(url) + '&maxHeight=1080');
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
            const blob = await res.blob();
            const file = new File([blob], 'youtube.mp4', { type: blob.type || 'video/mp4' });
            openVideoImport(file, 'YT ' + (url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/)?.[1] || tr('영상')), { url, key: 'yt:' + url });
        } catch (e) {
            console.error('[import]', e);
            notices.setError(tr('영상 가져오기 실패: ') + e.message);
        } finally { vid.setBusy(null); }
    };

    // Import a video as one cut per extracted frame (sequential on the current track).
    const { handleExport, handleExportFrames, handleExportPieces } = useExport({
        paint: { canvasRef, paintFrameRef, currentTimeRef, renderStateRef, bitmapStoreRef, videoStopRef: vid.stopRef },
        audio: { audioRef, audioCtxRef, audioSourceRef, audioDestRef, audioUrl, audioData },
        range: { playStart: exportStart, playEnd, cw: CANVAS_W, ch: CANVAS_H, transparentBg, transparentFormat },
        doc: { buildData, restore, invalidateCutsUsing, decodeFrameBitmap, paintFrame },
        report: { setLoadProgress: notices.setProgress, setAppError: notices.setError, setCurrentTime, setIsPlaying },
        recording: { isExporting, exportEndRef, exportStartRef, requestFrameRef, mediaRecorderRef },
    });


    // Everything a layer row needs, as against everything the panel around it needs. Grouped
    // rather than listed flat for the same reason usePlayback groups its inputs: twenty names
    // threaded one by one through a panel that uses none of them is not clearer than one that
    // says what the bundle is.
    const layerRows = {
        animLayer, currentTime, dispatchCuts, dragLayerInfo, dropInfo, handleDeleteLayer,
        handleSetActive, handleToggleFolder, handleToggleVisible, jitterLayer, layerCanvasCache,
        onLayerDragEnd, onLayerDragOver, onLayerDragStart, onLayerDrop, pathCapture,
        setAnimLayer, setPathCapture, toggleJitterPanel, updLayerAnim, updLayerProps, updLayers,
        // The spine editor is opened from a layer row, so its two handles travel with the
        // rest of what a row needs. #144 turned the rows into a component while this branch
        // was adding them; neither is wrong alone, they only meet here.
        spineEdit, setSpineEdit,
        // One thing is selected at a time: while a text of this cut is selected, no layer row
        // shows as active, or two things look selected and the move tool's scope is a guess.
        selectedText,
    };


    // Tool panel: the buttons keep a comfortable size and the column count follows the width.
    // Named rather than inlined as [!!textEdit]: a dependency the linter cannot read is a
    // dependency nobody can check. This way it runs when the editor opens or closes and not
    // on every keystroke, which would drag the user back from the cut list mid-edit.
    const editingText = !!textEdit;
    useEffect(() => { setRightTab(editingText ? 'text' : 'cut'); }, [editingText]);

    const isSelectionTool = tool === 'lasso' || !!selection;
    liveRef.current = { cuts, copiedCut, selection, audioData, numTracks }; // current GC + history sources
    // What renderFrameRange paints from, read through a ref rather than closed over. The
    // multi-piece export opens a document and paints it inside one async run, and everything
    // captured when that run started is the *previous* document - so closing over cuts would
    // export the piece before the one that was just opened, silently and looking fine.
    renderStateRef.current = { cuts, currentCutId, cw: CANVAS_W, ch: CANVAS_H };


    // The tool panel body lives in a variable so the same markup can be mounted in the left
    // dock, the right dock, or a floating window without being duplicated.
    const toolsPanelEl = (
        <ToolsPanel
                    panel={{ width: toolW, onClose: () => setShowLeft(false), TOOL_TYPES }}
                    tools={{ tool, handleSetTool, isSelectionTool, pickingColor, pickColor, hasLassoClip, pasteLassoSelection }}
                    brush={{ color, applyColor, opacity, setOpacity, toolSize, setToolSize, pressureOn, setPressureOn, softMode, setSoftMode, rulerMode, setRulerMode, mosaicBlock, setMosaicBlock }}
                    edit={{ globalUndo, globalRedo, handleClearCut, doTween }}
                    onion={{ onionPrev, setOnionPrev, onionNext, setOnionNext }}
                    />
    );

    const colorPanelEl = (
                <ColorPanel
                    color={color} applyColor={applyColor} pickColor={pickColor} pickingColor={pickingColor}
                    recentColors={recentColors}
                    width={colorW}
                    onClose={() => setLeftDock(null)} />
    );
    // The editor is a tab in the cut panel, not a window over the canvas and not a fourth
    // panel beside it. It had grown enough controls to cover the drawing it was meant to be
    // editing; docked next to CUT / LAYER it left the canvas a sliver. Sharing that panel's
    // space, the way the project tabs share one bar, costs the canvas nothing.
    const textEditorBody = textEdit ? (
        <TextEditor textEdit={textEdit} setTextEdit={setTextEdit} textAreaRef={textAreaRef}
            commitText={commitText} cancelText={cancelText} />
    ) : null;

    const cutPanelEl = (
                <CutLayerPanel
                    doc={{ cuts, currentCutId, copiedCut, videoBatches, layerRows }}
                    cutOps={{ handleAddCut, handleCopyCut, handleCutClick, handleDeleteCut, handleDuplicateCut, handlePasteCut, renameCut, deleteVideoBatch, updCutAnim, updCutTime, updCutCamera }}
                    layerOps={{ handleAddFolder, handleAddLayer, onListDrop, handleSetTool }}
                    text={{ selectedText, setSelectedText, openEditText, deleteTextObject, toggleTextVisible, textEditorBody, cancelText }}
                    camera={{ cameraCapture, setCameraCapture }}
                    panel={{ showRight, setShowRight, rightW, rightTab, setRightTab }}
                    canvas={{ canvasW: CANVAS_W, canvasH: CANVAS_H }}
                    cutList={cutList}
                    />
    );


    const panelEls = { color: colorPanelEl, tools: toolsPanelEl, cut: cutPanelEl };

    // Where each of those goes - a dock, or a window of its own - is PanelDock's business.
    const dockProps = { panelIds: PANEL_IDS, docks, panelOpen, panelEls };

    return (
        <div className="app-container">
            <audio ref={audioRef} style={{ display: 'none' }} />
            <video ref={vid.elRef} muted playsInline style={{ display: 'none' }} />
            <ProgressOverlay progress={notices.progress} />
            {dialogs.settings && (
                <SettingsModal
                    tab={dialogs.settingsTab} setTab={dialogs.setSettingsTab}
                    onClose={dialogs.closeSettings}
                    themeColor={themeColor} setThemeColor={setThemeColor} themeRecent={themeRecent} defaultTheme={DEFAULT_THEME}
                    uiSat={uiSat} setUiSat={setUiSat}
                    keymap={keymap} setKeymap={setKeymap} defaultKeys={DEFAULT_KEYS} keyLabels={KEY_LABELS} conflicts={findConflicts(keymap)}
                    videoOpacity={videoOverlay ? (videoOverlay.opacity ?? 1) : null} setVideoOpacity={v => dispatchMedia(setVideoOpacity(v))}
                    setShowToolKeys={dialogs.setToolKeys}
                    lang={lang} changeLang={changeLang}
                    playbackRate={playbackRate} setPlaybackRate={setPlaybackRate} playbackRates={PLAYBACK_RATES}
                    bakeInfo={bakeInfo} bakePlaybackSpeed={bakePlaybackSpeed}
                    rebinding={dialogs.rebinding} setRebinding={dialogs.setRebinding} />
            )}
            {serverProjects !== null && <ProjectPicker title={tr('서버에서 열기')} items={serverProjects} onOpen={doServerOpen} onDelete={doServerDelete} onClose={() => setServerProjects(null)} />}
            {localProjects !== null && <ProjectPicker title={tr('로컬에서 열기')} items={localProjects} onOpen={doLocalOpen} onDelete={doLocalDelete} onClose={() => setLocalProjects(null)} />}
            {backupList !== null && (
                <ProjectPicker
                    title={tr('백업에서 되돌리기 (최근 12개 보관)')}
                    items={backupList.map(b => ({ id: b.stamp, name: `${b.name}${b.size ? ` · ${(b.size / 1048576).toFixed(1)}MB` : ''}`, savedAt: b.savedAt }))}
                    onOpen={(stamp) => doBackupRestore(stamp)}
                    onDelete={(stamp) => doBackupDelete(stamp)}
                    onClose={() => setBackupList(null)} />
            )}
            <Notices videoBusy={vid.busy} videoBusyBg={vid.busyBg} setVideoBusyBg={vid.setBusyBg} videoStopRef={vid.stopRef}
                backupProg={backupProg} toast={notices.toast} setToast={notices.setToast} appError={notices.error} setAppError={notices.setError} />
            {notices.linkPrompt && (
                <LinkPromptModal
                    title={notices.linkPrompt.kind === 'audio' ? tr('유튜브 음원 가져오기') : tr('유튜브 영상 프레임 가져오기')}
                    placeholder="https://www.youtube.com/watch?v=..."
                    onClose={() => notices.setLinkPrompt(null)}
                    onSubmit={(url) => {
                        const kind = notices.linkPrompt.kind;
                        notices.setLinkPrompt(null);
                        if (kind === 'audio') loadYoutubeAudio(url); else loadYoutubeVideo(url);
                    }} />
            )}
            {vid.cfg && !(vid.busyBg && vid.busy) && (
                <VideoImportModal
                    videoImport={vid.cfg} setVideoImport={vid.setCfg}
                    videoBusy={vid.busy} setVideoBusyBg={vid.setBusyBg} videoStopRef={vid.stopRef}
                    runVideoImport={() => vid.run({
                        cw: CANVAS_W, ch: CANVAS_H, cuts, currentCutId, docEpochRef, setCanvasSize, storeBitmapBlob,
                        dispatchCuts, setCurrentCutId, setCurrentTime, loadAudioUrl, gcBitmaps, notices,
                    })}
                    loadVideoOverlay={loadVideoOverlay} loadAudioUrl={loadAudioUrl} parseClock={parseClock}
                    setShowHelp={dialogs.setHelp} canvasW={CANVAS_W} canvasH={CANVAS_H} setCanvasSize={setCanvasSize} />
            )}
            {vid.sceneCfg && videoOverlay && (
                <SceneDetectModal sceneCfg={vid.sceneCfg} setSceneCfg={vid.setSceneCfg}
                    sceneDetect={vid.scene} runSceneDetect={runSceneDetect}
                    autoSceneDetect={autoSceneDetect} setAutoSceneDetect={setAutoSceneDetect}
                    videoOpacity={videoOverlay.opacity ?? 1} setVideoOpacity={v => dispatchMedia(setVideoOpacity(v))}
                    cancelSceneDetect={() => { vid.sceneStopRef.current = true; }}
                    hasCuts={!!videoOverlay.cuts?.length} clearVideoCuts={() => dispatchMedia(clearVideoCuts())} />
            )}
            {dialogs.exportRange && (
                <ExportRangeModal first={exportStart} end={playEnd} playhead={currentTime} transparentBg={transparentBg} format={transparentFormat}
                    onClose={() => dialogs.setExportRange(false)}
                    onExport={(from, to) => { dialogs.setExportRange(false); handleExport({ from, to }); }} />
            )}
            {dialogs.toolKeys && (
                <ToolKeysModal keymap={keymap} setKeymap={setKeymap} defaultKeys={DEFAULT_KEYS} keyLabels={KEY_LABELS}
                    conflicts={findConflicts(keymap)} rebinding={dialogs.rebinding} setRebinding={dialogs.setRebinding}
                    onClose={dialogs.closeToolKeys} />
            )}
            {dialogs.help && <HelpModal keymap={keymap} onClose={() => dialogs.setHelp(false)} />}
            <TopBar
                    project={{ doNew, doSave, doOpen, doLocalSave, openLocalList, doServerSave, openServerList, doServerBackup, openBackupList, backupBusy, doSplitSave, handleExportPieces, handleExport: () => dialogs.setExportRange(true) }}
                    status={{ autoSavedAt, autosaveErr, backupAt, storageInfo, serverAvailable, setToast: notices.setToast }}
                    media={{ handleAudioUpload, loadYoutubeAudio, handleDeleteAudio, audioFile, openVideoImport, loadYoutubeVideo, videoFileRef, recentVideos: vid.recent, reimportRecent }}
                    canvas={{ canvasW: CANVAS_W, canvasH: CANVAS_H, setCanvasSize, view, zoomCanvas, resetView }}
                    dialogs={{ setShowHelp: dialogs.setHelp, setShowSettings: dialogs.setSettings, keymap }}
                    />
            <DocTabs
                tabs={tabs} activeTabId={activeTabId} switchTab={switchTab} renameTab={renameTab} closeTab={closeTab} newTab={newTab}
                selection={selection} setSelection={setSelection} extractSelectionToPart={extractSelectionToPart}
                copyLassoSelection={copyLassoSelection} commitSelection={commitSelection} cancelSelection={cancelSelection}
                etool={etool} curvePts={curve.count} commitCurve={curve.commit} cancelCurve={curve.cancel}
                cameraCapture={cameraCapture} setCameraCapture={setCameraCapture}
                pathCapture={pathCapture} setPathCapture={setPathCapture} />

            <div className="main-content" onPointerDown={onDockPointerDown}>
                <DockRail showLeft={showLeft} setShowLeft={setShowLeft} leftDock={leftDock} setLeftDock={setLeftDock} />
                <DockSlot side="left" {...dockProps} startPanelResize={startPanelResize} />

                <CanvasStage
                    canvasAreaRef={canvasAreaRef} canvasRef={canvasRef} liveCanvasRef={liveCanvasRef}
                    cw={CANVAS_W} ch={CANVAS_H} transparentBg={transparentBg} view={view} resetView={resetView}
                    gesture={{ spaceDown, onAreaPointerDown, onAreaPointerMove, onAreaPointerUp }}
                    draw={{ startDraw, onDraw, stopDraw, onPointerLeaveCanvas }}
                    cursor={canvasCursor({ spaceDown, selection, hoverHandle, tool })}
                    spine={{
                        layer: spineLayer,
                        onChange: (prof) => updLayerAnim(spineEdit.cutId, spineEdit.layerId, { swayProfile: prof }),
                        onClose: () => setSpineEdit(null),
                    }} />

                <DockSlot side="right" {...dockProps} startPanelResize={startPanelResize} />

                {!showRight && <ReopenRight setShowRight={setShowRight} />}
            </div>

            <FloatingPanels {...dockProps} floatPos={floatPos} panelDrag={panelDrag} onDockPointerDown={onDockPointerDown} />
            <DockHint panelDrag={panelDrag} />

            {showBottom && <div className="splitter-h" style={{ touchAction: 'none' }} onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } startBottomResize(e.clientY); }} />}

            <Timeline
                doc={{ cuts, currentCutId, setCurrentCutId, parts, numTracks, maxTime }}
                view={{ showBottom, setShowBottom, timelineH, timelineRef, playheadRef, fmt }}
                tracks={{ hiddenTracks, toggleTrackHidden, handleAddTrack, handleDeleteTrack }}
                partOps={{ makePartFromSelection, selectPart, renamePart, ungroupPart }}
                drag={{ cutDragArmedRef, cutDragMovedRef, cutDragTimerRef, draggingCutData, setDraggingCutData, setResizingData }}
                media={{ audioData, audioFile, videoOverlay, removeVideoOverlay }}
                rate={{ loopPlay, setLoopPlay, playbackRate, setPlaybackRate }}
                bg={{ transparentBg, setTransparentBg, transparentFormat, setTransparentFormat }}
                playback={playback}
                gestures={tlGestures}
                tl={tl}
                cutList={cutList}
                audio={audio}
                openPlaybackSettings={() => dialogs.openSettings('play')}
                openVideoSettings={() => vid.setSceneCfg(c => c || { threshold: 14, rangeOn: false, startText: '0:00', endText: '' })}
                sceneDetect={vid.scene}
                setSceneCfg={vid.setSceneCfg}
                addCuts={cs => dispatchCuts(addCuts(cs))}
                />
        </div>
    );
}
