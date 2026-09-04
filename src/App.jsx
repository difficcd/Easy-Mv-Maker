import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { X, Plus, Trash2, PenLine, Pen, Feather, Eraser, Undo, Redo, Layers, Trash, ChevronRight, ChevronDown, Folder, FolderOpen, Eye, EyeOff, ClipboardPaste, GitBranch, Move, Type, Cloud, Film, Repeat, Minus, Waves, Grid3x3, Palette, Menu, PaintBucket, Pipette, RotateCcw, ArrowDownToLine, CornerDownRight } from 'lucide-react';
import './App.css';
import { saveAutosave, loadAutosave, saveProject, loadProject, listProjects, deleteProject, autosaveKey } from './db';
import { CutAnimPanel, LayerAnimPanel, JitterPanel } from './ui/AnimPanels';
import { NumField, clampNum } from './ui/NumField';
import ColorPanel, { RECENT_SLOTS } from './ui/ColorPanel';
import { TopBar } from './ui/TopBar';
import { CutLayerPanel } from './ui/CutLayerPanel';
import { useStored } from './hooks/useStored.js';
import { nextId, randomId } from './core/ids.js';
import { clampZoom } from './core/viewZoom.js';
import { arrayCodec, onOffCodec, oneZeroCodec, numberCodec } from './core/persist.js';
import { TextEditor } from './ui/TextEditor';
import { ToolsPanel } from './ui/ToolsPanel';
import { Timeline } from './ui/Timeline';
import { ProjectPicker, ProgressOverlay, SettingsModal, HelpModal, VideoImportModal, SceneDetectModal, LinkPromptModal, ToolKeysModal } from './ui/Modals';
import { tr, loadLang, saveLang, setLangValue } from './i18n';
import { moveLayer } from './core/layerOps.js';
import { resolveDrawLayer as resolveDrawLayerPure, commitStroke, insertFill, patchLayer } from './core/layerOps.js';
import { closeLassoPath, lassoBounds, applyResize } from './core/lassoOps.js';
import { useTimelineGestures } from './hooks/useTimelineGestures.js';
import { fmt, parseClock } from './core/timeCode.js';
import { useHistory } from './hooks/useHistory.js';
import { usePlayback } from './hooks/usePlayback.js';
import { useServerProbe } from './hooks/useServerProbe.js';
import { useAutosave } from './hooks/useAutosave.js';
import { nextProbeDelay } from './core/probeBackoff.js';
import { playbackStartFrom } from './core/playbackStart.js';
import {
    mediaReducer, EMPTY_MEDIA, loadAudio, setAudioDuration, setAudioClip, clearAudio,
    loadVideo, clearVideo, setVideoCuts, setVideoOpacity, clearVideoCuts, moveTrack, resizeAudio,
} from './core/mediaReducer.js';
import { cloneCutContents as cloneCutContentsPure } from './core/cutClone.js';
import { DEFAULT_KEYS, KEY_LABELS, keyOf, matchShortcut, keymapFrom, toolFromAction, findConflicts } from './core/shortcuts.js';
import { derivePartsFrom, deriveVideoBatches } from './core/partOps.js';
import {
    cutsReducer, replaceCuts, addCuts, updateCut, setCutAnim, setCutCamera, clearCut,
    updateLayer, setLayerAnim, moveLayers, upsertText, moveText, deleteText, toggleTextVisible as toggleTextVisibleAction,
    assignPartTo, renamePart as renamePartAction, ungroupPart as ungroupPartAction, removeBatch,
    insertCutsShifting, deleteTrack, moveCutGroup, replaceBatchCuts, mergeLayerDown, patchCut, patchCuts,
} from './core/cutsReducer.js';
import { measureTextBox as measureTextBoxPure, textNeedsBox, drawTextObject } from './canvas/textRender.js';
import { migrateCuts, projectSettings, makeLoadProgress } from './core/projectFormat.js';
import { frameLoad, imageExtFromType, audioExt, videoExt, collectBitmaps } from './core/projectAssets.js';
import { xAtTime, timeAtX, zoomAnchored, pinchZoom } from './core/timelineZoom.js';
import { preparePath } from './core/pathMotion.js';
import { dragOnWindow } from './core/windowDrag.js';
// Recording a camera path reuses the pen the way a part's motion path does; the two cannot be
// active at once, and startDraw checks this one first because a camera is a property of the cut
// rather than of whichever layer happens to be selected.

import { computeCamera, applyCamera } from './core/camera.js';
import { clipGroups, canClip } from './core/clipping.js';
import { setLayerClipped } from './core/cutsReducer.js';
import { onionNeighbours, topCutAt } from './engine/selectCuts.js';
import { evaluateFrame } from './engine/evaluateFrame.js';
import { pendingBitmapIds, scanLayerBitmaps } from './engine/pendingBitmaps.js';
import { makeZip, frameName } from './export/zip.js';
import { encodeGif } from './export/gif.js';
import { unusedBitmapIds } from './core/bitmapRefs.js';
import { dragCut, resizeCut } from './core/cutOps.js';
import {
    DEFAULT_CUT_DURATION, CANVAS_W as CANVAS_W_DEFAULT, CANVAS_H as CANVAS_H_DEFAULT, FONT_PRESETS, fontGroups,
    pointInPolygon, dist, safeArray, hexToRgb, bucketFillTransparentRegion,
    layerKey, imageDataToDataURL, dataURLToImageData, drawStrokesOnCtx, sizeCanvas, scratchCanvas,
    flattenForCanvas, flattenLayersInUiOrder, layerSig, applyCutAnim, extractVideoFrames, fitRect, detectSceneCuts, curveToWave, swayWeightAt, morphPrepare,
    accentSoft, computeCutAnim, computeLayerAnim, TEXT_ANIM_DEFAULT, computeTextAnim,
    targetCanvasFor, imageDataCanvas, cutProgress, seekTarget,
} from './canvas/canvasUtils';

