import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, PenLine, Pen, Feather, Eraser, Undo, Layers, ChevronRight, GitBranch, Move, Type, Cloud, Minus, Grid3x3, Palette, Menu, PaintBucket, RotateCcw, Waves } from 'lucide-react';
import './App.css';
import { saveAutosave } from './db';
import ColorPanel from './ui/ColorPanel';
import { TopBar } from './ui/TopBar';
import { CutLayerPanel } from './ui/CutLayerPanel';
import { useStored } from './hooks/useStored.js';
import { nextId } from './core/ids.js';
import { arrayCodec, onOffCodec, oneZeroCodec, numberCodec } from './core/persist.js';
import { TextEditor } from './ui/TextEditor';
import { SwaySpine } from './ui/SwaySpine';
import { ToolsPanel } from './ui/ToolsPanel';
import { Timeline } from './ui/Timeline';
import { ProjectPicker, ProgressOverlay, SettingsModal, HelpModal, VideoImportModal, SceneDetectModal, LinkPromptModal, ToolKeysModal } from './ui/Modals';
import { tr, loadLang, saveLang, setLangValue } from './i18n';
import { resolveDrawLayer as resolveDrawLayerPure, commitStroke, insertFill, patchLayer, nextLayerId, appendLayer, appendFolder, removeLayerTree } from './core/layerOps.js';
import { mkCut, firstCut } from './core/document.js';
import { toggled, selectionAfterClick, cutsToCopy } from './core/cutSelection.js';
import { closeLassoPath, lassoBounds, applyResize, cutOutPolygon, selectionStrokes, applyWarpDrag, paintedBounds } from './core/lassoOps.js';
import { pushAlong } from './core/liquify.js';
import { shapePoints } from './core/shapeStroke.js';
import { EXPORT_FPS } from './core/recordClock.js';
import { pickRecordingType, frameSource, startRecorder } from './export/recorder.js';
import { useTimelineGestures } from './hooks/useTimelineGestures.js';
import { useTextDrag } from './hooks/useTextDrag.js';
import { useLayerDnD } from './hooks/useLayerDnD.js';
import { useCanvasView } from './hooks/useCanvasView.js';
import { fmt, parseClock } from './core/timeCode.js';
import { textFromEdit, editFromText, blankTextEdit } from './core/textEdit.js';
import { useHistory } from './hooks/useHistory.js';
import { usePlayback } from './hooks/usePlayback.js';
import { useServerProbe } from './hooks/useServerProbe.js';
import { useServerStorage } from './hooks/useServerStorage.js';
import { usePanelLayout } from './hooks/usePanelLayout.js';
import { useLocalDocuments } from './hooks/useLocalDocuments.js';
import { fetchAsset } from './core/api.js';
import { PLAYBACK_RATES, RATE_DEFAULT, playbackRateCodec } from './core/playbackRate.js';
import { scaleProjectTimes, bakePlan } from './core/timeScale.js';
import { drawSwayed } from './canvas/swayRender.js';
import { warpedOutline, warpedHandles } from './canvas/warpRender.js';
import { drawMarquee, HANDLE_GRAB_PX } from './canvas/marquee.js';
import { drawTextSelection, drawFloatingSelection, drawMotionPath } from './canvas/editChrome.js';
import { createBitmapStore } from './canvas/bitmapStore.js';
import { useLayerCache } from './hooks/useLayerCache.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { applyPartTransform, drawMaskedLayer } from './canvas/layerComposite.js';
import { detachMedia, safeMediaSrc } from './core/mediaEl.js';
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
import { importPlacement, buildImportedCuts, extractOptionsFor } from './core/videoCuts.js';
import { playRange } from './core/playRange.js';
import { pieceRange } from './core/exportQueue.js';
import { frameExportPlan, exportFileInfo, LONG_EXPORT_FRAMES } from './core/frameExport.js';
import { brushUp, brushDown } from './core/brushSize.js';
import {
    cutsReducer, replaceCuts, addCuts, updateCut, setCutAnim, setCutCamera, clearCut,
    updateLayer, setLayerAnim, moveLayers, upsertText, deleteText, toggleTextVisible as toggleTextVisibleAction,
    assignPartTo, renamePart as renamePartAction, ungroupPart as ungroupPartAction, removeBatch,
    insertCutsShifting, deleteTrack, moveCutGroup, replaceBatchCuts, patchCut, patchCuts,
} from './core/cutsReducer.js';
import { textNeedsBox, drawTextObject } from './canvas/textRender.js';
import { migrateCuts, projectSettings, makeLoadProgress } from './core/projectFormat.js';
import { imageExtFromType, audioExt, videoExt, collectBitmaps, loadBitmapStore, blobToDataURL, packMedia } from './core/projectAssets.js';
import { xAtTime } from './core/timelineZoom.js';
import { preparePath } from './core/pathMotion.js';
import { dragOnWindow } from './core/windowDrag.js';
// Recording a camera path reuses the pen the way a part's motion path does; the two cannot be
// active at once, and startDraw checks this one first because a camera is a property of the cut
// rather than of whichever layer happens to be selected.

