import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Plus, Trash2, PenLine, Pen, Feather, Eraser, Undo, Redo, Layers, Trash, ChevronRight, ChevronDown, Folder, FolderOpen, Eye, EyeOff, ClipboardPaste, GitBranch, Move, Type, Cloud, Film, Repeat, Minus, Waves, Grid3x3, Palette, Menu, PaintBucket, Pipette } from 'lucide-react';
import './App.css';
import { saveAutosave, loadAutosave, saveProject, loadProject, listProjects, deleteProject, autosaveKey } from './db';
import { CutAnimPanel, LayerAnimPanel, JitterPanel } from './AnimPanels';
import { NumField, clampNum } from './NumField';
import ColorPanel, { RECENT_SLOTS } from './ColorPanel';
import { TopBar } from './TopBar';
import { CutLayerPanel } from './CutLayerPanel';
import { ToolsPanel } from './ToolsPanel';
import { Timeline } from './Timeline';
import { ProjectPicker, ProgressOverlay, SettingsModal, HelpModal, VideoImportModal, SceneDetectModal, LinkPromptModal } from './Modals';
import { tr, loadLang, saveLang, setLangValue } from './i18n';
import { moveLayer } from './layerOps.js';
import { resolveDrawLayer as resolveDrawLayerPure, commitStroke, insertFill } from './layerOps.js';
import { closeLassoPath, lassoBounds, applyResize } from './lassoOps.js';
import { useTimelineGestures } from './useTimelineGestures.js';
import { fmt, parseClock } from './timeCode.js';
import { pushSnapshot, step } from './historyOps.js';
import { cloneCutContents as cloneCutContentsPure } from './cutClone.js';
import { DEFAULT_KEYS, KEY_LABELS, keyOf, matchShortcut, loadKeymap } from './shortcuts.js';
import { derivePartsFrom, deriveVideoBatches } from './partOps.js';
import {
    cutsReducer, replaceCuts, addCuts, updateCut, setCutAnim, clearCut,
    updateLayer, setLayerAnim, moveLayers, upsertText, moveText, deleteText, toggleTextVisible as toggleTextVisibleAction,
    assignPartTo, renamePart as renamePartAction, ungroupPart as ungroupPartAction, removeBatch,
    insertCutsShifting, deleteTrack, moveCutGroup, replaceBatchCuts, patchCut, patchCuts,
} from './cutsReducer.js';
import { measureTextBox as measureTextBoxPure, textNeedsBox, drawTextObject } from './textRender.js';
import { migrateCuts, projectSettings, makeLoadProgress } from './projectFormat.js';
import { unusedBitmapIds } from './bitmapRefs.js';
import { dragCut, resizeCut } from './cutOps.js';
import {
    DEFAULT_CUT_DURATION, CANVAS_W as CANVAS_W_DEFAULT, CANVAS_H as CANVAS_H_DEFAULT, FONT_PRESETS,
    pointInPolygon, dist, safeArray, hexToRgb, bucketFillTransparentRegion,
    layerKey, imageDataToDataURL, dataURLToImageData, drawStrokesOnCtx, sizeCanvas,
    flattenForCanvas, flattenLayersInUiOrder, strokeSig, extractVideoFrames, fitRect, detectSceneCuts, curveToWave, swayWeightAt, morphPrepare,
    accentSoft, computeCutAnim, computeLayerAnim, TEXT_ANIM_DEFAULT, computeTextAnim,
    targetCanvasFor,
} from './canvasUtils';

const PEN_TYPES = [
    { id: 'pen', label: 'Dot', Icon: PenLine },
    { id: 'brush', label: '펜', Icon: Feather },
    { id: 'pencil', label: '연필', Icon: PenLine },
    { id: 'soft', label: '에어', Icon: Cloud },
    { id: 'marker', label: 'Marker', Icon: Pen },
    // Line and curve share one Ruler slot rather than taking two, and split into modes below.
    { id: 'ruler', label: '자', Icon: Minus },
    { id: 'mosaic', label: '모자이크', Icon: Grid3x3 },
    { id: 'eraser', label: 'Eraser', Icon: Eraser },
    { id: 'fill', label: 'Fill', Icon: PaintBucket },
];
const BOIL_FPS = 10; // how many times a second the boiling-line motion advances
const TIMELINE_MIN_SPAN = 240; // seconds of ruler even with nothing in the project
const TIMELINE_TAIL_PAD = 60;  // empty room past the end, to drag into
// How many distinct wobbles the boiling line cycles through. A hand-drawn boiling line is a
// handful of drawings alternating, not a new one every frame, so this reads right - and it is
// what keeps the effect affordable, since each phase is rasterised once and then cached.
const BOIL_PHASES = 3;
// Layer canvases held on demand during render. Each is a full canvas (8MB at 1920x1080), so this
// is a memory ceiling as much as a cache size: a boiling layer occupies BOIL_PHASES of them.
const LAYER_CANVAS_LRU = 24;

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

function LayerThumbnail({ layer, cutId, layerCanvasCache }) {
    const ref = useRef(null);
    const key = layerKey(cutId, layer.id);
    useEffect(() => {
        const c = ref.current; if (!c) return;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 56, 31);
        const layerCanvas = layerCanvasCache[key];
        if (layerCanvas) {
            ctx.drawImage(layerCanvas, 0, 0, 56, 31);
        }
    }, [layer, layerCanvasCache[key]]);
    return <canvas ref={ref} width={56} height={31} style={{ width: 42, height: 23, borderRadius: 3, background: '#fff', flexShrink: 0, border: '1px solid hsl(var(--ui-h) var(--ui-s) 22%)' }} />;
}