/**
 * Let go of a media element's source.
 *
 * Three steps, and the order is the point: pause first or the browser keeps decoding a source
 * that is being taken away; remove the attribute rather than setting src to '' or the element
 * reloads the page URL as media and logs a failure; then load(), which is what actually drops
 * the buffered data - without it the bytes stay held and a project with a big import never
 * gives them back.
 *
 * Written out six times, three for audio and three for video, and they had drifted: the audio
 * copies left pause() outside the try, so a detached element would throw where the video
 * copies would not.
 *
 * @param {HTMLMediaElement | null | undefined} el
 */
const detachMedia = (el) => {
    if (!el) return;
    try {
        el.pause();
        el.removeAttribute('src');
        el.load();
    } catch { }
};


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
// The long edge a GIF is scaled to fit. Every pixel of a GIF is a palette index with no
// inter-frame compression, so full size is tens of megabytes a second and as slow again to write.
const GIF_MAX_EDGE = 720;
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
    const [playbackRate, setPlaybackRate] = useState(1);
    const [rightW, setRightW] = useState(270);
    // Which tab the cut panel is showing. It follows the editor rather than being chosen: a text
    // you have just opened is the thing you want to see.
    const [rightTab, setRightTab] = useState('cut');
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

    // Where each panel lives: 'left', 'right' or 'float'. Panels are drawn from these rather than
    // from fixed positions in the layout, so dragging one only has to change this value.
    const [docks, setDocks] = useStored('mv_docks', { tools: 'left', color: 'left', cut: 'right' }, {
        // A layout stored by a version that docked differently is treated as absent rather than
        // restored into a shape this one cannot lay out.
        decode: (raw) => { const v = JSON.parse(raw); return v && ['left', 'right', 'float'].includes(v.tools) ? v : undefined; },
        encode: JSON.stringify,
    });
    const [floatPos, setFloatPos] = useStored('mv_floats',
        { tools: { x: 120, y: 120 }, color: { x: 160, y: 160 }, cut: { x: 200, y: 200 } }, {
        decode: (raw) => { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : undefined; },
        encode: JSON.stringify,
    });
    // The panel being dragged by its header, plus where it would land if dropped now.
    const [panelDrag, setPanelDrag] = useState(null);

    const [snapLinePos, setSnapLinePos] = useState(null);
    // The audio and video tracks move together - loading audio sets four of these at once - so
    // they are one reducer. Destructured here so every read site keeps the name it always had;
    // only the writes go through an action. See core/mediaReducer.
    const [media, dispatchMedia] = React.useReducer(mediaReducer, EMPTY_MEDIA);
    const { audioFile, audioUrl, audioDuration, audioData } = media;
    const audioRef = useRef(null);
    const audioB64Ref = useRef(null); // audio as base64 data URL, embedded into saves
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
    const [recentColors, setRecentColors] = useStored('mv_recent_colors', [], arrayCodec);
    const [pickingColor, setPickingColor] = useState(false); // eyedropper: next canvas click samples a pixel
    // Palettes start empty - no built-in presets. The user fills them.
    const [palettes, setPalettes] = useStored('mv_palettes', [{ name: tr('내 팔레트'), colors: [] }], {
        // An empty stored list means the starting palette, not no palettes at all.
        decode: (raw) => { const v = JSON.parse(raw); return Array.isArray(v) && v.length ? v : undefined; },
        encode: JSON.stringify,
    });
    const [activePalette, setActivePalette] = useState(0);
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
    // Pen pressure. Off means an even line however hard the pen is pressed - wanted for lineart,
    // and for pens that report pressure unevenly.
    const [pressureOn, setPressureOn] = useStored('mv_pressure', true, onOffCodec);
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
    const fileMenuRef = useRef(null);
    const mediaMenuRef = useRef(null);
    const timelineRef = useRef(null);
    // Where the timeline was scrolled to before it was folded away, so unfolding returns to the
    // same place rather than to the start of the project.
    const timelineScrollRef = useRef(/** @type {{left: number, top: number} | null} */(null));
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
    const paintFrameRef = useRef(/** @type {((t: number, playing: boolean) => void) | null} */(null)); // set below, beside paintFrame
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
    const textDragRef = useRef(null);
    const textMeasureCtxRef = useRef(null);
    const didRecoverRef = useRef(false);
    const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
    const touchPtsRef = useRef(new Map());
    const pinchRef = useRef(null);
    const tlTouchRef = useRef(new Map());
    const tlPinchRef = useRef(null);
    const [serverProjects, setServerProjects] = useState(null); // null = picker closed
    const [localProjects, setLocalProjects] = useState(null); // IndexedDB project picker
    const localIdRef = useRef(null);
    const localNameRef = useRef('');
    // Which document is loaded, as a number that changes whenever the whole thing is replaced.
    //
    // Long jobs - extracting frames from a video, detecting scenes - can be sent to the
    // background and finish minutes later, by which time another project may be open. They
    // captured no notion of *which* project they were started for, so the result landed in
    // whatever was on screen: frames from project 1 appearing in project 2. Each job takes a copy
    // of this when it starts and drops its result if it no longer matches.
    const docEpochRef = useRef(0);
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

    const [storageInfo, setStorageInfo] = useState(null); // local storage usage
    const [loadProgress, setLoadProgress] = useState(null); // {label, done, total}; total 0 means the length is unknown
    const backupKeyRef = useRef(null);
    const backupBusyRef = useRef(false);
    const lastBackupSigRef = useRef('');
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
    const [spaceDown, setSpaceDown] = useState(false); // space = pan (hand) mode
    const spaceDownRef = useRef(false);
    const panningRef = useRef(false);
    const lastInteractRef = useRef(0); // time of the last zoom or pan, used to briefly yield the boiling preview
    const [pathCapture, setPathCapture] = useState(null); // {cutId, layerId} while recording a motion path
    const pathPtsRef = useRef(null);
    const [cameraCapture, setCameraCapture] = useState(null); // {cutId} while drawing a camera path

    const storeBitmap = (imageData) => {
        const id = randomId();
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
        const id = randomId();
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
                        { id: nextId(), tool: 'eraseBitmap', bitmapId: maskBitmapId, x: px, y: py },
                        { id: nextId(), tool: 'paste', bitmapId, x: tx, y: ty, w: tw, h: th },
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
            const layers = patchLayer(c.layers, sel.sourceLayerId,
                l => ({ strokes: [...l.strokes, { id: nextId(), tool: 'eraseBitmap', bitmapId: sel.maskBitmapId, x: px, y: py }] }));
            const partLayer = { id: newId, name: tr('파츠 {0}', newId), type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [{ id: nextId(), tool: 'paste', bitmapId: sel.bitmapId, x: tx, y: ty, w: tw, h: th }] };
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
        const cut = currentCut;
        if (!clip || !cut) return;
        const layerId = cut.activeLayerId;
        const bmpCache = new Map();
        const bitmapId = cloneBitmapId(clip.bitmapId, bmpCache); // independent copy per paste
        const x = Math.round(CANVAS_W / 2 - clip.w / 2), y = Math.round(CANVAS_H / 2 - clip.h / 2);
        updLayers(currentCutId, c => ({
            layers: patchLayer(c.layers, layerId,
                l => ({ strokes: [...l.strokes, { id: nextId(), tool: 'paste', bitmapId, x, y, w: clip.w, h: clip.h }] }))
        }));
    };

    const handleSetTool = (newTool) => {
        if (selection) return;
        if (textEdit) return;
        // Switching tools mid-curve commits it automatically.
        if (curveAnchorsRef.current && newTool !== 'ruler') commitCurve();
        setTool(newTool);
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
        recording: { isExporting, exportEndRef, mediaRecorderRef },
    });


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
            // Save is claimed before the input guard below. A text field has no "save" of its
            // own, so Ctrl+S typed while editing text used to fall through to the browser and
            // offer to save the page as HTML - which is the reflex moment for pressing it.
            // Undo and redo are deliberately *not* hoisted: inside a field those belong to the
            // field.
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); doSave(false); return; }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            // Tab hides every panel so the canvas is alone on screen, and restores exactly what was
            // open before. Plain Tab only: Ctrl/Alt/Shift+Tab stay with the browser.
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                toggleAllPanelsRef.current?.();
                // Folding unmounts whatever held focus, and focus then falls back to <body> -
                // which is why the next Tab started from the top of the page. Put it on the
                // canvas instead, where the shortcuts are aimed.
                requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }));
                return;
            }
            // User-defined shortcuts first; the conventional Ctrl+Z / Ctrl+Y combinations are
            // left in place below.
            const hit = matchShortcut(keymap, keyOf(e));
            if (hit) {
                e.preventDefault();
                // Tools are routed by prefix rather than by a list of ids kept in step with the
                // toolbar; handleSetTool already does the tidying up a switch needs (committing a
                // curve in progress, refusing while the text editor is open).
                const toolId = toolFromAction(hit);
                if (toolId) { handleSetTool(toolId); return; }
                if (hit === 'undo') globalUndo();
                else if (hit === 'redo') globalRedo();
                else if (hit === 'zoomIn') zoomCanvas(1.25);
                else if (hit === 'zoomOut') zoomCanvas(1 / 1.25);
                else if (hit === 'resetView') resetView();
                else if (hit === 'brushUp') { const s = tool === 'eraser' ? eraserSize : brushSize; const n = Math.min(200, Math.round(s * 1.25) + 1); tool === 'eraser' ? setEraserSize(n) : setBrushSize(n); }
                else if (hit === 'brushDown') { const s = tool === 'eraser' ? eraserSize : brushSize; const n = Math.max(1, Math.round(s / 1.25)); tool === 'eraser' ? setEraserSize(n) : setBrushSize(n); }
                return;
            }
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
            const top = topCutAt(cuts, currentTime);
            if (top && top.id !== currentCutId) setCurrentCutId(top.id);
        }
    }, [currentTime, isPlaying]);


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
            const want = seekTarget(exp, v.duration);
            if (Math.abs(v.currentTime - want) > 0.03) { try { v.currentTime = want; } catch { } }
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
                const [lo, hi] = PANEL_W[splitter.id] || PANEL_W.cut;
                const w = Math.max(lo, Math.min(hi, splitter.startW + delta));
                if (splitter.id === 'color') setColorW(w);
                else if (splitter.id === 'tools') setLeftW(w);
                else setRightW(w);
            }
            else if (splitter.type === 'bottom') setTimelineH(Math.max(100, Math.min(600, splitter.startH + (splitter.startY - e.clientY))));
        };
        return dragOnWindow(mv, () => setSplitter(null));
    }, [splitter]);

    // Zoom the timeline about a screen x (cursor), keeping the time under it fixed. The scroll
    // adjustment is deferred to a layout effect so it runs after the new width is laid out.
    const zoomTimelineAt = (clientX, factor) => {
        const el = timelineRef.current; if (!el) return;
        const localX = clientX - el.getBoundingClientRect().left;
        setPps(prev => {
            const r = zoomAnchored(prev, factor, el.scrollLeft, localX);
            if (!r) return prev; // already at the limit - leave the scroll where it is
            pendingTlScrollRef.current = r.scrollLeft;
            return r.pps;
        });
    };
    useLayoutEffect(() => {
        if (pendingTlScrollRef.current != null && timelineRef.current) {
            timelineRef.current.scrollLeft = pendingTlScrollRef.current;
            pendingTlScrollRef.current = null;
        }
    }, [pps]);
    // Ctrl/Cmd + wheel is left to the browser. The timeline and the canvas both zoom on a plain
    // wheel, so the app never needs the modifier - and taking it away everywhere would remove
    // page zoom from the whole application to protect against pressing it by accident.
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
        // Re-attach when the timeline is shown again. It is inside `showBottom &&`, so hiding it
        // unmounts the element and showing it mounts a new one - an empty dependency list would
        // leave these listeners on the detached node and wheel zoom silently dead after a Tab.
    }, [showBottom]);

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
                const midX = (a.x + b.x) / 2 - rect.left;
                pinch = { startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startPps: ppsRef.current, anchorTime: Math.max(0, timeAtX(el.scrollLeft, midX, ppsRef.current)) };
                e.preventDefault(); e.stopPropagation();
            }
        };
        const move = (e) => {
            if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size >= 2 && pinch) {
                const [a, b] = [...pts.values()];
                const rect = el.getBoundingClientRect();
                const r = pinchZoom(pinch, Math.hypot(a.x - b.x, a.y - b.y), (a.x + b.x) / 2 - rect.left);
                setPps(r.pps);
                el.scrollLeft = r.scrollLeft;
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
        // As above: the element is replaced whenever the timeline is hidden and shown.
    }, [showBottom]);

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
            // liveRef holds the current document precisely so this does not have to reach for
            // a state setter to read it, and the ref keeps the effect's dependency list honest.
            const lv = liveRef.current;
            recordHistory({ cuts: lv.cuts, audioData: lv.audioData, numTracks: lv.numTracks });
        };
        return dragOnWindow(mv, up);
    }, [recordHistory, resizingData, draggingCutData, pps, numTracks]);

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
        if (includeAudio && audioB64Ref.current && audioData) {
            const meta = { name: audioFile?.name || tr('오디오'), startTime: audioData.startTime, endTime: audioData.endTime, offset: audioData.offset, duration: audioDuration };
            if (assetSink) {
                const ext = audioExt(audioB64Ref.current);
                assetSink.push({ id: '__audio__', url: audioB64Ref.current, ext });
                out.audio = { ...meta, asset: true, ext };
            } else {
                out.audio = { ...meta, dataUrl: audioB64Ref.current };
            }
        }
        // Video overlay track (like audio): externalize the video blob for server saves; store the
        // Blob directly for IndexedDB; embed as dataURL only for a self-contained .emv file.
        if (videoOverlay && videoBlobRef.current) {
            const meta = { name: videoOverlay.name, startTime: videoOverlay.startTime, endTime: videoOverlay.endTime, offset: videoOverlay.offset, duration: videoOverlay.duration, w: videoOverlay.w, h: videoOverlay.h, opacity: videoOverlay.opacity ?? 1, cuts: videoOverlay.cuts, cutStart: videoOverlay.cutStart, cutOffset: videoOverlay.cutOffset };
            const ext = videoExt(videoBlobRef.current.type);
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
                    const how = frameLoad(val, compressedSet, id);
                    if (how === 'blob') {
                        return [id, { imageData: null, imageBitmap: null, blob: val, ext: imageExtFromType(val.type) }];
                    }
                    if (how === 'compressed') {
                        const blob = await (await fetch(val)).blob();
                        return [id, { imageData: null, imageBitmap: null, blob, ext: imageExtFromType(blob.type) }];
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
        docEpochRef.current++;   // opening a project: anything still running belongs to the old one
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
            dispatchMedia(loadAudio(data.audio.name || tr('오디오'), audioDataUrl));
            dispatchMedia(setAudioDuration(data.audio.duration || 30));
            dispatchMedia(setAudioClip({ startTime: data.audio.startTime ?? 0, endTime: data.audio.endTime ?? (data.audio.duration || 30), offset: data.audio.offset ?? 0 }));
            if (audioRef.current) audioRef.current.src = audioDataUrl;
        } else {
            audioB64Ref.current = null;
            detachMedia(audioRef.current);
            dispatchMedia(clearAudio());
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
            dispatchMedia(loadVideo({ name: data.video.name || tr('영상'), startTime: data.video.startTime ?? 0, endTime: data.video.endTime ?? (data.video.duration || 0), offset: data.video.offset ?? 0, duration: data.video.duration || 0, w: data.video.w || 0, h: data.video.h || 0, cuts: data.video.cuts, cutStart: data.video.cutStart, cutOffset: data.video.cutOffset }));
        } else {
            videoBlobRef.current = null; dispatchMedia(clearVideo());
            detachMedia(videoElRef.current);
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
        docEpochRef.current++;   // starting over
        dispatchCuts(replaceCuts([{ id: 1, name: 'Cut 1', startTime: 0, endTime: 1, track: 0, layers: [mkLayer(1)], activeLayerId: 1, texts: [] }]));
        setNumTracks(2); setCurrentCutId(1); setCurrentTime(0); setExpandedCuts(new Set());
        setCopiedCut(null); setSelectedCutIds(new Set()); setActivePartId(null);
        setLayerCanvasCache({});
        serverIdRef.current = null; serverNameRef.current = '';
        detachMedia(audioRef.current);
        audioB64Ref.current = null; dispatchMedia(clearAudio());
        videoBlobRef.current = null; dispatchMedia(clearVideo()); setSceneCfg(null);
        detachMedia(videoElRef.current);
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
            const id = 't' + nextId().toString(36);
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
        } finally { setLoadProgress(null); }
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
                k = randomId('bk_');
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
            const id = randomId('l_');
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



    // Debounced autosave to IndexedDB, so a refresh or a crash never costs work. It waits for
    // crash recovery to finish deciding - otherwise a new empty document overwrites the autosave
    // the user is about to be offered - and skips mid-gesture, where a half-drawn stroke is not
    // worth keeping and encoding one costs frames.
    const autosaveDoc = useMemo(() => ({ cuts, numTracks, onionPrev, onionNext, pps }), [cuts, numTracks, onionPrev, onionNext, pps]);
    const { savedAt: autoSavedAt, error: autosaveErr } = useAutosave({
        doc: autosaveDoc,
        ready: () => didRecoverRef.current,
        busy: () => isDrawing.current || isDraggingOrResizingRef.current,
        build: () => {
            gcBitmaps();                       // reclaim orphaned bitmaps before encoding
            return buildData(false, null, true); // IDB stores frame Blobs -> cheap, low-memory
        },
        save: saveAutosave,
    });

    const handleAddCut = () => {
        const last = cuts[cuts.length - 1];
        const ns = last?.endTime ?? 0, trk = last?.track ?? 0;
        if (trk >= numTracks) setNumTracks(trk + 1);
        const nc = { id: nextId(), name: `Cut ${cuts.length + 1}`, startTime: ns, endTime: ns + DEFAULT_CUT_DURATION, track: trk, layers: [mkLayer(1)], activeLayerId: 1, texts: [] };
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
    const updCutCamera = (id, patch) => dispatchCuts(setCutCamera(id, patch));
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
        const src = currentCut;
        let cursor = src ? src.endTime : (cuts.length ? Math.max(...cuts.map(c => c.endTime)) : 0);
        const trk = src ? src.track : (arr[0]?.track ?? 0);
        const made = arr.map((cc) => {
            const dur = cc.endTime - cc.startTime;
            const { layers, activeLayerId, texts } = cloneCutContents(cc);
            const nc = { ...cc, id: nextId(), name: `${cc.name} (copy)`, startTime: cursor, endTime: cursor + dur, track: trk, layers, activeLayerId, texts };
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
                newCuts.push({
                    id: nextId(), name: `${A.name}~${i + 1}`, startTime: st, endTime: st + dur, track: A.track,
                    layers: [{ id: 1, name: 'L1', type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [{ id: nextId(), tool: 'paste', bitmapId, x: 0, y: 0 }] }],
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
        const newId = nextId();
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
            if (!nl.some(l => l.type === 'layer')) nl = [...nl, mkLayer(nextId())];
            const na = toRm.has(c.activeLayerId) ? (nl.find(l => l.type === 'layer')?.id ?? null) : c.activeLayerId;
            return { layers: nl, activeLayerId: na };
        });
    };
    const handleToggleVisible = (e, cutId, layerId) => { e.stopPropagation(); updLayers(cutId, c => ({ layers: patchLayer(c.layers, layerId, l => ({ visible: !l.visible })) })); };
    const handleSetActive = (e, cutId, layerId) => {
        e.stopPropagation();
        const cut = cuts.find(c => c.id === cutId); if (!cut) return;
        const layer = cut.layers.find(l => l.id === layerId); if (!layer || layer.type === 'folder') return;
        dispatchCuts(updateCut(cutId, { activeLayerId: layerId }));
    };
    const handleToggleFolder = (e, cutId, fid) => { e.stopPropagation(); updLayers(cutId, c => ({ layers: patchLayer(c.layers, fid, l => ({ collapsed: !l.collapsed })) })); };
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
    const commitCurve = () => {
        const pts = curveAnchorsRef.current;
        curveAnchorsRef.current = null; curveDraggingRef.current = false; setCurvePts(0);
        if (pts && pts.length >= 2) {
            const st = curveStrokeFromAnchors(pts);
            const mc = canvasRef.current; if (mc) drawStrokesOnCtx(mc.getContext('2d'), [st], false, bitmapStoreRef.current);
            clearLiveOverlay();
            commitStrokeToLayer(currentCutId, drawTargetLayerRef.current || (currentCut?.activeLayerId), st);
            noteColorUsed(st.color);
        } else {
            clearLiveOverlay();
        }
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
        dragOnWindow(mv, () => { panningRef.current = false; });
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
            const zoom = clampZoom(p.startView.zoom * (dist / p.startDist));
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
                return next;
            });
            setRebinding(null);
        };
        window.addEventListener('keydown', h, true);
        return () => window.removeEventListener('keydown', h, true);
    }, [rebinding, setKeymap]);

    // Zoom about the centre of the view, for the buttons and shortcuts.
    const zoomCanvas = (factor) => {
        lastInteractRef.current = Date.now();
        setView(v => {
            const zoom = clampZoom(v.zoom * factor);
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
                const zoom = clampZoom(v.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
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
                liveStrokeRef.current = { id: nextId(), tool: etool, color, opacity, size: brushSize, points: [pos], pen: pressureOn && e.pointerType === 'pen' };
                liveDrawnRef.current = 0; renderLiveStroke(true);
                break;
            }
            case 'line': {
                // Line ruler: the start is pinned and only the end follows, giving a two-point line.
                lineStartRef.current = pos;
                liveStrokeRef.current = { id: nextId(), tool: 'brush', color, opacity, size: brushSize, points: [pos, { ...pos }], pen: pressureOn && e.pointerType === 'pen' };
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
        const id = textEdit.textId ?? nextId();
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
            curve: textEdit.curve ?? 0,
            flipX: !!textEdit.flipX,
            flipY: !!textEdit.flipY,
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
            curve: t.curve ?? 0,
            flipX: !!t.flipX,
            flipY: !!t.flipY,
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
        const primary = currentCut;
        if (primary) {
            visible.add(primary.id);
            if (onionPrev) {
                const prev = onionNeighbours(cuts, primary).prev;
                if (prev) visible.add(prev.id);
            }
            if (onionNext) {
                const next = onionNeighbours(cuts, primary).next;
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
                const layerStrokes = layerSig(layer);
                if (!canvas || canvas.dataset.strokes !== layerStrokes) {
                    // Skip (don't cache a blank) if a frame isn't decoded yet — the prefetch effect
                    // decodes it and repaints. Do NOT request a decode here (would loop with tick).
                    if (scanLayerBitmaps(layer, bitmapStoreRef.current).pending.length) continue;
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
    }, [cuts, currentCutId, currentCut, currentTime, onionPrev, onionNext]);

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
        const sig = layerSig(layer, rOpts);
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
        // Draw the layer into the cache under a signature. The complete and the incomplete paths
        // below were the same six lines twice, differing only in that signature - and two copies
        // of a caching rule are two chances for them to drift into disagreeing about what is
        // cached under what.
        //
        // Resize only when the size actually changed: this canvas is reused every boiling phase,
        // ten times a second, and re-assigning the same width reallocated 8MB each time - the
        // measured 79MB/s that ran the tab out of memory. drawStrokesOnCtx clears it either way,
        // which is why this does not go through scratchCanvas.
        const bake = (signature) => {
            const cnv = hit || document.createElement('canvas');
            sizeCanvas(cnv, CANVAS_W, CANVAS_H);
            drawStrokesOnCtx(cnv.getContext('2d'), layer.strokes, true, store, rOpts);
            cnv.dataset.strokes = signature;
            map.delete(slotKey); map.set(slotKey, cnv);   // re-insert = most recently used
            while (map.size > LAYER_CANVAS_LRU) map.delete(map.keys().next().value);
            return cnv;
        };
        const scan = scanLayerBitmaps(layer, store);
        const missing = scan.pending;
        // Anything this layer did draw from is now the most recently used, so the LRU keeps it.
        for (const id of scan.decoded) touchDecoded(id);
        if (missing.length) {
            if (isPlayingRef.current) requestFrameDecode(missing);
            if (cached || hit) return cached || hit;
            // If a bitmap (a video frame, say) has not decoded yet - or never will - the layer
            // is still not skipped wholesale. Skipping it would take the pen strokes on the same
            // layer with it and leave the screen blank, which is what happened when a server
            // asset was unavailable. Instead the strokes that can be drawn are drawn, and the
            // signature is marked incomplete so it redraws once the decode finishes.
            return bake(sig + '|miss' + missing.length);
        }
        return bake(sig);
    };


    // A clipping group, flattened into one canvas.
    //
    // Clipping is "show only where the layer below has paint", and the way to get that from a 2D
    // context is `destination-in`: stack the clipped layers, then keep only the pixels that
    // overlap the base's alpha.
    //
    // It has to happen before the per-layer transform rather than after. A clipped layer is paint
    // *on* the base - shading inside a shape - so it moves with the base; masking after each
    // layer had been transformed separately would let the shadow slide out of the thing it is
    // shading. The clipped layers' own part animations are therefore ignored, which is the same
    // choice every drawing app makes and the reason the group is composited as a unit.
    //
    // Two scratch canvases and one composite pass per group, and only for groups that actually
    // have something clipped to them - a stack with no clipping does not allocate anything.
    const clipScratchRef = useRef(null);
    const clipPaintRef = useRef(null);
    const flattenClipGroup = (cutId, group) => {
        const baseCanvas = ensureLayerCanvas(cutId, group.base);
        if (!baseCanvas || group.clipped.length === 0) return baseCanvas;

        // Every clipped layer has to be ready, or the group would flash without its shading while
        // one frame is still decoding.
        // A layer being dragged is drawn by the overlay with the original hidden, and a clipped
        // one is no different - leaving it in the group would draw it twice and trail a ghost.
        const drag = layerDragRef.current;
        const dragging = (id) => !!drag && drag.cutId === cutId && drag.layerIds.includes(id);

        const parts = [];
        for (let k = group.clipped.length - 1; k >= 0; k--) {   // bottom-to-top within the group
            if (dragging(group.clipped[k].id)) continue;
            const c = ensureLayerCanvas(cutId, group.clipped[k]);
            if (!c) return baseCanvas;
            parts.push(c);
        }
        if (parts.length === 0) return baseCanvas;

        const { canvas: paint, ctx: pctx } = scratchCanvas(clipPaintRef, CANVAS_W, CANVAS_H);
        pctx.globalCompositeOperation = 'source-over';
        for (const c of parts) pctx.drawImage(c, 0, 0);

        // Keep only what lands on the base.
        pctx.globalCompositeOperation = 'destination-in';
        pctx.drawImage(baseCanvas, 0, 0);
        pctx.globalCompositeOperation = 'source-over';

        const { canvas: out, ctx: octx } = scratchCanvas(clipScratchRef, CANVAS_W, CANVAS_H);
        octx.drawImage(baseCanvas, 0, 0);
        octx.drawImage(paint, 0, 0);
        return out;
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

        if (!playing && primary) {
            if (onionPrev) {
                const prevCut = onionNeighbours(cuts, primary).prev;
                if (prevCut) {
                    const order = flattenLayersInUiOrder(prevCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = ensureLayerCanvas(prevCut.id, order[i]);
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
                }
            }
            if (onionNext) {
                const nextCut = onionNeighbours(cuts, primary).next;
                if (nextCut) {
                    const order = flattenLayersInUiOrder(nextCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = ensureLayerCanvas(nextCut.id, order[i]);
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
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

                // Per-layer ("part") transform nests inside the cut transform.
                const la = group.anim;
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
                    // Reused rather than allocated. This runs inside the composite loop, so a
                    // fresh canvas here is 8MB per masked layer per frame - sixty times a second
                    // while playing, which is the shape of allocation that took a tab out once.
                    const { canvas: tmp, ctx: tctx } = scratchCanvas(maskScratchRef, CANVAS_W, CANVAS_H);
                    tctx.setTransform(1, 0, 0, 1, 0, 0);
                    tctx.globalAlpha = 1.0;
                    tctx.globalCompositeOperation = 'source-over';
                    tctx.drawImage(layerCanvas, 0, 0);
                    tctx.globalCompositeOperation = 'destination-out';
                    // imageDataCanvas is a different shared canvas from this one, so nesting them
                    // is safe - which is why they are separate helpers rather than slots of one.
                    tctx.drawImage(mb || imageDataCanvas(mi), mx, my);
                    tctx.globalCompositeOperation = 'source-over';
                    ctx.drawImage(tmp, 0, 0);
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

            if (bmp) ctx.drawImage(bmp, tx, ty, tw, th);
            else if (img) ctx.drawImage(imageDataCanvas(img), tx, ty, tw, th);

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
            const cc = currentCut;
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
    }, [paintFrame, cuts, currentCutId, currentCut, isPlaying, scrubbing, currentTime, lassoPoints, selection, selectedText, animLayer]);

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
    }, [isPlaying, cuts, currentCutId, currentCut]);

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
        dispatchMedia(loadAudio(name, url));
        const audio = new Audio(url);
        // startAt aligns the track to a given timeline position (e.g. the first imported video frame);
        // offset/clipDur select a sub-range of the source audio (used when only a video segment is
        // imported), so audio + frames extracted together stay mechanically in sync.
        audio.onloadedmetadata = () => {
            dispatchMedia(setAudioDuration(audio.duration));
            const dur = clipDur != null ? Math.min(clipDur, Math.max(0, audio.duration - offset)) : Math.max(0, audio.duration - offset);
            dispatchMedia(setAudioClip({ startTime: startAt, endTime: startAt + dur, offset }));
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
            dispatchMedia(loadVideo({ name: name || tr('영상'), startTime: startAt, endTime: startAt + dur, offset, duration: v.duration, w: v.videoWidth, h: v.videoHeight }));
            // Prime the first frame so a paused canvas shows something immediately.
            try { v.currentTime = offset; } catch { }
        };
        v.onseeked = () => { setFrameDecodeTick(t => t + 1); }; // repaint the (paused) overlay frame
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
            const kept = cuts.filter(c => c.videoSrc !== srcKey);
            const track = kept.find(c => c.id === currentCutId)?.track ?? 0;
            const startAt = kept.filter(c => c.track === track).reduce((m, c) => Math.max(m, c.endTime), 0);
            const dur = 1 / Math.max(0.1, fps);
            // The batch key comes from an id rather than the clock so that importing twice in
            // quick succession cannot produce two batches with the same name.
            const batch = 'vb_' + nextId().toString(36);
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
                    id: nextId(), name: `${label} ${i + 1}`, startTime: s, endTime: e, track,
                    activeLayerId: 1, texts: [], videoBatch: batch, videoLabel: label, videoSrc: srcKey, partId, partName,
                    layers: [{ id: 1, name: 'L1', type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [{ id: nextId(), tool: 'paste', bitmapId, x: px, y: py, w: pw, h: ph }] }],
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
        detachMedia(audioRef.current);
        if (audioUrl && audioUrl.startsWith('blob:')) { try { URL.revokeObjectURL(audioUrl); } catch { } }
        audioB64Ref.current = null;
        dispatchMedia(clearAudio());
    };
    const loadYoutubeAudio = async (presetUrl) => {
        const url = typeof presetUrl === 'string' ? presetUrl : null;
        if (!url) { setLinkPrompt({ kind: 'audio' }); return; }
        try {
            const res = await fetch('/api/youtube-audio?url=' + encodeURIComponent(url));
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
            const blob = await res.blob();
            loadAudioUrl(URL.createObjectURL(blob), tr('유튜브 음원'));
        } catch (e) { alert(tr('음원 추출 실패: ') + e.message); }
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
    const handleExportFrames = async () => {
        const canvas = canvasRef.current; if (!canvas) return;
        const ctMax = Math.max(...cuts.map(c => c.endTime), 0);
        if (ctMax <= 0) { alert(tr('내보낼 콘텐츠가 없습니다.')); return; }
        // A GIF at 30fps is enormous and plays no better; twelve is what hand-drawn animation
        // usually runs at anyway. A PNG sequence is going into an editor, so it keeps the full
        // rate.
        const gif = transparentFormat === 'gif';
        const fps = gif ? 12 : 30;
        // A GIF at the project's full size is not a thing anyone wants: every pixel is a palette
        // index and none of it is inter-frame compressed, so a second of 1920x1080 runs to tens
        // of megabytes and takes as long again to encode. Scaled to fit 720 on the long edge it
        // is a file that can be posted. A PNG sequence keeps the full size.
        const gifScale = gif ? Math.min(1, GIF_MAX_EDGE / Math.max(CANVAS_W, CANVAS_H)) : 1;
        const gw = Math.max(1, Math.round(CANVAS_W * gifScale));
        const gh = Math.max(1, Math.round(CANVAS_H * gifScale));
        // One scratch canvas for the whole export rather than one a frame.
        const gifScratch = { current: null };
        const total = Math.max(1, Math.round(ctMax * fps));
        // Every frame is held in memory until the file is built, so the cap is about RAM, not
        // patience: a thousand 1080p frames is already a few hundred megabytes.
        if (total > 1000 && !confirm(tr('{0}프레임을 내보냅니다. 메모리를 많이 쓰고 오래 걸립니다. 계속할까요?').replace('{0}', String(total)))) return;

        const label = tr('프레임 내보내는 중');
        setLoadProgress({ label, done: 0, total });
        isExporting.current = true;
        const entries = [];
        try {
            for (let i = 0; i < total; i++) {
                const t = i / fps;
                // Wait for what this frame needs rather than painting without it.
                const scene = evaluateFrame(cuts, t, { playing: true, currentCutId, cw: CANVAS_W, ch: CANVAS_H });
                const missing = pendingBitmapIds(scene.cuts.map(e => e.cut), bitmapStoreRef.current);
                if (missing.length) {
                    const store = bitmapStoreRef.current;
                    for (const id of missing) {
                        const e = store.get(id); if (!e || !e.blob) continue;
                        try { e.imageBitmap = await decodeFrameBitmap(e); } catch { }
                    }
                    invalidateCutsUsing(missing);
                }
                paintFrame(t, true);
                if (gif) {
                    // Straight off the canvas as pixels: going through a PNG and back would cost
                    // an encode and a decode a frame for nothing.
                    let src = canvas;
                    if (gifScale < 1) {
                        const { canvas: small, ctx: sctx } = scratchCanvas(gifScratch, gw, gh);
                        sctx.imageSmoothingQuality = 'high';
                        sctx.drawImage(canvas, 0, 0, gw, gh);
                        src = small;
                    }
                    entries.push({ rgba: src.getContext('2d').getImageData(0, 0, gw, gh).data });
                } else {
                    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                    if (!blob) throw new Error('toBlob returned nothing');
                    entries.push({ name: frameName(i, total), data: new Uint8Array(await blob.arrayBuffer()) });
                }
                // Yield often enough that the progress bar moves and the tab stays answerable.
                if (i % 5 === 0 || i === total - 1) {
                    setLoadProgress({ label, done: i + 1, total });
                    await new Promise(res => setTimeout(res, 0));
                }
            }
            const { bytes, type, name } = gif
                ? {
                    bytes: encodeGif(entries, { width: gw, height: gh, delayMs: Math.round(1000 / fps) }),
                    type: 'image/gif', name: 'mv_export.gif',
                }
                : { bytes: makeZip(entries), type: 'application/zip', name: 'mv_frames.zip' };
            const url = URL.createObjectURL(new Blob([bytes], { type }));
            const a = Object.assign(document.createElement('a'), { href: url, download: name, style: 'display:none' });
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
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
                        {!isFolder && (() => {
                            // Shown even where it cannot apply, greyed out: hiding it would make
                            // the row's controls shift position as layers are reordered, which is
                            // worse than a disabled button.
                            const clippable = canClip(flattenLayersInUiOrder(cut.layers || []).filter(l => l.type === 'layer'), layer.id);
                            return (
                                <button className="icon-btn" disabled={!clippable && !layer.clipped}
                                    style={{ color: layer.clipped ? 'var(--accent-pale)' : undefined, opacity: (clippable || layer.clipped) ? 1 : 0.3 }}
                                    title={layer.clipped
                                        ? tr('클리핑 해제 (지금은 아래 레이어가 그려진 곳에만 보입니다)')
                                        : clippable
                                            ? tr('아래 레이어에 클리핑 — 아래 레이어가 그려진 곳에만 보이게 합니다')
                                            : tr('맨 아래 레이어는 클리핑할 대상이 없습니다')}
                                    onClick={e => { e.stopPropagation(); dispatchCuts(setLayerClipped(cut.id, layer.id, !layer.clipped)); }}>
                                    <CornerDownRight size={11} />
                                </button>
                            );
                        })()}
                        {!isFolder && (
                            <button className="icon-btn" title={tr('아래 레이어와 병합')}
                                onClick={e => { e.stopPropagation(); dispatchCuts(mergeLayerDown(cut.id, layer.id, flattenLayersInUiOrder)); }}>
                                <ArrowDownToLine size={11} />
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
                            cutProgress={cutProgress(cut, currentTime)} />
                    )}
                    {dt === 'after' && <div className="drop-line" />}
                    {isFolder && !layer.collapsed && renderLayers(cut, layer.id, depth + 1)}
                </div>
            );
        });
    };

    // Tool panel: the buttons keep a comfortable size and the column count follows the width.
    const toolW = Math.max(56, leftW || 96);
    // Named rather than inlined as [!!textEdit]: a dependency the linter cannot read is a
    // dependency nobody can check. This way it runs when the editor opens or closes and not
    // on every keystroke, which would drag the user back from the cut list mid-edit.
    const editingText = !!textEdit;
    useEffect(() => { setRightTab(editingText ? 'text' : 'cut'); }, [editingText]);

    const isSelectionTool = tool === 'lasso' || !!selection;
    liveRef.current = { cuts, copiedCut, selection, audioData, numTracks }; // current GC + history sources

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
        dragOnWindow(mv, (ev) => {
            const zone = dropZoneAt(ev.clientX);
            setPanelDrag(null);
            setDocks(d => ({ ...d, [id]: zone }));
            if (zone === 'float') setFloatPos(p => ({ ...p, [id]: { x: Math.max(0, ev.clientX - grab.dx), y: Math.max(0, ev.clientY - grab.dy) } }));
        });
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
            eraserSize={eraserSize} setEraserSize={setEraserSize}
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
                reimportRecent={reimportRecent} serverAvailable={serverAvailable} setToast={setToast} showFileMenu={showFileMenu}
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
                    {cameraCapture && (
                        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 31, background: 'var(--accent-soft)', color: '#fff', fontSize: 12, padding: '6px 12px', borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                            {tr('카메라가 지나갈 길을 그리세요 — 재생하면 그 길을 따라갑니다')}
                            <button className="button" style={{ height: 24, padding: '0 8px' }} onClick={() => setCameraCapture(null)}>{tr('취소')}</button>
                        </div>
                    )}
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
                            {Math.round(view.zoom * 100)}% <RotateCcw size={11} />
                        </button>
                    )}
                    <div className={`canvas-stage${transparentBg ? ' checkered' : ''}`} style={{ position: 'relative', transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, maxWidth: '100%', maxHeight: '100%' }}>
                        {/* tabIndex -1: focusable from code, never a stop in the tab order. The
                            canvas is where the keys are meant to land, but nobody tabs to a
                            drawing surface. */}
                        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} tabIndex={-1}
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
                transparentBg={transparentBg} setTransparentBg={setTransparentBg}
                transparentFormat={transparentFormat} setTransparentFormat={setTransparentFormat}
                numTracks={numTracks} onTimelinePointerDown={onTimelinePointerDown}
                onTimelinePointerMove={onTimelinePointerMove} onTimelinePointerUp={onTimelinePointerUp} parts={parts}
                playbackRate={playbackRate} playheadRef={playheadRef} pps={pps}
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