import { applyCamera } from './core/camera.js';
import { onionNeighbours, topCutAt } from './engine/selectCuts.js';
import { evaluateFrame } from './engine/evaluateFrame.js';
import { pendingBitmapIds } from './engine/pendingBitmaps.js';
import { frameName, ZipWriter } from './export/zip.js';
import { GifWriter } from './export/gif.js';
import { downloadBlob } from './export/download.js';
import { unusedBitmapIds } from './core/bitmapRefs.js';
import { dragCut, resizeCut } from './core/cutOps.js';
import {
    DEFAULT_CUT_DURATION, CANVAS_W as CANVAS_W_DEFAULT, CANVAS_H as CANVAS_H_DEFAULT,
    pointInPolygon, safeArray, hexToRgb, bucketFillTransparentRegion,
    imageDataToDataURL, dataURLToImageData, drawStrokesOnCtx, sizeCanvas, scratchCanvas, flattenLayersInUiOrder, applyCutAnim, extractVideoFrames, fitRect, detectSceneCuts, curveToWave, morphPrepare,
    targetCanvasFor, imageDataCanvas, seekTarget,
} from './canvas/canvasUtils';



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
const BOIL_FPS = 10; // how many times a second the boiling-line motion advances
/** How faint a neighbouring drawing is under the one being worked on. */
const ONION_ALPHA = 0.35;
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

    const [showLeft, setShowLeft] = useState(true);
    const [showRight, setShowRight] = useState(true);
    const [showBottom, setShowBottom] = useState(true);
    // True while the playhead is being dragged. Rendering treats it as playback (see paintFrame).
    const [scrubbing, setScrubbing] = useState(false);

    // The editor opens at the text's position, so clicking near an edge used to put half of it

    // Where each panel lives: 'left', 'right' or 'float'. Panels are drawn from these rather than
    // from fixed positions in the layout, so dragging one only has to change this value.

    const [snapLinePos, setSnapLinePos] = useState(null);
    // The audio and video tracks move together - loading audio sets four of these at once - so
    // they are one reducer. Destructured here so every read site keeps the name it always had;
    // only the writes go through an action. See core/mediaReducer.
    const [media, dispatchMedia] = React.useReducer(mediaReducer, EMPTY_MEDIA);
    const { audioFile, audioUrl, audioDuration, audioData } = media;
    // Video overlay track: play the original video underneath the drawing layers (no per-frame
    // cuts) - for drawing over a video. Like audio, but painted onto the canvas each frame.
    const { videoOverlay } = media; // { name, startTime, endTime, offset, duration, w, h, cuts? }
    const [sceneDetect, setSceneDetect] = useState(null);   // { done, total } while auto-detecting scene cuts
    // Which media rows are folded away in the timeline. Purely a view setting - the audio still
    // plays and the video still draws; this is only about giving the cut tracks the height back.
    const [hiddenTracks, setHiddenTracks] = useStored('mv_hidden_tracks', { audio: false, video: false }, {
        // Spread over the defaults, so a stored value from before a track existed still names it.
        decode: (raw) => ({ audio: false, video: false, ...JSON.parse(raw) }),
        encode: JSON.stringify,
    });
    const toggleTrackHidden = (which) => setHiddenTracks(h => ({ ...h, [which]: !h[which] }));
    const [showToolKeys, setShowToolKeys] = useState(false);
    const sceneStopRef = useRef(false);   // set to ask a running scene detection to stop
    const [sceneCfg, setSceneCfg] = useState(null);         // scene-detect settings modal { threshold, rangeOn, startText, endText }
    const [autoSceneDetect, setAutoSceneDetect] = useStored('mv_auto_scene', true, onOffCodec);
    const videoElRef = useRef(null);      // hidden <video> element that decodes/plays the overlay
    const videoBlobRef = useRef(null);    // the video Blob, for saving
    const [videoImport, setVideoImport] = useState(null); // {file, fps, maxFrames} dialog
    const [recentVideos, setRecentVideos] = useState([]); // fetched/opened videos, reusable without re-downloading
    const [videoBusy, setVideoBusy] = useState(null); // {done, total} while extracting
    const [videoBusyBg, setVideoBusyBg] = useState(false); // extraction moved to a background chip
    // YouTube link input. A native prompt fails silently once blocked, so this asks in-app.
    const [linkPrompt, setLinkPrompt] = useState(null); // {kind:'video'|'audio'}

    const {
        audioRef, audioB64Ref, audioCtxRef, audioSourceRef, audioDestRef,
        audioAsBlob, restoreAudio, loadAudioUrl, handleAudioUpload, handleDeleteAudio, loadYoutubeAudio,
    } = useAudioTrack({ audioUrl, dispatchMedia, setLinkPrompt });
    // Make failures visible. Once the browser blocks dialogs, alert is swallowed and the app
    // looks like it simply did nothing - which is exactly why one bug here took so long to find.
    const [appError, setAppError] = useState(null);
    const [toast, setToast] = useState(null);            // unobtrusive notice
    useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
    const videoStopRef = useRef(false);
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
        leaveCurve: () => { if (curveAnchorsRef.current) commitCurve(); },
    });
    const [expandedCuts, setExpandedCuts] = useState(new Set());
    const [collapsedCutIds, setCollapsedCutIds] = useState(new Set());
    const [renamingCutId, setRenamingCutId] = useState(null);
    const [selectedCutIds, setSelectedCutIds] = useState(new Set());
    const [marquee, setMarquee] = useState(null); // rubber-band rect (content px) while drag-selecting cuts
    const [activePartId, setActivePartId] = useState(null); // scope playback and editing to one part (null = all)
    const lassoClipRef = useRef(null); // copied lasso pixels: { bitmapId, w, h }
    const [hasLassoClip, setHasLassoClip] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const fileHandleRef = useRef(null);
    // Shared by both document hooks: the server backup falls back to it for a name, and the
    // local save writes it. Owned here because the two hooks cannot both create it.
    const localNameRef = useRef('');
    const canvasRef = useRef(null);
    const liveCanvasRef = useRef(null);   // overlay for the in-progress stroke (drawn without touching layer state)
    const liveStrokeRef = useRef(null);   // the stroke currently being drawn
    const liveClearPendingRef = useRef(false); // after a commit, clear the overlay only once the layer cache has drawn the new stroke,
    // which avoids a flicker or a vanishing line
    const lineStartRef = useRef(null);    // start point of the line tool
    const drawTargetLayerRef = useRef(null); // the layer id this stroke will commit to, in case the active layer changes under us
    const layerDragRef = useRef(null);    // while dragging everything with the move tool
    // While the liquify brush is down: the layer's pixels being pushed around, and the canvas
    // the overlay shows them from. The layer itself is hidden until the pen lifts.
    const liquifyRef = useRef(null);
    /** Layers a gesture is drawing on the overlay instead, so the composite must skip them. */
    const hiddenByGesture = (cutId, layerId) => {
        const d = layerDragRef.current;
        if (d && d.cutId === cutId && d.layerIds.includes(layerId)) return true;
        const q = liquifyRef.current;
        return !!q && q.cutId === cutId && q.layerId === layerId;
    };
    const [dragTick, setDragTick] = useState(0); // signal to redraw with the original hidden while dragging
    const liveDrawnRef = useRef(0);       // how many points are already on the live overlay, so only the tail is appended
    const liveRafRef = useRef(0);
    const boilPhaseRef = useRef(0);       // boiling-motion phase; advancing it over time makes the strokes shimmer in place
    const [boilTick, setBoilTick] = useState(0); // phase ticker so the boiling motion previews even while paused for editing
    const curveAnchorsRef = useRef(null); // curve tool: the anchor points tapped out so far
    const curveDraggingRef = useRef(false); // an anchor was just placed and is being fine-tuned by dragging
    const [curvePts, setCurvePts] = useState(0); // anchor count, for the done/cancel bar
    const mosaicRectRef = useRef(null);   // mosaic drag rectangle
    const isDrawing = useRef(false);
    const timelineRef = useRef(null);
    // Where the timeline was scrolled to before it was folded away, so unfolding returns to the
    // same place rather than to the start of the project.
    const timelineScrollRef = useRef(/** @type {{left: number, top: number} | null} */(null));
    const [pps, setPps] = useState(50);
    // Visible px window of the horizontally-scrolled timeline, so only on-screen cut blocks and
    // ruler ticks are rendered (thousands of DOM nodes otherwise stall the whole app).
    const [tlWin, setTlWin] = useState({ left: 0, right: 4000 });
    const tlWinRafRef = useRef(0);
    const ppsRef = useRef(50);
    ppsRef.current = pps;
    // User-adjustable canvas resolution. Shadows the imported defaults for the whole component.
    const [canvasSize, setCanvasSize] = useState({ w: CANVAS_W_DEFAULT, h: CANVAS_H_DEFAULT });
    const CANVAS_W = canvasSize.w, CANVAS_H = canvasSize.h;
    const [copiedCut, setCopiedCut] = useState(null);
    // The loop being drawn. A ref and the overlay, not state: a lasso is a pointer gesture like
    // a stroke, and setting state on every move meant a React render plus a full repaint per
    // sample - which is why the loop could not keep up with the pen and often missed (#lasso).
    const lassoRef = useRef(null);
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
    const paintedOnceRef = useRef(false); // once we've painted a real frame, hold it rather than flash white
    const canvasAreaRef = useRef(null);
    const videoFileRef = useRef(null);
    const playheadRef = useRef(null);        // moved imperatively during playback
    // Reused inside the composite loop; see the mask path in paintFrame.
    const maskScratchRef = useRef(null);
    const dataUrlCacheRef = useRef(new Map()); // id -> {imageData, url}; avoids re-encoding bitmaps each autosave
    const liveRef = useRef({}); // latest {cuts, copiedCut, selection} for safe bitmap GC from effects
    const selectionDragRef = useRef(null);
    const activePointerIdRef = useRef(null);
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

    const [loadProgress, setLoadProgress] = useState(null); // {label, done, total}; total 0 means the length is unknown
    // The lang state exists only to trigger a redraw; lookups read the module variable.
    // Nothing here is memoised, so changing it re-renders the whole tree in the new language.
    const [lang, setLang] = useState(loadLang);
    const changeLang = (l) => { setLangValue(l); saveLang(l); setLang(l); };
    const [themeColor, setThemeColor] = useStored('mv_theme', DEFAULT_THEME);
    const [themeRecent, setThemeRecent] = useStored('mv_theme_recent', [], arrayCodec);
    // This one had no try/catch at all, so a browser that refuses localStorage took the app
    // down on first render instead of falling back to 3.
    const [uiSat, setUiSat] = useStored('mv_ui_sat', 3, numberCodec);
    // Only the applying is left here; useStored does the remembering.
    useEffect(() => { applyTheme(themeColor, uiSat); }, [themeColor, uiSat]);
    // The value changes continuously while picking, so it is only recorded once picking stops.
    useEffect(() => {
        if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) return;
        const t = setTimeout(() => {
            // No write here: the list only changes after the debounce, and useStored records
            // it when it does.
            setThemeRecent(p => [themeColor, ...p.filter(x => x.toLowerCase() !== themeColor.toLowerCase())].slice(0, 10));
        }, 800);
        return () => clearTimeout(t);
        // The setter is listed because it comes from a custom hook: the linter knows a useState
        // setter is stable and cannot know that about one handed back from useStored. It is
        // stable, so saying so costs nothing and keeps the warning count honest.
    }, [themeColor, setThemeRecent]);
    const [leftDock, setLeftDock] = useState('color'); // which panel is open in the left dock (null = closed); switched from the icon rail

    // Tab collapses every panel to leave just the canvas, and remembers what was open so the
    // second press restores exactly that rather than opening everything.
    const panelsBeforeHideRef = useRef(null);
    const toggleAllPanels = () => {
        const prev = panelsBeforeHideRef.current;
        if (prev) {
            panelsBeforeHideRef.current = null;
            setShowLeft(prev.left); setLeftDock(prev.dock); setShowRight(prev.right); setShowBottom(prev.bottom);
            // After the layout has been laid out again - the container does not exist until then.
            const want = timelineScrollRef.current;
            if (want) requestAnimationFrame(() => requestAnimationFrame(() => {
                const el = timelineRef.current;
                if (el) { el.scrollLeft = want.left; el.scrollTop = want.top; }
            }));
        } else {
            // The timeline's scroll container is unmounted while the panels are folded, so it
            // comes back a fresh element scrolled to zero - the view jumps to the start of the
            // project rather than staying where the work was. Remember where it was looking.
            const tl = timelineRef.current;
            timelineScrollRef.current = tl ? { left: tl.scrollLeft, top: tl.scrollTop } : null;
            panelsBeforeHideRef.current = { left: showLeft, dock: leftDock, right: showRight, bottom: showBottom };
            setShowLeft(false); setLeftDock(null); setShowRight(false); setShowBottom(false);
        }
    };
    // The key handler subscribes once with an empty dependency list, so calling toggleAllPanels
    // directly from it would freeze the panel state as it was on the first render. Same ref trick
    // paintFrame already uses.
    const toggleAllPanelsRef = useRef(null);
    toggleAllPanelsRef.current = toggleAllPanels;
    // One place writes the keymap. It used to be written in three: here, and again inside each
    // of the two modals that edit it.
    const [keymap, setKeymap] = useStored('mv_keymap', { ...DEFAULT_KEYS }, {
        decode: (raw) => keymapFrom(JSON.parse(raw)),
        encode: JSON.stringify,
    });
    const [showSettings, setShowSettings] = useState(false); // settings dialog (shortcuts and theme)
    const [settingsTab, setSettingsTab] = useState('theme'); // open on the theme tab
    const [rebinding, setRebinding] = useState(null);  // id of the action waiting to be rebound
    // The view - zoom and offset - and every gesture that changes it, from a hook. It only needs
    // the element the wheel listens on.
    const { view, setView, zoomCanvas, resetView, spaceDown, spaceDownRef, panningRef, lastInteractRef,
        onAreaPointerDown, onAreaPointerMove, onAreaPointerUp } = useCanvasView({ canvasAreaRef });
    const [pathCapture, setPathCapture] = useState(null); // {cutId, layerId} while recording a motion path
    // {cutId, layerId} while the sway profile is being dragged on the canvas rather than typed.
    const [spineEdit, setSpineEdit] = useState(null);
    const pathPtsRef = useRef(null);
    const [cameraCapture, setCameraCapture] = useState(null); // {cutId} while drawing a camera path


    const isDraggingOrResizingRef = useRef(false);

    const updLayers = (cutId, fn) => dispatchCuts(patchCut(cutId, fn));

    // Work out which layer to actually draw into: if the active one is a folder or missing,
    // fall back to the topmost visible drawing layer. A hidden active layer is kept, but made
    // visible again on commit, so a stroke never disappears.
    const resolveDrawLayer = (cut) => resolveDrawLayerPure(cut, flattenLayersInUiOrder);
    // Commit the stroke to its target layer and force that layer and its parent folders
    // visible, so the result is always on screen.
    const commitStrokeToLayer = (cutId, layerId, st) => {
        // A missing layer yields null; an empty patch then leaves the cut alone rather than
        // writing a half-formed one.
        updLayers(cutId, c => commitStroke(c.layers, layerId, st) || {});
    };

    const cancelSelection = () => {
        setSelection(null);
        lassoRef.current = null;
        clearLiveOverlay();
        selectionDragRef.current = null;
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
        if (!b) { setToast(tr('이 레이어에는 아직 그린 것이 없습니다')); return; }
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
        setToast(tr('붙여넣었습니다 — 캔버스 가운데'));
    };


    // Undo/redo lives in useHistory. What stays here is the two things only this component can
    // answer: what the document currently is, and whether a gesture is in progress - drawing,
    // dragging a cut, moving a selection - during which a snapshot would capture a half-finished
    // state.
    const historySnapshot = useMemo(() => ({ cuts, audioData, numTracks }), [cuts, audioData, numTracks]);
    const { undo: globalUndo, redo: globalRedo, record: recordHistory, entries: historyEntries } = useHistory({
        snapshot: historySnapshot,
        shouldSkip: () => isDrawing.current || isDraggingOrResizingRef.current || !!selectionDragRef.current,
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

    // Content bounds - playback and loop run between these, not out to maxTime, which has empty
    // padding for the timeline ruler.
    // Parts (scenes): cuts grouped by partId. Each video import is one part; cuts can also be
    // grouped manually. Selecting a part scopes playback (and dims the rest) to it.
    const parts = derivePartsFrom(cuts, tr('파트'));
    const activePart = activePartId ? parts.find(p => p.id === activePartId) : null;
    // Playback runs within the active part when one is selected, else across all content. The
    // exports use the same two numbers - see playRange.js for what that fixed.
    const { start: playStart, end: playEnd } = playRange({ cuts, audio: audioData, video: videoOverlay, part: activePart });

    // Playback owns the clock: isPlaying, currentTime, and the refs the rAF loop reads instead
    // of state so it never runs on a stale closure. Everything passed in is an input - playback
    // is a function of the timeline, the media and where to paint - and the groups say which is
    // which rather than leaving seventeen arguments in a row.
    const {
        isPlaying, setIsPlaying, currentTime, setCurrentTime,
        currentTimeRef, seekRef, isPlayingRef,
        playPause: handlePlayPause, stop: handleStop,
    } = usePlayback({
        media: { audioRef, videoElRef, audioUrl, audioData, videoOverlay },
        range: { playStart, playEnd, maxTime, loopPlay, playbackRate, anchorTime: currentCut?.startTime },
        paint: { pps, playheadRef, paintFrameRef, prefetchRef },
        recording: { isExporting, exportEndRef, exportStartRef, requestFrameRef, mediaRecorderRef },
    });

    // The layer canvases: which cuts are rendered to one, when they are rebuilt, the frames
    // decoded ahead of the playhead, and the clip groups flattened on top. hooks/useLayerCache
    // owns all of it over the bitmap store; App reads the cache for its rows and paints from
    // ensureLayerCanvas and flattenClipGroup.
    const {
        layerCanvasCache, clearLayerCache, ensureLayerCanvas, flattenClipGroup,
        invalidateCutsUsing, requestFrameDecode, frameDecodeTick, requestRepaint,
    } = useLayerCache({
        store: bitmapStore.current, cuts, currentCutId, currentCut, currentTime, onionPrev, onionNext,
        activePartId, isPlaying, isPlayingRef, canvasW: CANVAS_W, canvasH: CANVAS_H, hiddenByGesture,
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
        const v = videoElRef.current; if (!v || !videoOverlay) return;
        if (currentTime >= videoOverlay.startTime && currentTime < videoOverlay.endTime) {
            const exp = (currentTime - videoOverlay.startTime) + videoOverlay.offset;
            const want = seekTarget(exp, v.duration);
            if (Math.abs(v.currentTime - want) > 0.03) { try { v.currentTime = want; } catch { } }
        }
    }, [currentTime, isPlaying, videoOverlay]);


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
        setToast(plan.stranded.length
            ? tr('{0}배 길이로 굳혔습니다 · 음원/영상 트랙은 늘어나지 않으니 위치를 다시 맞춰주세요 · Ctrl+Z로 취소', plan.factor.toFixed(2).replace(/\.?0+$/, ''))
            : tr('{0}배 길이로 굳혔습니다 · Ctrl+Z로 취소', plan.factor.toFixed(2).replace(/\.?0+$/, '')));
    };



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
    }, [recordLiveHistory, resizingData, draggingCutData, pps, numTracks]);

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
            version: '1.5', appName: 'EasyMVMaker', savedAt: new Date().toISOString(), numTracks, onionPrev, onionNext, pps, bitmaps, compressedBitmaps: compressed,
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
        if (videoOverlay && videoBlobRef.current) {
            const meta = { name: videoOverlay.name, startTime: videoOverlay.startTime, endTime: videoOverlay.endTime, offset: videoOverlay.offset, duration: videoOverlay.duration, w: videoOverlay.w, h: videoOverlay.h, opacity: videoOverlay.opacity ?? 1, cuts: videoOverlay.cuts, cutStart: videoOverlay.cutStart, cutOffset: videoOverlay.cutOffset };
            out.video = await packMedia(meta, { id: '__video__', ext: videoExt(videoBlobRef.current.type), assetSink, blobsOk, blob: videoBlobRef.current, toDataUrl: blobToDataURL });
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
        // Rebuild the bitmap store before swapping cuts in, so fill/lasso/paste render correctly.
        const store = bitmapStoreRef.current;
        store.clear();
        // Progress: a project with many frames takes a while to open, so it gets a bar.
        // Only past a certain count, to stop small projects flashing one up for an instant.
        const assetCount = (assetBase && Array.isArray(data.assets)) ? data.assets.length : 0;
        const bmpCount = data.bitmaps ? Object.keys(data.bitmaps).length : 0;
        const total = assetCount + bmpCount;
        const { heavy, tick } = makeLoadProgress(total, p => setLoadProgress({ label, ...p }));
        if (heavy) setLoadProgress({ label, done: 0, total });
        // Externalized frame assets (server projects): fetch one at a time and keep as a Blob
        // (off-heap). Bounded memory — one frame in flight.
        let missingAssets = 0;
        if (assetBase && Array.isArray(data.assets)) {
            for (const a of data.assets) {
                try {
                    const blob = await fetchAsset(`${assetBase}/asset/${a.id}`);
                    // Don't decode here — lazy decode on display keeps opening a big project from OOMing.
                    store.set(a.id, { imageData: null, imageBitmap: null, blob, ext: a.ext, w: a.w || 0, h: a.h || 0 });
                } catch { missingAssets++; }
                tick();
            }
        }
        // Frames may arrive as a Blob (IndexedDB autosave) or a dataURL (embedded .emv); which is
        // which, and what each becomes, is projectAssets' decision rather than a second opinion
        // taken here. Reading a document's pixels without opening the document is also what the
        // export queue needs (#123), which is why this is a function and no longer a block.
        const { store: loaded, failed } = await loadBitmapStore(data, {
            dataURLToImageData,
            createBitmap: (img) => createImageBitmap(img),
            urlToBlob: async (url) => (await fetch(url)).blob(),
            extFromType: imageExtFromType,
            onEach: tick,
        });
        for (const [id, entry] of loaded) store.set(id, entry);
        missingAssets += failed;
        // Older files are brought up to the current shape in projectFormat, where the renames and
        // added fields are written down and tested.
        docEpochRef.current++;   // opening a project: anything still running belongs to the old one
        dispatchCuts(replaceCuts(migrateCuts(data.cuts)));
        setActivePartId(null);
        const s = projectSettings(data);
        if (s.canvas) setCanvasSize(s.canvas);
        setNumTracks(s.numTracks); setCurrentCutId(s.currentCutId); setCurrentTime(0);
        setOnionPrev(s.onionPrev); setOnionNext(s.onionNext); setPps(s.pps); setExpandedCuts(new Set());
        setCopiedCut(null); // clipboard may reference bitmaps from the old project
        clearLayerCache(); // Clear cache on new project
        // The audio lives in useAudioTrack, and so does putting it back: the element, the
        // base64 copy a local save needs, and the three shapes a stored track can arrive in.
        missingAssets += await restoreAudio(data, assetBase);
        // Restore the video overlay track (Blob from IDB / server asset / embedded dataURL).
        let videoBlob = null;
        if (data.video?.blob instanceof Blob) videoBlob = data.video.blob;
        else if (data.video?.asset && assetBase) { try { videoBlob = await fetchAsset(`${assetBase}/asset/__video__`); } catch { missingAssets++; } }
        else if (data.video?.dataUrl) { try { videoBlob = await (await fetch(data.video.dataUrl)).blob(); } catch { } }
        if (videoBlob) {
            videoBlobRef.current = videoBlob;
            const url = URL.createObjectURL(videoBlob);
            const v = videoElRef.current;
            // The url here is ours (createObjectURL), but it goes through the same gate as the
            // audio so there is one rule about what may reach a media element, not two.
            const videoSrc = safeMediaSrc(url, 'video');
            if (v && videoSrc) { v.muted = true; v.playsInline = true; v.src = videoSrc; v.onseeked = () => requestRepaint(); v.onloadedmetadata = () => { try { v.currentTime = data.video.offset || 0; } catch { } }; }
            dispatchMedia(loadVideo({ name: data.video.name || tr('영상'), startTime: data.video.startTime ?? 0, endTime: data.video.endTime ?? (data.video.duration || 0), offset: data.video.offset ?? 0, duration: data.video.duration || 0, w: data.video.w || 0, h: data.video.h || 0, cuts: data.video.cuts, cutStart: data.video.cutStart, cutOffset: data.video.cutOffset }));
        } else {
            videoBlobRef.current = null; dispatchMedia(clearVideo());
            detachMedia(videoElRef.current);
        }
            // Said once, after everything that could be loaded has been. A project that opens
            // with holes in it should say so - the alternative is blank frames that look like the
            // work was lost. Deliberately not "not found on the server": this counts a missing
            // server asset and a frame that would not decode out of a local file, and only one of
            // those has a server in it.
            if (missingAssets) setAppError(tr('{0}개의 파일을 불러오지 못해 비어 있습니다.', missingAssets));
        } finally { setLoadProgress(null); restoreBusyRef.current = false; }
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
        setLoadProgress, setAppError, setToast,
        liveRef, localNameRef,
    });

    const resetToEmpty = () => {
        fileHandleRef.current = null;
        bitmapStoreRef.current.clear();
        docEpochRef.current++;   // starting over
        dispatchCuts(replaceCuts([firstCut()]));
        setNumTracks(2); setCurrentCutId(1); setCurrentTime(0); setExpandedCuts(new Set());
        setCopiedCut(null); setSelectedCutIds(new Set()); setActivePartId(null);
        clearLayerCache();
        forgetProject();
        detachMedia(audioRef.current);
        audioB64Ref.current = null; dispatchMedia(clearAudio());
        videoBlobRef.current = null; dispatchMedia(clearVideo()); setSceneCfg(null);
        detachMedia(videoElRef.current);
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
        setAppError, setToast, setLoadProgress, fileHandleRef, localNameRef,
    });

    // Debounced autosave to IndexedDB, so a refresh or a crash never costs work. It waits for
    // crash recovery to finish deciding - otherwise a new empty document overwrites the autosave
    // the user is about to be offered - and skips mid-gesture, where a half-drawn stroke is not
    // worth keeping and encoding one costs frames.
    // audioData and videoOverlay are in here because trimming either one is a change worth
    // keeping - and without them nothing about the media reached the autosave until the next
    // stroke happened to trigger one.
    const autosaveDoc = useMemo(() => ({ cuts, numTracks, onionPrev, onionNext, pps, audioData, videoOverlay }),
        [cuts, numTracks, onionPrev, onionNext, pps, audioData, videoOverlay]);
    const { savedAt: autoSavedAt, error: autosaveErr } = useAutosave({
        doc: autosaveDoc,
        ready: () => didRecoverRef.current,
        busy: () => isDrawing.current || isDraggingOrResizingRef.current,
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
        const ids = (selectedCutIds.size > 1 && selectedCutIds.has(id)) ? new Set(selectedCutIds) : new Set([id]);
        const nc = cuts.filter(c => !ids.has(c.id));
        dispatchCuts(replaceCuts(nc));
        if (ids.has(currentCutId)) setCurrentCutId(nc.length > 0 ? nc[0].id : null);
        setSelectedCutIds(new Set());
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
    const toggleCutSettings = (id) => setExpandedCuts(p => toggled(p, id));
    const toggleCutCollapse = (id) => setCollapsedCutIds(p => toggled(p, id));
    const renameCut = (id, name) => dispatchCuts(updateCut(id, { name }));
    const updCutAnim = (id, patch) => dispatchCuts(setCutAnim(id, patch));
    const updCutCamera = (id, patch) => dispatchCuts(setCutCamera(id, patch));
    const updLayerAnim = (cutId, layerId, patch) => dispatchCuts(setLayerAnim(cutId, layerId, patch));
    const handleAddTrack = () => setNumTracks(p => p + 1);
    const handleDeleteTrack = (i) => { if (numTracks <= 1) return; if (!window.confirm(tr('Track {0} 삭제?', i))) return; dispatchCuts(deleteTrack(i)); setNumTracks(p => p - 1); };
    // Click a cut in the list: plain = select one, Ctrl/Cmd = toggle, Shift = range (timeline order).
    // Plain, Ctrl and Shift clicks are three selection rules; core/cutSelection has them.
    const handleCutClick = (e, id) => {
        setSelectedCutIds(p => selectionAfterClick(p, cuts, currentCutId, id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
        setCurrentCutId(id);
    };
    const handleCopyCut = (id) => {
        // The whole multi-selection when this cut is in it, else just this one. Deep-copied,
        // so later edits to the originals do not reach the clipboard.
        const arr = cutsToCopy(cuts, selectedCutIds, id).map(c => JSON.parse(JSON.stringify(c)));
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
        setLoadProgress({ label: tr('중간 프레임 만드는 중'), done: 0, total: n });
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
                setLoadProgress({ label: tr('중간 프레임 만드는 중'), done: i + 1, total: n });
                await new Promise(r => setTimeout(r, 0)); // yield to the UI between frames so it does not look frozen
            }
            dispatchCuts(insertCutsShifting(A.track, A.endTime, n * dur, newCuts));
        } catch (e) { alert(tr('트위닝 실패: ') + e.message); }
        finally { setLoadProgress(null); }
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

    /** The overlay's 2D context, or null before the canvas has mounted. */
    const liveCtx = () => liveCanvasRef.current?.getContext('2d') ?? null;

    /** Wipe it. Safe to call when there is no overlay yet. */
    const clearLiveOverlay = () => {
        const lc = liveCanvasRef.current;
        if (lc) lc.getContext('2d').clearRect(0, 0, lc.width, lc.height);
    };

    // how long the stroke is.
    const renderLiveStroke = (full = false) => {
        const ctx = liveCtx(); if (!ctx) return;
        const st = liveStrokeRef.current;
        if (!st) { clearLiveOverlay(); liveDrawnRef.current = 0; return; }
        const n = st.points.length;
        // Cases needing a full redraw, such as the line and curve tools where the earlier part
        // of the stroke changes.
        if (full || liveDrawnRef.current === 0 || n < liveDrawnRef.current) {
            clearLiveOverlay();
            drawStrokesOnCtx(ctx, [st], false, bitmapStoreRef.current);
            liveDrawnRef.current = n;
            return;
        }
        if (n === liveDrawnRef.current) return;
        // Tail only: starting slightly before the last drawn point hides the seam.
        const from = Math.max(0, liveDrawnRef.current - 3);
        drawStrokesOnCtx(ctx, [{ ...st, points: st.points.slice(from) }], false, bitmapStoreRef.current);
        liveDrawnRef.current = n;
    };
    // The loop as it is drawn, on the overlay. Line width in screen pixels, so it is as visible
    // zoomed out as zoomed in.
    const renderLassoPreview = () => {
        const ctx = liveCtx(); if (!ctx) return;
        clearLiveOverlay();
        const pts = lassoRef.current; if (!pts || pts.length === 0) return;
        drawMarquee(ctx, pts, view.zoom);
    };
    // Move preview: the shifted result is drawn on the overlay while paintFrame hides the
    // original. It has to draw once on press too, or the screen flashes empty for a moment.
    const renderLayerDragPreview = () => {
        const d = layerDragRef.current; if (!d) return;
        const c2 = liveCtx(); if (!c2) return;
        const cut = cuts.find(c => c.id === d.cutId); if (!cut) return;
        clearLiveOverlay();
        const ox = Math.round(d.dx), oy = Math.round(d.dy);
        const order = flattenLayersInUiOrder(cut.layers || []).filter(l => l.type === 'layer' && d.layerIds.includes(l.id));
        for (let i = order.length - 1; i >= 0; i--) {
            const src = ensureLayerCanvas(cut.id, order[i]); // create it on the spot if it is not cached
            if (src) c2.drawImage(src, ox, oy);
        }
    };

    // Coalesce to one draw per frame - pointer events arrive far more often than frames.
    const scheduleLiveRender = () => {
        if (liveRafRef.current) return;
        liveRafRef.current = requestAnimationFrame(() => { liveRafRef.current = 0; renderLiveStroke(); });
    };
    // Curve tool: densely samples a Catmull-Rom spline through the anchors that were tapped.
    const catmullThrough = (pts, seg = 16) => {
        if (!pts || pts.length < 3) return (pts || []).slice();
        const at = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
        const out = [];
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
            for (let t = 0; t < seg; t++) {
                const s = t / seg, s2 = s * s, s3 = s2 * s;
                const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3);
                const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3);
                const pr = (p1.pressure ?? 0.5) + ((p2.pressure ?? 0.5) - (p1.pressure ?? 0.5)) * s;
                out.push({ x, y, pressure: pr });
            }
        }
        out.push(at(pts.length - 1));
        return out;
    };
    const curveStrokeFromAnchors = (pts) => ({ id: nextId(), tool: 'brush', color, opacity, size: brushSize, points: catmullThrough(pts) });
    const renderCurvePreview = () => {
        const ctx = liveCtx(); if (!ctx) return;
        clearLiveOverlay();
        const pts = curveAnchorsRef.current || [];
        if (pts.length >= 2) drawStrokesOnCtx(ctx, [curveStrokeFromAnchors(pts)], false, bitmapStoreRef.current);
        ctx.save();
        for (let i = 0; i < pts.length; i++) {
            ctx.beginPath();
            ctx.arc(pts[i].x, pts[i].y, 5, 0, Math.PI * 2);
            ctx.fillStyle = i === 0 ? '#4ea1ff' : '#fff';
            ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
            ctx.fill(); ctx.stroke();
        }
        ctx.restore();
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
        const layerId = drawTargetLayerRef.current || resolveDrawLayer(currentCut)?.id;
        if (layerId == null) return;
        commitStrokeToLayer(currentCutId, layerId, st);
        if (st.tool !== 'eraser') noteColorUsed(st.color);
    };
    const commitCurve = () => {
        const pts = curveAnchorsRef.current;
        curveAnchorsRef.current = null; curveDraggingRef.current = false; setCurvePts(0);
        if (pts && pts.length >= 2) commitLiveStroke(curveStrokeFromAnchors(pts));
        else clearLiveOverlay();
    };
    const cancelCurve = () => {
        curveAnchorsRef.current = null; curveDraggingRef.current = false; setCurvePts(0);
        clearLiveOverlay();
    };
    // Blur brush: uses the path it travels as a mask and blurs the layer pixels beneath it.
    // This spreads what is already drawn rather than adding a vector stroke, so it works on
    // raster data.
    const applyBlurStroke = (st) => {
        const cut = currentCut;
        const layer = cut?.layers.find(l => l.id === drawTargetLayerRef.current);
        if (!cut || !layer) return;
        const src = ensureLayerCanvas(cut.id, layer); if (!src) return;
        const pts = st.points, rad = Math.max(2, st.size);
        // Only the affected region is processed, which keeps large canvases cheap.
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        const pad = rad + 4;
        x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
        x1 = Math.min(CANVAS_W, Math.ceil(x1 + pad)); y1 = Math.min(CANVAS_H, Math.ceil(y1 + pad));
        const w = x1 - x0, h = y1 - y0;
        if (w < 2 || h < 2) return;
        // 1) A blurred copy of the region. Several light passes look far smoother than one
        //    heavy pass, since repeated blurring approximates a Gaussian.
        const blurred = document.createElement('canvas'); blurred.width = w; blurred.height = h;
        const bctx = blurred.getContext('2d');
        bctx.drawImage(src, x0, y0, w, h, 0, 0, w, h);
        const step = Math.max(1, rad / 4);
        for (let i = 0; i < 3; i++) {
            bctx.filter = `blur(${step}px)`;
            bctx.drawImage(blurred, 0, 0);
        }
        bctx.filter = 'none';
        // 2) Keep only what the brush passed over, softening the mask edge so no seam forms.
        //    A hard mask leaves a visible line where the blurred area meets the original.
        const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
        const mctx = mask.getContext('2d');
        mctx.filter = `blur(${Math.max(1, rad / 3)}px)`;
        mctx.strokeStyle = '#000'; mctx.fillStyle = '#000';
        mctx.lineCap = 'round'; mctx.lineJoin = 'round'; mctx.lineWidth = rad * 0.8;
        mctx.beginPath();
        pts.forEach((p, i) => i ? mctx.lineTo(p.x - x0, p.y - y0) : mctx.moveTo(p.x - x0, p.y - y0));
        mctx.stroke();
        if (pts.length === 1) { mctx.beginPath(); mctx.arc(pts[0].x - x0, pts[0].y - y0, rad / 2, 0, Math.PI * 2); mctx.fill(); }
        mctx.filter = 'none';
        bctx.globalCompositeOperation = 'destination-in';
        bctx.drawImage(mask, 0, 0);
        bctx.globalCompositeOperation = 'source-over';
        const bitmapId = storeBitmap(bctx.getImageData(0, 0, w, h));
        commitStrokeToLayer(currentCutId, layer.id, { id: nextId(), tool: 'paste', bitmapId, x: x0, y: y0, w, h });
    };

    // Liquify: the layer's pixels are copied out when the pen goes down, pushed around in that
    // copy on every move, and stamped back as an erase-hole plus a paste when it lifts. While the
    // pen is down the overlay shows the copy and the composite hides the layer, so what is on
    // screen is exactly the buffer being edited.
    const beginLiquify = (cut, layer, pos) => {
        const src = ensureLayerCanvas(cut.id, layer); if (!src) return false;
        const canvas = document.createElement('canvas');
        sizeCanvas(canvas, CANVAS_W, CANVAS_H);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(src, 0, 0);
        const image = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
        liquifyRef.current = { cutId: cut.id, layerId: layer.id, canvas, ctx, image, last: pos, box: null };
        renderLiquifyPreview();
        setDragTick(v => v + 1);    // hide the original
        return true;
    };
    const renderLiquifyPreview = () => {
        const q = liquifyRef.current; if (!q) return;
        const ctx = liveCtx(); if (!ctx) return;
        clearLiveOverlay();
        ctx.drawImage(q.canvas, 0, 0);
    };
    const liquifyTo = (pos) => {
        const q = liquifyRef.current; if (!q) return;
        // Radius from the brush size, strength from opacity - both already on the panel.
        const b = pushAlong(q.image.data, CANVAS_W, CANVAS_H, q.last, pos, Math.max(2, brushSize), opacity);
        q.last = pos;
        if (!b) return;
        // Only the touched rectangle goes back to the canvas; the buffer is the whole layer.
        q.ctx.putImageData(q.image, 0, 0, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        q.box = q.box ? { x0: Math.min(q.box.x0, b.x0), y0: Math.min(q.box.y0, b.y0), x1: Math.max(q.box.x1, b.x1), y1: Math.max(q.box.y1, b.y1) } : b;
        renderLiquifyPreview();
    };
    const endLiquify = () => {
        const q = liquifyRef.current; liquifyRef.current = null;
        clearLiveOverlay();
        setDragTick(v => v + 1);    // show the layer again
        if (!q || !q.box) return;
        const { x0, y0, x1, y1 } = q.box;
        const w = x1 - x0, h = y1 - y0;
        if (w < 1 || h < 1) return;
        // The result replaces the rectangle rather than painting over it: pixels that flowed
        // away leave transparency behind, and a plain paste would let the original show through
        // there. So it is the same pair a selection commits with - a hole, then the pixels.
        const mask = new ImageData(w, h);
        mask.data.fill(255);
        const sel = { x: x0, y: y0, tx: x0, ty: y0, tw: w, th: h, bitmapId: storeBitmap(q.ctx.getImageData(x0, y0, w, h)), maskBitmapId: storeBitmap(mask) };
        const { erase, paste } = selectionStrokes(sel, nextId(), nextId());
        commitStrokeToLayer(q.cutId, q.layerId, [erase, paste]);
    };

    // Mosaic: previews the drag rectangle as a dashed outline.
    const renderMosaicMarquee = () => {
        const ctx = liveCtx(); if (!ctx) return;
        clearLiveOverlay();
        const r = mosaicRectRef.current; if (!r) return;
        const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
        ctx.save();
        ctx.fillStyle = 'rgba(120,140,255,0.15)'; ctx.fillRect(x, y, w, h);
        ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = 'var(--accent-soft)';
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    };
    // Reads the rectangle from the composited canvas, pixelates it in blocks, and stamps the
    // result onto the active layer.
    const applyMosaic = (rect) => {
        const bx = Math.max(0, Math.floor(Math.min(rect.x0, rect.x1)));
        const by = Math.max(0, Math.floor(Math.min(rect.y0, rect.y1)));
        const bw = Math.min(CANVAS_W - bx, Math.ceil(Math.abs(rect.x1 - rect.x0)));
        const bh = Math.min(CANVAS_H - by, Math.ceil(Math.abs(rect.y1 - rect.y0)));
        if (bw < 2 || bh < 2) return;
        const src = canvasRef.current.getContext('2d').getImageData(bx, by, bw, bh);
        const d = src.data;
        const block = Math.max(2, Math.round(mosaicBlock));
        for (let y0 = 0; y0 < bh; y0 += block) {
            for (let x0 = 0; x0 < bw; x0 += block) {
                let r = 0, g = 0, b = 0, a = 0, cnt = 0;
                const xe = Math.min(bw, x0 + block), ye = Math.min(bh, y0 + block);
                for (let y = y0; y < ye; y++) for (let x = x0; x < xe; x++) { const i = (y * bw + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; cnt++; }
                r = r / cnt; g = g / cnt; b = b / cnt; a = a / cnt;
                for (let y = y0; y < ye; y++) for (let x = x0; x < xe; x++) { const i = (y * bw + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
            }
        }
        const bitmapId = storeBitmap(src);
        const stroke = { id: nextId(), tool: 'paste', bitmapId, x: bx, y: by, w: bw, h: bh };
        updLayers(currentCutId, c => ({ layers: patchLayer(c.layers, c.activeLayerId, l => ({ strokes: [...l.strokes, stroke] })) }));
    };

    // Rebinding: while waiting, whatever combination is pressed is captured verbatim, ahead of
    // any other handling.
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
    }, [rebinding, setKeymap]);

    // Track the timeline's visible px window (scroll + resize) to drive virtualization.
    useEffect(() => {
        const el = timelineRef.current; if (!el) return;
        const update = () => {
            cancelAnimationFrame(tlWinRafRef.current);
            tlWinRafRef.current = requestAnimationFrame(() => {
                const pad = el.clientWidth || 2000; // one screen of margin each side
                setTlWin({ left: el.scrollLeft - pad, right: el.scrollLeft + (el.clientWidth || 2000) + pad });
            });
        };
        update();
        el.addEventListener('scroll', update, { passive: true });
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => { el.removeEventListener('scroll', update); ro.disconnect(); cancelAnimationFrame(tlWinRafRef.current); };
    }, [showBottom, timelineH]);
    // Keep the window sensible when zoom/content changes the scrollable width.
    useEffect(() => {
        const el = timelineRef.current; if (!el) return;
        const pad = el.clientWidth || 2000;
        setTlWin({ left: el.scrollLeft - pad, right: el.scrollLeft + (el.clientWidth || 2000) + pad });
    }, [pps, maxTime, numTracks]);

    // The handles and the outline are where paintFrame draws them - on the warped box - and the
    // grab radius is in screen pixels, like their size. Measured in canvas pixels it shrank with
    // every zoom-out until a corner could not be caught at all.
    const hitTestSelection = (pos) => {
        if (!selection) return null;
        const box = { x: selection.tx, y: selection.ty, w: selection.tw, h: selection.th, rot: selection.rot, skew: selection.skew, bend: selection.bend };
        const grab = HANDLE_GRAB_PX / view.zoom;
        for (const hd of warpedHandles(box)) {
            if (Math.abs(pos.x - hd.x) <= grab && Math.abs(pos.y - hd.y) <= grab) return { type: 'resize', handle: hd.id };
        }
        return pointInPolygon([pos.x, pos.y], warpedOutline(box).map(p => [p.x, p.y])) ? { type: 'move' } : null;
    };


    // A press that claims the canvas. Every branch of startDraw that takes over the pointer does
    // these three things together: remember which pointer owns the gesture, capture it so moves
    // keep arriving even once it leaves the canvas, and mark a drag in progress.
    //
    // setPointerCapture needs the try/catch. It throws when the pointer id is already gone -
    // optional chaining does not help, that guards a missing method, not a throw - and an
    // uncaught throw out of a pointerdown handler takes the whole app down. That happened.
    const beginGesture = (e) => {
        // Drawing means the canvas is what is being worked on. Leaving focus in the size box - a
        // very ordinary place for it to be - sent the next keystroke there instead of to the
        // shortcut it was meant for.
        canvasRef.current?.focus({ preventScroll: true });
        activePointerIdRef.current = e.pointerId;
        try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }
        isDrawing.current = true;
    };

    // The other half of beginGesture: give the pointer back and stop treating moves as drawing.
    // Every branch of stopDraw ends this way. releasePointerCapture throws on a pointer that is
    // already gone, exactly as its counterpart does, so it needs the same guard.
    const endGesture = () => {
        isDrawing.current = false;
        try { if (activePointerIdRef.current !== null) canvasRef.current?.releasePointerCapture(activePointerIdRef.current); } catch { }
        activePointerIdRef.current = null;
    };

    // Grabbing a text and dragging it, plus the measuring that hit-testing needs. The text tool
    // and the move tool both start one and differ in one flag: under the text tool, releasing
    // without having moved opens the editor, which is why endTextDrag reports what ended.
    const { measureTextBox, hitTestText, startTextDrag, moveTextDrag, endTextDrag } = useTextDrag({
        dispatchCuts, currentCutId, setSelectedText, beginGesture,
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
        updLayers(currentCutId, c => ({
            layers: patchLayer(c.layers, activeLayer.id, l => ({ strokes: insertFill(l.strokes, stroke, region.overPaint) }))
        }));
    };

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
        if (cameraCapture) {
            beginGesture(e);
            pathPtsRef.current = [pos];
            e.preventDefault();
            return;
        }
        // Recording a motion path for a part animation: capture the stroke as a path.
        if (pathCapture) {
            beginGesture(e);
            pathPtsRef.current = [pos];
            e.preventDefault();
            return;
        }
        // Even if the active layer is a folder, hidden or invalid, this substitutes a real
        // drawable layer, so the stroke always survives and stays visible.
        const activeLayer = resolveDrawLayer(currentCut);
        if (!activeLayer) return;
        drawTargetLayerRef.current = activeLayer.id;

        if (textEdit) return;

        // Selection has priority over other interactions to avoid tool conflicts.
        if (selection) {
            const hit = hitTestSelection(pos);
            if (hit) {
                beginGesture(e);
                // A drag adjusts skew and bend instead of moving or resizing when Ctrl is held
                // (#175) - wherever it starts, handles included. Letting the handles keep
                // resizing under Ctrl meant a drag begun on a corner resized and one begun a few
                // pixels inward warped, which read as Ctrl working only sometimes.
                const warp = e.ctrlKey || e.metaKey;
                const kind = warp ? { type: 'warp' } : hit;
                selectionDragRef.current = { hit: kind, startPos: { x: pos.x, y: pos.y }, startSel: { ...selection } };
                e.preventDefault();
                return;
            }
            // Click outside selection commits by default (standard behavior).
            commitSelectionImpl(selection);
        }

        if (tool === 'text') {
            const hit = hitTestText(pos, currentCut);
            if (hit) { startTextDrag(e, pos, hit, true); return; }
            openTextEditorAt(pos, currentCut);
            isDrawing.current = false;
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
            if (ids.length) {
                beginGesture(e);
                layerDragRef.current = { cutId: currentCutId, layerIds: ids, startPos: { x: pos.x, y: pos.y }, dx: 0, dy: 0 };
                renderLayerDragPreview();   // draw immediately on press so the screen does not flash empty
                setDragTick(v => v + 1);    // hide the original
                e.preventDefault();
                return;
            }
        }

        if (etool === 'curve') {
            // Curve ruler: tap to place anchors (hold and drag to fine-tune), then confirm with
            // the done button.
            beginGesture(e);
            if (!curveAnchorsRef.current) curveAnchorsRef.current = [];
            curveAnchorsRef.current.push({ x: pos.x, y: pos.y, pressure: pos.pressure });
            curveDraggingRef.current = true;
            setCurvePts(curveAnchorsRef.current.length);
            renderCurvePreview();
            e.preventDefault();
            return;
        }

        beginGesture(e);
        if (tool !== 'move' && tool !== 'text' && selectedText) setSelectedText(null);

        switch (etool) {
            case 'lasso':
                lassoRef.current = [pos];
                renderLassoPreview();
                break;
            case 'pen':
            case 'brush':
            case 'pencil':
            case 'soft':
            case 'blur':
            case 'marker': {
                // Draw on the live overlay only — no layer-state writes per move (that was the lag).
                liveStrokeRef.current = { id: nextId(), tool: etool, color, opacity, size: brushSize, points: [pos], pen: pressureOn && e.pointerType === 'pen' };
                liveDrawnRef.current = 0; renderLiveStroke(true);
                break;
            }
            case 'line':
            case 'rect':
            case 'ellipse': {
                // Drag rulers: the start is pinned and only the end follows. The shape is rebuilt
                // from those two corners on every move, so what gets stored is an ordinary stroke
                // - it takes the brush, it boils with the layer, it erases and saves like any
                // other line, and nothing downstream has to learn that a rectangle exists.
                lineStartRef.current = pos;
                liveStrokeRef.current = { id: nextId(), tool: 'brush', color, opacity, size: brushSize, points: shapePoints(etool, pos, pos) || [pos, { ...pos }], pen: pressureOn && e.pointerType === 'pen' };
                liveDrawnRef.current = 0; renderLiveStroke(true);
                break;
            }
            case 'mosaic': {
                mosaicRectRef.current = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
                renderMosaicMarquee();
                break;
            }
            case 'liquify': {
                if (!beginLiquify(currentCut, activeLayer, pos)) endGesture();
                break;
            }
            case 'eraser': {
                // Eraser must composite against the layer, so it stays on the layer-write path.
                const newStroke = { id: nextId(), tool, color, opacity, size: eraserSize, points: [pos] };
                updLayers(currentCutId, c => ({
                    layers: patchLayer(c.layers, drawTargetLayerRef.current, l => ({ strokes: [...l.strokes, newStroke] }))
                }));
                break;
            }
            case 'fill':
                // A fill is a single act, not a drag.
                isDrawing.current = false;
                floodFillAt(pos, currentCut, activeLayer);
                break;
            case 'move':
                isDrawing.current = false;
                break;
        }
    };

    // Which resize handle the pointer is over, or null. Only used for the cursor, so it is set
    // from the hover pass below and never read by anything that draws.
    const [hoverHandle, setHoverHandle] = useState(/** @type {string|null} */(null));

    const onDraw = (e) => {
        // Hovering, not drawing: the only thing to work out is what the cursor should say. A
        // selection has eight handles and hitTestSelection already knows which one a point is
        // over; without this the cursor said "move" over all of them, so the one gesture that
        // resizes looked like the one that moves.
        if (!isDrawing.current) {
            if (!selection) { if (hoverHandle) setHoverHandle(null); return; }
            const hit = hitTestSelection(getPos(e));
            const next = hit?.type === 'resize' ? hit.handle : null;
            if (next !== hoverHandle) setHoverHandle(next);   // guarded: this runs on every move
            return;
        }
        const pos = getPos(e);

        if (pathPtsRef.current) { pathPtsRef.current.push(pos); return; }

        // Move preview: the overlay draws the shifted copy while paintFrame hides the original.
        if (layerDragRef.current) {
            const d = layerDragRef.current;
            d.dx = pos.x - d.startPos.x; d.dy = pos.y - d.startPos.y;
            renderLayerDragPreview();
            setDragTick(v => v + 1); // redraw while keeping the original hidden
            return;
        }

        if (etool === 'curve' && curveDraggingRef.current && curveAnchorsRef.current) {
            const a = curveAnchorsRef.current; a[a.length - 1] = { x: pos.x, y: pos.y, pressure: pos.pressure };
            renderCurvePreview();
            return;
        }

        if (moveTextDrag(pos)) return;

        if (selectionDragRef.current && selection) {
            const { hit, startPos, startSel } = selectionDragRef.current;
            const dx = pos.x - startPos.x;
            const dy = pos.y - startPos.y;
            if (hit.type === 'move') {
                setSelection(s => s ? ({ ...s, tx: startSel.tx + dx, ty: startSel.ty + dy }) : s);
            } else if (hit.type === 'resize') {
                const next = applyResize(hit.handle, startSel, dx, dy);
                setSelection(s => s ? ({ ...s, ...next }) : s);
            } else if (hit.type === 'warp') {
                const next = applyWarpDrag(startSel, dx, dy);
                setSelection(s => s ? ({ ...s, ...next }) : s);
            }
            return;
        }

        switch (etool) {
            case 'lasso':
                if (lassoRef.current) { lassoRef.current.push(pos); renderLassoPreview(); }
                break;
            case 'move':
                break;
            case 'line':
            case 'rect':
            case 'ellipse': {
                if (liveStrokeRef.current && lineStartRef.current) {
                    liveStrokeRef.current.points = shapePoints(etool, lineStartRef.current, pos)
                        || [lineStartRef.current, pos];
                    renderLiveStroke(true); // the far corner moved, so redraw the whole thing
                }
                break;
            }
            case 'mosaic': {
                if (mosaicRectRef.current) { mosaicRectRef.current.x1 = pos.x; mosaicRectRef.current.y1 = pos.y; renderMosaicMarquee(); }
                break;
            }
            case 'liquify': {
                // Every sample, not just the last per frame: the push is path-dependent, and
                // skipping samples straightens a curve the pen drew.
                const raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
                for (const p of (raw && raw.length > 1 ? raw.map(getPos) : [pos])) liquifyTo(p);
                break;
            }
            case 'pen':
            case 'brush':
            case 'pencil':
            case 'soft':
            case 'blur':
            case 'marker':
            case 'eraser': {
                // Fast strokes get coalesced by the browser into one event; recover every
                // intermediate sample so quick curves stay curved instead of going polygonal.
                const raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
                const positions = raw && raw.length > 1 ? raw.map(getPos) : [pos];
                if (liveStrokeRef.current) {
                    // Brush tools: append + repaint just the overlay (no React, no full-layer rebuild).
                    for (const p of positions) liveStrokeRef.current.points.push(p);
                    scheduleLiveRender();
                    break;
                }
                // Eraser: layer-write path (needs to composite against the layer).
                updLayers(currentCutId, c => ({
                    layers: patchLayer(c.layers, drawTargetLayerRef.current, l => {
                        const newStrokes = [...l.strokes];
                        const currentStroke = newStrokes[newStrokes.length - 1];
                        if (currentStroke && currentStroke.tool !== 'paste' && currentStroke.tool !== 'fill') {
                            for (const p of positions) currentStroke.points.push(p);
                        }
                        return { strokes: newStrokes };
                    })
                }));
                break;
            }
        }
    };

    const stopDraw = () => {
        // Committing a whole-layer move: the offset is added to every stroke coordinate.
        if (layerDragRef.current) {
            const d = layerDragRef.current; layerDragRef.current = null;
            endGesture();
            const dx = Math.round(d.dx), dy = Math.round(d.dy);
            clearLiveOverlay();
            if (dx || dy) dispatchCuts(moveLayers(d.cutId, d.layerIds, dx, dy));
            setDragTick(v => v + 1);
            return;
        }
        // Curve ruler: one anchor placed or fine-tuned; the done button commits it.
        if (etool === 'curve' && curveDraggingRef.current) {
            curveDraggingRef.current = false;
            endGesture();
            renderCurvePreview();
            return;
        }
        // Liquify: the pushed pixels go back into the layer.
        if (liquifyRef.current) {
            endGesture();
            endLiquify();
            return;
        }
        // Mosaic: pixelates the dragged rectangle and stamps it down.
        if (mosaicRectRef.current) {
            const r = mosaicRectRef.current; mosaicRectRef.current = null;
            endGesture();
            applyMosaic(r);
            liveClearPendingRef.current = true;
            return;
        }
        // Finish recording a motion path → store it on the target layer's animation.
        if (pathPtsRef.current) {
            const pts = pathPtsRef.current;
            pathPtsRef.current = null;
            endGesture();
            if (cameraCapture) {
                // Evened out the same way a part path is, and for the same reason: the camera
                // walks it by index, so uneven points would replay the drawing speed. A camera
                // doing that is far more obvious than a part doing it, because the whole frame
                // lurches rather than one drawing.
                const path = preparePath(pts);
                if (path.length > 1) dispatchCuts(setCutCamera(cameraCapture.cutId, { path }));
                setCameraCapture(null);
                return;
            }
            if (pathCapture && pts.length > 1) {
                if (pathCapture.mode === 'sway') {
                    // Sway from a drawn curve: the curve is stored as a waveform, and how far it
                    // actually swung becomes the default strength.
                    const w = curveToWave(pts);
                    if (w) updLayerAnim(pathCapture.cutId, pathCapture.layerId, { swayCurve: w.wave, swayAmount: Math.max(1, Math.round(w.amp / 4)) });
                    else alert(tr('거의 직선이라 흔들림을 만들 수 없습니다. 물결치듯 그려보세요.'));
                } else {
                    // Evened out before it is stored, not while it is played. The renderer walks
                    // the path by index, so equal spacing is what makes the motion a constant
                    // speed instead of a replay of how fast the pen was moving at each point.
                    const path = preparePath(pts);
                    if (path.length > 1) updLayerAnim(pathCapture.cutId, pathCapture.layerId, { path });
                }
            }
            setPathCapture(null);
            return;
        }
        // Commit the live overlay stroke into the layer data (one write), then clear the overlay
        // after the layer has repainted so there's no flicker.
        if (liveStrokeRef.current) {
            const st = liveStrokeRef.current; liveStrokeRef.current = null;
            endGesture();
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
        selectionDragRef.current = null;
        const endedTextDrag = endTextDrag();
        if (!isDrawing.current) return;
        endGesture();

        if (endedTextDrag?.clickToEdit && !endedTextDrag.moved) {
            openEditText(endedTextDrag.cutId, endedTextDrag.textId);
            return;
        }

        if (tool === 'lasso' && lassoRef.current) {
            const pts = lassoRef.current; lassoRef.current = null;
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
        const { selection: sel, eraseMask, hasContent } = cutOutPolygon({
            layer: ctx.getImageData(minX, minY, w, h),
            poly, minX, minY, w, h,
            makeImageData: (iw, ih) => new ImageData(iw, ih),
            inside: pointInPolygon,
        });
        if (!hasContent) return;

        setSelection({
            cutId: currentCutId,
            sourceLayerId: activeLayer.id,
            bitmapId: storeBitmap(sel),
            maskBitmapId: storeBitmap(eraseMask),
            x: minX, y: minY, w, h,
            tx: minX, ty: minY, tw: w, th: h,
        });
    };

    const onPointerLeaveCanvas = () => {
        setHoverHandle(null);   // the pointer is gone; the cursor it implied should go too

        // With pointer capture, we still receive move/up events outside the canvas.
        // Avoid auto-stopping lasso/selection transforms just because the pointer left the element.
        if (isDrawing.current && (tool === 'lasso' || selectionDragRef.current)) return;
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
        const ctx = canvas.getContext('2d');
        // Boiling phase, quantised to about ten changes a second like a traditional boiling line.
        // Changing it every frame just reads as noise; this rate is what makes the drawing feel
        // alive.
        boilPhaseRef.current = t * BOIL_FPS + boilTick;
        const primary = currentCut;
        // Everything about *what* this frame is - which cuts, their animation, their layer
        // groups, their texts, the camera - is worked out once, before anything is drawn.
        // The two passes below then read the same answer instead of each recomputing it.
        const scene = evaluateFrame(cuts, t, { playing, currentCutId, cw: CANVAS_W, ch: CANVAS_H });
        const activeCuts = scene.cuts.map(e => e.cut);
        // Never flash white DURING PLAYBACK: if the frame we're about to show isn't decoded yet,
        // HOLD the last painted frame (skip this repaint) and kick a decode. The loop keeps advancing,
        // so it reads as a brief hold instead of a white flash. Paused/editing always paints normally
        // (the prefetch effect repaints once the frame is ready), so a still frame is never stuck.
        if (playing && paintedOnceRef.current) {
            const missing = pendingBitmapIds(activeCuts, bitmapStoreRef.current);
            if (missing.length) { requestFrameDecode(missing); return; }
        }
        // Clear either way - the canvas holds the previous frame otherwise. The difference is
        // whether white is then painted over it, which is what makes an export opaque.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!transparentBg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        paintedOnceRef.current = true;
        // The camera is a window onto the frame, so it wraps everything drawn into it - the video
        // reference, the artwork and the text move together, which is the whole point of it being
        // a camera rather than another per-layer transform. The white fill above stays outside:
        // that is the viewport itself, and zooming it would leave the edges unpainted.
        //
        // Playback only, like cut and part animation. While editing, a moved canvas would put the
        // pen somewhere other than where the drawing appears, which is not a trade worth making
        // for a preview.
        //
        // A shot belongs to the cut on the lowest active track: that is the base scene, and the
        // tracks above it are parts of the same shot rather than shots of their own.
        const camAt = scene.camera;
        if (camAt) { ctx.save(); applyCamera(ctx, camAt, CANVAS_W, CANVAS_H); }
        // Video overlay track: drawn underneath everything. The <video> element is kept at time t by
        // the playback loop (playing) or a paused-seek effect.
        if (videoOverlay && t >= videoOverlay.startTime && t < videoOverlay.endTime) {
            const v = videoElRef.current;
            if (v && v.readyState >= 2) {
                const r = fitRect(videoOverlay.w || v.videoWidth || CANVAS_W, videoOverlay.h || v.videoHeight || CANVAS_H, CANVAS_W, CANVAS_H);
                // Restored rather than left set: everything drawn after this - the artwork, the
                // text - would otherwise inherit the reference layer's fade.
                const prevAlpha = ctx.globalAlpha;
                ctx.globalAlpha = videoOverlay.opacity ?? 1;
                try { ctx.drawImage(v, r.x, r.y, r.w, r.h); } catch { }
                ctx.globalAlpha = prevAlpha;
            }
        }

        // Onion skin: the neighbouring drawings, faint, so a new one can be lined up against
        // them. Paused only - during playback the next frame is about to be shown anyway.
        if (!playing && primary && (onionPrev || onionNext)) {
            const { prev, next } = onionNeighbours(cuts, primary);
            for (const cut of [onionPrev ? prev : null, onionNext ? next : null]) {
                if (!cut) continue;
                const order = flattenLayersInUiOrder(cut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                for (let i = order.length - 1; i >= 0; i--) {
                    const lc = ensureLayerCanvas(cut.id, order[i]);
                    if (lc) { ctx.globalAlpha = ONION_ALPHA; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                }
            }
        }

        scene.cuts.forEach(({ cut: ac, anim, groups }) => {
            ctx.save();
            if (anim) {
                ctx.globalAlpha = anim.alpha;
                applyCutAnim(ctx, anim, CANVAS_W, CANVAS_H);
            }
            // Draw bottom -> top so the topmost layer (UI top) is visually on top.
            for (let i = groups.length - 1; i >= 0; i--) {
                const group = groups[i];
                const l = group.base;
                const layerCanvas = flattenClipGroup(ac.id, group);
                if (!layerCanvas) continue; // frame still decoding (part-scoped memory); will repaint when ready

                // Per-layer ("part") transform nests inside the cut transform. The composition
                // order - and why rotation happens about the pivot rather than the origin - is
                // in canvas/layerComposite, where it is a matrix and can be checked.
                const la = group.anim;
                ctx.save();
                applyPartTransform(ctx, la);

                const shouldMask = selection?.maskBitmapId && selection.cutId === ac.id && selection.sourceLayerId === l.id;
                const maskEntry = shouldMask ? bitmapStoreRef.current.get(selection.maskBitmapId) : null;
                const mb = maskEntry?.imageBitmap;
                const mi = maskEntry?.imageData;

                // A layer being dragged or liquified is drawn by the overlay instead, with the
                // original hidden, which prevents a ghost trailing behind it.
                if (hiddenByGesture(ac.id, l.id)) { ctx.restore(); continue; }
                if (la?.swayProfile && (!shouldMask || (!mb && !mi))) {
                    drawSwayed(ctx, layerCanvas, {
                        profile: la.swayProfile, axis: la.swayAxis, disp: la.swayDisp,
                        cw: CANVAS_W, ch: CANVAS_H,
                    });
                } else if (!shouldMask || (!mb && !mi)) {
                    ctx.drawImage(layerCanvas, 0, 0);
                } else {
                    // imageDataCanvas is a different shared canvas from the mask scratch, so
                    // nesting them is safe - which is why they are separate helpers rather than
                    // two slots of one.
                    drawMaskedLayer(ctx, layerCanvas, mb || imageDataCanvas(mi), selection,
                        scratchCanvas(maskScratchRef, CANVAS_W, CANVAS_H));
                }
                ctx.restore();
            }
            ctx.restore();
        });

        // Text objects live outside paint layers ("text layer").
        scene.cuts.forEach(({ anim, texts }) => {
            ctx.save();
            // The alpha is not set here the way it is for the artwork: a text has its own
            // opacity, so drawTextObject multiplies the two rather than being handed a context
            // that already has one applied.
            applyCutAnim(ctx, anim, CANVAS_W, CANVAS_H);
            for (const { text, anim: ta } of texts) {
                drawTextObject(ctx, text, {
                    anim: ta,
                    box: textNeedsBox(text, ta) ? measureTextBox(text) : null,
                    alpha: anim ? anim.alpha : 1,
                });
            }
            ctx.restore();
        });
        if (camAt) ctx.restore();
    }, [cuts, currentCutId, currentCut, onionPrev, onionNext, selection, layerCanvasCache, frameDecodeTick, videoOverlay, boilTick, dragTick, transparentBg]);

    paintFrameRef.current = paintFrame;

    // Editing render: full frame + editing-only overlays. During playback the rAF loop
    // paints imperatively (see below), so this effect just draws overlays at rest.
    useEffect(() => {
        if (isPlaying) return;              // rAF loop owns the canvas during playback
        paintFrame(currentTime, scrubbing); // scrubbing renders like playback so animation shows
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
                drawMotionPath(ctx, l.anim?.path, !!animLayer && animLayer.cutId === cc.id && animLayer.layerId === l.id);
            }
        }

    }, [paintFrame, cuts, currentCutId, currentCut, isPlaying, scrubbing, currentTime, selection, selectedText, animLayer, view.zoom]);

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
            if (isDrawing.current || panningRef.current) return; // mid-stroke or mid-pan
            if (Date.now() - lastInteractRef.current < 400) return; // yield briefly right after a zoom
            setBoilTick(v => (v + 1) % 100000);
        }, Math.round(1000 / BOIL_FPS));
        return () => clearInterval(id);
        // The two refs come from useCanvasView and never change identity; listed so the linter
        // can see them rather than left out of a list it cannot check.
    }, [isPlaying, cuts, currentCutId, currentCut, panningRef, lastInteractRef]);

    // The live overlay is cleared once the layer cache has updated, not on a timer, so the
    // committed stroke is already on the main canvas before the overlay goes. That makes it
    // independent of how fast the machine is - the line cannot vanish in between.
    useEffect(() => {
        if (liveClearPendingRef.current && !isDrawing.current && !liveStrokeRef.current) {
            liveClearPendingRef.current = false;
            clearLiveOverlay();
        }
    }, [layerCanvasCache]);

    // Every way the timeline can be pointed at - scrub, marquee, middle-click pan, one-finger
    // pan/tap, two-finger pinch - lives in useTimelineGestures, where the overlaps between them
    // are visible.
    const {
        seekToTime, seekToClientX, goToScene,
        startTimelinePan, startTimelineScrub,
        onTimelinePointerDown, zoomTimelineAt,
    } = useTimelineGestures({
        timelineRef, timelineMounted: showBottom,
        cuts, currentCutId, setCurrentCutId, maxTime,
        pps, setPps,
        setCurrentTime, currentTimeRef, isPlayingRef, seekRef,
        audioRef, audioUrl, audioData,
        setScrubbing, setMarquee, selectedCutIds, setSelectedCutIds,
        videoOverlay,
    });

    // Lay a whole video under the drawing layers (overlay/rotoscope use). No frame cuts.
    const loadVideoOverlay = (blob, name, startAt = 0, offset = 0, clipDur = null) => {
        videoBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        const v = videoElRef.current || document.createElement('video');
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
        const blob = videoBlobRef.current; if (!blob) return;
        const cs = cutStart != null ? cutStart : (videoOverlay?.startTime ?? 0);
        const co = cutOffset != null ? cutOffset : (videoOverlay?.offset ?? 0);
        const rStart = rangeOn ? parseClock(startText) : 0;
        const rEndRaw = rangeOn ? parseClock(endText) : 0;
        const rEnd = rangeOn && rEndRaw > rStart ? rEndRaw : null;
        // detectSceneCuts polls shouldStop between frames, so cancelling takes effect within one
        // seek rather than running the scan to the end and throwing the answer away.
        sceneStopRef.current = false;
        const startedFor = docEpochRef.current;
        setSceneDetect({ done: 0, total: 0 });
        detectSceneCuts(blob, {
            start: rStart, end: rEnd, threshold,
            onProgress: (d, t) => setSceneDetect({ done: d, total: t }),
            shouldStop: () => sceneStopRef.current,
        })
            // A cancelled scan returns what it found so far; keeping a partial set of markers
            // would look like a finished detection that missed most of the cuts.
            // Same reasoning as the frame import: a scan of a long video outlives a project
            // switch, and its markers describe a video that is no longer loaded.
            .then(cuts => { if (!sceneStopRef.current && docEpochRef.current === startedFor) dispatchMedia(setVideoCuts(cuts, cs, co)); })
            .catch(() => { })
            .finally(() => { setSceneDetect(null); sceneStopRef.current = false; });
    };
    const removeVideoOverlay = () => {
        dispatchMedia(clearVideo()); videoBlobRef.current = null; setSceneCfg(null);
        detachMedia(videoElRef.current);
    };
    // Remember fetched/opened videos so they can be re-imported with different settings
    // without downloading again (session only — keeps at most 3 to bound memory).
    // Recents keep only the source key/link, never the video data — the downloaded file is
    // dropped right after extraction, so re-importing the same link re-downloads it.
    const openVideoImport = (file, name, src) => {
        // A new import must always raise the settings dialog. That dialog only shows while
        // videoImport && !videoBusyBg, so if an earlier extraction was sent to the background and
        // then failed to finish cleanly, the flag stays true and no later import ever opens the
        // dialog again. Clearing it here at the start prevents that.
        setVideoBusyBg(false);
        const label = (name || file.name).replace(/\.[^.]+$/, '').slice(0, 24);
        const srcKey = src?.key || `f:${file.name}:${file.size}`;
        setRecentVideos(p => [{ id: 'rv_' + nextId().toString(36), name: label, srcKey, url: src?.url || null },
        ...p.filter(v => v.srcKey !== srcKey)].slice(0, 3));
        setVideoImport({ file, srcKey, label, fps: 4, maxFrames: 60, scale: 0.5, whole: true, withAudio: false, dedupe: 'exact', quality: 'compressed', rangeOn: false, startText: '0:00', endText: '', parts: 1, canvasMode: 'source', srcW: 0, srcH: 0 });
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
                setVideoImport(vi => (vi && vi.file === file) ? { ...vi, durationSec: dur, parts, srcW: sw, srcH: sh } : vi);
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
        setSelectedCutIds(new Set());
        setTimeout(gcBitmaps, 0); // free the frame bitmaps right away
    };

    // Select a part: scope playback to it and jump the playhead to its start.
    const selectPart = (partId) => {
        setActivePartId(partId);
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
        if (!selectedCutIds.size) { alert(tr('먼저 컷을 선택하세요 (타임라인에서 드래그 또는 Ctrl+클릭).')); return; }
        const name = window.prompt(tr('새 파트 이름:'), tr('파트 {0}', parts.length + 1));
        if (name == null) return;
        const pid = 'part_' + nextId().toString(36);
        dispatchCuts(assignPartTo(selectedCutIds, pid, name));
        setActivePartId(pid);
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
        if (activePartId === partId) setActivePartId(null);
    };

    // Local-only: pull a video by URL through the API, then reuse the frame-import dialog.
    const loadYoutubeVideo = async (presetUrl) => {
        const url = typeof presetUrl === 'string' ? presetUrl : null;
        if (!url) { setLinkPrompt({ kind: 'video' }); return; } // raise the input dialog and stop here
        setVideoBusy({ done: 0, total: 0, fetching: true });
        try {
            const res = await fetch('/api/youtube-video?url=' + encodeURIComponent(url) + '&maxHeight=1080');
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
            const blob = await res.blob();
            const file = new File([blob], 'youtube.mp4', { type: blob.type || 'video/mp4' });
            openVideoImport(file, 'YT ' + (url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/)?.[1] || tr('영상')), { url, key: 'yt:' + url });
        } catch (e) {
            console.error('[import]', e);
            setAppError(tr('영상 가져오기 실패: ') + e.message);
        } finally { setVideoBusy(null); }
    };

    // Import a video as one cut per extracted frame (sequential on the current track).
    const runVideoImport = async () => {
        const cfg = videoImport;
        if (!cfg?.file) return;
        const startedFor = docEpochRef.current;
        setVideoBusy({ done: 0, total: 0 });
        try {
            const tgt = targetCanvasFor(cfg, CANVAS_W, CANVAS_H);
            const TW = tgt.w, TH = tgt.h;
            if (TW !== CANVAS_W || TH !== CANVAS_H) setCanvasSize({ w: TW, h: TH });
            // The dialog's settings become the extractor's numbers in core/videoCuts, where the
            // quality tiers are a table.
            const { opts, nativeRes: isNative } = extractOptionsFor(cfg, tgt, parseClock);
            const { frames, holds = [], skipped = 0, fps, width: fW, height: fH } = await extractVideoFrames(cfg.file, {
                ...opts,
                onProgress: (done, total, skipped) => setVideoBusy({ done, total, skipped }),
                shouldStop: () => videoStopRef.current,
            });
            if (!frames.length) { alert(tr('추출된 프레임이 없습니다.')); return; }
            // Extraction can take minutes and can be left running in the background, so the
            // project may have been swapped underneath it. Dropping the frames is the only safe
            // answer: putting them in the project that happens to be open now would be writing
            // into a document the user never asked to change.
            if (docEpochRef.current !== startedFor) {
                setAppError(tr('다른 프로젝트를 여는 동안 영상 프레임 추출이 끝나 결과를 버렸습니다. 프로젝트를 연 뒤 다시 가져오세요.'));
                return;
            }
            // Re-importing the same source replaces its old frames instead of piling up duplicates.
            const srcKey = cfg.srcKey;
            const { track, startAt } = importPlacement(cuts, srcKey, currentCutId);
            // The batch key comes from an id rather than the clock so that importing twice in
            // quick succession cannot produce two batches with the same name.
            const batch = 'vb_' + nextId().toString(36);
            const label = cfg.label || cfg.file.name.replace(/\.[^.]+$/, '').slice(0, 24);
            // Native-res frames keep the source aspect, so letterbox-fit them into the canvas;
            // compressed frames are already pre-letterboxed to the canvas (full-canvas paste).
            const fit = (isNative && fW && fH) ? fitRect(fW, fH, TW, TH) : { x: 0, y: 0, w: TW, h: TH };
            const rect = { x: Math.round(fit.x), y: Math.round(fit.y), w: Math.round(fit.w), h: Math.round(fit.h) };
            // Storing the blobs is the only part of this that has to happen here: everything after
            // it - where the cuts go, how long each lasts, which part it belongs to - is arithmetic,
            // and lives in core/videoCuts.js where it can be tested.
            const bitmapIds = [];
            for (let i = 0; i < frames.length; i++) bitmapIds.push(await storeBitmapBlob(frames[i], fW, fH));
            const made = buildImportedCuts({
                bitmapIds, holds, fps, track, startAt, batch, label, srcKey, parts: cfg.parts, rect, nextId,
            });
            dispatchCuts(replaceBatchCuts(srcKey, made));
            setCurrentCutId(made[0].id);
            setCurrentTime(made[0].startTime);
            // Audio (if asked) is the only thing that keeps the video bytes alive past this point.
            // Aligned to the first imported frame; when only a range was imported, the audio is
            // clipped to that same range (offset rStart, duration rEnd-rStart).
            if (cfg.withAudio) loadAudioUrl(URL.createObjectURL(cfg.file), label + tr(' (영상 음원)'), made[0].startTime, opts.start, opts.end == null ? null : opts.end - opts.start);
            setVideoImport(null);
            setTimeout(gcBitmaps, 0); // replaced frames' bitmaps go too
        } catch (e) {
            console.error('[import]', e);
            setAppError(tr('영상 가져오기 실패: ') + e.message);
        } finally {
            videoStopRef.current = false;
            setVideoBusy(null);
            setVideoBusyBg(false);
        }
    };
    // Transparency cannot survive the recorder. Chrome hands VP9 to the hardware encoder above
    // roughly 480p, and that encoder has no alpha channel - measured here, the background came back
    // solid black at 1920x1080 while the same code kept it transparent at 640x360. WebCodecs is no
    // way out either: VideoEncoder reports alpha 'keep' unsupported for vp8 and vp9 alike.
    //
    // So a transparent project exports as a PNG sequence, which is what an editor wants for an
    // overlay anyway. Drawing each frame deliberately rather than recording one in real time also
    // means no dropped or duplicated frames, and it waits for pasted bitmaps to decode instead of
    // holding the previous frame the way playback does.
    /**
     * Put one painted canvas into the file being written.
     *
     * The two formats want opposite things from the same canvas: a GIF wants raw pixels, scaled
     * down, because a full-size GIF is tens of megabytes a second and going through a PNG and
     * back would cost an encode and a decode a frame for nothing. A PNG sequence wants the file
     * itself, full size, because it is going into an editor.
     *
     * @param {GifWriter|ZipWriter} writer
     * @param {HTMLCanvasElement} src the canvas as just painted
     * @param {number} i frame number across the whole export, so a queue keeps counting
     */
    const captureFrame = async (writer, src, i, { gif, gw, gh, scratch, total }) => {
        // Scaled whenever the canvas is not already the output size. That is the same condition
        // as "the GIF was scaled down" for a single project, and it is also what makes a queue of
        // pieces work: each piece has its own canvas size, and a file has one.
        const needsFit = src.width !== gw || src.height !== gh;
        let from = src;
        if (needsFit) {
            const { canvas: fitted, ctx: fctx } = scratchCanvas(scratch, gw, gh);
            fctx.imageSmoothingQuality = 'high';
            fctx.drawImage(src, 0, 0, gw, gh);
            from = fitted;
        }
        if (gif) {
            // Straight off the canvas as pixels: going through a PNG and back would cost an
            // encode and a decode a frame for nothing.
            /** @type {GifWriter} */(writer).addFrame(from.getContext('2d').getImageData(0, 0, gw, gh).data);
            return;
        }
        const blob = await new Promise(res => from.toBlob(res, 'image/png'));
        if (!blob) throw new Error('toBlob returned nothing');
        /** @type {ZipWriter} */(writer).add(frameName(i, total), new Uint8Array(await blob.arrayBuffer()));
    };

    /**
     * Paint a range and hand each finished frame to `capture`.
     *
     * Split out from the export below because the multi-piece export (#123) runs it once per
     * piece into one shared writer. Nothing here knows what is being written, which is what lets
     * a second piece carry on into the same file.
     *
     * Frames are painted with the app's own paint path rather than a second renderer built for
     * exporting. A parallel renderer is a thing that agrees with the real one until it quietly
     * does not, and the first anyone hears of it is an export that looks wrong.
     */
    const renderFrameRange = async ({ from, to, fps, capture, onProgress, indexBase = 0 }) => {
        const canvas = canvasRef.current; if (!canvas) return 0;
        const count = Math.max(1, Math.round((to - from) * fps));
        for (let i = 0; i < count; i++) {
            const t = from + i / fps;
            // Read per frame, not once: between pieces the whole document changes underneath this.
            const live = renderStateRef.current;
            // Wait for what this frame needs rather than painting without it.
            const scene = evaluateFrame(live.cuts, t, { playing: true, currentCutId: live.currentCutId, cw: live.cw, ch: live.ch });
            const missing = pendingBitmapIds(scene.cuts.map(e => e.cut), bitmapStoreRef.current);
            if (missing.length) {
                const store = bitmapStoreRef.current;
                for (const id of missing) {
                    const e = store.get(id); if (!e || !e.blob) continue;
                    try { e.imageBitmap = await decodeFrameBitmap(e); } catch { }
                }
                invalidateCutsUsing(missing);
            }
            paintFrameRef.current?.(t, true);
            await capture(canvas, indexBase + i);
            // Yield often enough that the progress bar moves and the tab stays answerable.
            if (i % 5 === 0 || i === count - 1) {
                onProgress?.(indexBase + i + 1);
                await new Promise(res => setTimeout(res, 0));
            }
        }
        return count;
    };

    /**
     * Ask for files, and resolve with what was chosen - or nothing, if the dialog was dismissed.
     *
     * A plain input rather than showOpenFilePicker: this needs several files at once, and it has
     * to work on the tablet, where the picker API is not there. `cancel` fires on browsers that
     * have it; where it does not, the promise settles when the dialog is used, and a dismissed
     * dialog simply leaves it pending until the page goes - which costs nothing, since nothing is
     * held open waiting for it.
     *
     * @param {string} accept
     * @param {boolean} [multiple]
     * @returns {Promise<File[]>}
     */
    const pickFiles = (accept, multiple = false) => new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.multiple = multiple;
        inp.onchange = () => resolve([...(inp.files || [])]);
        inp.oncancel = () => resolve([]);
        inp.click();
    });

    /**
     * Export several separately-made projects as one file (#123).
     *
     * Past a certain number of cuts the app lags, so the advice is to work in pieces - which is
     * only worth saying if combining them is easy. This is the combining.
     *
     * The design in one line: **a piece is a temporary tab.** Opening a document, painting it and
     * putting it back is what tab switching already does, and it does it with buildData and
     * restore, both of which are here. So the queue snapshots what is open, opens each piece in
     * turn, paints its frames straight into one writer, and puts the original document back at
     * the end.
     *
     * That gets two things for free. Peak memory stays at one piece, which is the whole reason
     * for splitting. And the frames come out of the app's own paint path, so there is no second
     * renderer to drift from the first - which is what a headless exporter would have been.
     *
     * The output is the size of the document that is open now. It needs no lookahead, and it is a
     * number the user can see before they start; a piece of another size is fitted to it.
     */
    const handleExportPieces = async () => {
        const canvas = canvasRef.current; if (!canvas) return;
        const files = await pickFiles('.emv', true);
        if (!files.length) return;

        // Planned once, from the document that is open: a file has one frame size and each
        // piece has its own canvas. Planning per piece would give a 16:9 piece the same answer
        // and a square one a different one, which is a file no decoder opens.
        const { gif, fps, gw, gh, delayMs } = frameExportPlan({ format: transparentFormat, cw: CANVAS_W, ch: CANVAS_H });
        const scratch = { current: null };
        // Frame names are padded to a fixed width rather than to the real total, because the total
        // is not known until every piece has been opened - and opening them twice, once to measure
        // and once to draw, is the cost this whole feature exists to avoid. Five digits sorts
        // correctly up to a hundred thousand frames, which is an hour at thirty a second.
        const NAME_WIDTH = 99999;

        let snapshot = null;
        try {
            snapshot = await buildData(true, null, true);
        } catch (e) {
            setAppError(tr('현재 작업을 저장할 수 없어 내보내기를 시작하지 않았습니다: ') + (e?.message || String(e)));
            return;
        }

        const label = tr('조각 내보내는 중');
        isExporting.current = true;
        videoStopRef.current = false;
        const writer = gif ? new GifWriter({ width: gw, height: gh, delayMs }) : new ZipWriter();
        let written = 0;
        let opened = 0;
        try {
            for (let p = 0; p < files.length; p++) {
                setLoadProgress({ label: `${label} (${p + 1}/${files.length})`, done: written, total: 0 });
                const text = await files[p].text();
                let doc;
                try { doc = JSON.parse(text); }
                catch { throw new Error(tr('{0}: 읽을 수 없는 파일입니다', files[p].name)); }
                if (!await restore(doc)) throw new Error(tr('{0}: 열 수 없습니다', files[p].name));
                opened++;
                // restore dispatches; the refs the renderer reads are written during the render
                // that follows. Yielding a macrotask lets that render happen, so the first frame
                // of this piece is this piece.
                await new Promise(res => setTimeout(res, 0));
                // The range comes from the document rather than from playStart, which is state and
                // is still the previous piece's until React re-renders.
                const { start, end } = pieceRange({ cuts: doc.cuts, audio: doc.audio, video: doc.video });
                if (end <= start) continue;   // an empty piece contributes nothing, and no gap
                written += await renderFrameRange({
                    from: start, to: end, fps, indexBase: written,
                    capture: (src, i) => captureFrame(writer, src, i, { gif, gw, gh, scratch, total: NAME_WIDTH }),
                    onProgress: (done) => setLoadProgress({ label: `${label} (${p + 1}/${files.length})`, done, total: 0 }),
                });
            }
            if (!written) throw new Error(tr('내보낼 콘텐츠가 없습니다.'));
            const bytes = gif ? /** @type {GifWriter} */(writer).finish() : /** @type {ZipWriter} */(writer).finish();
            const { type, name } = exportFileInfo(gif, { gif: 'mv_pieces', zip: 'mv_pieces' });
            downloadBlob(new Blob([bytes], { type }), name);
            alert(tr('완료!'));
        } catch (e) {
            setAppError(tr('내보내기 실패: ') + (e && e.message ? e.message : String(e)));
        } finally {
            isExporting.current = false;
            // Put back what was open. Only if a piece actually replaced it - restoring a snapshot
            // over the document it was taken from is work for nothing, and it would also throw
            // away an undo history the user still has.
            if (opened) {
                try { await restore(snapshot, null, tr('작업 내용 복구 중')); }
                catch (e) { setAppError(tr('내보내기는 끝났지만 원래 작업을 되돌리지 못했습니다: ') + (e?.message || String(e))); }
            }
            setLoadProgress(null);
            paintFrame(currentTimeRef.current, false);
        }
    };

    const handleExportFrames = async () => {
        const canvas = canvasRef.current; if (!canvas) return;
        // The range playback uses, so what you watch is what comes out: it starts where the
        // content starts rather than at zero, and it follows the selected part the way playback
        // and the dimming already do. Exporting from zero meant a project whose first cut sits at
        // three seconds began with three seconds of nothing.
        const from = playStart, to = playEnd;
        // The rates, the scale and the frame count are all in core/frameExport, with the
        // reasoning behind each. The queue above plans through the same function.
        const { gif, fps, gw, gh, delayMs, total, empty } = frameExportPlan({ format: transparentFormat, cw: CANVAS_W, ch: CANVAS_H, from, to });
        if (empty) { alert(tr('내보낼 콘텐츠가 없습니다.')); return; }
        // One scratch canvas for the whole export rather than one a frame.
        const gifScratch = { current: null };
        if (total > LONG_EXPORT_FRAMES && !confirm(tr('{0}프레임을 내보냅니다. 오래 걸립니다. 계속할까요?').replace('{0}', String(total)))) return;

        const label = tr('프레임 내보내는 중');
        setLoadProgress({ label, done: 0, total });
        isExporting.current = true;
        const writer = gif ? new GifWriter({ width: gw, height: gh, delayMs }) : new ZipWriter();
        try {
            await renderFrameRange({
                from, to, fps,
                capture: (src, i) => captureFrame(writer, src, i, { gif, gw, gh, scratch: gifScratch, total }),
                onProgress: (done) => setLoadProgress({ label, done, total }),
            });
            const bytes = gif ? /** @type {GifWriter} */(writer).finish() : /** @type {ZipWriter} */(writer).finish();
            const { type, name } = exportFileInfo(gif);
            downloadBlob(new Blob([bytes], { type }), name);
            alert(tr('완료!'));
        } catch (e) {
            alert(tr('내보내기 실패: ') + (e && e.message ? e.message : String(e)));
        } finally {
            isExporting.current = false;
            setLoadProgress(null);
            paintFrame(currentTimeRef.current, false);
        }
    };

    const handleExport = () => {
        if (transparentBg) { handleExportFrames(); return; }
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (typeof canvas.captureStream !== 'function' || typeof window.MediaRecorder === 'undefined') {
            alert(tr('이 환경에서는 내보내기를 지원하지 않습니다.\nPC 브라우저(Chrome 등)에서 실행해 주세요.')); return;
        }
        // Same range as the frame export and as playback. This used to be its own third answer
        // to "where does the content end" - cuts and audio, but not the reference video, which is
        // on the canvas being recorded.
        if (playEnd <= playStart) { alert(tr('내보낼 콘텐츠가 없습니다.')); return; }
        const { mimeType, ext } = pickRecordingType(t => MediaRecorder.isTypeSupported(t));
        alert(tr('녹화가 시작됩니다.')); setCurrentTime(playStart); if (audioRef.current) audioRef.current.currentTime = audioData ? Math.max(0, (playStart - audioData.startTime) + audioData.offset) : playStart;
        // Frames on request rather than sampled at 30Hz off a 60Hz paint loop - that sampling
        // put two paints in one frame and three in the next, which is the judder in #156. The
        // loop paints on the frame grid and asks for each frame itself (usePlayback).
        const { stream, requestFrame } = frameSource(canvas, EXPORT_FPS);
        requestFrameRef.current = requestFrame;
        exportStartRef.current = playStart;
        const tracks = [...stream.getVideoTracks()];
        if (audioRef.current && audioUrl && !audioSourceRef.current) { try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)(); audioDestRef.current = audioCtxRef.current.createMediaStreamDestination(); audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current); audioSourceRef.current.connect(audioDestRef.current); audioSourceRef.current.connect(audioCtxRef.current.destination); } catch (e) { } }
        if (audioDestRef.current) tracks.push(...audioDestRef.current.stream.getAudioTracks());
        let mr;
        try {
            mr = startRecorder(tracks, mimeType, (blob) => {
                downloadBlob(blob, `mv_export.${ext}`);
                alert(tr('완료!'));
                isExporting.current = false; requestFrameRef.current = null;
            });
        } catch (e) { alert(tr('녹화를 시작할 수 없습니다: ') + e.message); return; }
        exportEndRef.current = playEnd; isExporting.current = true; mediaRecorderRef.current = mr; setIsPlaying(true);
    };


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

    const panelOpen = { color: leftDock === 'color', tools: showLeft, cut: showRight };

    // A docked panel keeps a splitter on the side that faces the canvas.
    const panelSplitter = (id, side) => (
        <div key={id + '-sp'} className="splitter-v" style={{ touchAction: 'none' }}
            title={tr('드래그로 패널 너비 조절')}
            onPointerDown={e => {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
                startPanelResize(id, side, e.clientX);
            }} />
    );

    // The tool panel body lives in a variable so the same markup can be mounted in the left
    // dock, the right dock, or a floating window without being duplicated.
    const toolsPanelEl = (
        <ToolsPanel
            width={toolW} onClose={() => setShowLeft(false)}
            TOOL_TYPES={TOOL_TYPES} tool={tool} handleSetTool={handleSetTool}
            onionPrev={onionPrev} setOnionPrev={setOnionPrev} onionNext={onionNext} setOnionNext={setOnionNext}
            globalUndo={globalUndo} globalRedo={globalRedo} handleClearCut={handleClearCut} doTween={doTween}
            hasLassoClip={hasLassoClip} pasteLassoSelection={pasteLassoSelection}
            pickingColor={pickingColor} pickColor={pickColor} isSelectionTool={isSelectionTool}
            color={color} applyColor={applyColor} opacity={opacity} setOpacity={setOpacity}
            softMode={softMode} setSoftMode={setSoftMode}
            rulerMode={rulerMode} setRulerMode={setRulerMode}
            mosaicBlock={mosaicBlock} setMosaicBlock={setMosaicBlock}
            toolSize={toolSize} setToolSize={setToolSize}
            pressureOn={pressureOn} setPressureOn={setPressureOn} />
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
                    collapsedCutIds={collapsedCutIds} copiedCut={copiedCut} currentCutId={currentCutId} cuts={cuts}
                    deleteTextObject={deleteTextObject} deleteVideoBatch={deleteVideoBatch}
                    onListDrop={onListDrop} expandedCuts={expandedCuts} handleAddCut={handleAddCut}
                    handleAddFolder={handleAddFolder} handleAddLayer={handleAddLayer} handleCopyCut={handleCopyCut}
                    handleCutClick={handleCutClick} handleDeleteCut={handleDeleteCut}
                    handleDuplicateCut={handleDuplicateCut} handlePasteCut={handlePasteCut}
                    handleSetTool={handleSetTool} openEditText={openEditText} renameCut={renameCut}
                    renamingCutId={renamingCutId} layerRows={layerRows} rightW={rightW}
                    selectedCutIds={selectedCutIds} selectedText={selectedText}
                    setRenamingCutId={setRenamingCutId} setSelectedText={setSelectedText}
                    setShowRight={setShowRight} showRight={showRight} toggleCutCollapse={toggleCutCollapse}
                    toggleCutSettings={toggleCutSettings} toggleTextVisible={toggleTextVisible}
                    updCutAnim={updCutAnim} updCutTime={updCutTime}
                    updCutCamera={updCutCamera} cameraCapture={cameraCapture} setCameraCapture={setCameraCapture}
                    canvasW={CANVAS_W} canvasH={CANVAS_H}
                    rightTab={rightTab} setRightTab={setRightTab} textEditorBody={textEditorBody} cancelText={cancelText}
                    videoBatches={videoBatches} />
    );


    const panelEls = { color: colorPanelEl, tools: toolsPanelEl, cut: cutPanelEl };

    // Panels docked to one side, each with its splitter facing the canvas.
    const dockSlot = (side) => PANEL_IDS.filter(id => docks[id] === side && panelOpen[id]).map(id => (
        <React.Fragment key={id}>
            {side === 'right' && panelSplitter(id, side)}
            {panelEls[id]}
            {side === 'left' && panelSplitter(id, side)}
        </React.Fragment>
    ));

    // Panels pulled out of the docks, drawn above everything and positioned by their own state.
    const floatingPanels = PANEL_IDS.filter(id => docks[id] === 'float' && panelOpen[id]).map(id => {
        // A window being dragged follows the pointer live; the stored position only updates on drop.
        const live = panelDrag?.id === id;
        const x = live ? panelDrag.x - panelDrag.dx : (floatPos[id]?.x ?? 120);
        const y = live ? panelDrag.y - panelDrag.dy : (floatPos[id]?.y ?? 120);
        return (
            // These sit outside main-content, so they need the header-drag handler of their own.
            <div key={id} className="float-panel" onPointerDown={onDockPointerDown}
                style={{ left: Math.max(0, x), top: Math.max(0, y), opacity: live ? 0.85 : 1 }}>
                {panelEls[id]}
            </div>
        );
    });

    return (
        <div className="app-container">
            <audio ref={audioRef} style={{ display: 'none' }} />
            <video ref={videoElRef} muted playsInline style={{ display: 'none' }} />
            <ProgressOverlay progress={loadProgress} />
            {showSettings && (
                <SettingsModal
                    tab={settingsTab} setTab={setSettingsTab}
                    onClose={() => { setShowSettings(false); setRebinding(null); }}
                    themeColor={themeColor} setThemeColor={setThemeColor} themeRecent={themeRecent} defaultTheme={DEFAULT_THEME}
                    uiSat={uiSat} setUiSat={setUiSat}
                    keymap={keymap} setKeymap={setKeymap} defaultKeys={DEFAULT_KEYS} keyLabels={KEY_LABELS} conflicts={findConflicts(keymap)}
                    videoOpacity={videoOverlay ? (videoOverlay.opacity ?? 1) : null} setVideoOpacity={v => dispatchMedia(setVideoOpacity(v))}
                    setShowToolKeys={setShowToolKeys}
                    lang={lang} changeLang={changeLang}
                    playbackRate={playbackRate} setPlaybackRate={setPlaybackRate} playbackRates={PLAYBACK_RATES}
                    bakeInfo={bakeInfo} bakePlaybackSpeed={bakePlaybackSpeed}
                    rebinding={rebinding} setRebinding={setRebinding} />
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
            {/* Fetching a video and the automatic backup both take a while, so neither blocks
                the screen. They used to raise a full-screen overlay that stopped all work. */}
            {(videoBusy?.fetching || backupProg || toast) && (
                <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1500, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    {videoBusy?.fetching && (
                        <div className="bg-chip">
                            <span className="bg-spin" /> {tr('영상 받는 중…')} <span style={{ color: '#888' }}>{tr('(작업 계속 가능)')}</span>
                        </div>
                    )}
                    {backupProg && (
                        <div className="bg-chip">
                            <span className="bg-spin" /> {tr('서버 백업')} {backupProg.done}/{backupProg.total}
                        </div>
                    )}
                    {toast && (
                        <div className="bg-chip" style={{ borderColor: 'var(--accent-hi)' }}>
                            {toast}
                            <button className="icon-btn" style={{ marginLeft: 4 }} onClick={() => setToast(null)}>✕</button>
                        </div>
                    )}
                </div>
            )}
            {videoBusy && videoBusyBg && !videoBusy.fetching && (
                <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1000, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', color: '#ccc', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}>
                    <span>{tr('프레임 추출')} {videoBusy.done}/{videoBusy.total || '?'}</span>
                    <div style={{ width: 80, height: 6, background: 'hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${videoBusy.total ? (videoBusy.done / videoBusy.total * 100) : 0}%`, background: 'var(--accent-soft)' }} /></div>
                    <button className="button" style={{ height: 26, padding: '0 8px' }} onClick={() => setVideoBusyBg(false)}>{tr('열기')}</button>
                    <button className="button" style={{ height: 26, padding: '0 8px' }} onClick={() => { videoStopRef.current = true; }}>{tr('중지')}</button>
                </div>
            )}
            {/* Failure banner: keeps the error on screen. With the API server down, a blocked
                alert used to make it look as though nothing had happened at all. */}
            {appError && (
                <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 3000,
                    maxWidth: 640, background: '#3a1414', border: '1px solid #a33', color: '#ffd9d9',
                    borderRadius: 8, padding: '10px 14px', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center',
                    boxShadow: '0 8px 28px rgba(0,0,0,.5)' }}>
                    <span style={{ flex: 1 }}>{appError}</span>
                    <button className="button" style={{ height: 26, padding: '0 10px' }} onClick={() => setAppError(null)}>{tr('닫기')}</button>
                </div>
            )}
            {linkPrompt && (
                <LinkPromptModal
                    title={linkPrompt.kind === 'audio' ? tr('유튜브 음원 가져오기') : tr('유튜브 영상 프레임 가져오기')}
                    placeholder="https://www.youtube.com/watch?v=..."
                    onClose={() => setLinkPrompt(null)}
                    onSubmit={(url) => {
                        const kind = linkPrompt.kind;
                        setLinkPrompt(null);
                        if (kind === 'audio') loadYoutubeAudio(url); else loadYoutubeVideo(url);
                    }} />
            )}
            {videoImport && !(videoBusyBg && videoBusy) && (
                <VideoImportModal
                    videoImport={videoImport} setVideoImport={setVideoImport}
                    videoBusy={videoBusy} setVideoBusyBg={setVideoBusyBg} videoStopRef={videoStopRef}
                    runVideoImport={runVideoImport}
                    loadVideoOverlay={loadVideoOverlay} loadAudioUrl={loadAudioUrl} parseClock={parseClock}
                    setShowHelp={setShowHelp} canvasW={CANVAS_W} canvasH={CANVAS_H} setCanvasSize={setCanvasSize} />
            )}
            {sceneCfg && videoOverlay && (
                <SceneDetectModal sceneCfg={sceneCfg} setSceneCfg={setSceneCfg}
                    sceneDetect={sceneDetect} runSceneDetect={runSceneDetect}
                    autoSceneDetect={autoSceneDetect} setAutoSceneDetect={setAutoSceneDetect}
                    videoOpacity={videoOverlay.opacity ?? 1} setVideoOpacity={v => dispatchMedia(setVideoOpacity(v))}
                    cancelSceneDetect={() => { sceneStopRef.current = true; }}
                    hasCuts={!!videoOverlay.cuts?.length} clearVideoCuts={() => dispatchMedia(clearVideoCuts())} />
            )}
            {showToolKeys && (
                <ToolKeysModal keymap={keymap} setKeymap={setKeymap} defaultKeys={DEFAULT_KEYS} keyLabels={KEY_LABELS}
                    conflicts={findConflicts(keymap)} rebinding={rebinding} setRebinding={setRebinding}
                    onClose={() => { setShowToolKeys(false); setRebinding(null); }} />
            )}
            {showHelp && <HelpModal keymap={keymap} onClose={() => setShowHelp(false)} />}
            <TopBar
                doNew={doNew} doSave={doSave} doOpen={doOpen} doLocalSave={doLocalSave}
                openLocalList={openLocalList} doServerSave={doServerSave} openServerList={openServerList}
                doServerBackup={doServerBackup} openBackupList={openBackupList} backupBusy={backupBusy}
                handleAudioUpload={handleAudioUpload} loadYoutubeAudio={loadYoutubeAudio}
                handleDeleteAudio={handleDeleteAudio} audioFile={audioFile} openVideoImport={openVideoImport}
                loadYoutubeVideo={loadYoutubeVideo} videoFileRef={videoFileRef} recentVideos={recentVideos}
                reimportRecent={reimportRecent} serverAvailable={serverAvailable} setToast={setToast}
                canvasW={CANVAS_W} canvasH={CANVAS_H}
                setCanvasSize={setCanvasSize} setShowHelp={setShowHelp} setShowSettings={setShowSettings}
                keymap={keymap} view={view} zoomCanvas={zoomCanvas} resetView={resetView} autoSavedAt={autoSavedAt}
                autosaveErr={autosaveErr} backupAt={backupAt} storageInfo={storageInfo} handleExport={handleExport}
                doSplitSave={doSplitSave} handleExportPieces={handleExportPieces} />
            {/* Project (document) tab bar, below the File and Media menus. The mode bar - selection,
                curve, camera path, motion path - floats over this row as a pill, centred: the
                row is always there, so nothing shifts when a mode comes and goes, and it is off
                the canvas, where a floating bar covered the zoom control. */}
            <div className="doc-tabs-wrap">
            <div className="doc-tabs" style={{ display: 'flex', alignItems: 'stretch', gap: 2, background: 'hsl(var(--ui-h) var(--ui-s) 11%)', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', padding: '3px 6px 0', overflowX: 'auto', flexShrink: 0 }}>
                {tabs.map(t => (
                    <div key={t.id} onClick={() => switchTab(t.id)}
                        onDoubleClick={() => { const n = window.prompt(tr('탭 이름'), t.name); if (n != null) renameTab(t.id, n); }}
                        title={tr('클릭: 전환 · 더블클릭: 이름변경')}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: '6px 6px 0 0', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', maxWidth: 180, background: t.id === activeTabId ? 'hsl(var(--ui-h) var(--ui-s) 15%)' : 'transparent', color: t.id === activeTabId ? '#fff' : '#9a9ab0', borderBottom: t.id === activeTabId ? '2px solid var(--accent-soft)' : '2px solid transparent' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                        <span onClick={e => { e.stopPropagation(); closeTab(t.id); }} title={tr('탭 닫기')} style={{ opacity: 0.6, fontSize: 13, lineHeight: 1 }}>✕</span>
                    </div>
                ))}
                <button className="icon-btn" onClick={newTab} title={tr('새 탭(프로젝트)')} style={{ alignSelf: 'center', marginLeft: 2 }}><Plus size={14} /></button>
            </div>
            {(selection || cameraCapture || pathCapture || etool === 'curve') && (
                <div className="mode-bar">
                    {selection && (
                        <div className="mode-group">
                            <span className="mode-label">{tr('선택 영역')}</span>
                            {/* Rotation in degrees, skew and bend in -100..100%. Sliders rather than
                                number fields: the value means nothing in itself and the eye is on
                                the canvas. Rotation is stored in radians, as layer animation does. */}
                            {[['rot', tr('회전'), 180, 180 / Math.PI], ['skew', tr('기울기'), 100, 100], ['bend', tr('곡률'), 100, 100]].map(([key, label, range, scale]) => (
                                <label key={key} className="mode-slider" title={tr('드래그해 조정, 두 번 눌러 0으로. 기울기·곡률은 Ctrl 누르고 선택 영역을 끌어도 됩니다')}>
                                    <span>{label}</span>
                                    <input type="range" min={-range} max={range} value={Math.round((selection[key] || 0) * scale)}
                                        onChange={e => setSelection(s => s && ({ ...s, [key]: +e.target.value / scale }))}
                                        onDoubleClick={() => setSelection(s => s && ({ ...s, [key]: 0 }))} />
                                </label>
                            ))}
                            <button className="button button-primary" onClick={extractSelectionToPart} style={{ height: 26, padding: '0 10px' }} title={tr('선택 영역을 별도 레이어(파츠)로 분리해 애니메이션')}>{tr('파츠로 분리')}</button>
                            <button className="button" onClick={copyLassoSelection} style={{ height: 26, padding: '0 10px' }} title={tr('선택 영역 복사 (다른 컷/레이어에 붙여넣기)')}>{tr('복사')}</button>
                            <button className="button" onClick={commitSelection} style={{ height: 26, padding: '0 10px' }} title={tr('제자리에 적용(이동/크기)')}>{tr('완료')}</button>
                            <button className="button" onClick={cancelSelection} style={{ height: 26, padding: '0 10px' }}>{tr('취소')}</button>
                        </div>
                    )}
                    {etool === 'curve' && (
                        <div className="mode-group">
                            <span className="mode-label">{tr('곡선 자')}</span>
                            {/* No anchors yet means there is nothing to finish and nothing to
                                cancel. These were rendered disabled, which on a tablet is a
                                button that looks pressable and does nothing - the same reading
                                as a broken app. */}
                            <span className="mode-hint">{curvePts === 0 ? tr('점을 찍어 곡선을 만드세요') : tr('앵커 {0}개 (누른 채 끌어 미세조정)', curvePts)}</span>
                            {curvePts > 0 && <>
                                <button className="button button-primary" style={{ height: 26, padding: '0 10px' }} disabled={curvePts < 2} onClick={commitCurve}>{tr('완료')}</button>
                                <button className="button" style={{ height: 26, padding: '0 10px' }} onClick={cancelCurve}>{tr('취소')}</button>
                            </>}
                        </div>
                    )}
                    {cameraCapture && (
                        <div className="mode-group">
                            <span className="mode-label">{tr('카메라 경로')}</span>
                            <span className="mode-hint">{tr('카메라가 지나갈 길을 그리세요 — 재생하면 그 길을 따라갑니다')}</span>
                            <button className="button" style={{ height: 26, padding: '0 10px' }} onClick={() => setCameraCapture(null)}>{tr('취소')}</button>
                        </div>
                    )}
                    {pathCapture && (
                        <div className="mode-group">
                            <span className="mode-label">{pathCapture.mode === 'sway' ? tr('흔들림 곡선') : tr('이동 경로')}</span>
                            <span className="mode-hint">{pathCapture.mode === 'sway' ? tr('물결치듯 곡선을 그리세요 — 그 모양·크기대로 흔들립니다') : tr('펜으로 이동 경로를 그리세요')}</span>
                            <button className="button" style={{ height: 26, padding: '0 10px' }} onClick={() => setPathCapture(null)}>{tr('취소')}</button>
                        </div>
                    )}
                </div>
            )}
            </div>

            <div className="main-content" onPointerDown={onDockPointerDown}>
                {/* Far-left icon rail for switching panels, Clip Studio style: tools on top,
                    colour below. */}
                <div className="dock-rail">
                    <button className={`dock-icon${showLeft ? ' active' : ''}`} title={tr('도구 창 (펜 · 지우개 · 스포이드 등)')}
                        onClick={() => setShowLeft(v => !v)}><Menu size={20} /></button>
                    <button className={`dock-icon${leftDock === 'color' ? ' active' : ''}`} title={tr('색상 창 (COLOR)')}
                        onClick={() => setLeftDock(v => v === 'color' ? null : 'color')}><Palette size={20} /></button>
                </div>
                {dockSlot('left')}

                {/* Scrolling is locked here while panning with space. Left open, space and drag
                    scroll the page down instead of moving the canvas. */}
                <div className="canvas-area" ref={canvasAreaRef} style={{ touchAction: 'none', position: 'relative', cursor: spaceDown ? 'grab' : undefined, overflow: spaceDown ? 'hidden' : 'auto' }}
                    onMouseDown={e => { if (e.button === 1) e.preventDefault(); }} /* suppress middle-click auto-scroll */
                    onAuxClick={e => { if (e.button === 1) e.preventDefault(); }}
                    onPointerDown={onAreaPointerDown} onPointerMove={onAreaPointerMove} onPointerUp={onAreaPointerUp} onPointerCancel={onAreaPointerUp}>
                    {(view.zoom !== 1 || view.x !== 0 || view.y !== 0) && (
                        <button className="button" onClick={resetView} title={tr('줌 초기화')}
                            style={{ position: 'absolute', top: 8, right: 8, zIndex: 30, height: 28, padding: '0 10px' }}>
                            {Math.round(view.zoom * 100)}% <RotateCcw size={11} />
                        </button>
                    )}
                    <div className={`canvas-stage${transparentBg ? ' checkered' : ''}`} style={{ position: 'relative', transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, maxWidth: '100%', maxHeight: '100%' }}>
                        {/* tabIndex -1: focusable from code, never a stop in the tab order. The
                            canvas is where the keys are meant to land, but nobody tabs to a
                            drawing surface. */}
                        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} tabIndex={-1}
                            onPointerDown={startDraw} onPointerMove={onDraw} onPointerUp={stopDraw} onPointerCancel={stopDraw} onPointerLeave={onPointerLeaveCanvas}
                            style={{
                                // `${handle}-resize` is the eight-way set - nw-resize, n-resize
                                // and so on - so the arrow points the way that edge will travel.
                                // `selection &&` first, so a handle the pointer was over when the
                                // selection was committed cannot leave a resize arrow behind on a
                                // canvas that has nothing to resize.
                                cursor: spaceDown ? 'grab'
                                    : (selection && hoverHandle) ? `${hoverHandle}-resize`
                                        : selection ? 'move'
                                            : tool === 'fill' ? 'cell' : 'crosshair',
                                touchAction: 'none',
                            }} />
                        {/* The live overlay must be transparent. Inheriting the global
                            `canvas { background:#fff }` rule paints white over the main canvas,
                            hiding the drawing and making committed strokes look as if they
                            vanished. */}
                        <canvas ref={liveCanvasRef} width={CANVAS_W} height={CANVAS_H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', background: 'transparent', boxShadow: 'none' }} />

                        {spineLayer && (
                            <SwaySpine
                                profile={spineLayer.anim.swayProfile} axis={spineLayer.anim.swayAxis === 'x' ? 'x' : 'y'}
                                amount={spineLayer.anim.swayAmount || 0} cw={CANVAS_W} ch={CANVAS_H}
                                onChange={(prof) => updLayerAnim(spineEdit.cutId, spineEdit.layerId, { swayProfile: prof })}
                                onClose={() => setSpineEdit(null)} />
                        )}
                    </div>
                </div>

                {dockSlot('right')}

                {!showRight && <button onClick={() => setShowRight(true)} className="icon-btn" style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: 'none', borderLeft: '1px solid #333' }}><ChevronRight size={14} /></button>}
            </div>

            {/* Panels pulled out of a dock float above the layout. */}
            {floatingPanels}
            {/* While a header is being dragged, show where it would land. */}
            {panelDrag && panelDrag.zone !== 'float' && (
                <div className="dock-hint" style={{ [panelDrag.zone]: 0 }} />
            )}

            {showBottom && <div className="splitter-h" style={{ touchAction: 'none' }} onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } startBottomResize(e.clientY); }} />}

            <Timeline
                activePartId={activePartId} audioData={audioData} audioFile={audioFile}
                currentCutId={currentCutId} currentTime={currentTime} cutDragArmedRef={cutDragArmedRef}
                cutDragMovedRef={cutDragMovedRef} cutDragTimerRef={cutDragTimerRef} cuts={cuts}
                draggingCutData={draggingCutData} fmt={fmt} goToScene={goToScene} handleAddTrack={handleAddTrack}
                handleDeleteAudio={handleDeleteAudio} handleDeleteTrack={handleDeleteTrack}
                handlePlayPause={handlePlayPause} handleStop={handleStop} isPlaying={isPlaying} loopPlay={loopPlay}
                makePartFromSelection={makePartFromSelection} marquee={marquee} maxTime={maxTime}
                transparentBg={transparentBg} setTransparentBg={setTransparentBg}
                transparentFormat={transparentFormat} setTransparentFormat={setTransparentFormat}
                numTracks={numTracks} onTimelinePointerDown={onTimelinePointerDown}
                parts={parts}
                playbackRate={playbackRate} playheadRef={playheadRef} pps={pps}
                openPlaybackSettings={() => { setSettingsTab('play'); setShowSettings(true); }}
                removeVideoOverlay={removeVideoOverlay} renamePart={renamePart} sceneDetect={sceneDetect}
                hiddenTracks={hiddenTracks} toggleTrackHidden={toggleTrackHidden}
                openVideoSettings={() => setSceneCfg(c => c || { threshold: 14, rangeOn: false, startText: '0:00', endText: '' })}
                seekToTime={seekToTime} selectPart={selectPart} selectedCutIds={selectedCutIds}
                setCurrentCutId={setCurrentCutId} setCurrentTime={setCurrentTime} addCuts={cs => dispatchCuts(addCuts(cs))}
                setDraggingCutData={setDraggingCutData} setLoopPlay={setLoopPlay} setPlaybackRate={setPlaybackRate}
                setResizingData={setResizingData} setSceneCfg={setSceneCfg} setSelectedCutIds={setSelectedCutIds}
                setShowBottom={setShowBottom} showBottom={showBottom} snapLinePos={snapLinePos}
                startTimelinePan={startTimelinePan} timelineH={timelineH} timelineRef={timelineRef} tlWin={tlWin}
                ungroupPart={ungroupPart} videoOverlay={videoOverlay} zoomTimelineAt={zoomTimelineAt} />
        </div>
    );
}