export default function App() {
    const mkLayer = (id) => ({ id, name: `L${id}`, type: 'layer', strokes: [], redoStrokes: [], visible: true, parentId: null });
    // The document. Changes go through cutsReducer's named actions - see that file for why, and
    // prefer a named action to patchCut/patchCuts when adding one.
    const [cuts, dispatchCuts] = React.useReducer(cutsReducer, [{ id: 1, name: 'Cut 1', startTime: 0, endTime: 1, track: 0, layers: [mkLayer(1)], activeLayerId: 1, texts: [] }]);
    const [numTracks, setNumTracks] = useState(2);
    const [onionPrev, setOnionPrev] = useState(false);
    const [onionNext, setOnionNext] = useState(false);
    const [resizingData, setResizingData] = useState(null);
    const [draggingCutData, setDraggingCutData] = useState(null);
    const [currentCutId, setCurrentCutId] = useState(1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [loopPlay, setLoopPlay] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [rightW, setRightW] = useState(270);
    const [leftW, setLeftW] = useState(96);
    const [colorW, setColorW] = useState(200);
    const [timelineH, setTimelineH] = useState(240);
    const [showLeft, setShowLeft] = useState(true);
    const [showRight, setShowRight] = useState(true);
    const [showBottom, setShowBottom] = useState(true);
    const [splitter, setSplitter] = useState(null);
    // True while the playhead is being dragged. Rendering treats it as playback (see paintFrame).
    const [scrubbing, setScrubbing] = useState(false);

    // The editor opens at the text's position, so clicking near an edge used to put half of it
    // off-screen with the Done button unreachable. Measure once it is laid out and nudge it back
    // in; its size changes as options appear, so this reruns whenever the editor does.
    const textEditorRef = useRef(null);
    useLayoutEffect(() => {
        const el = textEditorRef.current;
        if (!el) return;
        el.style.transform = 'translate(10px, 10px)';
        const r = el.getBoundingClientRect();
        const pad = 8;
        let dx = 0, dy = 0;
        if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right;
        if (r.bottom > window.innerHeight - pad) dy = window.innerHeight - pad - r.bottom;
        if (r.left + dx < pad) dx = pad - r.left;
        if (r.top + dy < pad) dy = pad - r.top;
        el.style.transform = `translate(${10 + dx}px, ${10 + dy}px)`;
    });

    // Where each panel lives: 'left', 'right' or 'float'. Panels are drawn from these rather than
    // from fixed positions in the layout, so dragging one only has to change this value.
    const [docks, setDocks] = useState(() => {
        try {
            const v = JSON.parse(localStorage.getItem('mv_docks'));
            if (v && ['left', 'right', 'float'].includes(v.tools)) return v;
        } catch { }
        return { tools: 'left', color: 'left', cut: 'right' };
    });
    const [floatPos, setFloatPos] = useState(() => {
        try {
            const v = JSON.parse(localStorage.getItem('mv_floats'));
            if (v && typeof v === 'object') return v;
        } catch { }
        return { tools: { x: 120, y: 120 }, color: { x: 160, y: 160 }, cut: { x: 200, y: 200 } };
    });
    useEffect(() => { try { localStorage.setItem('mv_docks', JSON.stringify(docks)); } catch { } }, [docks]);
    useEffect(() => { try { localStorage.setItem('mv_floats', JSON.stringify(floatPos)); } catch { } }, [floatPos]);
    // The panel being dragged by its header, plus where it would land if dropped now.
    const [panelDrag, setPanelDrag] = useState(null);

    const [snapLinePos, setSnapLinePos] = useState(null);
    const [audioFile, setAudioFile] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const [audioDuration, setAudioDuration] = useState(30);
    const [audioData, setAudioData] = useState(null);
    const audioRef = useRef(null);
    const audioB64Ref = useRef(null); // audio as base64 data URL, embedded into saves
    // Video overlay track: play the original video underneath the drawing layers (no per-frame
    // cuts) - for drawing over a video. Like audio, but painted onto the canvas each frame.
    const [videoOverlay, setVideoOverlay] = useState(null); // { name, startTime, endTime, offset, duration, w, h, cuts? }
    const [sceneDetect, setSceneDetect] = useState(null);   // { done, total } while auto-detecting scene cuts
    const [sceneCfg, setSceneCfg] = useState(null);         // scene-detect settings modal { threshold, rangeOn, startText, endText }
    const videoElRef = useRef(null);      // hidden <video> element that decodes/plays the overlay
    const videoBlobRef = useRef(null);    // the video Blob, for saving
    const videoSeekTokRef = useRef(0);    // paused-seek token so a stale 'seeked' doesn't repaint
    const [videoImport, setVideoImport] = useState(null); // {file, fps, maxFrames} dialog
    const [recentVideos, setRecentVideos] = useState([]); // fetched/opened videos, reusable without re-downloading
    const [videoBusy, setVideoBusy] = useState(null); // {done, total} while extracting
    const [videoBusyBg, setVideoBusyBg] = useState(false); // extraction moved to a background chip
    // YouTube link input. A native prompt fails silently once blocked, so this asks in-app.
    const [linkPrompt, setLinkPrompt] = useState(null); // {kind:'video'|'audio'}
    // Make failures visible. Once the browser blocks dialogs, alert is swallowed and the app
    // looks like it simply did nothing - which is exactly why one bug here took so long to find.
    const [appError, setAppError] = useState(null);
    const [toast, setToast] = useState(null);            // unobtrusive notice
    const [backupProg, setBackupProg] = useState(null);  // automatic-backup progress, shown in the corner
    useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
    const videoStopRef = useRef(false);
    const isExporting = useRef(false);
    const mediaRecorderRef = useRef(null);
    const audioCtxRef = useRef(null);
    const audioSourceRef = useRef(null);
    const audioDestRef = useRef(null);
    const exportEndRef = useRef(0);
    const [tool, setTool] = useState('pen');
    const [rulerMode, setRulerMode] = useState('line'); // the Ruler tool's two options: line and curve
    const [softMode, setSoftMode] = useState('soft');   // the Air tool's two options: airbrush and blur
    // The logic below still works in terms of "line" and "curve"; the Ruler tool just picks
    // between them by mode.
    const etool = tool === 'ruler' ? rulerMode : tool === 'soft' ? softMode : tool;
    const [color, setColor] = useState('#000000');
    // Recent colours only collect colours actually used, not ones merely selected.
    // See noteColorUsed below.
    const [recentColors, setRecentColors] = useState(() => {
        try { const v = JSON.parse(localStorage.getItem('mv_recent_colors')); if (Array.isArray(v)) return v; } catch { }
        return [];
    });
    useEffect(() => { try { localStorage.setItem('mv_recent_colors', JSON.stringify(recentColors)); } catch { } }, [recentColors]);
    const [pickingColor, setPickingColor] = useState(false); // eyedropper: next canvas click samples a pixel
    // Palettes start empty - no built-in presets. The user fills them.
    const [palettes, setPalettes] = useState(() => {
        try { const s = JSON.parse(localStorage.getItem('mv_palettes')); if (Array.isArray(s) && s.length) return s; } catch { }
        return [{ name: tr('내 팔레트'), colors: [] }];
    });
    const [activePalette, setActivePalette] = useState(0);
    const [paletteEdit, setPaletteEdit] = useState(false); // when on, tapping a swatch deletes it (for tablets)
    useEffect(() => { try { localStorage.setItem('mv_palettes', JSON.stringify(palettes)); } catch { } }, [palettes]);
    const addToPalette = (c) => setPalettes(ps => ps.map((p, i) => i === activePalette && !p.colors.some(x => x.toLowerCase() === c.toLowerCase()) ? { ...p, colors: [...p.colors, c] } : p));
    const removeFromPalette = (ci) => setPalettes(ps => ps.map((p, i) => i === activePalette ? { ...p, colors: p.colors.filter((_, j) => j !== ci) } : p));
    const addPalette = () => { setPalettes(ps => [...ps, { name: tr('팔레트 {0}', ps.length + 1), colors: [] }]); setActivePalette(palettes.length); };
    const deletePalette = () => { if (palettes.length <= 1) return; setPalettes(ps => ps.filter((_, i) => i !== activePalette)); setActivePalette(i => Math.max(0, i - 1)); };
    const renamePalette = () => { const n = window.prompt(tr('팔레트 이름'), palettes[activePalette]?.name); if (n) setPalettes(ps => ps.map((p, i) => i === activePalette ? { ...p, name: n } : p)); };
    const applyColor = (c) => { if (!c) return; setColor(c); };
    // "Used" means something was actually drawn in that colour; only then does it join Recent.
    const noteColorUsed = (c) => {
        if (!c) return;
        setRecentColors(p => (p[0] && p[0].toLowerCase() === c.toLowerCase())
            ? p
            : [c, ...p.filter(x => x.toLowerCase() !== c.toLowerCase())].slice(0, RECENT_SLOTS));
    };
    // Eyedropper: native picker where available, else sample the canvas on the next click.
    const pickColor = async () => {
        if (window.EyeDropper) { try { const r = await new window.EyeDropper().open(); applyColor(r.sRGBHex); } catch { } }
        else setPickingColor(true);
    };
    const [brushSize, setBrushSize] = useState(5);
    const [eraserSize, setEraserSize] = useState(20);
    const [opacity, setOpacity] = useState(1.0);
    const [expandedCuts, setExpandedCuts] = useState(new Set());
    const [collapsedCutIds, setCollapsedCutIds] = useState(new Set());
    const [renamingCutId, setRenamingCutId] = useState(null);
    const [selectedCutIds, setSelectedCutIds] = useState(new Set());
    const [marquee, setMarquee] = useState(null); // rubber-band rect (content px) while drag-selecting cuts
    const [activePartId, setActivePartId] = useState(null); // scope playback and editing to one part (null = all)
    const lassoClipRef = useRef(null); // copied lasso pixels: { bitmapId, w, h }
    const [hasLassoClip, setHasLassoClip] = useState(false);
    const [showFileMenu, setShowFileMenu] = useState(false);
    const [showMediaMenu, setShowMediaMenu] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const fileHandleRef = useRef(null);
    const [dragLayerInfo, setDragLayerInfo] = useState(null);
    const [dropInfo, setDropInfo] = useState(null);
    const canvasRef = useRef(null);
    const liveCanvasRef = useRef(null);   // overlay for the in-progress stroke (drawn without touching layer state)
    const liveStrokeRef = useRef(null);   // the stroke currently being drawn
    const liveClearTokRef = useRef(0);
    const liveClearPendingRef = useRef(false); // after a commit, clear the overlay only once the layer cache has drawn the new stroke,
    // which avoids a flicker or a vanishing line
    const lineStartRef = useRef(null);    // start point of the line tool
    const drawTargetLayerRef = useRef(null); // the layer id this stroke will commit to, in case the active layer changes under us
    const layerDragRef = useRef(null);    // while dragging everything with the move tool
    const [dragTick, setDragTick] = useState(0); // signal to redraw with the original hidden while dragging
    const liveDrawnRef = useRef(0);       // how many points are already on the live overlay, so only the tail is appended
    const liveRafRef = useRef(0);
    const boilPhaseRef = useRef(0);       // boiling-motion phase; advancing it over time makes the strokes shimmer in place
    const [boilTick, setBoilTick] = useState(0); // phase ticker so the boiling motion previews even while paused for editing
    const curveAnchorsRef = useRef(null); // curve tool: the anchor points tapped out so far
    const curveDraggingRef = useRef(false); // an anchor was just placed and is being fine-tuned by dragging
    const [curvePts, setCurvePts] = useState(0); // anchor count, for the done/cancel bar
    const mosaicRectRef = useRef(null);   // mosaic drag rectangle
    const [mosaicBlock, setMosaicBlock] = useState(14); // mosaic block size (px)
    const isDrawing = useRef(false);
    const reqRef = useRef(null);
    const isPlayingRef = useRef(false);
    const fileMenuRef = useRef(null);
    const mediaMenuRef = useRef(null);
    const timelineRef = useRef(null);
    const [pps, setPps] = useState(50);
    // Visible px window of the horizontally-scrolled timeline, so only on-screen cut blocks and
    // ruler ticks are rendered (thousands of DOM nodes otherwise stall the whole app).
    const [tlWin, setTlWin] = useState({ left: 0, right: 4000 });
    const tlWinRafRef = useRef(0);
    const pendingTlScrollRef = useRef(null); // scrollLeft to apply after a pps change (cursor-anchored zoom)
    const ppsRef = useRef(50);
    ppsRef.current = pps;
    // User-adjustable canvas resolution. Shadows the imported defaults for the whole component.
    const [canvasSize, setCanvasSize] = useState({ w: CANVAS_W_DEFAULT, h: CANVAS_H_DEFAULT });
    const CANVAS_W = canvasSize.w, CANVAS_H = canvasSize.h;
    // Cached layer canvases hold the old dimensions — drop them when the size changes.
    useEffect(() => { setLayerCanvasCache({}); }, [canvasSize.w, canvasSize.h]);
    const [copiedCut, setCopiedCut] = useState(null);
    const [lassoPoints, setLassoPoints] = useState([]);
    const [selection, setSelection] = useState(null);
    const [textEdit, setTextEdit] = useState(null);
    const [selectedText, setSelectedText] = useState(null);
    const [layerCanvasCache, setLayerCanvasCache] = useState({});
    const bitmapStoreRef = useRef(new Map());
    const fallbackCanvasRef = useRef(new Map()); // LRU of layer canvases built on demand during render
    const decodingRef = useRef(new Set()); // frame ids currently being re-decoded from their Blob
    const hotWindowRef = useRef(new Set()); // frame ids in the current prefetch window — never LRU-evicted
    const prefetchRef = useRef(null); // prefetchFramesAt, called by the rAF loop with the real playhead
    const paintedOnceRef = useRef(false); // once we've painted a real frame, hold it rather than flash white
    const canvasAreaRef = useRef(null);
    const videoFileRef = useRef(null);
    const currentTimeRef = useRef(0);       // playback clock read by the rAF loop (avoids stale closure)
    const playheadRef = useRef(null);        // moved imperatively during playback
    const seekRef = useRef(null);            // pending seek the playback loop applies (scrub while playing)
    const dataUrlCacheRef = useRef(new Map()); // id -> {imageData, url}; avoids re-encoding bitmaps each autosave
    const liveRef = useRef({}); // latest {cuts, copiedCut, selection} for safe bitmap GC from effects
    const selectionDragRef = useRef(null);
    const activePointerIdRef = useRef(null);
    const textAreaRef = useRef(null);
    const textDragRef = useRef(null);
    const textMeasureCtxRef = useRef(null);
    const [autoSavedAt, setAutoSavedAt] = useState(null);
    const autosaveTimerRef = useRef(null);
    const didRecoverRef = useRef(false);
    const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
    const touchPtsRef = useRef(new Map());
    const pinchRef = useRef(null);
    const tlTouchRef = useRef(new Map());
    const tlPinchRef = useRef(null);
    const [serverProjects, setServerProjects] = useState(null); // null = picker closed
    const [serverAvailable, setServerAvailable] = useState(false); // is the project API reachable?
    const [serverBusy, setServerBusy] = useState(false);
    const [localProjects, setLocalProjects] = useState(null); // IndexedDB project picker
    const localIdRef = useRef(null);
    const localNameRef = useRef('');
    const serverIdRef = useRef(null);
    const serverNameRef = useRef('');
    const cutDragMovedRef = useRef(false); // distinguishes a click (select) from a real drag (move)
    const cutDragArmedRef = useRef(false); // long-press must arm before a touch can drag a cut
    const cutDragTimerRef = useRef(null);
    const [animLayer, setAnimLayer] = useState(null); // {cutId, layerId} whose part-anim panel is open
    const [jitterLayer, setJitterLayer] = useState(null); // {cutId, layerId} whose boiling-settings panel is open
    const [backupAt, setBackupAt] = useState(null);      // time of the last server backup
    const [backupBusy, setBackupBusy] = useState(false);
    const [backupList, setBackupList] = useState(null);  // null = the list is closed
    const [storageInfo, setStorageInfo] = useState(null); // local storage usage
    const [autosaveErr, setAutosaveErr] = useState(null); // why autosave failed - never swallowed silently
    const [loadProgress, setLoadProgress] = useState(null); // {label, done, total}; total 0 means the length is unknown
    const backupKeyRef = useRef(null);
    const backupBusyRef = useRef(false);
    const lastBackupSigRef = useRef('');
    // The lang state exists only to trigger a redraw; lookups read the module variable.
    // Nothing here is memoised, so changing it re-renders the whole tree in the new language.
    const [lang, setLang] = useState(loadLang);
    const changeLang = (l) => { setLangValue(l); saveLang(l); setLang(l); };
    const [themeColor, setThemeColor] = useState(() => { try { return localStorage.getItem('mv_theme') || DEFAULT_THEME; } catch { return DEFAULT_THEME; } });
    const [themeRecent, setThemeRecent] = useState(() => {
        try { const v = JSON.parse(localStorage.getItem('mv_theme_recent')); return Array.isArray(v) ? v : []; } catch { return []; }
    });
    const [uiSat, setUiSat] = useState(() => { const v = parseFloat(localStorage.getItem('mv_ui_sat')); return isNaN(v) ? 3 : v; });
    useEffect(() => {
        applyTheme(themeColor, uiSat);
        try { localStorage.setItem('mv_theme', themeColor); localStorage.setItem('mv_ui_sat', String(uiSat)); } catch { }
    }, [themeColor, uiSat]);
    // The value changes continuously while picking, so it is only recorded once picking stops.
    useEffect(() => {
        if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) return;
        const t = setTimeout(() => {
            setThemeRecent(p => {
                const next = [themeColor, ...p.filter(x => x.toLowerCase() !== themeColor.toLowerCase())].slice(0, 10);
                try { localStorage.setItem('mv_theme_recent', JSON.stringify(next)); } catch { }
                return next;
            });
        }, 800);
        return () => clearTimeout(t);
    }, [themeColor]);
    const [leftDock, setLeftDock] = useState('color'); // which panel is open in the left dock (null = closed); switched from the icon rail

    // Tab collapses every panel to leave just the canvas, and remembers what was open so the
    // second press restores exactly that rather than opening everything.
    const panelsBeforeHideRef = useRef(null);
    const toggleAllPanels = () => {
        const prev = panelsBeforeHideRef.current;
        if (prev) {
            panelsBeforeHideRef.current = null;
            setShowLeft(prev.left); setLeftDock(prev.dock); setShowRight(prev.right); setShowBottom(prev.bottom);
        } else {
            panelsBeforeHideRef.current = { left: showLeft, dock: leftDock, right: showRight, bottom: showBottom };
            setShowLeft(false); setLeftDock(null); setShowRight(false); setShowBottom(false);
        }
    };
    // The key handler subscribes once with an empty dependency list, so calling toggleAllPanels
    // directly from it would freeze the panel state as it was on the first render. Same ref trick
    // paintFrame already uses.
    const toggleAllPanelsRef = useRef(null);
    toggleAllPanelsRef.current = toggleAllPanels;
    const [keymap, setKeymap] = useState(loadKeymap);
    const [showSettings, setShowSettings] = useState(false); // settings dialog (shortcuts and theme)
    const [settingsTab, setSettingsTab] = useState('theme'); // open on the theme tab
    const [rebinding, setRebinding] = useState(null);  // id of the action waiting to be rebound
    const [spaceDown, setSpaceDown] = useState(false); // space = pan (hand) mode
    const spaceDownRef = useRef(false);
    const panningRef = useRef(false);
    const lastInteractRef = useRef(0); // time of the last zoom or pan, used to briefly yield the boiling preview
    const [pathCapture, setPathCapture] = useState(null); // {cutId, layerId} while recording a motion path
    const pathPtsRef = useRef(null);

    const storeBitmap = (imageData) => {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        bitmapStoreRef.current.set(id, { imageData, imageBitmap: null });
        // Best-effort bitmap for fast preview; fall back to ImageData rendering if this fails.
        createImageBitmap(imageData).then(bmp => {
            const entry = bitmapStoreRef.current.get(id);
            if (!entry) return;
            entry.imageBitmap = bmp;
        }).catch(() => { });
        return id;
    };

    // Store an already-compressed image (video frames). Keeps only the decoded bitmap for
    // rendering plus its data URL for saving — no raw ImageData, so memory stays small.
    // Store a video frame as a Blob (browser-managed, off the JS heap) rather than a base64
    // dataURL string. Crucially we DON'T decode it here — decoding every frame into an
    // ImageBitmap at import is what OOMs a big video (hundreds of full-res bitmaps resident).
    // The bitmap is decoded lazily on first display and released under an LRU cap.
    const storeBitmapBlob = async (blob, w = 0, h = 0) => {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        const ext = (blob.type.match(/image\/(\w+)/)?.[1] || 'webp');
        bitmapStoreRef.current.set(id, { imageData: null, imageBitmap: null, blob, ext, w, h });
        return id;
    };
    // Decode a frame Blob to an ImageBitmap, downscaling to at most the canvas size. The source
    // stays max-quality (for save/export); the DISPLAY bitmap is capped so decoding a 4K frame
    // costs the same as a 1080p one — this is what keeps max-quality playback smooth.
    const decodeFrameBitmap = (e) => {
        if (e.w && e.h && (e.w > CANVAS_W || e.h > CANVAS_H)) {
            const s = Math.min(CANVAS_W / e.w, CANVAS_H / e.h);
            return createImageBitmap(e.blob, { resizeWidth: Math.max(1, Math.round(e.w * s)), resizeHeight: Math.max(1, Math.round(e.h * s)), resizeQuality: 'high' });
        }
        return createImageBitmap(e.blob);
    };
    // LRU cap on how many frame ImageBitmaps stay decoded at once (bounds memory regardless of
    // import size or which mode you're in). Released frames keep their Blob and re-decode on view.
    const DECODED_CAP = 120; // must exceed the prefetch window (~50) so prefetched frames aren't evicted
    const decodeOrderRef = useRef(new Map()); // id -> monotonically increasing use counter
    const decodeSeqRef = useRef(0);
    const [frameDecodeTick, setFrameDecodeTick] = useState(0); // bumped when a frame finishes decoding → forces cache rebuild
    const touchDecoded = (id) => { decodeOrderRef.current.set(id, ++decodeSeqRef.current); };
    const trimDecodedFrames = (protect) => {
        const store = bitmapStoreRef.current;
        const decoded = [];
        for (const [id, e] of store) if (e.blob && e.imageBitmap) decoded.push(id);
        if (decoded.length <= DECODED_CAP) return;
        const order = decodeOrderRef.current;
        const hot = hotWindowRef.current; // the on-screen / prefetch window is never evicted
        decoded.sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0)); // oldest first
        let toRelease = decoded.length - DECODED_CAP;
        for (const id of decoded) {
            if (toRelease <= 0) break;
            if ((protect && protect.has(id)) || hot.has(id)) continue;
            const e = store.get(id); try { e.imageBitmap.close?.(); } catch { } e.imageBitmap = null;
            order.delete(id); toRelease--;
        }
    };
    // Invalidate ONLY the cached layer canvases of cuts that use the given (just-decoded) frames,
    // instead of nuking the whole cache — nuking made on-screen frames flicker while playing.
    const invalidateCutsUsing = (ids) => {
        const idset = new Set(ids);
        const affected = new Set();
        for (const c of cuts) for (const l of safeArray(c.layers)) if (safeArray(l.strokes).some(s => s.tool === 'paste' && idset.has(s.bitmapId))) affected.add(layerKey(c.id, l.id));
        if (!affected.size) return;
        // A boiling layer holds one canvas per phase, keyed "cut:layer#phase", so dropping the
        // plain key alone would leave its phases behind holding the stale bitmap.
        for (const k of [...fallbackCanvasRef.current.keys()]) {
            const base = k.includes('#') ? k.slice(0, k.indexOf('#')) : k;
            if (affected.has(base)) fallbackCanvasRef.current.delete(k);
        }
        setLayerCanvasCache(prev => { const n = { ...prev }; for (const k of affected) delete n[k]; return n; });
    };
    const blobToDataURL = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

    // Duplicate a stored bitmap under a fresh id so a pasted/duplicated cut owns its
    // own pixels instead of aliasing the source's. `cache` dedups within one operation.
    const cloneBitmapId = (oldId, cache) => {
        if (!oldId) return oldId;
        if (cache.has(oldId)) return cache.get(oldId);
        const entry = bitmapStoreRef.current.get(oldId);
        let newId = oldId; // legacy strokes carry inline imageData; leave their id as-is
        if (entry?.imageData) {
            const src = entry.imageData;
            const copy = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
            newId = storeBitmap(copy);
        }
        cache.set(oldId, newId);
        return newId;
    };

    const historyRef = useRef([]);
    const recordHistoryRef = useRef(/** @type {(s: any) => void} */(() => { }));
    const historyIndexRef = useRef(-1);
    const isUndoRedoRef = useRef(false);
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
        setLassoPoints([]);
        selectionDragRef.current = null;
    };

    const commitSelectionImpl = (sel) => {
        if (!sel) return;
        const { cutId, sourceLayerId, bitmapId, maskBitmapId } = sel;
        const entry = bitmapStoreRef.current.get(bitmapId);
        const maskEntry = bitmapStoreRef.current.get(maskBitmapId);
        if (!entry?.imageData && !entry?.imageBitmap) { cancelSelection(); return; }
        if (!maskEntry?.imageData && !maskEntry?.imageBitmap) { cancelSelection(); return; }

        const px = Math.round(sel.x);
        const py = Math.round(sel.y);
        const tx = Math.round(sel.tx);
        const ty = Math.round(sel.ty);
        const tw = Math.max(1, Math.round(sel.tw));
        const th = Math.max(1, Math.round(sel.th));

        updLayers(cutId, c => ({
            layers: c.layers.map(l => {
                if (l.id !== sourceLayerId) return l;
                return {
                    ...l,
                    strokes: [
                        ...l.strokes,
                        { id: Date.now(), tool: 'eraseBitmap', bitmapId: maskBitmapId, x: px, y: py },
                        { id: Date.now() + 1, tool: 'paste', bitmapId, x: tx, y: ty, w: tw, h: th },
                    ]
                };
            })
        }));

        cancelSelection();
    };

    const commitSelection = () => commitSelectionImpl(selection);

    // Lasso to part: lift the selected region out of its source layer into a NEW layer,
    // so that region can be animated on its own (via the layer/part animation panel).
    const extractSelectionToPart = () => {
        const sel = selection;
        if (!sel) return;
        const entry = bitmapStoreRef.current.get(sel.bitmapId);
        const maskEntry = bitmapStoreRef.current.get(sel.maskBitmapId);
        if (!entry?.imageData && !entry?.imageBitmap) { cancelSelection(); return; }
        if (!maskEntry?.imageData && !maskEntry?.imageBitmap) { cancelSelection(); return; }
        const px = Math.round(sel.x), py = Math.round(sel.y);
        const tx = Math.round(sel.tx), ty = Math.round(sel.ty);
        const tw = Math.max(1, Math.round(sel.tw)), th = Math.max(1, Math.round(sel.th));
        const cut = cuts.find(c => c.id === sel.cutId);
        const newId = cut ? Math.max(...cut.layers.map(l => l.id), 0) + 1 : 1;
        updLayers(sel.cutId, c => {
            const layers = c.layers.map(l => l.id === sel.sourceLayerId
                ? { ...l, strokes: [...l.strokes, { id: Date.now(), tool: 'eraseBitmap', bitmapId: sel.maskBitmapId, x: px, y: py }] }
                : l);
            const partLayer = { id: newId, name: tr('파츠 {0}', newId), type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [{ id: Date.now() + 1, tool: 'paste', bitmapId: sel.bitmapId, x: tx, y: ty, w: tw, h: th }] };
            return { layers: [...layers, partLayer], activeLayerId: newId };
        });
        cancelSelection();
        setAnimLayer({ cutId: sel.cutId, layerId: newId }); // open its anim panel
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
        const cut = cuts.find(c => c.id === currentCutId);
        if (!clip || !cut) return;
        const layerId = cut.activeLayerId;
        const bmpCache = new Map();
        const bitmapId = cloneBitmapId(clip.bitmapId, bmpCache); // independent copy per paste
        const x = Math.round(CANVAS_W / 2 - clip.w / 2), y = Math.round(CANVAS_H / 2 - clip.h / 2);
        updLayers(currentCutId, c => ({
            layers: c.layers.map(l => l.id === layerId ? { ...l, strokes: [...l.strokes, { id: Date.now(), tool: 'paste', bitmapId, x, y, w: clip.w, h: clip.h }] } : l)
        }));
    };

    const handleSetTool = (newTool) => {
        if (selection) return;
        if (textEdit) return;
        // Switching tools mid-curve commits it automatically.
        if (curveAnchorsRef.current && newTool !== 'ruler') commitCurve();
        setTool(newTool);
    };

    useEffect(() => {
        if (isDrawing.current || isDraggingOrResizingRef.current || selectionDragRef.current) return;
        if (isUndoRedoRef.current) { isUndoRedoRef.current = false; return; }
        recordHistoryRef.current({ cuts, audioData, numTracks });
    }, [cuts, audioData, numTracks]);

    // The one place history is written. It was two copies of the same arithmetic, one of which
    // had the limit inlined as a bare 80 - the kind of pair where only one gets fixed.
    const recordHistory = (snapshot) => {
        const r = pushSnapshot(historyRef.current, historyIndexRef.current, snapshot);
        if (!r.changed) return;
        historyRef.current = r.history;
        historyIndexRef.current = r.index;
    };
    // The recording effect reaches it through a ref, the way paintFrame and the prefetch already
    // do: naming the function in the dependency list would re-run the effect on every render,
    // since it is rebuilt each time.
    recordHistoryRef.current = recordHistory;

    const applyHistory = (snap) => {
        const s = JSON.parse(JSON.stringify(snap));
        isUndoRedoRef.current = true;
        dispatchCuts(replaceCuts(s.cuts));
        setAudioData(s.audioData ?? null);
        setNumTracks(s.numTracks ?? 2);
    };
    const stepHistory = (dir) => {
        const r = step(historyRef.current, historyIndexRef.current, dir);
        if (!r) return;                       // already at that end
        historyIndexRef.current = r.index;
        applyHistory(r.snapshot);
    };
    const globalUndo = () => stepHistory(-1);
    const globalRedo = () => stepHistory(1);

    // The ruler runs to the content plus a tail of empty room to drag into, and never less than
    // TIMELINE_MIN_SPAN - a music video is three to five minutes, so a timeline that stops at two
    // leaves nowhere to place anything before the audio is loaded.
    const maxTime = Math.max(TIMELINE_MIN_SPAN, audioData?.endTime ?? audioDuration, videoOverlay?.endTime ?? 0, ...cuts.map(c => c.endTime)) + TIMELINE_TAIL_PAD;
    // Actual content bounds (where cuts/audio live) — playback & loop run between these,
    // not out to maxTime (which has empty padding for the timeline ruler).
    const contentEnd = Math.max(0, audioData?.endTime ?? 0, videoOverlay?.endTime ?? 0, ...cuts.map(c => c.endTime));
    const contentStart = (cuts.length || videoOverlay) ? Math.max(0, Math.min(videoOverlay?.startTime ?? Infinity, ...cuts.map(c => c.startTime), audioData?.startTime ?? Infinity)) : 0;
    // Parts (scenes): cuts grouped by partId. Each video import is one part; cuts can also be
    // grouped manually. Selecting a part scopes playback (and dims the rest) to it.
    const parts = derivePartsFrom(cuts, tr('파트'));
    const activePart = activePartId ? parts.find(p => p.id === activePartId) : null;
    // Playback runs within the active part when one is selected, else across all content.
    const playStart = activePart ? activePart.start : contentStart;
    const playEnd = activePart ? activePart.end : contentEnd;

    useEffect(() => {
        const h = (e) => {
            if (fileMenuRef.current && !fileMenuRef.current.contains(e.target)) setShowFileMenu(false);
            if (mediaMenuRef.current && !mediaMenuRef.current.contains(e.target)) setShowMediaMenu(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            // Tab hides every panel so the canvas is alone on screen, and restores exactly what was
            // open before. Plain Tab only: Ctrl/Alt/Shift+Tab stay with the browser.
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                toggleAllPanelsRef.current?.();
                return;
            }
            // User-defined shortcuts first; the conventional Ctrl+Z / Ctrl+Y combinations are
            // left in place below.
            const hit = matchShortcut(keymap, keyOf(e));
            if (hit) {
                e.preventDefault();
                if (hit === 'undo') globalUndo();
                else if (hit === 'redo') globalRedo();
                else if (hit === 'zoomIn') zoomCanvas(1.25);
                else if (hit === 'zoomOut') zoomCanvas(1 / 1.25);
                else if (hit === 'resetView') resetView();
                else if (hit === 'brushUp') { const s = tool === 'eraser' ? eraserSize : brushSize; const n = Math.min(200, Math.round(s * 1.25) + 1); tool === 'eraser' ? setEraserSize(n) : setBrushSize(n); }
                else if (hit === 'brushDown') { const s = tool === 'eraser' ? eraserSize : brushSize; const n = Math.max(1, Math.round(s / 1.25)); tool === 'eraser' ? setEraserSize(n) : setBrushSize(n); }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); doSave(false); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); globalUndo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); globalRedo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') { if (currentCutId) { e.preventDefault(); handleCopyCut(currentCutId); } }
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') { if (copiedCut) { e.preventDefault(); handlePasteCut(); } }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { if (currentCutId) { e.preventDefault(); handleDuplicateCut(currentCutId); } }
            if (e.key === 'Escape') { if (selection) { e.preventDefault(); cancelSelection(); } }
            if (e.key === 'Enter') { if (selection) { e.preventDefault(); commitSelection(); } }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !selection && !textEdit && currentCutId) { e.preventDefault(); handleDeleteCut(currentCutId); }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [cuts, currentCutId, copiedCut, selection, keymap, tool, brushSize, eraserSize]);

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
            const active = cuts.filter(c => currentTime >= c.startTime && currentTime < c.endTime);
            if (active.length) { const top = active.reduce((p, c) => p.track > c.track ? p : c); if (top.id !== currentCutId) setCurrentCutId(top.id); }
        }
    }, [currentTime, isPlaying]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        if (!isPlaying) { if (audioRef.current) audioRef.current.pause(); cancelAnimationFrame(reqRef.current); return; }
        // Export must record at real time; preview honors the chosen playback speed.
        const rate = isExporting.current ? 1 : playbackRate;
        const audio = audioRef.current;
        if (audio) audio.playbackRate = rate;
        let last = performance.now();
        let t = currentTimeRef.current;
        let lastUiSync = 0, lastPrefetch = 0;
        const audible = () => audio && audioUrl && (!audioData || (t >= audioData.startTime && t < audioData.endTime));
        // Kick audio once, seeking only at the start — not every frame (per-frame seeks stutter).
        if (audio && audioUrl) {
            if (audible()) { const exp = audioData ? (t - audioData.startTime) + audioData.offset : t; if (Math.abs(audio.currentTime - exp) > 0.05) audio.currentTime = exp; audio.play().catch(() => { }); }
        }
        // Video overlay follows the clock (audio stays the master). Seek only on real drift so the
        // browser's native video decode plays smoothly instead of stuttering on per-frame seeks.
        const vid = videoElRef.current;
        if (vid && videoOverlay) vid.playbackRate = rate;
        const syncVideo = (tt, forceSeek) => {
            if (!vid || !videoOverlay) return;
            if (tt >= videoOverlay.startTime && tt < videoOverlay.endTime) {
                const exp = (tt - videoOverlay.startTime) + videoOverlay.offset;
                if (forceSeek || Math.abs(vid.currentTime - exp) > 0.2) { try { vid.currentTime = exp; } catch { } }
                if (vid.paused) vid.play().catch(() => { });
            } else if (!vid.paused) vid.pause();
        };
        syncVideo(t, true);
        const finish = (end) => { isPlayingRef.current = false; setIsPlaying(false); if (audio) audio.pause(); if (vid) vid.pause(); setCurrentTime(end); currentTimeRef.current = end; paintFrameRef.current?.(end, false); };
        const step = (now) => {
            if (!isPlayingRef.current) return;
            const dt = (now - last) / 1000; last = now;
            // A scrub while playing drops a target time here; jump to it and re-seek audio this frame.
            if (seekRef.current != null) {
                t = seekRef.current; seekRef.current = null;
                if (audio && audioUrl) { const exp = audioData ? Math.max(0, (t - audioData.startTime) + audioData.offset) : t; try { audio.currentTime = exp; } catch { } }
                syncVideo(t, true);
                currentTimeRef.current = t;
                paintFrameRef.current?.(t, true);
                if (playheadRef.current) playheadRef.current.style.left = `${t * pps + 60}px`;
                reqRef.current = requestAnimationFrame(step);
                return;
            }
            // Audio is the master clock while it's sounding: read its time so A/V never drift and
            // we never seek it mid-play. Fall back to wall-clock accumulation otherwise.
            if (audio && audioUrl && audible()) {
                if (audio.paused) { const exp = audioData ? (t - audioData.startTime) + audioData.offset : t; audio.currentTime = exp; audio.play().catch(() => { }); }
                t = audioData ? audioData.startTime + (audio.currentTime - audioData.offset) : audio.currentTime;
            } else {
                if (audio && !audio.paused) audio.pause();
                t += dt * rate;
            }
            syncVideo(t, false);
            if (isExporting.current && t >= exportEndRef.current) {
                if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
                isExporting.current = false; finish(t); return;
            }
            const endAt = isExporting.current ? maxTime : playEnd;
            if (t >= endAt) {
                if (loopPlay && !isExporting.current) {
                    t = playStart;
                    if (audio && audioUrl) { audio.currentTime = audioData ? Math.max(0, (playStart - audioData.startTime) + audioData.offset) : playStart; if (audible()) audio.play().catch(() => { }); }
                } else { finish(endAt); return; }
            }
            currentTimeRef.current = t;
            paintFrameRef.current?.(t, true);                                   // 60fps imperative canvas
            if (playheadRef.current) playheadRef.current.style.left = `${t * pps + 60}px`; // 60fps imperative playhead
            if (now - lastPrefetch > 120) { lastPrefetch = now; prefetchRef.current?.(t, true); } // decode ahead of the REAL playhead
            if (now - lastUiSync > 200) { lastUiSync = now; setCurrentTime(t); } // ~5Hz React sync — keep re-renders off the rAF thread so prefetch keeps up
            reqRef.current = requestAnimationFrame(step);
        };
        reqRef.current = requestAnimationFrame(step);
        return () => cancelAnimationFrame(reqRef.current);
    }, [isPlaying, maxTime, audioUrl, audioData, loopPlay, playStart, playEnd, playbackRate, pps, videoOverlay]);

    useEffect(() => { if (!isPlaying) currentTimeRef.current = currentTime; }, [currentTime, isPlaying]);

    useEffect(() => {
        if (!isPlaying && audioRef.current && audioUrl && Math.abs(audioRef.current.currentTime - currentTime) > 0.1)
            audioRef.current.currentTime = currentTime;
    }, [currentTime, isPlaying, audioUrl]);
    // Paused: seek the overlay video to the scrubbed time so the canvas shows that frame (onseeked repaints).
    useEffect(() => {
        if (isPlaying) return;
        const v = videoElRef.current; if (!v || !videoOverlay) return;
        if (currentTime >= videoOverlay.startTime && currentTime < videoOverlay.endTime) {
            const exp = (currentTime - videoOverlay.startTime) + videoOverlay.offset;
            if (Math.abs(v.currentTime - exp) > 0.03) { try { v.currentTime = exp; } catch { } }
        }
    }, [currentTime, isPlaying, videoOverlay]);

    useEffect(() => {
        if (!splitter) return;
        const mv = (e) => {
            // Relative to grab point so the panel doesn't jump on first move (precise drag).
            if (splitter.type === 'panel') {
                // A left-docked panel grows as the pointer moves right; a right-docked one is the
                // mirror image, so the sign follows the side it is docked to.
                const delta = splitter.side === 'left' ? (e.clientX - splitter.startX) : (splitter.startX - e.clientX);
                const w = Math.max(120, Math.min(640, splitter.startW + delta));
                if (splitter.id === 'color') setColorW(w);
                else if (splitter.id === 'tools') setLeftW(w);
                else setRightW(w);
            }
            else if (splitter.type === 'right') setRightW(Math.max(150, Math.min(640, splitter.startW + (splitter.startX - e.clientX))));
            else if (splitter.type === 'left') setLeftW(Math.max(56, Math.min(420, splitter.startW + (e.clientX - splitter.startX))));
            else if (splitter.type === 'color') setColorW(Math.max(150, Math.min(520, splitter.startW + (e.clientX - splitter.startX))));
            else if (splitter.type === 'bottom') setTimelineH(Math.max(100, Math.min(600, splitter.startH + (splitter.startY - e.clientY))));
        };
        const up = () => setSplitter(null);
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    }, [splitter]);

    // Zoom the timeline about a screen x (cursor), keeping the time under it fixed. The scroll
    // adjustment is deferred to a layout effect so it runs after the new width is laid out.
    const zoomTimelineAt = (clientX, factor) => {
        const el = timelineRef.current; if (!el) return;
        const localX = clientX - el.getBoundingClientRect().left;
        setPps(prev => {
            const next = Math.max(10, Math.min(300, prev * factor));
            if (next === prev) return prev;
            const time = (el.scrollLeft + localX - 60) / prev;
            pendingTlScrollRef.current = time * next + 60 - localX;
            return next;
        });
    };
    useLayoutEffect(() => {
        if (pendingTlScrollRef.current != null && timelineRef.current) {
            timelineRef.current.scrollLeft = Math.max(0, pendingTlScrollRef.current);
            pendingTlScrollRef.current = null;
        }
    }, [pps]);
    useEffect(() => {
        const t = timelineRef.current; if (!t) return;
        // Plain wheel over the timeline zooms about the cursor (Shift+wheel = horizontal scroll).
        const h = (e) => {
            if (e.shiftKey) return; // let shift-wheel scroll horizontally
            e.preventDefault();
            zoomTimelineAt(e.clientX, e.deltaY > 0 ? 0.9 : 1.1);
        };
        t.addEventListener('wheel', h, { passive: false });
        return () => t.removeEventListener('wheel', h);
    }, []);

    // Two-finger pinch-zoom on the timeline, intercepted in the CAPTURE phase so it works
    // even over cut blocks (which stop propagation / capture the pointer for dragging).
    useEffect(() => {
        const el = timelineRef.current;
        if (!el) return;
        const pts = new Map();
        let pinch = null;
        const down = (e) => {
            if (e.pointerType !== 'touch') return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2) {
                const [a, b] = [...pts.values()];
                const rect = el.getBoundingClientRect();
                const contentX = (a.x + b.x) / 2 - rect.left + el.scrollLeft - 60;
                pinch = { startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startPps: ppsRef.current, anchorTime: Math.max(0, contentX / ppsRef.current) };
                e.preventDefault(); e.stopPropagation();
            }
        };
        const move = (e) => {
            if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size >= 2 && pinch) {
                const [a, b] = [...pts.values()];
                const np = Math.max(10, Math.min(300, pinch.startPps * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.startDist)));
                setPps(np);
                const rect = el.getBoundingClientRect();
                el.scrollLeft = Math.max(0, pinch.anchorTime * np + 60 - ((a.x + b.x) / 2 - rect.left));
                e.preventDefault(); e.stopPropagation();
            }
        };
        const up = (e) => { if (e.pointerType !== 'touch') return; pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
        const opt = { capture: true, passive: false };
        el.addEventListener('pointerdown', down, opt);
        el.addEventListener('pointermove', move, opt);
        el.addEventListener('pointerup', up, opt);
        el.addEventListener('pointercancel', up, opt);
        return () => {
            el.removeEventListener('pointerdown', down, opt);
            el.removeEventListener('pointermove', move, opt);
            el.removeEventListener('pointerup', up, opt);
            el.removeEventListener('pointercancel', up, opt);
        };
    }, []);

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
                    setAudioData(prev => {
                        if (!prev) return prev;
                        if (resizingData.edge === 'left') { const ns = Math.max(0, Math.min(i1 - 0.1, i0 + dt)); return { ...prev, startTime: ns, offset: Math.max(0, (resizingData.initialOffset ?? 0) + (ns - i0)) }; }
                        return { ...prev, endTime: Math.max(i0 + 0.1, i1 + dt) };
                    });
                    return;
                }
                // The geometry is in cutOps and unit tested; only the guide line is a side
                // effect, and it is done out here. Setting state from inside an updater looks
                // harmless but React invokes updaters twice in StrictMode, and a reducer that is
                // not pure is a reducer that cannot be reasoned about or replayed. resizeCut
                // works from the edges the drag started at plus the delta, so reading the
                // document from liveRef gives the same answer as the updater's argument would.
                const r = resizeCut(liveRef.current.cuts, { cutId: resizingData.cutId, edge: resizingData.edge, initialStart: i0, initialEnd: i1 }, dt, pps);
                setSnapLinePos(r.snapAt == null ? null : r.snapAt * pps + 60);
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
                    setAudioData(prev => { if (!prev) return prev; const ns = Math.max(0, draggingCutData.initialStart + dt); return { ...prev, startTime: ns, endTime: ns + (prev.endTime - prev.startTime) }; }); return;
                }
                if (draggingCutData.cutId === 'video') {
                    setVideoOverlay(prev => { if (!prev) return prev; const ns = Math.max(0, draggingCutData.initialStart + dt); return { ...prev, startTime: ns, endTime: ns + (prev.endTime - prev.startTime) }; }); return;
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
                setSnapLinePos(r.snapAt == null ? null : r.snapAt * pps + 60);
                dispatchCuts(replaceCuts(r.cuts));
            }
        };
        const up = () => {
            isDraggingOrResizingRef.current = false;
            clearTimeout(cutDragTimerRef.current);
            cutDragArmedRef.current = false;
            setResizingData(null); setDraggingCutData(null); setSnapLinePos(null);
            // liveRef holds the current document precisely so this does not have to reach for
            // a state setter to read it, and the ref keeps the effect's dependency list honest.
            const lv = liveRef.current;
            recordHistoryRef.current({ cuts: lv.cuts, audioData: lv.audioData, numTracks: lv.numTracks });
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    }, [resizingData, draggingCutData, pps, numTracks]);

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
            history: historyRef.current,
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
        const usedIds = new Set();
        cuts.forEach(c => c.layers.forEach(l => safeArray(l.strokes).forEach(s => { if (s.bitmapId) usedIds.add(s.bitmapId); })));
        const bitmaps = {};
        const compressed = []; // ids stored as a whole encoded image (video frames) — keep compressed on restore
        const assets = [];     // externalized frame manifest [{id, ext}] when assetSink is used
        const cache = dataUrlCacheRef.current;
        for (const id of usedIds) {
            const entry = bitmapStoreRef.current.get(id);
            if (!entry) continue;
            // Video frames are held as a Blob (preferred) or legacy dataURL.
            if (entry.blob || entry.url) {
                const ext = entry.ext || (entry.url?.match(/^data:image\/(\w+)/)?.[1]) || 'webp';
                if (assetSink) { assets.push({ id, ext, w: entry.w || 0, h: entry.h || 0 }); assetSink.push({ id, blob: entry.blob, url: entry.url, ext }); }
                else if (blobsOk && entry.blob) { bitmaps[id] = entry.blob; compressed.push(id); }
                else { bitmaps[id] = entry.blob ? await blobToDataURL(entry.blob) : entry.url; compressed.push(id); }
                continue;
            }
            if (!entry.imageData) continue;
            const c = cache.get(id);
            if (c && c.imageData === entry.imageData) { bitmaps[id] = c.url; continue; }
            const url = imageDataToDataURL(entry.imageData);
            cache.set(id, { imageData: entry.imageData, url });
            bitmaps[id] = url;
        }
        const out = {
            version: '1.5', appName: 'EasyMVMaker', savedAt: new Date().toISOString(), numTracks, onionPrev, onionNext, pps, bitmaps, compressedBitmaps: compressed,
            canvas: { w: CANVAS_W, h: CANVAS_H },
            cuts: cuts.map(c => ({ ...c, layers: c.layers.map(l => ({ ...l, redoStrokes: [] })) }))
        };
        if (assetSink && assets.length) out.assets = assets;
        // Save the audio "with the music". For server save (assetSink) the audio goes out as a
        // separate binary asset — embedding it as base64 (often tens of MB) is the main remaining
        // OOM source. For local/autosave it's embedded so the file stays self-contained.
        if (includeAudio && audioB64Ref.current && audioData) {
            const meta = { name: audioFile?.name || tr('오디오'), startTime: audioData.startTime, endTime: audioData.endTime, offset: audioData.offset, duration: audioDuration };
            if (assetSink) {
                const ext = (audioB64Ref.current.match(/^data:audio\/([\w.-]+)/)?.[1] || 'mp3').replace('mpeg', 'mp3').replace('x-m4a', 'm4a');
                assetSink.push({ id: '__audio__', url: audioB64Ref.current, ext });
                out.audio = { ...meta, asset: true, ext };
            } else {
                out.audio = { ...meta, dataUrl: audioB64Ref.current };
            }
        }
        // Video overlay track (like audio): externalize the video blob for server saves; store the
        // Blob directly for IndexedDB; embed as dataURL only for a self-contained .emv file.
        if (videoOverlay && videoBlobRef.current) {
            const meta = { name: videoOverlay.name, startTime: videoOverlay.startTime, endTime: videoOverlay.endTime, offset: videoOverlay.offset, duration: videoOverlay.duration, w: videoOverlay.w, h: videoOverlay.h, cuts: videoOverlay.cuts, cutStart: videoOverlay.cutStart, cutOffset: videoOverlay.cutOffset };
            const ext = (videoBlobRef.current.type.match(/video\/([\w.-]+)/)?.[1] || 'mp4').replace('x-matroska', 'mkv').replace('quicktime', 'mov');
            if (assetSink) { assetSink.push({ id: '__video__', blob: videoBlobRef.current, ext }); out.video = { ...meta, asset: true, ext }; }
            else if (blobsOk) { out.video = { ...meta, blob: videoBlobRef.current }; }
            else { out.video = { ...meta, dataUrl: await blobToDataURL(videoBlobRef.current) }; }
        }
        return out;
    };
    const restore = async (data, assetBase = null, label = tr('프로젝트 여는 중')) => {
        if (data.appName !== 'EasyMVMaker') { alert(tr('올바른 .emv 파일이 아닙니다.')); return; }
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
        try {
        // Externalized frame assets (server projects): fetch one at a time and keep as a Blob
        // (off-heap). Bounded memory — one frame in flight.
        if (assetBase && Array.isArray(data.assets)) {
            for (const a of data.assets) {
                try {
                    const blob = await (await fetch(`${assetBase}/asset/${a.id}`)).blob();
                    // Don't decode here — lazy decode on display keeps opening a big project from OOMing.
                    store.set(a.id, { imageData: null, imageBitmap: null, blob, ext: a.ext, w: a.w || 0, h: a.h || 0 });
                } catch { }
                tick();
            }
        }
        if (data.bitmaps) {
            const compressedSet = new Set(data.compressedBitmaps || []);
            const entries = await Promise.all(Object.entries(data.bitmaps).map(async ([id, val]) => {
                try {
                    // Frames may arrive as a Blob (IndexedDB autosave) or a dataURL (embedded .emv).
                    // Keep them as a Blob (off-heap) and decode lazily. Drawing layers (small PNG
                    // dataURLs, not flagged compressed) become editable ImageData up front.
                    if (val instanceof Blob) {
                        return [id, { imageData: null, imageBitmap: null, blob: val, ext: (val.type.match(/image\/(\w+)/)?.[1]) || 'webp' }];
                    }
                    if (compressedSet.has(id) || /^data:image\/(webp|jpeg)/.test(val)) {
                        const blob = await (await fetch(val)).blob();
                        return [id, { imageData: null, imageBitmap: null, blob, ext: (blob.type.match(/image\/(\w+)/)?.[1]) || 'webp' }];
                    }
                    const imageData = await dataURLToImageData(val);
                    let imageBitmap = null;
                    try { imageBitmap = await createImageBitmap(imageData); } catch { }
                    return [id, { imageData, imageBitmap }];
                } catch { return null; } finally { tick(); }
            }));
            entries.forEach(e => { if (e) store.set(e[0], e[1]); });
        }
        // Older files are brought up to the current shape in projectFormat, where the renames and
        // added fields are written down and tested.
        dispatchCuts(replaceCuts(migrateCuts(data.cuts)));
        setActivePartId(null);
        const s = projectSettings(data);
        if (s.canvas) setCanvasSize(s.canvas);
        setNumTracks(s.numTracks); setCurrentCutId(s.currentCutId); setCurrentTime(0);
        setOnionPrev(s.onionPrev); setOnionNext(s.onionNext); setPps(s.pps); setExpandedCuts(new Set());
        setCopiedCut(null); // clipboard may reference bitmaps from the old project
        setLayerCanvasCache({}); // Clear cache on new project
        // Restore audio: embedded (dataUrl) or externalized as a server asset. Either way we end
        // up with a dataURL in audioB64Ref so a later LOCAL save stays self-contained.
        let audioDataUrl = data.audio?.dataUrl || null;
        if (!audioDataUrl && data.audio?.asset && assetBase) {
            try {
                const blob = await (await fetch(`${assetBase}/asset/__audio__`)).blob();
                audioDataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
            } catch { }
        }
        if (audioDataUrl) {
            audioB64Ref.current = audioDataUrl;
            setAudioFile({ name: data.audio.name || tr('오디오') });
            setAudioUrl(audioDataUrl);
            setAudioDuration(data.audio.duration || 30);
            setAudioData({ startTime: data.audio.startTime ?? 0, endTime: data.audio.endTime ?? (data.audio.duration || 30), offset: data.audio.offset ?? 0 });
            if (audioRef.current) audioRef.current.src = audioDataUrl;
        } else {
            audioB64Ref.current = null;
            if (audioRef.current) { audioRef.current.pause(); try { audioRef.current.removeAttribute('src'); audioRef.current.load(); } catch { } }
            setAudioFile(null); setAudioUrl(null); setAudioData(null);
        }
        // Restore the video overlay track (Blob from IDB / server asset / embedded dataURL).
        let videoBlob = null;
        if (data.video?.blob instanceof Blob) videoBlob = data.video.blob;
        else if (data.video?.asset && assetBase) { try { videoBlob = await (await fetch(`${assetBase}/asset/__video__`)).blob(); } catch { } }
        else if (data.video?.dataUrl) { try { videoBlob = await (await fetch(data.video.dataUrl)).blob(); } catch { } }
        if (videoBlob) {
            videoBlobRef.current = videoBlob;
            const url = URL.createObjectURL(videoBlob);
            const v = videoElRef.current;
            if (v) { v.muted = true; v.playsInline = true; v.src = url; v.onseeked = () => setFrameDecodeTick(t => t + 1); v.onloadedmetadata = () => { try { v.currentTime = data.video.offset || 0; } catch { } }; }
            setVideoOverlay({ name: data.video.name || tr('영상'), startTime: data.video.startTime ?? 0, endTime: data.video.endTime ?? (data.video.duration || 0), offset: data.video.offset ?? 0, duration: data.video.duration || 0, w: data.video.w || 0, h: data.video.h || 0, cuts: data.video.cuts, cutStart: data.video.cutStart, cutOffset: data.video.cutOffset });
        } else {
            videoBlobRef.current = null; setVideoOverlay(null);
            if (videoElRef.current) { try { videoElRef.current.pause(); videoElRef.current.removeAttribute('src'); videoElRef.current.load(); } catch { } }
        }
        } finally { setLoadProgress(null); }
    };
    const doSave = async (asNew = false) => {
        const json = JSON.stringify(await buildData(), null, 2);
        if ('showSaveFilePicker' in window && (asNew || !fileHandleRef.current)) {
            try { const h = await window.showSaveFilePicker({ suggestedName: 'project.emv', types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] }); fileHandleRef.current = h; const w = await h.createWritable(); await w.write(json); await w.close(); return; } catch (e) { if (e.name === 'AbortError') return; }
        } else if ('showSaveFilePicker' in window && fileHandleRef.current) {
            try { const w = await fileHandleRef.current.createWritable(); await w.write(json); await w.close(); return; } catch (e) { }
        }
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: 'project.emv' });
        a.click();
    };
    // A large .emv looks frozen during the read and parse alone, so that stretch shows just a
    // label with an indeterminate bar (total 0); restore then takes over with real progress.
    const readAndRestore = async (getText) => {
        setLoadProgress({ label: tr('파일 읽는 중'), done: 0, total: 0 });
        try {
            const text = await getText();
            setLoadProgress({ label: tr('파일 분석 중'), done: 0, total: 0 });
            await new Promise(r => setTimeout(r, 0)); // give the bar a chance to paint once
            const data = JSON.parse(text);
            await restore(data);
        } catch (err) {
            setLoadProgress(null);
            alert(tr('파일 오류: ') + err.message);
        }
    };
    const doOpen = async () => {
        if ('showOpenFilePicker' in window) {
            try {
                const [h] = await window.showOpenFilePicker({ types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] });
                fileHandleRef.current = h;
                await readAndRestore(async () => (await h.getFile()).text());
                return;
            } catch (e) { if (e.name === 'AbortError') return; }
        }
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.emv';
        inp.onchange = e => {
            const f = /** @type {HTMLInputElement} */ (e.target).files[0]; if (!f) return;
            readAndRestore(() => new Promise((res, rej) => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.onerror = rej; r.readAsText(f); }));
        };
        inp.click();
    };
    const resetToEmpty = () => {
        fileHandleRef.current = null;
        bitmapStoreRef.current.clear();
        dispatchCuts(replaceCuts([{ id: 1, name: 'Cut 1', startTime: 0, endTime: 1, track: 0, layers: [mkLayer(1)], activeLayerId: 1, texts: [] }]));
        setNumTracks(2); setCurrentCutId(1); setCurrentTime(0); setExpandedCuts(new Set());
        setCopiedCut(null); setSelectedCutIds(new Set()); setActivePartId(null);
        setLayerCanvasCache({});
        serverIdRef.current = null; serverNameRef.current = '';
        if (audioRef.current) { audioRef.current.pause(); try { audioRef.current.removeAttribute('src'); audioRef.current.load(); } catch { } }
        audioB64Ref.current = null; setAudioFile(null); setAudioUrl(null); setAudioData(null);
        videoBlobRef.current = null; setVideoOverlay(null); setSceneCfg(null);
        if (videoElRef.current) { try { videoElRef.current.pause(); videoElRef.current.removeAttribute('src'); videoElRef.current.load(); } catch { } }
    };
    const doNew = () => {
        if (!window.confirm(tr('새 프로젝트? 저장되지 않은 내용은 사라집니다.'))) return;
        resetToEmpty();
    };

    // --- Document tabs (multiple projects open at once, Clip Studio / SAI style) ---
    // Each tab keeps a full in-memory document snapshot (buildData with Blobs, so no base64 cost).
    // Switching = snapshot the current tab, then restore the target's snapshot.
    const [tabs, setTabs] = useState([{ id: 't1', name: tr('프로젝트 1') }]);
    const [activeTabId, setActiveTabId] = useState('t1');
    const tabDocsRef = useRef({}); // id -> doc snapshot (null = fresh/empty)
    const tabBusyRef = useRef(false);
    const snapshotActiveTab = async () => { try { tabDocsRef.current[activeTabId] = await buildData(true, null, true); } catch { } };
    const switchTab = async (id) => {
        if (id === activeTabId || tabBusyRef.current) return;
        tabBusyRef.current = true;
        try {
            await snapshotActiveTab();
            setActiveTabId(id);
            const doc = tabDocsRef.current[id];
            if (doc) await restore(doc); else resetToEmpty();
        } finally { tabBusyRef.current = false; }
    };
    const newTab = async () => {
        if (tabBusyRef.current) return; tabBusyRef.current = true;
        try {
            await snapshotActiveTab();
            const id = 't' + Date.now().toString(36);
            setTabs(p => { const n = [...p, { id, name: tr('프로젝트 ') + (p.length + 1) }]; return n; });
            tabDocsRef.current[id] = null;
            setActiveTabId(id);
            resetToEmpty();
        } finally { tabBusyRef.current = false; }
    };
    const closeTab = async (id) => {
        if (tabs.length <= 1) { if (window.confirm(tr('마지막 탭입니다. 내용을 비울까요?'))) { resetToEmpty(); tabDocsRef.current[id] = null; } return; }
        if (!window.confirm(tr('이 탭을 닫을까요? 저장하지 않은 내용은 사라집니다.'))) return;
        delete tabDocsRef.current[id];
        const rest = tabs.filter(t => t.id !== id);
        setTabs(rest);
        if (id === activeTabId) {
            const target = rest[rest.length - 1];
            setActiveTabId(target.id);
            const doc = tabDocsRef.current[target.id];
            if (doc) await restore(doc); else resetToEmpty();
        }
    };

    // --- Server-side project storage (separate from local download / .emv file) ---
    const apiFetch = async (url, opts) => {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    };
    // Upload externalized frame assets one at a time (binary, no base64) so peak memory is a
    // single frame — this is what keeps big/original-quality projects from OOMing on save.
    const uploadAssets = async (id, assetSink) => {
        const total = assetSink.length;
        for (let i = 0; i < total; i++) {
            const a = assetSink[i];
            // Prefer the Blob (uploads directly, no decode); fall back to a legacy dataURL.
            const blob = a.blob || await (await fetch(a.url)).blob();
            const res = await fetch(`/api/projects/${id}/asset/${a.id}?ext=${encodeURIComponent(a.ext)}`, {
                method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
            });
            if (!res.ok) throw new Error(tr('프레임 업로드 실패 ({0}/{1})', i + 1, total));
            if (total > 12) setLoadProgress({ label: tr('서버에 올리는 중'), done: i + 1, total });
        }
    };
    const doServerSave = async (forceNew = false) => {
        setServerBusy(true);
        try {
            const assetSink = [];
            const data = await buildData(true, assetSink); // frames/audio externalized → small JSON
            let id = (!forceNew && serverIdRef.current) ? serverIdRef.current : null;
            let name = serverNameRef.current || 'Untitled';
            if (!id) {
                name = window.prompt(tr('서버에 저장할 프로젝트 이름:'), serverNameRef.current || 'MV Project');
                if (!name) return;
                // Create the record first (just to get an id); the real data is committed LAST.
                const r = await apiFetch('/api/projects', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, data: { appName: 'EasyMVMaker', pending: true } }),
                });
                id = r.id; serverIdRef.current = r.id; serverNameRef.current = r.name;
            }
            // Upload assets BEFORE writing the manifest, so an interrupted save never leaves the
            // project JSON pointing at frames/audio that aren't on disk (which caused 404s + blanks).
            if (assetSink.length) await uploadAssets(id, assetSink);
            await apiFetch(`/api/projects/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data }),
            });
            alert(tr('서버에 저장했습니다.'));
        } catch (e) {
            console.error('[import]', e);
            setAppError(tr('서버 저장 실패: ') + e.message + '\n' + tr('(API 서버가 실행 중인지 확인하세요. 큰 프로젝트는 저장에 시간이 걸립니다.)'));
        } finally { setServerBusy(false); setLoadProgress(null); }
    };
    const openServerList = async () => {
        try { setServerProjects(await apiFetch('/api/projects')); }
        catch (e) { alert(tr('서버 목록을 불러오지 못했습니다: ') + e.message + '\n' + tr('(API 서버 실행 확인: npm run dev)')); }
    };
    const doServerOpen = async (id, name) => {
        try {
            const data = await apiFetch(`/api/projects/${id}`);
            await restore(data, `/api/projects/${id}`); // fetch externalized frame assets from this project
            serverIdRef.current = id; serverNameRef.current = name || '';
            setServerProjects(null);
        } catch (e) { alert(tr('서버에서 열기 실패: ') + e.message); }
    };
    const doServerDelete = async (id) => {
        if (!window.confirm(tr('이 프로젝트를 서버에서 삭제할까요?'))) return;
        try {
            await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
            if (serverIdRef.current === id) { serverIdRef.current = null; serverNameRef.current = ''; }
            openServerList();
        } catch (e) { alert(tr('삭제 실패: ') + e.message); }
    };

    // --- Rotating server backups of the autosave (a safety net separate from Save) ---------
    // The local IndexedDB autosave protects against a crash/refresh; this protects against the
    // browser profile itself being lost or a project being overwritten. Snapshots are kept as
    // separate timestamped files server-side and rotated, so you can roll back.
    const getBackupKey = () => {
        if (serverIdRef.current) return serverIdRef.current; // group under the server project if there is one
        if (!backupKeyRef.current) {
            let k = null;
            try { k = localStorage.getItem('mv_backup_key'); } catch { }
            if (!k) {
                k = 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                try { localStorage.setItem('mv_backup_key', k); } catch { }
            }
            backupKeyRef.current = k;
        }
        return backupKeyRef.current;
    };
    // Skip frames the server already has — otherwise every backup of a video project would
    // re-upload hundreds of MB. Assets are keyed by bitmapId, so presence means identical.
    const uploadAssetsDeduped = async (key, assetSink, onProgress) => {
        let have = new Set();
        try { have = new Set((await apiFetch(`/api/projects/${key}/assets`)).map(String)); } catch { }
        const todo = assetSink.filter(a => !have.has(String(a.id)));
        for (let i = 0; i < todo.length; i++) {
            const a = todo[i];
            const blob = a.blob || await (await fetch(a.url)).blob();
            const res = await fetch(`/api/projects/${key}/asset/${a.id}?ext=${encodeURIComponent(a.ext)}`, {
                method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
            });
            if (!res.ok) throw new Error(tr('에셋 업로드 실패 ({0}/{1})', i + 1, todo.length));
            setBackupProg({ done: i + 1, total: todo.length });
            onProgress?.(i + 1, todo.length);
        }
        return todo.length;
    };
    // The automatic backup runs itself every five minutes, so it must never block the screen.
    // It used to raise a full-screen progress overlay, which stopped all work while it ran.
    const doServerBackup = async (silent = true) => {
        if (!serverAvailable || backupBusyRef.current) return;
        backupBusyRef.current = true; setBackupBusy(true); setBackupProg(null);
        try {
            const key = getBackupKey();
            const assetSink = [];
            const data = await buildData(true, assetSink); // frames and audio go out as separate assets, keeping the JSON small
            if (assetSink.length) await uploadAssetsDeduped(key, assetSink);
            await apiFetch(`/api/backups/${key}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: serverNameRef.current || localNameRef.current || tr('자동 백업'), data }),
            });
            setBackupAt(Date.now());
            if (!silent) setToast(tr('서버에 백업했습니다.'));
        } catch (e) {
            if (!silent) setAppError(tr('서버 백업 실패: ') + e.message);
        } finally { backupBusyRef.current = false; setBackupBusy(false); setBackupProg(null); }
    };
    const openBackupList = async () => {
        try { setBackupList(await apiFetch(`/api/backups/${getBackupKey()}`)); }
        catch (e) { alert(tr('백업 목록을 불러오지 못했습니다: ') + e.message); }
    };
    const doBackupRestore = async (stamp) => {
        if (!window.confirm(tr('이 백업으로 되돌릴까요? 현재 작업 내용은 사라집니다.'))) return;
        try {
            const key = getBackupKey();
            const data = await apiFetch(`/api/backups/${key}/${stamp}`);
            await restore(data, `/api/projects/${key}`); // assets come from the store under the same key
            setBackupList(null);
        } catch (e) { alert(tr('백업 복구 실패: ') + e.message); }
    };
    const doBackupDelete = async (stamp) => {
        if (!window.confirm(tr('이 백업을 삭제할까요?'))) return;
        try { await apiFetch(`/api/backups/${getBackupKey()}/${stamp}`, { method: 'DELETE' }); openBackupList(); }
        catch (e) { alert(tr('삭제 실패: ') + e.message); }
    };
    // Periodic backup. Reads the newest state through a ref: putting `cuts` in the deps would
    // restart the timer on every stroke, so it would never actually fire while you draw.
    const backupFnRef = useRef(null);
    backupFnRef.current = doServerBackup;
    useEffect(() => {
        if (!serverAvailable) return;
        const id = setInterval(() => {
            const cs = liveRef.current?.cuts || [];
            const sig = cs.length + ':' + cs.map(c => safeArray(c.layers).reduce((n, l) => n + safeArray(l.strokes).length, 0)).join(',');
            if (sig === lastBackupSigRef.current) return; // nothing changed, so skip
            lastBackupSigRef.current = sig;
            backupFnRef.current?.(true);
        }, 5 * 60 * 1000);
        return () => clearInterval(id);
    }, [serverAvailable]);

    // Ask the browser to make local storage persistent, so the IndexedDB autosave isn't
    // silently evicted under storage pressure (the main way local-only work gets lost).
    useEffect(() => { navigator.storage?.persist?.().catch(() => { }); }, []);
    // Warn before the local quota runs out — a failed autosave is otherwise invisible.
    useEffect(() => {
        let alive = true;
        const check = async () => {
            try {
                const est = await navigator.storage?.estimate?.();
                if (!est || !alive || !est.quota) return;
                setStorageInfo({ usage: est.usage || 0, quota: est.quota, pct: (est.usage || 0) / est.quota });
            } catch { }
        };
        check();
        const id = setInterval(check, 60000);
        return () => { alive = false; clearInterval(id); };
    }, []);

    // --- Local (IndexedDB) named projects — works offline / in the deployed build too ---
    const doLocalSave = async (forceNew = false) => {
        try {
            const data = await buildData(true, null, true); // IndexedDB stores frame Blobs directly
            if (!forceNew && localIdRef.current) { await saveProject(localIdRef.current, data, localNameRef.current || 'Untitled'); alert(tr('로컬에 저장했습니다.')); return; }
            const name = window.prompt(tr('로컬 저장 이름:'), localNameRef.current || 'MV Project');
            if (!name) return;
            const id = 'l_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            await saveProject(id, data, name);
            localIdRef.current = id; localNameRef.current = name;
            alert(tr('로컬에 저장했습니다.'));
        } catch (e) { alert(tr('로컬 저장 실패: ') + e.message); }
    };
    const openLocalList = async () => {
        try { setLocalProjects((await listProjects()).filter(p => p.id !== autosaveKey)); }
        catch (e) { alert(tr('로컬 목록 실패: ') + e.message); }
    };
    const doLocalOpen = async (id, name) => {
        try { const data = await loadProject(id); if (!data) { alert(tr('데이터가 없습니다.')); return; } await restore(data); localIdRef.current = id; localNameRef.current = name || ''; setLocalProjects(null); }
        catch (e) { alert(tr('로컬 열기 실패: ') + e.message); }
    };
    const doLocalDelete = async (id) => {
        if (!window.confirm(tr('이 로컬 프로젝트를 삭제할까요?'))) return;
        try { await deleteProject(id); if (localIdRef.current === id) { localIdRef.current = null; localNameRef.current = ''; } openLocalList(); }
        catch (e) { alert(tr('삭제 실패: ') + e.message); }
    };

    // Crash recovery: on first load, offer to restore the last autosaved project.
    useEffect(() => {
        let cancelled = false;
        loadAutosave().then(data => {
            if (cancelled || !data || !Array.isArray(data.cuts)) return;
            const meaningful = data.cuts.length > 1 || data.cuts.some(c =>
                safeArray(c.layers).some(l => safeArray(l.strokes).length) || safeArray(c.texts).length);
            if (!meaningful) return;
            const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : '';
            if (window.confirm(tr('이전에 자동저장된 작업이 있습니다{0}.\n복구할까요?', when ? ` (${when})` : ''))) {
                restore(data);
            }
        }).catch(() => { }).finally(() => { didRecoverRef.current = true; });
        return () => { cancelled = true; };
    }, []);

    // Probe the project-storage API once; hide server menu when absent (static host / APK).
    useEffect(() => {
        let alive = true;
        // Checking once means that if the server happened to be down when the page loaded, the
        // app stays convinced it is down for the whole session. The YouTube menu entries then
        // never render at all, so clicking does nothing and the console stays empty - which is
        // exactly how one bug here hid for so long. Re-checking periodically lets it reconnect
        // on its own once the server comes back.
        const probe = () => fetch('/api/projects', { method: 'GET' })
            .then(r => { if (alive) setServerAvailable(r.ok); })
            .catch(() => { if (alive) setServerAvailable(false); });
        probe();
        const id = setInterval(probe, 10000);
        // Re-check immediately on refocus, since starting the server and coming back is the
        // common flow.
        const onFocus = () => probe();
        window.addEventListener('focus', onFocus);
        return () => { alive = false; clearInterval(id); window.removeEventListener('focus', onFocus); };
    }, []);

    // Debounced autosave to IndexedDB so a refresh/crash never loses work.
    useEffect(() => {
        if (!didRecoverRef.current) return;
        if (isDrawing.current || isDraggingOrResizingRef.current) return;
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(async () => {
            try {
                gcBitmaps(); // reclaim orphaned bitmaps before encoding the save
                const data = await buildData(false, null, true); // IDB stores frame Blobs → cheap, low-memory
                // Swallowing an autosave failure lets the user believe their work is being saved
                // right up until they lose all of it.
                saveAutosave(data).then(() => { setAutoSavedAt(Date.now()); setAutosaveErr(null); })
                    .catch(e => setAutosaveErr(String(e?.message || e)));
            } catch (e) { setAutosaveErr(String(e?.message || e)); }
        }, 1500);
        return () => clearTimeout(autosaveTimerRef.current);
    }, [cuts, numTracks, onionPrev, onionNext, pps]);

    const handlePlayPause = () => {
        if (!isPlaying) {
            // Playback is cut-based: pressing play after the current cut (or all content) has
            // finished rewinds to the CURRENT cut's start — even with music (audio re-seeks to match).
            const cc = cuts.find(c => c.id === currentCutId);
            let anchor = cc ? cc.startTime : playStart;
            if (anchor < playStart - 0.001 || anchor >= playEnd) anchor = playStart; // keep the anchor inside the active part
            const finished = currentTime >= playEnd - 0.001 || (cc && currentTime >= cc.endTime - 0.001);
            if (finished || currentTime < anchor - 0.001 || currentTime > playEnd + 0.001) {
                setCurrentTime(anchor);
                currentTimeRef.current = anchor;
                if (audioRef.current) audioRef.current.currentTime = audioData ? Math.max(0, (anchor - audioData.startTime) + audioData.offset) : anchor;
            }
        } else {
            // Pausing: stop audio immediately (don't wait for the effect).
            isPlayingRef.current = false;
            cancelAnimationFrame(reqRef.current);
            if (audioRef.current) audioRef.current.pause();
        }
        setIsPlaying(!isPlaying);
    };
    const handleStop = () => {
        // Stop should pause at the current position (do not rewind).
        isPlayingRef.current = false;
        cancelAnimationFrame(reqRef.current);
        setIsPlaying(false);
        if (audioRef.current) {
            audioRef.current.pause();
            // Keep audio element time aligned to the current timeline position.
            audioRef.current.currentTime = currentTime;
        }
    };
    const handleAddCut = () => {
        const last = cuts[cuts.length - 1];
        const ns = last?.endTime ?? 0, trk = last?.track ?? 0;
        if (trk >= numTracks) setNumTracks(trk + 1);
        const nc = { id: Date.now(), name: `Cut ${cuts.length + 1}`, startTime: ns, endTime: ns + DEFAULT_CUT_DURATION, track: trk, layers: [mkLayer(1)], activeLayerId: 1, texts: [] };
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
    const toggleCutSettings = (id) => setExpandedCuts(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
    const toggleCutCollapse = (id) => setCollapsedCutIds(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
    const renameCut = (id, name) => dispatchCuts(updateCut(id, { name }));
    const updCutAnim = (id, patch) => dispatchCuts(setCutAnim(id, patch));
    const updLayerAnim = (cutId, layerId, patch) => dispatchCuts(setLayerAnim(cutId, layerId, patch));
    const handleAddTrack = () => setNumTracks(p => p + 1);
    const handleDeleteTrack = (i) => { if (numTracks <= 1) return; if (!window.confirm(tr('Track {0} 삭제?', i))) return; dispatchCuts(deleteTrack(i)); setNumTracks(p => p - 1); };
    // Click a cut in the list: plain = select one, Ctrl/Cmd = toggle, Shift = range (timeline order).
    const handleCutClick = (e, id) => {
        if (e.ctrlKey || e.metaKey) {
            setSelectedCutIds(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
        } else if (e.shiftKey && currentCutId) {
            const ordered = [...cuts].sort((a, b) => a.track - b.track || a.startTime - b.startTime);
            const i1 = ordered.findIndex(c => c.id === currentCutId), i2 = ordered.findIndex(c => c.id === id);
            if (i1 >= 0 && i2 >= 0) { const lo = Math.min(i1, i2), hi = Math.max(i1, i2); setSelectedCutIds(new Set(ordered.slice(lo, hi + 1).map(c => c.id))); }
        } else {
            setSelectedCutIds(new Set([id]));
        }
        setCurrentCutId(id);
    };
    const handleCopyCut = (id) => {
        // Multi-copy when several cuts are selected, else just this one.
        const ids = (selectedCutIds.size > 1 && selectedCutIds.has(id)) ? [...selectedCutIds] : [id];
        const arr = ids.map(i => cuts.find(c => c.id === i)).filter(Boolean)
            .sort((a, b) => a.track - b.track || a.startTime - b.startTime)
            .map(c => JSON.parse(JSON.stringify(c)));
        if (arr.length) setCopiedCut(arr);
    };
    // Deep-clone a cut's contents: remap layer ids to 1..N (rewriting parentId so
    // folder hierarchy survives), clone referenced bitmaps to fresh ids, copy texts.
    // Layer ids are renumbered and stroke pixels are copied - see cutClone for why both are
    // necessary. cloneBitmapId is passed in because it is the one part that touches the store.
    const cloneCutContents = (srcCut) => cloneCutContentsPure(srcCut, cloneBitmapId);

    const handlePasteCut = () => {
        if (!copiedCut) return;
        const arr = Array.isArray(copiedCut) ? copiedCut : [copiedCut];
        if (!arr.length) return;
        const src = cuts.find(c => c.id === currentCutId);
        let cursor = src ? src.endTime : (cuts.length ? Math.max(...cuts.map(c => c.endTime)) : 0);
        const trk = src ? src.track : (arr[0]?.track ?? 0);
        const baseId = Date.now();
        const made = arr.map((cc, idx) => {
            const dur = cc.endTime - cc.startTime;
            const { layers, activeLayerId, texts } = cloneCutContents(cc);
            const nc = { ...cc, id: baseId + idx, name: `${cc.name} (copy)`, startTime: cursor, endTime: cursor + dur, track: trk, layers, activeLayerId, texts };
            cursor += dur;
            return nc;
        });
        dispatchCuts(addCuts(made));
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
        const A = cuts.find(c => c.id === currentCutId);
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
            const base = Date.now();
            const newCuts = [];
            for (let i = 0; i < n; i++) {
                const img = make((i + 1) / (n + 1));
                const bitmapId = storeBitmap(img);
                const st = A.endTime + i * dur;
                newCuts.push({
                    id: base + i + 1, name: `${A.name}~${i + 1}`, startTime: st, endTime: st + dur, track: A.track,
                    layers: [{ id: 1, name: 'L1', type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [{ id: base + 1000 + i, tool: 'paste', bitmapId, x: 0, y: 0 }] }],
                    activeLayerId: 1, texts: [],
                });
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
        const newId = Date.now();
        const { layers, activeLayerId, texts } = cloneCutContents(cut);
        const nc = { id: newId, name: `${cut.name}+`, startTime: insertAt, endTime: insertAt + dur, track: cut.track, layers, activeLayerId, texts };
        dispatchCuts(insertCutsShifting(cut.track, insertAt, dur, [nc], cut.id));
        setCurrentCutId(newId);
        setCurrentTime(insertAt);
    };

    const nextLayerId = (c) => Math.max(...c.layers.map(l => l.id), 0) + 1;
    const handleAddLayer = (e, cutId) => { e.stopPropagation(); updLayers(cutId, c => { const id = nextLayerId(c); return { layers: [...c.layers, mkLayer(id)], activeLayerId: id }; }); };
    const handleAddFolder = (e, cutId) => { e.stopPropagation(); updLayers(cutId, c => { const id = nextLayerId(c); return { layers: [...c.layers, { id, name: `Folder ${id}`, type: 'folder', visible: true, collapsed: false, parentId: null }] }; }); };
    const handleDeleteLayer = (e, cutId, layerId) => {
        e.stopPropagation();
        updLayers(cutId, c => {
            const toRm = new Set([layerId]);
            const findCh = (id) => c.layers.forEach(l => { if (l.parentId === id) { toRm.add(l.id); findCh(l.id); } });
            findCh(layerId);
            let nl = c.layers.filter(l => !toRm.has(l.id));
            if (!nl.some(l => l.type === 'layer')) nl = [...nl, mkLayer(Date.now())];
            const na = toRm.has(c.activeLayerId) ? (nl.find(l => l.type === 'layer')?.id ?? null) : c.activeLayerId;
            return { layers: nl, activeLayerId: na };
        });
    };
    const handleToggleVisible = (e, cutId, layerId) => { e.stopPropagation(); updLayers(cutId, c => ({ layers: c.layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l) })); };
    const handleSetActive = (e, cutId, layerId) => {
        e.stopPropagation();
        const cut = cuts.find(c => c.id === cutId); if (!cut) return;
        const layer = cut.layers.find(l => l.id === layerId); if (!layer || layer.type === 'folder') return;
        dispatchCuts(updateCut(cutId, { activeLayerId: layerId }));
    };
    const handleToggleFolder = (e, cutId, fid) => { e.stopPropagation(); updLayers(cutId, c => ({ layers: c.layers.map(l => l.id === fid ? { ...l, collapsed: !l.collapsed } : l) })); };
    // Boiling: wobbles the strokes already on the layer. Each click cycles off, light, strong,
    // and it never alters the stored strokes.
    // Opens and closes the boiling settings, where strength, wavelength, speed and the minimum
    // width are entered directly.
    const updLayerProps = (cutId, layerId, obj) => dispatchCuts(updateLayer(cutId, layerId, obj));
    const toggleJitterPanel = (e, cutId, layerId) => { e.stopPropagation(); setJitterLayer(j => (j && j.cutId === cutId && j.layerId === layerId) ? null : { cutId, layerId }); };

    const onLayerDragStart = (e, cutId, layerId) => { e.stopPropagation(); setDragLayerInfo({ cutId, layerId }); e.dataTransfer.effectAllowed = 'move'; };
    const onLayerDragOver = (e, targetId, targetType) => {
        e.preventDefault(); e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect(), mid = r.top + r.height / 2;
        const pos = (targetType === 'folder' && e.clientY > mid - 4 && e.clientY < mid + r.height * 0.4) ? 'inside' : (e.clientY < mid ? 'before' : 'after');
        setDropInfo({ layerId: targetId, position: pos }); e.dataTransfer.dropEffect = 'move';
    };
    const onLayerDrop = (e, cutId, targetId) => {
        e.preventDefault(); e.stopPropagation();
        if (!dragLayerInfo || dragLayerInfo.layerId === targetId || dragLayerInfo.cutId !== cutId) { setDragLayerInfo(null); setDropInfo(null); return; }
        const { layerId } = dragLayerInfo, { position } = dropInfo || { position: 'after' };
        // The move itself is pure and lives in layerOps, where it is unit tested; null means the
        // move was refused (dropping a folder into its own subtree) and nothing should change.
        updLayers(cutId, c => {
            const layers = moveLayer(c.layers, layerId, targetId, position);
            return layers ? { layers } : {};
        });
        setDragLayerInfo(null); setDropInfo(null);
    };
    const onLayerDragEnd = () => { setDragLayerInfo(null); setDropInfo(null); };

    const getPos = (e) => { const c = canvasRef.current, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), pressure: e.pressure > 0 ? e.pressure : 0.5 }; };
    // Render only the in-progress stroke on the overlay canvas — one stroke, no full-layer rebuild.
    // Live preview while drawing. This used to re-smooth and redraw the entire stroke on every
    // pointer move: the cost of one redraw grew with the length of the line and the total grew
    // quadratically, so drawing fast fell behind the input and the curve came out kinked.
    // Now it (1) draws at most once per frame via rAF and (2) leaves what is already drawn
    // alone, appending only the new tail - which makes the cost per movement independent of
    // how long the stroke is.
    const renderLiveStroke = (full = false) => {
        const lc = liveCanvasRef.current; if (!lc) return;
        const ctx = lc.getContext('2d');
        const st = liveStrokeRef.current;
        if (!st) { ctx.clearRect(0, 0, lc.width, lc.height); liveDrawnRef.current = 0; return; }
        const n = st.points.length;
        // Cases needing a full redraw, such as the line and curve tools where the earlier part
        // of the stroke changes.
        if (full || liveDrawnRef.current === 0 || n < liveDrawnRef.current) {
            ctx.clearRect(0, 0, lc.width, lc.height);
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
    // Move preview: the shifted result is drawn on the overlay while paintFrame hides the
    // original. It has to draw once on press too, or the screen flashes empty for a moment.
    const renderLayerDragPreview = () => {
        const d = layerDragRef.current; if (!d) return;
        const lc = liveCanvasRef.current; if (!lc) return;
        const cut = cuts.find(c => c.id === d.cutId); if (!cut) return;
        const c2 = lc.getContext('2d');
        c2.clearRect(0, 0, lc.width, lc.height);
        const ox = Math.round(d.dx), oy = Math.round(d.dy);
        const order = flattenLayersInUiOrder(cut.layers || []).filter(l => l.type === 'layer' && d.layerIds.includes(l.id));
        for (let i = order.length - 1; i >= 0; i--) {
            const src = ensureLayerCanvas(cut.id, order[i]); // create it on the spot if it is not cached
            if (src) c2.drawImage(src, ox, oy);
        }
    };

    // Coalesce to one draw per frame - pointer events arrive far more often than frames.
    // Coalesce a text drag to one document update per frame. The last position wins, so nothing
    // is lost by dropping the ones in between: each is absolute, computed from where the drag
    // started plus the total delta.
    const textDragRafRef = useRef(0);
    const flushTextDrag = () => {
        textDragRafRef.current = 0;
        const p = textDragRef.current?.pending;
        if (!p) return;
        textDragRef.current.pending = null;
        dispatchCuts(moveText(p.cutId, p.textId, p.x, p.y));
    };
    const scheduleTextDrag = () => {
        if (textDragRafRef.current) return;
        textDragRafRef.current = requestAnimationFrame(flushTextDrag);
    };

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
    const curveStrokeFromAnchors = (pts) => ({ id: Date.now(), tool: 'brush', color, opacity, size: brushSize, points: catmullThrough(pts) });
    const renderCurvePreview = () => {
        const lc = liveCanvasRef.current; if (!lc) return;
        const ctx = lc.getContext('2d');
        ctx.clearRect(0, 0, lc.width, lc.height);
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
    const commitCurve = () => {
        const pts = curveAnchorsRef.current;
        curveAnchorsRef.current = null; curveDraggingRef.current = false; setCurvePts(0);
        if (pts && pts.length >= 2) {
            const st = curveStrokeFromAnchors(pts);
            const mc = canvasRef.current; if (mc) drawStrokesOnCtx(mc.getContext('2d'), [st], false, bitmapStoreRef.current);
            const lc = liveCanvasRef.current; if (lc) lc.getContext('2d').clearRect(0, 0, lc.width, lc.height);
            commitStrokeToLayer(currentCutId, drawTargetLayerRef.current || (cuts.find(c => c.id === currentCutId)?.activeLayerId), st);
            noteColorUsed(st.color);
        } else {
            const lc = liveCanvasRef.current; if (lc) lc.getContext('2d').clearRect(0, 0, lc.width, lc.height);
        }
    };
    const cancelCurve = () => {
        curveAnchorsRef.current = null; curveDraggingRef.current = false; setCurvePts(0);
        const lc = liveCanvasRef.current; if (lc) lc.getContext('2d').clearRect(0, 0, lc.width, lc.height);
    };
    // Blur brush: uses the path it travels as a mask and blurs the layer pixels beneath it.
    // This spreads what is already drawn rather than adding a vector stroke, so it works on
    // raster data.
    const applyBlurStroke = (st) => {
        const cut = cuts.find(c => c.id === currentCutId);
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
        commitStrokeToLayer(currentCutId, layer.id, { id: Date.now(), tool: 'paste', bitmapId, x: x0, y: y0, w, h });
    };

    // Mosaic: previews the drag rectangle as a dashed outline.
    const renderMosaicMarquee = () => {
        const lc = liveCanvasRef.current; if (!lc) return;
        const ctx = lc.getContext('2d');
        ctx.clearRect(0, 0, lc.width, lc.height);
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
        const stroke = { id: Date.now(), tool: 'paste', bitmapId, x: bx, y: by, w: bw, h: bh };
        updLayers(currentCutId, c => ({ layers: c.layers.map(l => l.id === c.activeLayerId ? { ...l, strokes: [...l.strokes, stroke] } : l) }));
    };

    // Touch navigation on the canvas (fingers never draw — palm rejection):
    //   1 finger  = pan the view,  2 fingers = pinch zoom (+ pan).
    const startCanvasPan = () => {
        const [a] = [...touchPtsRef.current.values()];
        pinchRef.current = { mode: 'pan', startPt: { x: a.x, y: a.y }, startView: { ...view } };
    };
    // Panning on desktop: hold space and drag (the usual paint-program convention), or drag
    // with the middle button. startDraw is blocked while space is held, so nothing is drawn.
    const startMousePan = (e) => {
        const sx = e.clientX, sy = e.clientY, sv = { ...view };
        panningRef.current = true;
        const mv = (ev) => { lastInteractRef.current = Date.now(); setView({ zoom: sv.zoom, x: sv.x + (ev.clientX - sx), y: sv.y + (ev.clientY - sy) }); ev.preventDefault(); };
        const up = () => { panningRef.current = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
    };
    const onAreaPointerDown = (e) => {
        if (e.pointerType !== 'touch') {
            if (spaceDownRef.current || e.button === 1) { e.preventDefault(); startMousePan(e); }
            return;
        }
        touchPtsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touchPtsRef.current.size === 2) {
            const [a, b] = [...touchPtsRef.current.values()];
            pinchRef.current = {
                mode: 'pinch',
                startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                startView: { ...view },
            };
        } else if (touchPtsRef.current.size === 1) {
            startCanvasPan();
        }
    };
    const onAreaPointerMove = (e) => {
        if (e.pointerType !== 'touch') return;
        if (!touchPtsRef.current.has(e.pointerId)) return;
        touchPtsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = pinchRef.current;
        if (touchPtsRef.current.size >= 2 && p?.mode === 'pinch') {
            const [a, b] = [...touchPtsRef.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const zoom = Math.max(0.25, Math.min(8, p.startView.zoom * (dist / p.startDist)));
            lastInteractRef.current = Date.now();
            setView({ zoom, x: p.startView.x + (mid.x - p.startMid.x), y: p.startView.y + (mid.y - p.startMid.y) });
            e.preventDefault();
        } else if (touchPtsRef.current.size === 1 && p?.mode === 'pan') {
            const [a] = [...touchPtsRef.current.values()];
            lastInteractRef.current = Date.now();
            setView({ zoom: p.startView.zoom, x: p.startView.x + (a.x - p.startPt.x), y: p.startView.y + (a.y - p.startPt.y) });
            e.preventDefault();
        }
    };
    const onAreaPointerUp = (e) => {
        if (e.pointerType !== 'touch') return;
        touchPtsRef.current.delete(e.pointerId);
        if (touchPtsRef.current.size === 1) startCanvasPan(); // one finger remains → resume panning
        else if (touchPtsRef.current.size === 0) pinchRef.current = null;
    };
    const resetView = () => setView({ zoom: 1, x: 0, y: 0 });
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
                try { localStorage.setItem('mv_keymap', JSON.stringify(next)); } catch { }
                return next;
            });
            setRebinding(null);
        };
        window.addEventListener('keydown', h, true);
        return () => window.removeEventListener('keydown', h, true);
    }, [rebinding]);

    // Zoom about the centre of the view, for the buttons and shortcuts.
    const zoomCanvas = (factor) => {
        lastInteractRef.current = Date.now();
        setView(v => {
            const zoom = Math.max(0.1, Math.min(16, v.zoom * factor));
            const k = zoom / v.zoom;
            return { zoom, x: v.x * k, y: v.y * k };
        });
    };

    // Space is the hand (pan) mode. Ignored while typing in a field, and the default is
    // suppressed only so the page does not scroll.
    useEffect(() => {
        const isTyping = () => {
            const a = document.activeElement;
            return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || /** @type {HTMLElement} */ (a).isContentEditable);
        };
        const down = (e) => {
            if (e.code !== 'Space' || e.repeat || isTyping()) return;
            e.preventDefault();
            spaceDownRef.current = true; setSpaceDown(true);
        };
        const up = (e) => {
            if (e.code !== 'Space') return;
            // keyup must be suppressed too, or space "clicks" whichever button has focus.
            if (!isTyping()) e.preventDefault();
            spaceDownRef.current = false; setSpaceDown(false);
        };
        // Reset on refocus so the key does not stay stuck down after leaving the window.
        const blur = () => { spaceDownRef.current = false; setSpaceDown(false); };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
    }, []);

    // Wheel zoom on the canvas (PC): anchored at the cursor so the point under it stays put.
    // Shift/Ctrl not required — plain wheel zooms, since the stage never scrolls.
    useEffect(() => {
        const el = canvasAreaRef.current; if (!el) return;
        const h = (e) => {
            e.preventDefault();
            lastInteractRef.current = Date.now(); // keep the boiling preview out of the way while zooming
            const r = el.getBoundingClientRect();
            const cx = e.clientX - r.left - r.width / 2;
            const cy = e.clientY - r.top - r.height / 2;
            setView(v => {
                const zoom = Math.max(0.25, Math.min(8, v.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
                const k = zoom / v.zoom;
                return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
            });
        };
        el.addEventListener('wheel', h, { passive: false });
        return () => el.removeEventListener('wheel', h);
    }, []);

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

    const getTextMeasureCtx = () => {
        if (!textMeasureCtxRef.current) {
            const c = document.createElement('canvas');
            c.width = 16;
            c.height = 16;
            textMeasureCtxRef.current = c.getContext('2d');
        }
        return textMeasureCtxRef.current;
    };

    // Measuring and drawing text live in textRender; this only supplies the scratch context that
    // measureText needs.
    const measureTextBox = (t) => measureTextBoxPure(t, getTextMeasureCtx());

    const hitTestText = (pos, cut) => {
        const texts = safeArray(cut?.texts);
        for (let i = texts.length - 1; i >= 0; i--) {
            const t = texts[i];
            if (t.visible === false) continue;
            const b = measureTextBox(t);
            if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) return { text: t, box: b };
        }
        return null;
    };

    const hitTestSelection = (pos) => {
        if (!selection) return null;
        const x = selection.tx, y = selection.ty, w = selection.tw, h = selection.th;
        const hs = 8;
        const handles = [
            { id: 'nw', x: x, y: y },
            { id: 'n', x: x + w / 2, y: y },
            { id: 'ne', x: x + w, y: y },
            { id: 'e', x: x + w, y: y + h / 2 },
            { id: 'se', x: x + w, y: y + h },
            { id: 's', x: x + w / 2, y: y + h },
            { id: 'sw', x: x, y: y + h },
            { id: 'w', x: x, y: y + h / 2 },
        ];
        for (const hd of handles) {
            if (Math.abs(pos.x - hd.x) <= hs && Math.abs(pos.y - hd.y) <= hs) return { type: 'resize', handle: hd.id };
        }
        const inside = pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h;
        return inside ? { type: 'move' } : null;
    };


    // A press that claims the canvas. Every branch of startDraw that takes over the pointer does
    // these three things together: remember which pointer owns the gesture, capture it so moves
    // keep arriving even once it leaves the canvas, and mark a drag in progress.
    //
    // setPointerCapture needs the try/catch. It throws when the pointer id is already gone -
    // optional chaining does not help, that guards a missing method, not a throw - and an
    // uncaught throw out of a pointerdown handler takes the whole app down. That happened.
    const beginGesture = (e) => {
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

    // Wipe the in-progress-stroke overlay. It sits above the main canvas, so anything left on it
    // is drawn twice - once live, once committed - which reads as a doubled or smeared line.
    const clearLiveOverlay = () => {
        const lc = liveCanvasRef.current;
        if (lc) lc.getContext('2d').clearRect(0, 0, lc.width, lc.height);
    };

    // Grab a text object to drag. The text tool and the move tool both do this and differ in one
    // way: under the text tool, releasing without having moved opens the editor, so the drag
    // starts out "not yet moved". The move tool has no editor to open, so it never needs to know.
    const startTextDrag = (e, pos, hit, clickToEdit) => {
        setSelectedText({ cutId: currentCutId, textId: hit.text.id });
        beginGesture(e);
        textDragRef.current = {
            cutId: currentCutId,
            textId: hit.text.id,
            startPos: { x: pos.x, y: pos.y },
            startText: { x: hit.text.x ?? 0, y: hit.text.y ?? 0 },
            moved: !clickToEdit,
            clickToEdit,
        };
        e.preventDefault();
    };

    // Open the text editor over this point. Its position is in CSS pixels relative to the
    // displayed canvas, which is scaled to fit and zoomed independently of the drawing
    // resolution - hence converting through the bounding rect and the zoom rather than using
    // the canvas coordinates directly.
    const openTextEditorAt = (pos, currentCut) => {
        const c = canvasRef.current;
        const r = c.getBoundingClientRect();
        const sx = r.width / c.width;
        const sy = r.height / c.height;
        setTextEdit({
            cutId: currentCutId,
            layerId: currentCut.activeLayerId,
            textId: null,
            x: pos.x,
            y: pos.y,
            cssX: (pos.x * sx / view.zoom),
            cssY: (pos.y * sy / view.zoom),
            text: '',
            fontSize: 36,
            fontFamily: 'sans-serif',
            color,
            opacity,
            visible: true,
        });
    };

    // Bucket fill. The region is worked out against what is actually visible at and above the
    // active layer, so a line drawn on a layer above still acts as a boundary, and the result
    // lands as a pasted bitmap rather than a stroke - a filled region has no path to store.
    const floodFillAt = (pos, currentCut, activeLayer) => {
        const tmpCanvas = document.createElement('canvas');
        sizeCanvas(tmpCanvas, CANVAS_W, CANVAS_H);
        const tctx = tmpCanvas.getContext('2d');

        const activeCanvas = layerCanvasCache[layerKey(currentCut.id, activeLayer.id)];
        if (activeCanvas) tctx.drawImage(activeCanvas, 0, 0);
        else drawStrokesOnCtx(tctx, activeLayer.strokes, false, bitmapStoreRef.current);

        const stack = flattenLayersInUiOrder(currentCut?.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
        const activeIndex = stack.findIndex(l => l.id === activeLayer.id);
        for (let i = 0; i < activeIndex; i++) {
            const lc = layerCanvasCache[layerKey(currentCut.id, stack[i].id)];
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
        const stroke = { id: Date.now(), tool: 'paste', bitmapId, x: region.x, y: region.y };
        noteColorUsed(color);
        updLayers(currentCutId, c => ({
            layers: c.layers.map(l => l.id === activeLayer.id ? { ...l, strokes: insertFill(l.strokes, stroke, region.overPaint) } : l)
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
        // Recording a motion path for a part animation: capture the stroke as a path.
        if (pathCapture) {
            beginGesture(e);
            pathPtsRef.current = [pos];
            e.preventDefault();
            return;
        }
        const currentCut = cuts.find(c => c.id === currentCutId);
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
                selectionDragRef.current = { hit, startPos: { x: pos.x, y: pos.y }, startSel: { ...selection } };
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
            const hit = hitTestText(pos, currentCut);
            if (hit) { startTextDrag(e, pos, hit, false); return; }
            // With no text grabbed this becomes a move-everything drag; it has to work without
            // a selection. By default that is every visible layer and text in this cut, or just
            // the active layer while Alt is held.
            const drawable = flattenLayersInUiOrder(currentCut?.layers || []).filter(l => l.type === 'layer');
            const onlyActive = e.altKey;
            const act = resolveDrawLayer(currentCut);
            const ids = onlyActive ? (act ? [act.id] : []) : drawable.map(l => l.id);
            if (ids.length) {
                beginGesture(e);
                layerDragRef.current = { cutId: currentCutId, layerIds: ids, withTexts: !onlyActive, startPos: { x: pos.x, y: pos.y }, dx: 0, dy: 0 };
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
                setLassoPoints([pos]);
                break;
            case 'pen':
            case 'brush':
            case 'pencil':
            case 'soft':
            case 'blur':
            case 'marker':
            case 'rough':
            case 'calligraphy': {
                // Draw on the live overlay only — no layer-state writes per move (that was the lag).
                liveStrokeRef.current = { id: Date.now(), tool: etool, color, opacity, size: brushSize, points: [pos], pen: e.pointerType === 'pen' };
                liveDrawnRef.current = 0; renderLiveStroke(true);
                break;
            }
            case 'line': {
                // Line ruler: the start is pinned and only the end follows, giving a two-point line.
                lineStartRef.current = pos;
                liveStrokeRef.current = { id: Date.now(), tool: 'brush', color, opacity, size: brushSize, points: [pos, { ...pos }], pen: e.pointerType === 'pen' };
                liveDrawnRef.current = 0; renderLiveStroke(true);
                break;
            }
            case 'mosaic': {
                mosaicRectRef.current = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
                renderMosaicMarquee();
                break;
            }
            case 'eraser': {
                // Eraser must composite against the layer, so it stays on the layer-write path.
                const newStroke = { id: Date.now(), tool, color, opacity, size: eraserSize, points: [pos] };
                updLayers(currentCutId, c => ({
                    layers: c.layers.map(l => l.id === drawTargetLayerRef.current ? { ...l, strokes: [...l.strokes, newStroke] } : l)
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

    const onDraw = (e) => {
        if (!isDrawing.current) return;
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

        if (textDragRef.current) {
            const { cutId, textId, startPos, startText, clickToEdit } = textDragRef.current;
            const dx = pos.x - startPos.x;
            const dy = pos.y - startPos.y;
            if (clickToEdit && !textDragRef.current.moved && Math.hypot(dx, dy) <= 4) return;
            textDragRef.current.moved = true;
            // One update per frame, not one per event. A pen reports well over a hundred moves a
            // second and each write to the document is a React render plus a full repaint, so
            // most of that work is thrown away before it can be seen - and the drag ends up
            // lagging the pointer rather than following it. The strokes were fixed the same way
            // (see scheduleLiveRender); this is the same problem on the text path.
            textDragRef.current.pending = { cutId, textId, x: Math.round(startText.x + dx), y: Math.round(startText.y + dy) };
            scheduleTextDrag();
            return;
        }

        if (selectionDragRef.current && selection) {
            const { hit, startPos, startSel } = selectionDragRef.current;
            const dx = pos.x - startPos.x;
            const dy = pos.y - startPos.y;
            if (hit.type === 'move') {
                setSelection(s => s ? ({ ...s, tx: startSel.tx + dx, ty: startSel.ty + dy }) : s);
            } else if (hit.type === 'resize') {
                const next = applyResize(hit.handle, startSel, dx, dy);
                setSelection(s => s ? ({ ...s, ...next }) : s);
            }
            return;
        }

        switch (etool) {
            case 'lasso':
                setLassoPoints(p => [...p, pos]);
                break;
            case 'move':
                break;
            case 'line': {
                if (liveStrokeRef.current && lineStartRef.current) {
                    liveStrokeRef.current.points = [lineStartRef.current, pos];
                    renderLiveStroke(true); // the end point moved, so redraw the whole thing
                }
                break;
            }
            case 'mosaic': {
                if (mosaicRectRef.current) { mosaicRectRef.current.x1 = pos.x; mosaicRectRef.current.y1 = pos.y; renderMosaicMarquee(); }
                break;
            }
            case 'pen':
            case 'brush':
            case 'pencil':
            case 'soft':
            case 'blur':
            case 'marker':
            case 'rough':
            case 'calligraphy':
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
                    layers: c.layers.map(l => {
                        if (l.id !== drawTargetLayerRef.current) return l;
                        const newStrokes = [...l.strokes];
                        const currentStroke = newStrokes[newStrokes.length - 1];
                        if (currentStroke && currentStroke.tool !== 'paste' && currentStroke.tool !== 'fill') {
                            for (const p of positions) currentStroke.points.push(p);
                        }
                        return { ...l, strokes: newStrokes };
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
            if (dx || dy) dispatchCuts(moveLayers(d.cutId, d.layerIds, dx, dy, d.withTexts));
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
            if (pathCapture && pts.length > 1) {
                if (pathCapture.mode === 'sway') {
                    // Sway from a drawn curve: the curve is stored as a waveform, and how far it
                    // actually swung becomes the default strength.
                    const w = curveToWave(pts);
                    if (w) updLayerAnim(pathCapture.cutId, pathCapture.layerId, { swayCurve: w.wave, swayAmount: Math.max(1, Math.round(w.amp / 4)) });
                    else alert(tr('거의 직선이라 흔들림을 만들 수 없습니다. 물결치듯 그려보세요.'));
                } else {
                    updLayerAnim(pathCapture.cutId, pathCapture.layerId, { path: pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) });
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
            if (st.points.length) {
                // Bake the stroke straight onto the main canvas at the same coordinates as the
                // overlay and clear the overlay at once, so the line cannot disappear no matter
                // how state updates and repaints are timed. The next normal repaint replaces it
                // with an identical result.
                const mc = canvasRef.current; if (mc) drawStrokesOnCtx(mc.getContext('2d'), [st], false, bitmapStoreRef.current);
                clearLiveOverlay();
                commitStrokeToLayer(currentCutId, drawTargetLayerRef.current, st);
                if (st.tool !== 'eraser') noteColorUsed(st.color);
            } else clearLiveOverlay();
            return;
        }
        // A drag can end between frames with a move still queued; flush it or the text snaps
        // back to wherever the last painted frame left it.
        if (textDragRafRef.current) { cancelAnimationFrame(textDragRafRef.current); flushTextDrag(); }
        selectionDragRef.current = null;
        const endedTextDrag = textDragRef.current;
        textDragRef.current = null;
        if (!isDrawing.current) return;
        endGesture();

        if (endedTextDrag?.clickToEdit && !endedTextDrag.moved) {
            openEditText(endedTextDrag.cutId, endedTextDrag.textId);
            return;
        }

        if (tool === 'lasso' && lassoPoints.length > 1) {
            liftLassoSelection(lassoPoints);
            setLassoPoints([]);
        }
    };

    // Lift what the lasso encloses into a floating selection: the enclosed pixels, plus a mask
    // of exactly which ones, so committing the move knows what to erase from the source layer.
    const liftLassoSelection = (points) => {
        const currentCut = cuts.find(c => c.id === currentCutId);
        const activeLayer = currentCut?.layers.find(l => l.id === currentCut.activeLayerId);
        if (!activeLayer) return;

        // Rendered from the current strokes rather than the cached canvas, which may be a
        // repaint behind.
        const tmpCanvas = document.createElement('canvas');
        sizeCanvas(tmpCanvas, CANVAS_W, CANVAS_H);
        const ctx = tmpCanvas.getContext('2d');
        drawStrokesOnCtx(ctx, activeLayer.strokes, true, bitmapStoreRef.current);

        const poly = closeLassoPath(points).map(p => [p.x, p.y]);
        const { x: minX, y: minY, w, h } = lassoBounds(points, CANVAS_W, CANVAS_H);
        if (w <= 0 || h <= 0) return;

        const layerImageData = ctx.getImageData(minX, minY, w, h);
        const selectionImageData = new ImageData(w, h);
        const eraseMaskImageData = new ImageData(w, h);
        let hasContent = false;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                // Tested at the pixel centre: on the boundary itself the crossing test could go
                // either way, and a half-pixel offset makes the answer definite.
                if (!pointInPolygon([minX + x + 0.5, minY + y + 0.5], poly)) continue;
                const a = layerImageData.data[i + 3];
                if (a === 0) continue;
                hasContent = true;
                selectionImageData.data[i] = layerImageData.data[i];
                selectionImageData.data[i + 1] = layerImageData.data[i + 1];
                selectionImageData.data[i + 2] = layerImageData.data[i + 2];
                selectionImageData.data[i + 3] = a;
                eraseMaskImageData.data[i + 3] = 255;
            }
        }
        if (!hasContent) return;

        setSelection({
            cutId: currentCutId,
            sourceLayerId: activeLayer.id,
            bitmapId: storeBitmap(selectionImageData),
            maskBitmapId: storeBitmap(eraseMaskImageData),
            x: minX, y: minY, w, h,
            tx: minX, ty: minY, tw: w, th: h,
        });
    };

    const onPointerLeaveCanvas = () => {
        // With pointer capture, we still receive move/up events outside the canvas.
        // Avoid auto-stopping lasso/selection transforms just because the pointer left the element.
        if (isDrawing.current && (tool === 'lasso' || selectionDragRef.current)) return;
        stopDraw();
    };

    const cancelText = () => setTextEdit(null);
    const commitText = () => {
        if (!textEdit) return;
        const t = String(textEdit.text ?? '');
        if (!t.trim()) { setTextEdit(null); return; }
        const id = textEdit.textId ?? Date.now();
        const obj = {
            id,
            x: Math.round(textEdit.x),
            y: Math.round(textEdit.y),
            text: t,
            // Ctrl+Enter commits without the size field ever losing focus, so the range that the
            // field would have applied on blur is applied here too.
            fontSize: clampNum(Number(textEdit.fontSize) || 36, 6, 400),
            fontFamily: textEdit.fontFamily,
            color: textEdit.color,
            opacity: textEdit.opacity,
            visible: textEdit.visible ?? true,
            outline: !!textEdit.outline,
            outlineColor: textEdit.outlineColor || '#ffffff',
            bold: !!textEdit.bold,
            italic: !!textEdit.italic,
            align: textEdit.align || 'left',
            lineHeight: textEdit.lineHeight ?? 1.25,
            letterSpacing: textEdit.letterSpacing ?? 0,
            shadow: !!textEdit.shadow,
            shadowColor: textEdit.shadowColor || 'rgba(0,0,0,0.5)',
            shadowBlur: textEdit.shadowBlur ?? 6,
            gradient: !!textEdit.gradient,
            color2: textEdit.color2 || '#ffffff',
            bgColor: textEdit.bgColor || '',
            rotation: textEdit.rotation ?? 0,
            anim: textEdit.anim || null,
        };
        dispatchCuts(upsertText(textEdit.cutId, obj));
        setSelectedText({ cutId: textEdit.cutId, textId: id });
        setTextEdit(null);
    };

    const openEditText = (cutId, textId) => {
        const cut = cuts.find(c => c.id === cutId);
        const t = safeArray(cut?.texts).find(tt => tt.id === textId);
        if (!t || !canvasRef.current) return;
        const c = canvasRef.current;
        const r = c.getBoundingClientRect();
        const sx = r.width / c.width;
        const sy = r.height / c.height;
        setSelectedText({ cutId, textId });
        setTextEdit({
            cutId,
            textId,
            x: t.x ?? 0,
            y: t.y ?? 0,
            cssX: ((t.x ?? 0) * sx / view.zoom),
            cssY: ((t.y ?? 0) * sy / view.zoom),
            text: t.text ?? '',
            fontSize: t.fontSize ?? 36,
            fontFamily: t.fontFamily ?? 'sans-serif',
            color: t.color ?? color,
            opacity: t.opacity ?? opacity,
            visible: t.visible !== false,
            outline: !!t.outline,
            outlineColor: t.outlineColor || '#ffffff',
            bold: !!t.bold,
            italic: !!t.italic,
            align: t.align || 'left',
            lineHeight: t.lineHeight ?? 1.25,
            letterSpacing: t.letterSpacing ?? 0,
            shadow: !!t.shadow,
            shadowColor: t.shadowColor || 'rgba(0,0,0,0.5)',
            shadowBlur: t.shadowBlur ?? 6,
            gradient: !!t.gradient,
            color2: t.color2 || '#ffffff',
            bgColor: t.bgColor || '',
            rotation: t.rotation ?? 0,
            anim: t.anim || null,
        });
    };

    const deleteTextObject = (cutId, textId) => {
        dispatchCuts(deleteText(cutId, textId));
        if (selectedText?.cutId === cutId && selectedText?.textId === textId) setSelectedText(null);
    };

    const toggleTextVisible = (cutId, textId) => {
        dispatchCuts(toggleTextVisibleAction(cutId, textId));
    };

    useEffect(() => {
        const newCache = { ...layerCanvasCache };
        const validKeys = new Set();
        let changed = false;
        // Only cache cuts that can actually be on screen (playing/current + onion neighbours).
        // Caching every cut made hundreds of frames rebuild on each edit and stalled the app.
        const visible = new Set();
        cuts.forEach(c => { if (currentTime >= c.startTime && currentTime < c.endTime) visible.add(c.id); });
        const primary = cuts.find(c => c.id === currentCutId);
        if (primary) {
            visible.add(primary.id);
            if (onionPrev) {
                const prev = cuts.filter(c => c.startTime < primary.startTime && c.track === primary.track).sort((a, b) => b.startTime - a.startTime)[0];
                if (prev) visible.add(prev.id);
            }
            if (onionNext) {
                const next = cuts.filter(c => c.startTime >= primary.endTime && c.track === primary.track).sort((a, b) => a.startTime - b.startTime)[0];
                if (next) visible.add(next.id);
            }
        }
        for (const cut of cuts) {
            if (!visible.has(cut.id)) continue;
            for (const layer of cut.layers) {
                if (layer.type !== 'layer') continue;
                const key = layerKey(cut.id, layer.id);
                validKeys.add(key);
                const canvas = newCache[key];
                // Cheap change signature instead of JSON.stringify(strokes): strokes are only
                // appended/replaced in this app, so length + last-stroke id/points/tool is enough.
                // Avoids O(n) stringify of a growing stroke on every drawing frame.
                // A boiling layer changes phase constantly, so nothing is baked here;
                // ensureLayerCanvas redraws it per phase. Only a single still frame (phase 0) is
                // kept, for the thumbnail.
                // rev exists because edits that move coordinates without changing the stroke count
                // or the last stroke - a whole-layer move, say - are invisible to strokeSig.
                // Bumping rev invalidates the cache for those.
                const layerStrokes = strokeSig(layer.strokes) + '|r' + (layer.roughen || 0) + '|v' + (layer.rev || 0);
                if (!canvas || canvas.dataset.strokes !== layerStrokes) {
                    // Skip (don't cache a blank) if a frame isn't decoded yet — the prefetch effect
                    // decodes it and repaints. Do NOT request a decode here (would loop with tick).
                    let notReady = false;
                    for (const st of safeArray(layer.strokes)) { if (st.tool === 'paste' && st.bitmapId) { const e = bitmapStoreRef.current.get(st.bitmapId); if (e && e.blob && !e.imageBitmap && !e.imageData) { notReady = true; break; } } }
                    if (notReady) continue;
                    const newCanvas = canvas || document.createElement('canvas');
                    sizeCanvas(newCanvas, CANVAS_W, CANVAS_H);
                    drawStrokesOnCtx(newCanvas.getContext('2d'), layer.strokes, true, bitmapStoreRef.current, { roughen: layer.roughen || 0 });
                    newCanvas.dataset.strokes = layerStrokes;
                    newCache[key] = newCanvas;
                    changed = true;
                }
            }
        }
        // Drop cache entries for deleted cuts/layers so the cache doesn't grow unbounded.
        for (const key of Object.keys(newCache)) {
            if (!validKeys.has(key)) { delete newCache[key]; changed = true; }
        }
        if (changed) {
            setLayerCanvasCache(newCache);
        }
    }, [cuts, currentCutId, currentTime, onionPrev, onionNext]);

    // Re-create released frame bitmaps (from their Blob) on demand, then repaint. Used both by the
    // render path (a released frame scrolled into view) and the part-scoped release below.
    const requestFrameDecode = (ids) => {
        const store = bitmapStoreRef.current;
        const todo = ids.filter(id => { const e = store.get(id); return e && e.blob && !e.imageBitmap && !decodingRef.current.has(id); });
        if (!todo.length) return;
        todo.forEach(id => decodingRef.current.add(id));
        const playing = isPlayingRef.current;
        (async () => {
            let cursor = 0, firstDone = false;
            const done = [];
            // Decode several frames concurrently (createImageBitmap runs off-thread) so the buffer
            // fills faster than playback consumes it.
            const worker = async () => {
                while (cursor < todo.length) {
                    const id = todo[cursor++];
                    const e = store.get(id); if (!e || !e.blob) { decodingRef.current.delete(id); continue; }
                    try { e.imageBitmap = await decodeFrameBitmap(e); touchDecoded(id); done.push(id); } catch { }
                    decodingRef.current.delete(id);
                    // Paused: repaint once as soon as the FIRST frame lands (so the current frame shows
                    // immediately), then once more for the rest at the end — NOT per frame (hundreds of
                    // setState in a big batch trip React's update-depth guard). Playing: the rAF loop paints.
                    if (!playing && !firstDone) { firstDone = true; invalidateCutsUsing([id]); setFrameDecodeTick(t => t + 1); }
                }
            };
            await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
            trimDecodedFrames(new Set(todo)); // keep memory bounded; protect what we just decoded
            if (!playing && done.length) { invalidateCutsUsing(done); setFrameDecodeTick(t => t + 1); }
        })();
    };
    // Part-scoped memory: when a part is active, release frames that belong to OTHER parts (their
    // compact Blob stays, ready to re-decode). Decoding the active part's visible window is left to
    // the prefetch effect — don't bulk-decode the whole part here (hundreds of decodes = update storm).
    useEffect(() => {
        if (!activePartId) return; // all parts: leave decoded frames as-is; the LRU cap bounds memory
        const store = bitmapStoreRef.current;
        const keep = new Set(); // frame ids belonging to the active part
        cuts.forEach(c => { if (c.partId === activePartId) safeArray(c.layers).forEach(l => safeArray(l.strokes).forEach(s => { if (s.tool === 'paste' && s.bitmapId) keep.add(s.bitmapId); })); });
        let released = false;
        for (const [id, e] of store) { if (e.blob && e.imageBitmap && !keep.has(id) && !hotWindowRef.current.has(id)) { try { e.imageBitmap.close?.(); } catch { } e.imageBitmap = null; released = true; } }
        if (released) { fallbackCanvasRef.current.clear(); setLayerCanvasCache({}); }
    }, [activePartId]);

    // Prefetch: decode the current frame first (shows immediately) and a window of frames ahead of
    // the playhead (and a few behind), so playback and scrubbing don't stall on lazy decoding.
    // The LRU cap releases frames outside this window, so memory stays bounded.
    const prefetchFramesAt = (time, playing) => {
        const ordered = cuts.filter(c => safeArray(c.layers).some(l => safeArray(l.strokes).some(s => s.tool === 'paste' && s.bitmapId)))
            .sort((a, b) => a.startTime - b.startTime);
        if (!ordered.length) return;
        let idx = ordered.findIndex(c => time >= c.startTime && time < c.endTime);
        if (idx < 0) idx = ordered.findIndex(c => c.id === currentCutId);
        if (idx < 0) idx = 0;
        const AHEAD = playing ? 48 : 10, BEHIND = playing ? 2 : 4;
        const ids = [];
        const push = (c) => c && safeArray(c.layers).forEach(l => safeArray(l.strokes).forEach(s => { if (s.tool === 'paste' && s.bitmapId) ids.push(s.bitmapId); }));
        push(ordered[idx]);                                   // current first = highest priority
        for (let d = 1; d <= AHEAD; d++) push(ordered[idx + d]);
        for (let d = 1; d <= BEHIND; d++) push(ordered[idx - d]);
        hotWindowRef.current = new Set(ids); // protect this window from LRU eviction
        requestFrameDecode(ids);
    };
    prefetchRef.current = prefetchFramesAt;
    // While playing, the rAF loop drives prefetch from the REAL playhead — don't also run it on the
    // throttled currentTime (redundant work competing with the loop). Paused/seek uses this effect.
    useEffect(() => { if (!isPlaying) prefetchFramesAt(currentTime, false); }, [currentCutId, currentTime, isPlaying, cuts]);

    // The cache effect only precomputes visible cuts, and it commits one render late — so a cut
    // that just became visible (every frame during playback) would draw as a blank/white frame.
    // Build it synchronously here instead of skipping; the ref map keeps it bounded.
    const ensureLayerCanvas = (cutId, layer) => {
        const key = layerKey(cutId, layer.id);
        // A boiling layer folds the time phase into its signature, so it redraws each phase and
        // the strokes visibly shimmer. Layers with the effect off keep their old signature shape,
        // so their cache still hits and performance is unchanged.
        //
        // The phase cycles through BOIL_PHASES distinct wobbles rather than inventing a new one
        // every tick, which is both how a hand-drawn boiling line actually works - a few drawings
        // alternating, "on threes" - and what makes it affordable. Every phase being unique meant
        // the layer re-rasterised all of its strokes ten times a second for as long as it was on
        // screen, at a cost that grew with the drawing: 15 strokes already took the 95th-percentile
        // frame from 10ms to 28ms. Cycling means the layer is drawn BOIL_PHASES times and every
        // tick after that is a cache hit.
        //
        // The layer's speed multiplier still applies; a speed of 0 stops it.
        const phase = Math.floor(boilPhaseRef.current * (layer.roughSpeed ?? 1));
        const boil = layer.roughen ? ((phase % BOIL_PHASES) + BOIL_PHASES) % BOIL_PHASES : 0;
        const rOpts = { roughen: layer.roughen || 0, roughPhase: boil, roughWave: layer.roughWave ?? 1, roughMinSize: layer.roughMinSize ?? 0 };
        const sig = strokeSig(layer.strokes) + '|r' + (layer.roughen || 0) + '|v' + (layer.rev || 0) + (layer.roughen ? `|b${boil}|w${rOpts.roughWave}|m${rOpts.roughMinSize}` : '');
        // Each phase needs its own canvas, or they would evict one another every tick and the
        // cycling would buy nothing.
        const slotKey = layer.roughen ? `${key}#${boil}` : key;
        const cached = layerCanvasCache[key];
        if (cached && cached.dataset.strokes === sig) return cached;
        const map = fallbackCanvasRef.current;
        const hit = map.get(slotKey);
        if (hit && hit.dataset.strokes === sig) return hit;
        // A frame whose imageBitmap was released (part-scoped memory) needs re-decoding first.
        // Kick the decode and return the stale canvas (if any) rather than caching a blank one.
        // If a frame isn't decoded yet, show the stale canvas (or nothing). Requesting a decode from
        // the paint path is only safe WHILE PLAYING (requestFrameDecode does no setState then, so no
        // loop) — it's a safety net if the prefetch fell behind. When paused, decoding is driven only
        // by the prefetch effect (a paused decode fires setState, which would loop from here).
        const store = bitmapStoreRef.current;
        const missing = [];
        for (const st of safeArray(layer.strokes)) { if (st.tool === 'paste' && st.bitmapId) { const e = store.get(st.bitmapId); if (e && e.blob) { if (!e.imageBitmap && !e.imageData) missing.push(st.bitmapId); else if (e.imageBitmap) touchDecoded(st.bitmapId); } } }
        if (missing.length) {
            if (isPlayingRef.current) requestFrameDecode(missing);
            if (cached || hit) return cached || hit;
            // If a bitmap (a video frame, say) has not decoded yet - or never will - the layer
            // is still not skipped wholesale. Skipping it would take the pen strokes on the same
            // layer with it and leave the screen blank, which is what happened when a server
            // asset was unavailable. Instead the strokes that can be drawn are drawn, and the
            // signature is marked incomplete so it redraws once the decode finishes.
            const part = document.createElement('canvas');
            sizeCanvas(part, CANVAS_W, CANVAS_H);
            drawStrokesOnCtx(part.getContext('2d'), layer.strokes, true, store, rOpts);
            part.dataset.strokes = sig + '|miss' + missing.length;
            map.delete(slotKey); map.set(slotKey, part);
            while (map.size > LAYER_CANVAS_LRU) map.delete(map.keys().next().value);
            return part;
        }
        // Resize only when the size actually changed. This canvas is reused every boiling phase,
        // ten times a second, and re-assigning the same width reallocated 8MB each time - the
        // measured 79MB/s that ran the tab out of memory. drawStrokesOnCtx clears it either way.
        const cnv = hit || document.createElement('canvas');
        sizeCanvas(cnv, CANVAS_W, CANVAS_H);
        drawStrokesOnCtx(cnv.getContext('2d'), layer.strokes, true, bitmapStoreRef.current, rOpts);
        cnv.dataset.strokes = sig;
        map.delete(slotKey); map.set(slotKey, cnv); // re-insert = most recently used
        while (map.size > LAYER_CANVAS_LRU) map.delete(map.keys().next().value);
        return cnv;
    };

    const paintFrame = useCallback((t, playing) => {
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Boiling phase, quantised to about ten changes a second like a traditional boiling line.
        // Changing it every frame just reads as noise; this rate is what makes the drawing feel
        // alive.
        boilPhaseRef.current = t * BOIL_FPS + boilTick;
        const primary = cuts.find(c => c.id === currentCutId);
        let activeCuts = cuts.filter(c => t >= c.startTime && t < c.endTime);
        if (!activeCuts.find(c => c.id === currentCutId) && primary && !playing) activeCuts.push(primary);
        activeCuts.sort((a, b) => a.track - b.track);
        // Never flash white DURING PLAYBACK: if the frame we're about to show isn't decoded yet,
        // HOLD the last painted frame (skip this repaint) and kick a decode. The loop keeps advancing,
        // so it reads as a brief hold instead of a white flash. Paused/editing always paints normally
        // (the prefetch effect repaints once the frame is ready), so a still frame is never stuck.
        if (playing && paintedOnceRef.current) {
            const store = bitmapStoreRef.current;
            const missing = [];
            for (const ac of activeCuts) for (const l of safeArray(ac.layers)) { if (l.type !== 'layer' || l.visible === false) continue; for (const s of safeArray(l.strokes)) { if (s.tool === 'paste' && s.bitmapId) { const e = store.get(s.bitmapId); if (e && e.blob && !e.imageBitmap && !e.imageData) missing.push(s.bitmapId); } } }
            if (missing.length) { requestFrameDecode(missing); return; }
        }
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        paintedOnceRef.current = true;
        // Video overlay track: drawn underneath everything. The <video> element is kept at time t by
        // the playback loop (playing) or a paused-seek effect.
        if (videoOverlay && t >= videoOverlay.startTime && t < videoOverlay.endTime) {
            const v = videoElRef.current;
            if (v && v.readyState >= 2) {
                const r = fitRect(videoOverlay.w || v.videoWidth || CANVAS_W, videoOverlay.h || v.videoHeight || CANVAS_H, CANVAS_W, CANVAS_H);
                try { ctx.drawImage(v, r.x, r.y, r.w, r.h); } catch { }
            }
        }

        if (!playing && primary) {
            if (onionPrev) {
                const prevCut = cuts.filter(c => c.startTime < primary.startTime && c.track === primary.track).sort((a, b) => b.startTime - a.startTime)[0];
                if (prevCut) {
                    const order = flattenLayersInUiOrder(prevCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = ensureLayerCanvas(prevCut.id, order[i]);
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
                }
            }
            if (onionNext) {
                const nextCut = cuts.filter(c => c.startTime >= primary.endTime && c.track === primary.track).sort((a, b) => a.startTime - b.startTime)[0];
                if (nextCut) {
                    const order = flattenLayersInUiOrder(nextCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = ensureLayerCanvas(nextCut.id, order[i]);
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
                }
            }
        }

        activeCuts.forEach(ac => {
            const order = flattenLayersInUiOrder(ac.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
            // Cut-level animation (enter/exit/deform) applies only during playback/export,
            // so editing stays at rest. Transform about the canvas centre.
            const anim = playing ? computeCutAnim(ac, t, CANVAS_W, CANVAS_H) : null;
            ctx.save();
            if (anim) {
                ctx.globalAlpha = anim.alpha;
                ctx.translate(CANVAS_W / 2 + anim.tx, CANVAS_H / 2 + anim.ty);
                ctx.scale(anim.sx, anim.sy);
                ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
            }
            // Draw bottom -> top so the topmost layer (UI top) is visually on top.
            for (let i = order.length - 1; i >= 0; i--) {
                const l = order[i];
                const layerCanvas = ensureLayerCanvas(ac.id, l);
                if (!layerCanvas) continue; // frame still decoding (part-scoped memory); will repaint when ready

                // Per-layer ("part") transform nests inside the cut transform.
                const la = playing ? computeLayerAnim(l, ac, t, CANVAS_W, CANVAS_H) : null;
                ctx.save();
                if (la) {
                    if (la.alpha != null && la.alpha < 1) ctx.globalAlpha *= la.alpha; // keyframe opacity
                    ctx.translate(la.px + la.tx, la.py + la.ty);
                    ctx.rotate(la.rot);
                    ctx.scale(la.sc, la.sc);
                    ctx.translate(-la.px, -la.py);
                    if (la.shear) ctx.transform(1, 0, la.shear, 1, -la.shear * la.py, 0); // hair/cloth sway
                }

                const shouldMask = selection?.maskBitmapId && selection.cutId === ac.id && selection.sourceLayerId === l.id;
                const maskEntry = shouldMask ? bitmapStoreRef.current.get(selection.maskBitmapId) : null;
                const mb = maskEntry?.imageBitmap;
                const mi = maskEntry?.imageData;

                // A layer being dragged is drawn by the overlay instead, with the original hidden,
                // which prevents a ghost trailing behind it.
                if (layerDragRef.current && layerDragRef.current.cutId === ac.id
                    && layerDragRef.current.layerIds.includes(l.id)) { ctx.restore(); continue; }
                if (la?.swayProfile && (!shouldMask || (!mb && !mi))) {
                    // Per-point sway: the layer is sliced along the axis and each slice bends by a
                    // different amount. That is non-affine, so a single shear cannot express it.
                    // The key is that translating each slice as a rigid block makes the edges
                    // mismatch and the image tear. Giving each slice a shear instead makes the
                    // displacement vary continuously within it, and matching the boundary value to
                    // the neighbour exactly leaves no seam.
                    const SLICES = 64;
                    const vertical = la.swayAxis === 'y';
                    const span = vertical ? CANVAS_H : CANVAS_W;
                    const dispAt = (pos) => la.swayDisp * swayWeightAt(la.swayProfile, pos / span);
                    for (let sIdx = 0; sIdx < SLICES; sIdx++) {
                        const a0 = Math.round(sIdx * span / SLICES);
                        const a1 = Math.round((sIdx + 1) * span / SLICES);
                        const len = a1 - a0; if (len <= 0) continue;
                        const d0 = dispAt(a0), d1 = dispAt(a1);
                        const k = (d1 - d0) / len;  // gradient within the slice
                        const m = d0 - k * a0;      // so that it equals d0 exactly at a0
                        ctx.save();
                        // The coordinate along the axis is left untouched (diagonal term 1, that
                        // off-diagonal 0), so the slices butt together without gaps.
                        if (vertical) { ctx.transform(1, 0, k, 1, m, 0); ctx.drawImage(layerCanvas, 0, a0, CANVAS_W, len, 0, a0, CANVAS_W, len); }
                        else { ctx.transform(1, k, 0, 1, 0, m); ctx.drawImage(layerCanvas, a0, 0, len, CANVAS_H, a0, 0, len, CANVAS_H); }
                        ctx.restore();
                    }
                } else if (!shouldMask || (!mb && !mi)) {
                    ctx.drawImage(layerCanvas, 0, 0);
                } else {
                    const mx = Math.round(selection.x);
                    const my = Math.round(selection.y);
                    const tmp = document.createElement('canvas');
                    tmp.width = CANVAS_W;
                    tmp.height = CANVAS_H;
                    const tctx = tmp.getContext('2d');
                    tctx.drawImage(layerCanvas, 0, 0);
                    tctx.globalCompositeOperation = 'destination-out';
                    tctx.globalAlpha = 1.0;
                    if (mb) {
                        tctx.drawImage(mb, mx, my);
                    } else {
                        const mtmp = document.createElement('canvas');
                        mtmp.width = mi.width;
                        mtmp.height = mi.height;
                        const mctx = mtmp.getContext('2d');
                        mctx.putImageData(mi, 0, 0);
                        tctx.drawImage(mtmp, mx, my);
                    }
                    tctx.globalCompositeOperation = 'source-over';
                    tctx.globalAlpha = 1.0;
                    ctx.drawImage(tmp, 0, 0);
                }
                ctx.restore();
            }
            ctx.restore();
        });

        // Text objects live outside paint layers ("text layer").
        activeCuts.forEach(ac => {
            const anim = playing ? computeCutAnim(ac, t, CANVAS_W, CANVAS_H) : null;
            ctx.save();
            if (anim) {
                ctx.translate(CANVAS_W / 2 + anim.tx, CANVAS_H / 2 + anim.ty);
                ctx.scale(anim.sx, anim.sy);
                ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
            }
            const t2 = t; // the loop below names its text object t, shadowing the time t
            for (const t of safeArray(ac.texts)) {
                if (!t || t.visible === false) continue;
                // Text animation only applies during playback, like cut animation.
                const ta = playing ? computeTextAnim(t, ac, t2) : null;
                if (ta && ta.alpha <= 0.001) continue;
                drawTextObject(ctx, t, {
                    anim: ta,
                    box: textNeedsBox(t, ta) ? measureTextBox(t) : null,
                    alpha: anim ? anim.alpha : 1,
                });
            }
            ctx.restore();
        });
    }, [cuts, currentCutId, onionPrev, onionNext, selection, layerCanvasCache, frameDecodeTick, videoOverlay, boilTick, dragTick]);

    const paintFrameRef = useRef(null);
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
            if (t) {
                const b = measureTextBox(t);
                ctx.save();
                ctx.strokeStyle = accentSoft();
                ctx.lineWidth = 1;
                ctx.setLineDash([6, 4]);
                ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w), Math.round(b.h));
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        if (selection?.bitmapId) {
            const entry = bitmapStoreRef.current.get(selection.bitmapId);
            const bmp = entry?.imageBitmap;
            const img = entry?.imageData;
            const tx = Math.round(selection.tx);
            const ty = Math.round(selection.ty);
            const tw = Math.max(1, Math.round(selection.tw));
            const th = Math.max(1, Math.round(selection.th));

            if (bmp) {
                ctx.drawImage(bmp, tx, ty, tw, th);
            } else if (img) {
                const tmp = document.createElement('canvas');
                tmp.width = img.width;
                tmp.height = img.height;
                const tctx = tmp.getContext('2d');
                tctx.putImageData(img, 0, 0);
                ctx.drawImage(tmp, tx, ty, tw, th);
            }

            ctx.save();
            ctx.strokeStyle = accentSoft();
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(tx + 0.5, ty + 0.5, tw, th);
            ctx.setLineDash([]);

            const hs = 5;
            const handlePts = [
                [tx, ty], [tx + tw / 2, ty], [tx + tw, ty],
                [tx + tw, ty + th / 2],
                [tx + tw, ty + th], [tx + tw / 2, ty + th], [tx, ty + th],
                [tx, ty + th / 2],
            ];
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'rgba(30, 30, 46, 0.9)';
            for (const [hx, hy] of handlePts) {
                ctx.beginPath();
                ctx.rect(Math.round(hx) - hs, Math.round(hy) - hs, hs * 2, hs * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }

        // Recorded motion paths (per layer) shown while editing so they're visible/redrawable.
        if (!isPlaying) {
            const cc = cuts.find(c => c.id === currentCutId);
            for (const l of (cc?.layers || [])) {
                const path = l.anim?.path;
                if (!path || path.length < 2) continue;
                const editing = animLayer && animLayer.cutId === cc.id && animLayer.layerId === l.id;
                ctx.save();
                ctx.strokeStyle = editing ? accentSoft() : accentSoft(0.4);
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = editing ? accentSoft() : accentSoft(0.5);
                ctx.beginPath(); ctx.arc(path[0].x, path[0].y, 4, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
        }

        if (lassoPoints.length > 0) {
            ctx.strokeStyle = accentSoft();
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            lassoPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, [paintFrame, cuts, currentCutId, isPlaying, scrubbing, currentTime, lassoPoints, selection, selectedText, animLayer]);

    // Boiling is motion, so it is invisible on a still frame; the phase is advanced slowly
    // while editing to preview it. That preview redraws the whole layer, though, so it stops
    // whenever the user is actually doing something - letting it run while drawing or right
    // after a pan or zoom makes the interaction stutter badly.
    useEffect(() => {
        if (isPlaying) return;
        const cut = cuts.find(c => c.id === currentCutId);
        if (!cut || !safeArray(cut.layers).some(l => l.roughen && l.visible !== false)) return;
        const id = setInterval(() => {
            if (document.hidden) return;                      // pointless while the tab is hidden
            if (isDrawing.current || panningRef.current) return; // mid-stroke or mid-pan
            if (Date.now() - lastInteractRef.current < 400) return; // yield briefly right after a zoom
            setBoilTick(v => (v + 1) % 100000);
        }, Math.round(1000 / BOIL_FPS));
        return () => clearInterval(id);
    }, [isPlaying, cuts, currentCutId]);

    // The live overlay is cleared once the layer cache has updated, not on a timer, so the
    // committed stroke is already on the main canvas before the overlay goes. That makes it
    // independent of how fast the machine is - the line cannot vanish in between.
    useEffect(() => {
        if (liveClearPendingRef.current && !isDrawing.current && !liveStrokeRef.current) {
            liveClearPendingRef.current = false;
            const lc = liveCanvasRef.current; if (lc) lc.getContext('2d').clearRect(0, 0, lc.width, lc.height);
        }
    }, [layerCanvasCache]);

    // Every way the timeline can be pointed at - scrub, marquee, middle-click pan, one-finger
    // pan/tap, two-finger pinch - lives in useTimelineGestures, where the overlaps between them
    // are visible.
    const {
        seekToTime, seekToClientX, goToScene,
        startTimelinePan, startTimelineScrub,
        onTimelinePointerDown, onTimelinePointerMove, onTimelinePointerUp,
    } = useTimelineGestures({
        timelineRef, tlTouchRef, tlPinchRef,
        cuts, currentCutId, setCurrentCutId, maxTime,
        pps, setPps,
        setCurrentTime, currentTimeRef, isPlayingRef, seekRef,
        audioRef, audioUrl, audioData,
        setScrubbing, setMarquee, selectedCutIds, setSelectedCutIds,
        videoOverlay,
    });

    const loadAudioUrl = (url, name, startAt = 0, offset = 0, clipDur = null) => {
        setAudioFile({ name }); setAudioUrl(url);
        const audio = new Audio(url);
        // startAt aligns the track to a given timeline position (e.g. the first imported video frame);
        // offset/clipDur select a sub-range of the source audio (used when only a video segment is
        // imported), so audio + frames extracted together stay mechanically in sync.
        audio.onloadedmetadata = () => {
            setAudioDuration(audio.duration);
            const dur = clipDur != null ? Math.min(clipDur, Math.max(0, audio.duration - offset)) : Math.max(0, audio.duration - offset);
            setAudioData({ startTime: startAt, endTime: startAt + dur, offset });
            if (audioRef.current) audioRef.current.src = url;
        };
        // Capture base64 once so the project can be saved "with the music".
        if (url.startsWith('data:')) { audioB64Ref.current = url; }
        else { fetch(url).then(r => r.blob()).then(b => { const fr = new FileReader(); fr.onload = () => { audioB64Ref.current = fr.result; }; fr.readAsDataURL(b); }).catch(() => { }); }
    };
    const handleAudioUpload = (e) => {
        const file = e.target.files[0]; if (!file) return;
        loadAudioUrl(URL.createObjectURL(file), file.name);
    };
    // Lay a whole video under the drawing layers (overlay/rotoscope use). No frame cuts.
    const loadVideoOverlay = (blob, name, startAt = 0, offset = 0, clipDur = null) => {
        videoBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        const v = videoElRef.current || document.createElement('video');
        v.muted = true; v.playsInline = true; v.src = url;
        v.onloadedmetadata = () => {
            const dur = clipDur != null ? Math.min(clipDur, Math.max(0, v.duration - offset)) : Math.max(0, v.duration - offset);
            setVideoOverlay({ name: name || tr('영상'), startTime: startAt, endTime: startAt + dur, offset, duration: v.duration, w: v.videoWidth, h: v.videoHeight });
            // Prime the first frame so a paused canvas shows something immediately.
            try { v.currentTime = offset; } catch { }
        };
        v.onseeked = () => { setFrameDecodeTick(t => t + 1); }; // repaint the (paused) overlay frame
        // Auto-detect scene cuts in the background so the timeline can mark where the video changes.
        runSceneDetect({ cutStart: startAt, cutOffset: offset });
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
        setSceneDetect({ done: 0, total: 0 });
        detectSceneCuts(blob, { start: rStart, end: rEnd, threshold, onProgress: (d, t) => setSceneDetect({ done: d, total: t }) })
            .then(cuts => setVideoOverlay(prev => prev ? { ...prev, cuts, cutStart: cs, cutOffset: co } : prev))
            .catch(() => { })
            .finally(() => setSceneDetect(null));
    };
    const removeVideoOverlay = () => {
        setVideoOverlay(null); videoBlobRef.current = null; setSceneCfg(null);
        const v = videoElRef.current; if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { } }
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
        setRecentVideos(p => [{ id: 'rv_' + Date.now().toString(36), name: label, srcKey, url: src?.url || null },
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
        const pid = 'part_' + Date.now().toString(36);
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
            setAppError(tr('영상 가져오기 실패: ') + e.message + '\n' + tr('(서버에 yt-dlp 설치 필요)'));
        } finally { setVideoBusy(null); }
    };

    // Import a video as one cut per extracted frame (sequential on the current track).
    const runVideoImport = async () => {
        const cfg = videoImport;
        if (!cfg?.file) return;
        setVideoBusy({ done: 0, total: 0 });
        try {
            const rStart = cfg.rangeOn ? parseClock(cfg.startText) : 0;
            const rEnd = cfg.rangeOn ? parseClock(cfg.endText) : 0;
            const useRange = cfg.rangeOn && rEnd > rStart;
            // Quality tiers trade size vs fidelity. 'high' (WebP q0.95, native res) is visually
            // lossless at ~5-8x smaller than true-lossless PNG — best default for large videos.
            const q = cfg.quality || 'compressed';
            const isNative = q !== 'compressed';
            const tgt = targetCanvasFor(cfg, CANVAS_W, CANVAS_H);
            const TW = tgt.w, TH = tgt.h;
            if (TW !== CANVAS_W || TH !== CANVAS_H) setCanvasSize({ w: TW, h: TH });
            const { frames, holds = [], skipped = 0, fps, width: fW, height: fH } = await extractVideoFrames(cfg.file, {
                fps: cfg.fps, maxFrames: cfg.whole ? 0 : cfg.maxFrames,
                start: useRange ? rStart : 0, end: useRange ? rEnd : null,
                scale: isNative ? 1 : cfg.scale, quality: q === 'lossless' ? 1 : q === 'high' ? 0.95 : 0.82,
                dedupe: cfg.dedupe ?? 'exact', nativeRes: isNative, format: q === 'lossless' ? 'png' : 'webp',
                width: TW, height: TH,
                onProgress: (done, total, skipped) => setVideoBusy({ done, total, skipped }),
                shouldStop: () => videoStopRef.current,
            });
            if (!frames.length) { alert(tr('추출된 프레임이 없습니다.')); return; }
            // Re-importing the same source replaces its old frames instead of piling up duplicates.
            const srcKey = cfg.srcKey;
            const kept = cuts.filter(c => c.videoSrc !== srcKey);
            const track = kept.find(c => c.id === currentCutId)?.track ?? 0;
            const startAt = kept.filter(c => c.track === track).reduce((m, c) => Math.max(m, c.endTime), 0);
            const dur = 1 / Math.max(0.1, fps);
            const baseId = Date.now();
            const batch = 'vb_' + baseId.toString(36);
            const label = cfg.label || cfg.file.name.replace(/\.[^.]+$/, '').slice(0, 24);
            // Native-res frames keep the source aspect, so letterbox-fit them into the canvas;
            // compressed frames are already pre-letterboxed to the canvas (full-canvas paste).
            const fit = (isNative && fW && fH) ? fitRect(fW, fH, TW, TH) : { x: 0, y: 0, w: TW, h: TH };
            const px = Math.round(fit.x), py = Math.round(fit.y), pw = Math.round(fit.w), ph = Math.round(fit.h);
            // Split the import into N sequential parts (part1~n) so a long video comes in already
            // organized. videoBatch stays one value (the frame manager deletes the whole import).
            const nParts = Math.max(1, Math.min(frames.length, Math.floor(cfg.parts) || 1));
            const perPart = Math.ceil(frames.length / nParts);
            const made = [];
            let t = startAt;
            for (let i = 0; i < frames.length; i++) {
                const bitmapId = await storeBitmapBlob(frames[i], fW, fH);
                const s = t, e = t + dur * (holds[i] || 1); // held frames span their whole duplicate run
                t = e;
                const pIdx = nParts > 1 ? Math.floor(i / perPart) : 0;
                const partId = nParts > 1 ? `${batch}_p${pIdx}` : batch;
                const partName = nParts > 1 ? `${label} ${pIdx + 1}` : label;
                made.push({
                    id: baseId + i, name: `${label} ${i + 1}`, startTime: s, endTime: e, track,
                    activeLayerId: 1, texts: [], videoBatch: batch, videoLabel: label, videoSrc: srcKey, partId, partName,
                    layers: [{ id: 1, name: 'L1', type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [{ id: baseId + 100000 + i, tool: 'paste', bitmapId, x: px, y: py, w: pw, h: ph }] }],
                });
            }
            dispatchCuts(replaceBatchCuts(srcKey, made));
            setCurrentCutId(made[0].id);
            setCurrentTime(made[0].startTime);
            // Audio (if asked) is the only thing that keeps the video bytes alive past this point.
            // Aligned to the first imported frame; when only a range was imported, the audio is
            // clipped to that same range (offset rStart, duration rEnd-rStart).
            if (cfg.withAudio) loadAudioUrl(URL.createObjectURL(cfg.file), label + tr(' (영상 음원)'), made[0].startTime, useRange ? rStart : 0, useRange ? (rEnd - rStart) : null);
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
    const handleDeleteAudio = () => {
        if (audioRef.current) { audioRef.current.pause(); try { audioRef.current.removeAttribute('src'); audioRef.current.load(); } catch { } }
        if (audioUrl && audioUrl.startsWith('blob:')) { try { URL.revokeObjectURL(audioUrl); } catch { } }
        audioB64Ref.current = null;
        setAudioFile(null); setAudioUrl(null); setAudioData(null);
    };
    const loadYoutubeAudio = async (presetUrl) => {
        const url = typeof presetUrl === 'string' ? presetUrl : null;
        if (!url) { setLinkPrompt({ kind: 'audio' }); return; }
        try {
            const res = await fetch('/api/youtube-audio?url=' + encodeURIComponent(url));
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
            const blob = await res.blob();
            loadAudioUrl(URL.createObjectURL(blob), tr('유튜브 음원'));
        } catch (e) { alert(tr('음원 추출 실패: ') + e.message + '\n' + tr('(서버에 yt-dlp + ffmpeg 설치 필요)')); }
    };
    const handleExport = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (typeof canvas.captureStream !== 'function' || typeof window.MediaRecorder === 'undefined') {
            alert(tr('이 환경에서는 내보내기를 지원하지 않습니다.\nPC 브라우저(Chrome 등)에서 실행해 주세요.')); return;
        }
        const ctMax = Math.max(...cuts.map(c => c.endTime), audioData?.endTime ?? 0);
        if (ctMax <= 0) { alert(tr('내보낼 콘텐츠가 없습니다.')); return; }
        const candidates = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        const mimeType = candidates.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
        const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
        alert(tr('녹화가 시작됩니다.')); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0;
        const stream = canvas.captureStream(30), tracks = [...stream.getVideoTracks()];
        if (audioRef.current && audioUrl && !audioSourceRef.current) { try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)(); audioDestRef.current = audioCtxRef.current.createMediaStreamDestination(); audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current); audioSourceRef.current.connect(audioDestRef.current); audioSourceRef.current.connect(audioCtxRef.current.destination); } catch (e) { } }
        if (audioDestRef.current) tracks.push(...audioDestRef.current.stream.getAudioTracks());
        let mr;
        try { mr = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined); }
        catch (e) { try { mr = new MediaRecorder(new MediaStream(tracks)); } catch (e2) { alert(tr('녹화를 시작할 수 없습니다: ') + e2.message); return; } }
        const blobType = mimeType || 'video/webm';
        const chunks = [];
        mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        mr.onstop = () => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(chunks, { type: blobType })), download: `mv_export.${ext}`, style: 'display:none' }); document.body.appendChild(a); a.click(); document.body.removeChild(a); alert(tr('완료!')); isExporting.current = false; };
        exportEndRef.current = ctMax; isExporting.current = true; mediaRecorderRef.current = mr; mr.start(); setIsPlaying(true);
    };

    const renderLayers = (cut, parentId = null, depth = 0) => {
        return cut.layers.filter(l => (l.parentId ?? null) === parentId).map(layer => {
            const isFolder = layer.type === 'folder';
            const isDragging = dragLayerInfo?.layerId === layer.id;
            const dt = dropInfo?.layerId === layer.id ? dropInfo.position : null;
            return (
                <div key={layer.id} style={{ opacity: isDragging ? 0.4 : 1 }}>
                    {dt === 'before' && <div className="drop-line" />}
                    <div
                        className={`layer-row${!isFolder && cut.activeLayerId === layer.id ? ' layer-active' : ''}${isFolder ? ' layer-folder' : ''}${dt === 'inside' ? ' drop-inside' : ''}`}
                        style={{ paddingLeft: depth * 14 + 6 }}
                        draggable
                        onDragStart={e => onLayerDragStart(e, cut.id, layer.id)}
                        onDragOver={e => onLayerDragOver(e, layer.id, layer.type)}
                        onDrop={e => onLayerDrop(e, cut.id, layer.id)}
                        onDragEnd={onLayerDragEnd}
                        onClick={e => !isFolder && handleSetActive(e, cut.id, layer.id)}
                    >
                        {isFolder
                            ? <button className="icon-btn" onClick={e => handleToggleFolder(e, cut.id, layer.id)}>{layer.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}</button>
                            : <span style={{ width: 11, flexShrink: 0, display: 'inline-block' }} />}
                        {isFolder
                            ? (layer.collapsed ? <Folder size={13} style={{ color: '#888', marginRight: 4, flexShrink: 0 }} /> : <FolderOpen size={13} style={{ color: '#aaa', marginRight: 4, flexShrink: 0 }} />)
                            : <LayerThumbnail layer={layer} cutId={cut.id} layerCanvasCache={layerCanvasCache} />}
                        <button className="icon-btn" style={{ marginLeft: 4 }} onClick={e => handleToggleVisible(e, cut.id, layer.id)}>
                            {layer.visible ? <Eye size={10} /> : <EyeOff size={10} style={{ color: '#555' }} />}
                        </button>
                        <span className="layer-name">{layer.name}</span>
                        {!isFolder && (
                            <button className="icon-btn" style={{ color: layer.roughen ? '#e0a84e' : undefined }}
                                title={layer.roughen ? tr('자글자글 모션 (강도 {0}) — 클릭: 설정 열기', layer.roughen) : tr('자글자글 모션 설정 (이미 그린 선이 제자리에서 부글거림)')}
                                onClick={e => toggleJitterPanel(e, cut.id, layer.id)}>
                                <Waves size={11} />
                            </button>
                        )}
                        {!isFolder && (
                            <button className="icon-btn" style={{ color: layer.anim ? 'var(--accent-soft)' : undefined }} title={tr('파츠 애니메이션')}
                                onClick={e => { e.stopPropagation(); setAnimLayer(a => (a && a.cutId === cut.id && a.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id }); }}>
                                <Film size={11} />
                            </button>
                        )}
                        <button className="icon-btn del-btn" onClick={e => handleDeleteLayer(e, cut.id, layer.id)}><Trash2 size={11} /></button>
                    </div>
                    {!isFolder && jitterLayer && jitterLayer.cutId === cut.id && jitterLayer.layerId === layer.id && (
                        <JitterPanel cut={cut} layer={layer} updLayer={updLayerProps} />
                    )}
                    {!isFolder && animLayer && animLayer.cutId === cut.id && animLayer.layerId === layer.id && (
                        <LayerAnimPanel cut={cut} layer={layer} updLayerAnim={updLayerAnim} updLayers={updLayers} pathCapture={pathCapture} setPathCapture={setPathCapture}
                            cutProgress={(currentTime - cut.startTime) / Math.max(0.0001, cut.endTime - cut.startTime)} />
                    )}
                    {dt === 'after' && <div className="drop-line" />}
                    {isFolder && !layer.collapsed && renderLayers(cut, layer.id, depth + 1)}
                </div>
            );
        });
    };

    // Tool panel: the buttons keep a comfortable size and the column count follows the width.
    const toolW = Math.max(56, leftW || 96);
    const currentCut = cuts.find(c => c.id === currentCutId);
    const isSelectionTool = tool === 'lasso' || !!selection;
    liveRef.current = { cuts, copiedCut, selection, audioData, numTracks }; // current GC + history sources

    const PANEL_IDS = ['color', 'tools', 'cut'];
    const PANEL_ROOTS = { color: '.color-panel', tools: '.toolbar', cut: '.right-panel' };
    const panelWidth = { color: colorW, tools: toolW, cut: rightW };
    const panelOpen = { color: leftDock === 'color', tools: showLeft, cut: showRight };

    // Which dock a pointer position means. The edge bands are wide enough to hit on a tablet;
    // anywhere else means the panel is being pulled out into its own window.
    const dropZoneAt = (x) => (x < 140 ? 'left' : x > window.innerWidth - 140 ? 'right' : 'float');

    // Header drag is delegated from main-content rather than wired into each panel, so ColorPanel
    // and CutLayerPanel keep their own markup and know nothing about docking.
    const onDockPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const head = e.target.closest?.('.panel-head');
        if (!head) return;
        if (e.target.closest('button, input, select, textarea')) return;   // ✕ and controls still work
        const id = PANEL_IDS.find(p => head.closest(PANEL_ROOTS[p]));
        if (!id) return;
        e.preventDefault();
        const host = head.closest(PANEL_ROOTS[id]).getBoundingClientRect();
        const grab = { dx: e.clientX - host.left, dy: e.clientY - host.top };
        setPanelDrag({ id, x: e.clientX, y: e.clientY, zone: dropZoneAt(e.clientX), ...grab });
        const mv = (ev) => setPanelDrag(d => d && ({ ...d, x: ev.clientX, y: ev.clientY, zone: dropZoneAt(ev.clientX) }));
        const up = (ev) => {
            window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
            const zone = dropZoneAt(ev.clientX);
            setPanelDrag(null);
            setDocks(d => ({ ...d, [id]: zone }));
            if (zone === 'float') setFloatPos(p => ({ ...p, [id]: { x: Math.max(0, ev.clientX - grab.dx), y: Math.max(0, ev.clientY - grab.dy) } }));
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
    };

    // A docked panel keeps a splitter on the side that faces the canvas.
    const panelSplitter = (id, side) => (
        <div key={id + '-sp'} className="splitter-v" style={{ touchAction: 'none' }}
            title={tr('드래그로 패널 너비 조절')}
            onPointerDown={e => {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
                setSplitter({ type: 'panel', id, side, startX: e.clientX, startW: panelWidth[id] });
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
            rulerMode={rulerMode} setRulerMode={setRulerMode} commitCurve={commitCurve}
            mosaicBlock={mosaicBlock} setMosaicBlock={setMosaicBlock}
            brushSize={brushSize} setBrushSize={setBrushSize}
            eraserSize={eraserSize} setEraserSize={setEraserSize} />
    );

    const colorPanelEl = (
                <ColorPanel
                    color={color} applyColor={applyColor} pickColor={pickColor} pickingColor={pickingColor}
                    recentColors={recentColors}
                    width={colorW}
                    onClose={() => setLeftDock(null)} />
    );
    const cutPanelEl = (
                <CutLayerPanel
                    collapsedCutIds={collapsedCutIds} copiedCut={copiedCut} currentCutId={currentCutId} cuts={cuts}
                    deleteTextObject={deleteTextObject} deleteVideoBatch={deleteVideoBatch}
                    dragLayerInfo={dragLayerInfo} expandedCuts={expandedCuts} handleAddCut={handleAddCut}
                    handleAddFolder={handleAddFolder} handleAddLayer={handleAddLayer} handleCopyCut={handleCopyCut}
                    handleCutClick={handleCutClick} handleDeleteCut={handleDeleteCut}
                    handleDuplicateCut={handleDuplicateCut} handlePasteCut={handlePasteCut}
                    handleSetTool={handleSetTool} openEditText={openEditText} renameCut={renameCut}
                    renamingCutId={renamingCutId} renderLayers={renderLayers} rightW={rightW}
                    selectedCutIds={selectedCutIds} selectedText={selectedText} setDragLayerInfo={setDragLayerInfo}
                    setDropInfo={setDropInfo} setRenamingCutId={setRenamingCutId} setSelectedText={setSelectedText}
                    setShowRight={setShowRight} showRight={showRight} toggleCutCollapse={toggleCutCollapse}
                    toggleCutSettings={toggleCutSettings} toggleTextVisible={toggleTextVisible}
                    updCutAnim={updCutAnim} updCutTime={updCutTime} updLayers={updLayers}
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
                    keymap={keymap} setKeymap={setKeymap} defaultKeys={DEFAULT_KEYS} keyLabels={KEY_LABELS}
                    lang={lang} changeLang={changeLang}
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
                    sceneDetect={sceneDetect} runSceneDetect={runSceneDetect} />
            )}
            {showHelp && <HelpModal keymap={keymap} onClose={() => setShowHelp(false)} />}
            <TopBar
                doNew={doNew} doSave={doSave} doOpen={doOpen} doLocalSave={doLocalSave}
                openLocalList={openLocalList} doServerSave={doServerSave} openServerList={openServerList}
                doServerBackup={doServerBackup} openBackupList={openBackupList} backupBusy={backupBusy}
                handleAudioUpload={handleAudioUpload} loadYoutubeAudio={loadYoutubeAudio}
                handleDeleteAudio={handleDeleteAudio} audioFile={audioFile} openVideoImport={openVideoImport}
                loadYoutubeVideo={loadYoutubeVideo} videoFileRef={videoFileRef} recentVideos={recentVideos}
                reimportRecent={reimportRecent} serverAvailable={serverAvailable} showFileMenu={showFileMenu}
                setShowFileMenu={setShowFileMenu} showMediaMenu={showMediaMenu} setShowMediaMenu={setShowMediaMenu}
                fileMenuRef={fileMenuRef} mediaMenuRef={mediaMenuRef} canvasW={CANVAS_W} canvasH={CANVAS_H}
                setCanvasSize={setCanvasSize} setShowHelp={setShowHelp} setShowSettings={setShowSettings}
                keymap={keymap} view={view} zoomCanvas={zoomCanvas} resetView={resetView} autoSavedAt={autoSavedAt}
                autosaveErr={autosaveErr} backupAt={backupAt} storageInfo={storageInfo} handleExport={handleExport} />
            {/* Project (document) tab bar, below the File and Media menus. */}
            <div className="doc-tabs" style={{ display: 'flex', alignItems: 'stretch', gap: 2, background: 'hsl(var(--ui-h) var(--ui-s) 11%)', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', padding: '3px 6px 0', overflowX: 'auto', flexShrink: 0 }}>
                {tabs.map(t => (
                    <div key={t.id} onClick={() => switchTab(t.id)}
                        onDoubleClick={() => { const n = window.prompt(tr('탭 이름'), t.name); if (n != null) setTabs(p => p.map(x => x.id === t.id ? { ...x, name: n || x.name } : x)); }}
                        title={tr('클릭: 전환 · 더블클릭: 이름변경')}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: '6px 6px 0 0', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', maxWidth: 180, background: t.id === activeTabId ? 'hsl(var(--ui-h) var(--ui-s) 15%)' : 'transparent', color: t.id === activeTabId ? '#fff' : '#9a9ab0', borderBottom: t.id === activeTabId ? '2px solid var(--accent-soft)' : '2px solid transparent' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                        <span onClick={e => { e.stopPropagation(); closeTab(t.id); }} title={tr('탭 닫기')} style={{ opacity: 0.6, fontSize: 13, lineHeight: 1 }}>✕</span>
                    </div>
                ))}
                <button className="icon-btn" onClick={newTab} title={tr('새 탭(프로젝트)')} style={{ alignSelf: 'center', marginLeft: 2 }}><Plus size={14} /></button>
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
                    {pathCapture && (
                        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 31, background: 'var(--accent-soft)', color: '#fff', fontSize: 12, padding: '6px 12px', borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                            {pathCapture.mode === 'sway' ? tr('물결치듯 곡선을 그리세요 — 그 모양·크기대로 흔들립니다') : tr('펜으로 이동 경로를 그리세요')}
                            <button className="button" style={{ height: 24, padding: '0 8px' }} onClick={() => setPathCapture(null)}>{tr('취소')}</button>
                        </div>
                    )}
                    {etool === 'curve' && (
                        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 31, background: 'hsl(var(--ui-h) var(--ui-s) 20%)', color: '#fff', fontSize: 12, padding: '6px 12px', borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #444' }}>
                            {curvePts === 0 ? tr('점을 찍어 곡선을 만드세요') : tr('앵커 {0}개 (누른 채 끌어 미세조정)', curvePts)}
                            <button className="button" style={{ height: 24, padding: '0 10px', background: '#4ea1ff' }} disabled={curvePts < 2} onClick={commitCurve}>{tr('완료')}</button>
                            <button className="button" style={{ height: 24, padding: '0 8px' }} disabled={curvePts === 0} onClick={cancelCurve}>{tr('취소')}</button>
                        </div>
                    )}
                    {(view.zoom !== 1 || view.x !== 0 || view.y !== 0) && (
                        <button className="button" onClick={resetView} title={tr('줌 초기화')}
                            style={{ position: 'absolute', top: 8, right: 8, zIndex: 30, height: 28, padding: '0 10px' }}>
                            {Math.round(view.zoom * 100)}% ⟲
                        </button>
                    )}
                    <div className="canvas-stage" style={{ position: 'relative', transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, maxWidth: '100%', maxHeight: '100%' }}>
                        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
                            onPointerDown={startDraw} onPointerMove={onDraw} onPointerUp={stopDraw} onPointerCancel={stopDraw} onPointerLeave={onPointerLeaveCanvas}
                            style={{ cursor: spaceDown ? 'grab' : selection ? 'move' : tool === 'fill' ? 'cell' : tool === 'lasso' ? 'crosshair' : 'crosshair', touchAction: 'none' }} />
                        {/* The live overlay must be transparent. Inheriting the global
                            `canvas { background:#fff }` rule paints white over the main canvas,
                            hiding the drawing and making committed strokes look as if they
                            vanished. */}
                        <canvas ref={liveCanvasRef} width={CANVAS_W} height={CANVAS_H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', background: 'transparent', boxShadow: 'none' }} />
                        {selection && (
                            <div className="selection-actions">
                                <button className="button button-primary" onClick={extractSelectionToPart} style={{ height: 30, padding: '0 10px' }} title={tr('선택 영역을 별도 레이어(파츠)로 분리해 애니메이션')}>{tr('파츠로 분리')}</button>
                                <button className="button" onClick={copyLassoSelection} style={{ height: 30, padding: '0 10px' }} title={tr('선택 영역 복사 (다른 컷/레이어에 붙여넣기)')}>{tr('복사')}</button>
                                <button className="button" onClick={commitSelection} style={{ height: 30, padding: '0 10px' }} title={tr('제자리에 적용(이동/크기)')}>{tr('완료')}</button>
                                <button className="button" onClick={cancelSelection} style={{ height: 30, padding: '0 10px' }}>{tr('취소')}</button>
                            </div>
                        )}
                        {textEdit && (
                            <div className="text-editor" ref={textEditorRef} style={{ left: Math.round(textEdit.cssX), top: Math.round(textEdit.cssY) }}>
                                <textarea
                                    ref={textAreaRef}
                                    value={textEdit.text}
                                    onChange={e => setTextEdit(te => te ? ({ ...te, text: e.target.value }) : te)}
                                    onKeyDown={e => {
                                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelText(); }
                                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commitText(); }
                                    }}
                                    placeholder={tr('텍스트 입력 (Ctrl+Enter 완료, Esc 취소)')}
                                />
                                <div className="text-editor-row">
                                    <div className="te-section">{tr('글꼴')}</div>
                                    <label className="text-editor-label">Size</label>
                                    {/* No range at all while editing - not per keystroke, and not
                                        on blur either. Any clamp during editing makes 100
                                        unreachable: "1" becomes 6 before the zeros arrive, and
                                        clamping when the field is left does the same thing a
                                        keystroke later if focus moves between digits. The size is
                                        held to 6..400 where it is used instead - textRender clamps
                                        for drawing, and commitText clamps what gets saved. */}
                                    <NumField
                                        value={textEdit.fontSize}
                                        onChange={v => setTextEdit(te => te ? ({ ...te, fontSize: v }) : te)}
                                        className="text-editor-num"
                                    />
                                    {(() => {
                                        const isPreset = FONT_PRESETS.some(f => f.value === textEdit.fontFamily);
                                        return (
                                            <>
                                                <select
                                                    className="text-editor-font"
                                                    value={isPreset ? textEdit.fontFamily : '__custom__'}
                                                    onChange={e => {
                                                        const v = e.target.value;
                                                        setTextEdit(te => te ? ({ ...te, fontFamily: v === '__custom__' ? (te.fontFamily || 'sans-serif') : v }) : te);
                                                    }}
                                                    title={tr('폰트')}
                                                >
                                                    <option value="__custom__">Custom</option>
                                                    {FONT_PRESETS.map(f => (
                                                        <option key={f.value} value={f.value}>{f.label}</option>
                                                    ))}
                                                </select>
                                                {!isPreset && (
                                                    <input
                                                        className="text-editor-font"
                                                        value={textEdit.fontFamily}
                                                        onChange={e => setTextEdit(te => te ? ({ ...te, fontFamily: e.target.value }) : te)}
                                                        placeholder="Custom font-family"
                                                        title={tr('커스텀 폰트')}
                                                    />
                                                )}
                                            </>
                                        );
                                    })()}
                                    <input
                                        type="color"
                                        value={textEdit.color}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, color: e.target.value }) : te)}
                                        className="text-editor-color"
                                        title={tr('색상')}
                                    />
                                    <button className="button" title={tr('굵게')} onClick={() => setTextEdit(te => te ? ({ ...te, bold: !te.bold }) : te)}
                                        style={{ height: 26, width: 28, padding: 0, fontWeight: 800, background: textEdit.bold ? 'hsl(var(--ui-h) var(--ui-s) 29%)' : undefined }}>B</button>
                                    <button className="button" title={tr('기울임')} onClick={() => setTextEdit(te => te ? ({ ...te, italic: !te.italic }) : te)}
                                        style={{ height: 26, width: 28, padding: 0, fontStyle: 'italic', background: textEdit.italic ? 'hsl(var(--ui-h) var(--ui-s) 29%)' : undefined }}>I</button>
                                    <select className="time-input" style={{ width: 52 }} title={tr('정렬')} value={textEdit.align || 'left'}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, align: e.target.value }) : te)}>
                                        <option value="left">◧</option><option value="center">▣</option><option value="right">◨</option>
                                    </select>
                                    <select className="time-input" style={{ width: 54 }} title={tr('줄간격')} value={textEdit.lineHeight ?? 1.25}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, lineHeight: +e.target.value }) : te)}>
                                        {[1, 1.15, 1.25, 1.5, 1.8, 2].map(v => <option key={v} value={v}>{v}x</option>)}
                                    </select>
                                    <select className="time-input" style={{ width: 58 }} title={tr('자간(글자 간격)')} value={textEdit.letterSpacing ?? 0}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, letterSpacing: +e.target.value }) : te)}>
                                        {[-2, 0, 1, 2, 4, 8, 12].map(v => <option key={v} value={v}>{tr('자간')}{v}</option>)}
                                    </select>
                                    <div className="te-section">{tr('효과')}</div>
                                    <label className="te-check" title={tr('가독성용 외곽선')}>
                                        <input type="checkbox" checked={!!textEdit.outline} onChange={e => setTextEdit(te => te ? ({ ...te, outline: e.target.checked }) : te)} />{tr('테두리')}
                                    </label>
                                    {textEdit.outline && <input type="color" value={textEdit.outlineColor || '#ffffff'} onChange={e => setTextEdit(te => te ? ({ ...te, outlineColor: e.target.value }) : te)} className="text-editor-color" title={tr('테두리 색')} />}
                                    <label className="te-check" title={tr('그림자')}>
                                        <input type="checkbox" checked={!!textEdit.shadow} onChange={e => setTextEdit(te => te ? ({ ...te, shadow: e.target.checked }) : te)} />{tr('그림자')}
                                    </label>
                                    {textEdit.shadow && <input type="color" value={(textEdit.shadowColor || '#000000').startsWith('#') ? textEdit.shadowColor : '#000000'} onChange={e => setTextEdit(te => te ? ({ ...te, shadowColor: e.target.value }) : te)} className="text-editor-color" title={tr('그림자 색')} />}
                                    <label className="te-check" title={tr('위→아래 2색 그라데이션')}>
                                        <input type="checkbox" checked={!!textEdit.gradient} onChange={e => setTextEdit(te => te ? ({ ...te, gradient: e.target.checked }) : te)} />{tr('그라데이션')}
                                    </label>
                                    {textEdit.gradient && <input type="color" value={textEdit.color2 || '#ffffff'} onChange={e => setTextEdit(te => te ? ({ ...te, color2: e.target.value }) : te)} className="text-editor-color" title={tr('그라데이션 끝 색')} />}
                                    <label className="te-check" title={tr('글자 뒤 배경 박스')}>
                                        <input type="checkbox" checked={!!textEdit.bgColor} onChange={e => setTextEdit(te => te ? ({ ...te, bgColor: e.target.checked ? (te.bgColor || '#ffffff') : '' }) : te)} />{tr('배경')}
                                    </label>
                                    {textEdit.bgColor && <input type="color" value={textEdit.bgColor.startsWith('#') ? textEdit.bgColor : '#ffffff'} onChange={e => setTextEdit(te => te ? ({ ...te, bgColor: e.target.value }) : te)} className="text-editor-color" title={tr('배경 색')} />}
                                    <NumField className="time-input" width={54} title={tr('회전(도)')} value={textEdit.rotation ?? 0} step={5}
                                        onChange={v => setTextEdit(te => te ? ({ ...te, rotation: v }) : te)} />
                                    {/* Text animation, visible only during playback. */}
                                    {(() => {
                                        const an = { ...TEXT_ANIM_DEFAULT, ...(textEdit.anim || {}) };
                                        const on = !!textEdit.anim;
                                        const set = (o) => setTextEdit(te => te ? ({ ...te, anim: { ...an, ...o } }) : te);
                                        return (<>
                                            <div className="te-section">{tr('애니메이션')}</div>
                                            <label className="te-check" title={tr('재생할 때만 적용됩니다')}>
                                                <input type="checkbox" checked={on}
                                                    onChange={e => setTextEdit(te => te ? ({ ...te, anim: e.target.checked ? { ...TEXT_ANIM_DEFAULT } : null }) : te)} />{tr('애니메이션')}
                                            </label>
                                            {on && <>
                                                <select className="time-input" style={{ width: 74 }} title={tr('등장')} value={an.inType} onChange={e => set({ inType: e.target.value })}>
                                                    <option value="none">{tr('등장없음')}</option><option value="fade">{tr('페이드')}</option><option value="up">{tr('아래→위')}</option>
                                                    <option value="down">{tr('위→아래')}</option><option value="scale">{tr('확대')}</option><option value="blur">{tr('흐림')}</option>
                                                </select>
                                                <select className="time-input" style={{ width: 74 }} title={tr('퇴장')} value={an.outType} onChange={e => set({ outType: e.target.value })}>
                                                    <option value="none">{tr('퇴장없음')}</option><option value="fade">{tr('페이드')}</option><option value="up">{tr('위로')}</option>
                                                    <option value="down">{tr('아래로')}</option><option value="scale">{tr('축소')}</option><option value="blur">{tr('흐림')}</option>
                                                </select>
                                                <select className="time-input" style={{ width: 74 }} title={tr('계속 반복되는 강조')} value={an.emphasis} onChange={e => set({ emphasis: e.target.value })}>
                                                    <option value="none">{tr('강조없음')}</option><option value="pulse">{tr('두근두근')}</option><option value="shake">{tr('흔들기')}</option><option value="swing">{tr('갸우뚱')}</option>
                                                </select>
                                                {an.emphasis !== 'none' && <>
                                                    <input type="number" className="time-input" style={{ width: 50 }} title={tr('강조 세기')} value={an.emAmount} step={5} min={0}
                                                        onChange={e => set({ emAmount: Math.max(0, +e.target.value || 0) })} />
                                                    <input type="number" className="time-input" style={{ width: 50 }} title={tr('강조 속도')} value={an.emSpeed} step={0.5} min={0}
                                                        onChange={e => set({ emSpeed: Math.max(0, +e.target.value || 0) })} />
                                                </>}
                                                <label className="te-check" title={tr('한 글자씩 나타남')}>
                                                    <input type="checkbox" checked={!!an.typing} onChange={e => set({ typing: e.target.checked })} />{tr('타이핑')}
                                                </label>
                                                {an.typing && <input type="number" className="time-input" style={{ width: 56 }} title={tr('초당 글자수')} value={an.typeSpeed} step={2} min={1}
                                                    onChange={e => set({ typeSpeed: Math.max(1, +e.target.value || 1) })} />}
                                            </>}
                                        </>);
                                    })()}
                                    <div className="te-footer">
                                        <button className="button button-primary" onClick={commitText} style={{ height: 28, padding: '0 12px' }}>{tr('완료')}</button>
                                        <button className="button" onClick={cancelText} style={{ height: 28, padding: '0 12px' }}>{tr('취소')}</button>
                                    </div>
                                </div>
                            </div>
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

            {showBottom && <div className="splitter-h" style={{ touchAction: 'none' }} onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } setSplitter({ type: 'bottom', startY: e.clientY, startH: timelineH }); }} />}

            <Timeline
                activePartId={activePartId} audioData={audioData} audioFile={audioFile} audioRef={audioRef}
                currentCutId={currentCutId} currentTime={currentTime} cutDragArmedRef={cutDragArmedRef}
                cutDragMovedRef={cutDragMovedRef} cutDragTimerRef={cutDragTimerRef} cuts={cuts}
                draggingCutData={draggingCutData} fmt={fmt} goToScene={goToScene} handleAddTrack={handleAddTrack}
                handleDeleteAudio={handleDeleteAudio} handleDeleteTrack={handleDeleteTrack}
                handlePlayPause={handlePlayPause} handleStop={handleStop} isPlaying={isPlaying} loopPlay={loopPlay}
                makePartFromSelection={makePartFromSelection} marquee={marquee} maxTime={maxTime} mkLayer={mkLayer}
                numTracks={numTracks} onTimelinePointerDown={onTimelinePointerDown}
                onTimelinePointerMove={onTimelinePointerMove} onTimelinePointerUp={onTimelinePointerUp} parts={parts}
                playbackRate={playbackRate} playheadRef={playheadRef} pps={pps}
                removeVideoOverlay={removeVideoOverlay} renamePart={renamePart} sceneDetect={sceneDetect}
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
