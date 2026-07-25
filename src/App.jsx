import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Play, Pause, Square, Plus, Trash2, Download, Upload, PenLine, Pen, Feather, Eraser, Droplets, Undo, Redo, Layers, Trash, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FolderPlus, Folder, FolderOpen, Settings, Eye, EyeOff, Copy, CopyPlus, ClipboardPaste, GitBranch, Move, Type, Server, Cloud, CloudDownload, Film, Repeat } from 'lucide-react';
import './App.css';
import { saveAutosave, loadAutosave, saveProject, loadProject, listProjects, deleteProject, autosaveKey } from './db';
import { CutAnimPanel, LayerAnimPanel } from './AnimPanels';
import {
    DEFAULT_CUT_DURATION, CANVAS_W as CANVAS_W_DEFAULT, CANVAS_H as CANVAS_H_DEFAULT, FONT_PRESETS,
    pointInPolygon, dist, safeArray, hexToRgb, bucketFillTransparentRegion,
    layerKey, imageDataToDataURL, dataURLToImageData, drawStrokesOnCtx,
    flattenForCanvas, flattenLayersInUiOrder, strokeSig, extractVideoFrames, fitRect, detectSceneCuts,
    ANIM_DEFAULT, computeCutAnim, LAYER_ANIM_DEFAULT, computeLayerAnim,
} from './canvasUtils';

const PEN_TYPES = [
    { id: 'pen', label: 'Dot', Icon: PenLine },
    { id: 'brush', label: '펜', Icon: Feather },
    { id: 'pencil', label: '연필', Icon: PenLine },
    { id: 'soft', label: '에어', Icon: Cloud },
    { id: 'marker', label: 'Marker', Icon: Pen },
    { id: 'eraser', label: 'Eraser', Icon: Eraser },
    { id: 'fill', label: 'Fill', Icon: Droplets },
];
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
    return <canvas ref={ref} width={56} height={31} style={{ width: 42, height: 23, borderRadius: 3, background: '#fff', flexShrink: 0, border: '1px solid #2e2e40' }} />;
}

function ProjectPicker({ title, items, onOpen, onDelete, onClose }) {
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 420, maxHeight: '70vh', overflow: 'auto', background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">{title}</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
                {items.length === 0 && <div style={{ fontSize: 12, color: '#888', padding: '12px 2px' }}>저장된 프로젝트가 없습니다.</div>}
                {items.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid #2a2a3a' }}>
                        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(p.id, p.name)}>
                            <div style={{ fontSize: 13, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                            <div style={{ fontSize: 10, color: '#777' }}>{p.savedAt ? new Date(p.savedAt).toLocaleString() : ''}</div>
                        </div>
                        <button className="button" style={{ height: 28, padding: '0 10px' }} onClick={() => onOpen(p.id, p.name)}>열기</button>
                        <button className="icon-btn del-btn" onClick={() => onDelete(p.id)}><Trash2 size={13} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function App() {
    const mkLayer = (id) => ({ id, name: `L${id}`, type: 'layer', strokes: [], redoStrokes: [], visible: true, parentId: null });
    const [cuts, setCuts] = useState([{ id: 1, name: 'Cut 1', startTime: 0, endTime: 1, track: 0, layers: [mkLayer(1)], activeLayerId: 1, texts: [] }]);
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
    const [timelineH, setTimelineH] = useState(240);
    const [showLeft, setShowLeft] = useState(true);
    const [showRight, setShowRight] = useState(true);
    const [showBottom, setShowBottom] = useState(true);
    const [splitter, setSplitter] = useState(null);
    const [snapLinePos, setSnapLinePos] = useState(null);
    const [audioFile, setAudioFile] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const [audioDuration, setAudioDuration] = useState(30);
    const [audioData, setAudioData] = useState(null);
    const audioRef = useRef(null);
    const audioB64Ref = useRef(null); // audio as base64 data URL, embedded into saves
    // Video overlay track: play the original video underneath the drawing layers (no per-frame
    // cuts) — for "덧그리기" over a video. Like audio but drawn onto the canvas each frame.
    const [videoOverlay, setVideoOverlay] = useState(null); // { name, startTime, endTime, offset, duration, w, h, cuts? }
    const [sceneDetect, setSceneDetect] = useState(null);   // { done, total } while auto-detecting scene cuts
    const [detectCfg, setDetectCfg] = useState({ threshold: 20, startText: '', endText: '', open: false }); // scene-detect controls
    const videoElRef = useRef(null);      // hidden <video> element that decodes/plays the overlay
    const videoBlobRef = useRef(null);    // the video Blob, for saving
    const videoSeekTokRef = useRef(0);    // paused-seek token so a stale 'seeked' doesn't repaint
    const [videoImport, setVideoImport] = useState(null); // {file, fps, maxFrames} dialog
    const [recentVideos, setRecentVideos] = useState([]); // fetched/opened videos, reusable without re-downloading
    const [videoBusy, setVideoBusy] = useState(null); // {done, total} while extracting
    const [videoBusyBg, setVideoBusyBg] = useState(false); // extraction moved to a background chip
    const videoStopRef = useRef(false);
    const isExporting = useRef(false);
    const mediaRecorderRef = useRef(null);
    const audioCtxRef = useRef(null);
    const audioSourceRef = useRef(null);
    const audioDestRef = useRef(null);
    const exportEndRef = useRef(0);
    const [tool, setTool] = useState('pen');
    const [color, setColor] = useState('#000000');
    const [brushSize, setBrushSize] = useState(5);
    const [eraserSize, setEraserSize] = useState(20);
    const [opacity, setOpacity] = useState(1.0);
    const [expandedCuts, setExpandedCuts] = useState(new Set());
    const [collapsedCutIds, setCollapsedCutIds] = useState(new Set());
    const [renamingCutId, setRenamingCutId] = useState(null);
    const [selectedCutIds, setSelectedCutIds] = useState(new Set());
    const [marquee, setMarquee] = useState(null); // rubber-band rect (content px) while drag-selecting cuts
    const [activePartId, setActivePartId] = useState(null); // scope playback/editing to one part (null = 전체)
    const lassoClipRef = useRef(null); // copied lasso pixels: { bitmapId, w, h }
    const [hasLassoClip, setHasLassoClip] = useState(false);
    const [showFileMenu, setShowFileMenu] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const fileHandleRef = useRef(null);
    const [dragLayerInfo, setDragLayerInfo] = useState(null);
    const [dropInfo, setDropInfo] = useState(null);
    const canvasRef = useRef(null);
    const isDrawing = useRef(false);
    const reqRef = useRef(null);
    const isPlayingRef = useRef(false);
    const fileMenuRef = useRef(null);
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
        for (const k of affected) fallbackCanvasRef.current.delete(k);
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
    const historyIndexRef = useRef(-1);
    const isUndoRedoRef = useRef(false);
    const isDraggingOrResizingRef = useRef(false);

    const updLayers = (cutId, fn) => setCuts(p => p.map(c => c.id === cutId ? { ...c, ...fn(c) } : c));

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

    // Lasso → 파츠: lift the selected region out of its source layer into a NEW layer,
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
            const partLayer = { id: newId, name: `파츠 ${newId}`, type: 'layer', parentId: null, visible: true, redoStrokes: [], strokes: [{ id: Date.now() + 1, tool: 'paste', bitmapId: sel.bitmapId, x: tx, y: ty, w: tw, h: th }] };
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
        setTool(newTool);
    };

    useEffect(() => {
        if (isDrawing.current || isDraggingOrResizingRef.current || selectionDragRef.current) return;
        if (isUndoRedoRef.current) { isUndoRedoRef.current = false; return; }
        const snapshot = JSON.stringify({ cuts, audioData, numTracks });
        if (historyRef.current.length > 0 && JSON.stringify(historyRef.current[historyIndexRef.current]) === snapshot) return;
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current.push(JSON.parse(snapshot));
        historyIndexRef.current = historyRef.current.length - 1;
        if (historyRef.current.length > 80) { historyRef.current.shift(); historyIndexRef.current--; }
    }, [cuts, audioData, numTracks]);

    const applyHistory = (snap) => {
        const s = JSON.parse(JSON.stringify(snap));
        isUndoRedoRef.current = true;
        setCuts(s.cuts);
        setAudioData(s.audioData ?? null);
        setNumTracks(s.numTracks ?? 2);
    };
    const globalUndo = () => {
        if (historyIndexRef.current <= 0) return;
        historyIndexRef.current--;
        applyHistory(historyRef.current[historyIndexRef.current]);
    };
    const globalRedo = () => {
        if (historyIndexRef.current >= historyRef.current.length - 1) return;
        historyIndexRef.current++;
        applyHistory(historyRef.current[historyIndexRef.current]);
    };

    const maxTime = Math.max(60, audioData?.endTime ?? audioDuration, videoOverlay?.endTime ?? 0, ...cuts.map(c => c.endTime)) + 60;
    // Actual content bounds (where cuts/audio live) — playback & loop run between these,
    // not out to maxTime (which has empty padding for the timeline ruler).
    const contentEnd = Math.max(0, audioData?.endTime ?? 0, videoOverlay?.endTime ?? 0, ...cuts.map(c => c.endTime));
    const contentStart = (cuts.length || videoOverlay) ? Math.max(0, Math.min(videoOverlay?.startTime ?? Infinity, ...cuts.map(c => c.startTime), audioData?.startTime ?? Infinity)) : 0;
    // Parts (scenes): cuts grouped by partId. Each video import is one part; cuts can also be
    // grouped manually. Selecting a part scopes playback (and dims the rest) to it.
    const parts = (() => {
        const m = new Map();
        for (const c of cuts) {
            if (!c.partId) continue;
            const p = m.get(c.partId) || { id: c.partId, name: c.partName || '파트', count: 0, start: Infinity, end: 0 };
            p.count++; p.start = Math.min(p.start, c.startTime); p.end = Math.max(p.end, c.endTime);
            m.set(c.partId, p);
        }
        return [...m.values()].sort((a, b) => a.start - b.start);
    })();
    const activePart = activePartId ? parts.find(p => p.id === activePartId) : null;
    // Playback runs within the active part when one is selected, else across all content.
    const playStart = activePart ? activePart.start : contentStart;
    const playEnd = activePart ? activePart.end : contentEnd;

    useEffect(() => {
        const h = (e) => { if (fileMenuRef.current && !fileMenuRef.current.contains(e.target)) setShowFileMenu(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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
    }, [cuts, currentCutId, copiedCut, selection]);

    useEffect(() => {
        if (selection && selection.cutId !== currentCutId) cancelSelection();
    }, [currentCutId, selection]);

    useEffect(() => {
        if (selectedText && selectedText.cutId !== currentCutId) setSelectedText(null);
    }, [currentCutId, selectedText]);

    useEffect(() => {
        if (!textEdit) return;
        // Focus after rendering overlay.
        queueMicrotask(() => textAreaRef.current?.focus());
    }, [textEdit]);

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
            if (splitter.type === 'right') setRightW(Math.max(200, Math.min(600, splitter.startW + (splitter.startX - e.clientX))));
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
                setCuts(prev => {
                    const tc = prev.find(c => c.id === resizingData.cutId); if (!tc) return prev;
                    const others = prev.filter(o => o.id !== tc.id && o.track === tc.track);
                    const edges = [0, ...others.flatMap(o => [o.startTime, o.endTime])];
                    const snap = (v) => { for (const ed of edges) { if (Math.abs((v - ed) * pps) <= 8) return ed; } return v; };
                    if (resizingData.edge === 'left') {
                        let ns = snap(Math.max(0, i0 + dt));
                        for (const o of others) if (ns < o.endTime && i0 >= o.endTime) ns = o.endTime;
                        ns = Math.min(ns, i1 - 0.05);
                        setSnapLinePos(ns * pps + 60);
                        return prev.map(c => c.id === tc.id ? { ...c, startTime: ns } : c);
                    } else {
                        let ne = snap(Math.max(i0 + 0.05, i1 + dt));
                        for (const o of others) if (ne > o.startTime && i1 <= o.startTime) ne = o.startTime;
                        setSnapLinePos(ne * pps + 60);
                        return prev.map(c => c.id === tc.id ? { ...c, endTime: ne } : c);
                    }
                });
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
                    const minStart = Math.min(...grp.map(g => g.startTime));
                    const minTrack = Math.min(...grp.map(g => g.track)), maxTrack = Math.max(...grp.map(g => g.track));
                    const cdt = Math.max(dt, -minStart);
                    const cto = Math.max(-minTrack, Math.min(numTracks - 1 - maxTrack, trackOff));
                    const byId = new Map(grp.map(g => [g.id, g]));
                    setSnapLinePos(null);
                    setCuts(prev => prev.map(c => {
                        const g = byId.get(c.id); if (!g) return c;
                        const ns = Math.max(0, g.startTime + cdt), dur = g.endTime - g.startTime;
                        return { ...c, startTime: ns, endTime: ns + dur, track: g.track + cto };
                    }));
                    return;
                }
                setCuts(prev => {
                    const tc = prev.find(c => c.id === draggingCutData.cutId); if (!tc) return prev;
                    let ns = Math.max(0, draggingCutData.initialStart + dt), dur = tc.endTime - tc.startTime;
                    const nt = Math.max(0, Math.min(numTracks - 1, draggingCutData.initialTrack + trackOff));
                    const others = prev.filter(o => o.id !== tc.id && o.track === nt);
                    const edges = [0, ...others.flatMap(o => [o.startTime, o.endTime])];
                    const snap = (v) => { for (const e of edges) { if (Math.abs((v - e) * pps) <= 8) return e; } return v; };
                    const snStart = snap(ns);
                    const snEnd = snap(ns + dur);
                    const dS = Math.abs((snStart - ns) * pps), dE = Math.abs((snEnd - (ns + dur)) * pps);
                    let snapped = false;
                    if (dS <= 8 && dS <= dE) { ns = snStart; setSnapLinePos(ns * pps + 60); snapped = true; }
                    else if (dE <= 8) { ns = snEnd - dur; setSnapLinePos((ns + dur) * pps + 60); snapped = true; }
                    if (!snapped) setSnapLinePos(null);
                    for (const o of others) {
                        if (ns < o.endTime && ns + dur > o.startTime) {
                            const sideL = o.startTime - dur, sideR = o.endTime;
                            ns = Math.abs(ns - sideL) < Math.abs(ns - sideR) ? sideL : sideR;
                            setSnapLinePos(null);
                        }
                    }
                    ns = Math.max(0, ns);
                    return prev.map(c => c.id === tc.id ? { ...c, startTime: ns, endTime: ns + dur, track: nt } : c);
                });
            }
        };
        const up = () => {
            isDraggingOrResizingRef.current = false;
            clearTimeout(cutDragTimerRef.current);
            cutDragArmedRef.current = false;
            setResizingData(null); setDraggingCutData(null); setSnapLinePos(null);
            setCuts(prev => {
                const lv = liveRef.current;
                const snapshot = JSON.stringify({ cuts: prev, audioData: lv.audioData, numTracks: lv.numTracks });
                if (historyRef.current.length > 0 && JSON.stringify(historyRef.current[historyIndexRef.current]) === snapshot) return prev;
                historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
                historyRef.current.push(JSON.parse(snapshot));
                historyIndexRef.current = historyRef.current.length - 1;
                if (historyRef.current.length > 80) { historyRef.current.shift(); historyIndexRef.current--; }
                return prev;
            });
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    }, [resizingData, draggingCutData, pps, numTracks]);

    // Free bitmaps no longer referenced by any cut, history snapshot, clipboard, or selection.
    // Scans ALL reference sources so undo/paste never lose their pixels.
    const gcBitmaps = () => {
        const used = new Set();
        const scan = (arr) => arr && arr.forEach(c => c.layers && c.layers.forEach(l => l.strokes && l.strokes.forEach(s => { if (s.bitmapId) used.add(s.bitmapId); })));
        const live = liveRef.current;
        scan(live.cuts);
        historyRef.current.forEach(s => scan(s.cuts));
        const cc = live.copiedCut; if (cc) scan(Array.isArray(cc) ? cc : [cc]);
        if (lassoClipRef.current?.bitmapId) used.add(lassoClipRef.current.bitmapId);
        const sel = live.selection; if (sel) { if (sel.bitmapId) used.add(sel.bitmapId); if (sel.maskBitmapId) used.add(sel.maskBitmapId); }
        const store = bitmapStoreRef.current, cache = dataUrlCacheRef.current;
        for (const id of [...store.keys()]) if (!used.has(id)) { store.delete(id); cache.delete(id); }
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
            const meta = { name: audioFile?.name || '오디오', startTime: audioData.startTime, endTime: audioData.endTime, offset: audioData.offset, duration: audioDuration };
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
    const restore = async (data, assetBase = null) => {
        if (data.appName !== 'EasyMVMaker') { alert('올바른 .emv 파일이 아닙니다.'); return; }
        // Rebuild the bitmap store before swapping cuts in, so fill/lasso/paste render correctly.
        const store = bitmapStoreRef.current;
        store.clear();
        // Externalized frame assets (server projects): fetch one at a time and keep as a Blob
        // (off-heap). Bounded memory — one frame in flight.
        if (assetBase && Array.isArray(data.assets)) {
            for (const a of data.assets) {
                try {
                    const blob = await (await fetch(`${assetBase}/asset/${a.id}`)).blob();
                    // Don't decode here — lazy decode on display keeps opening a big project from OOMing.
                    store.set(a.id, { imageData: null, imageBitmap: null, blob, ext: a.ext, w: a.w || 0, h: a.h || 0 });
                } catch { }
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
                } catch { return null; }
            }));
            entries.forEach(e => { if (e) store.set(e[0], e[1]); });
        }
        setCuts(data.cuts.map(c => ({
            ...c,
            // Migrate older projects: a video import (videoBatch) becomes a part.
            partId: c.partId ?? c.videoBatch, partName: c.partName ?? c.videoLabel,
            texts: safeArray(c.texts),
            layers: c.layers.map(l => ({ type: 'layer', parentId: null, ...l, redoStrokes: [] }))
        })));
        setActivePartId(null);
        if (data.canvas?.w && data.canvas?.h) setCanvasSize({ w: data.canvas.w, h: data.canvas.h });
        setNumTracks(data.numTracks || 2); setCurrentCutId(data.cuts[0]?.id || 1); setCurrentTime(0);
        setOnionPrev(data.onionPrev ?? false); setOnionNext(data.onionNext ?? false); setPps(data.pps ?? 50); setExpandedCuts(new Set());
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
            setAudioFile({ name: data.audio.name || '오디오' });
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
            setVideoOverlay({ name: data.video.name || '영상', startTime: data.video.startTime ?? 0, endTime: data.video.endTime ?? (data.video.duration || 0), offset: data.video.offset ?? 0, duration: data.video.duration || 0, w: data.video.w || 0, h: data.video.h || 0, cuts: data.video.cuts, cutStart: data.video.cutStart, cutOffset: data.video.cutOffset });
        } else {
            videoBlobRef.current = null; setVideoOverlay(null);
            if (videoElRef.current) { try { videoElRef.current.pause(); videoElRef.current.removeAttribute('src'); videoElRef.current.load(); } catch { } }
        }
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
    const doOpen = async () => {
        if ('showOpenFilePicker' in window) {
            try { const [h] = await window.showOpenFilePicker({ types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] }); fileHandleRef.current = h; await restore(JSON.parse(await (await h.getFile()).text())); return; } catch (e) { if (e.name === 'AbortError') return; }
        }
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.emv';
        inp.onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { restore(JSON.parse(ev.target.result)) } catch (err) { alert('파일 오류: ' + err.message) } }; r.readAsText(f); }; inp.click();
    };
    const doNew = () => {
        if (!window.confirm('새 프로젝트? 저장되지 않은 내용은 사라집니다.')) return;
        fileHandleRef.current = null;
        bitmapStoreRef.current.clear();
        setCuts([{ id: 1, name: 'Cut 1', startTime: 0, endTime: 1, track: 0, layers: [mkLayer(1)], activeLayerId: 1, texts: [] }]);
        setNumTracks(2); setCurrentCutId(1); setCurrentTime(0); setExpandedCuts(new Set());
        setCopiedCut(null);
        setLayerCanvasCache({});
        serverIdRef.current = null; serverNameRef.current = '';
        if (audioRef.current) { audioRef.current.pause(); try { audioRef.current.removeAttribute('src'); audioRef.current.load(); } catch { } }
        audioB64Ref.current = null; setAudioFile(null); setAudioUrl(null); setAudioData(null);
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
        for (let i = 0; i < assetSink.length; i++) {
            const a = assetSink[i];
            // Prefer the Blob (uploads directly, no decode); fall back to a legacy dataURL.
            const blob = a.blob || await (await fetch(a.url)).blob();
            const res = await fetch(`/api/projects/${id}/asset/${a.id}?ext=${encodeURIComponent(a.ext)}`, {
                method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
            });
            if (!res.ok) throw new Error(`프레임 업로드 실패 (${i + 1}/${assetSink.length})`);
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
                name = window.prompt('서버에 저장할 프로젝트 이름:', serverNameRef.current || 'MV Project');
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
            alert('서버에 저장했습니다.');
        } catch (e) {
            alert('서버 저장 실패: ' + e.message + '\n(API 서버가 실행 중인지 확인하세요. 큰 프로젝트는 저장에 시간이 걸립니다.)');
        } finally { setServerBusy(false); }
    };
    const openServerList = async () => {
        try { setServerProjects(await apiFetch('/api/projects')); }
        catch (e) { alert('서버 목록을 불러오지 못했습니다: ' + e.message + '\n(API 서버 실행 확인: npm run dev)'); }
    };
    const doServerOpen = async (id, name) => {
        try {
            const data = await apiFetch(`/api/projects/${id}`);
            await restore(data, `/api/projects/${id}`); // fetch externalized frame assets from this project
            serverIdRef.current = id; serverNameRef.current = name || '';
            setServerProjects(null);
        } catch (e) { alert('서버에서 열기 실패: ' + e.message); }
    };
    const doServerDelete = async (id) => {
        if (!window.confirm('이 프로젝트를 서버에서 삭제할까요?')) return;
        try {
            await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
            if (serverIdRef.current === id) { serverIdRef.current = null; serverNameRef.current = ''; }
            openServerList();
        } catch (e) { alert('삭제 실패: ' + e.message); }
    };

    // --- Local (IndexedDB) named projects — works offline / in the deployed build too ---
    const doLocalSave = async (forceNew = false) => {
        try {
            const data = await buildData(true, null, true); // IndexedDB stores frame Blobs directly
            if (!forceNew && localIdRef.current) { await saveProject(localIdRef.current, data, localNameRef.current || 'Untitled'); alert('로컬에 저장했습니다.'); return; }
            const name = window.prompt('로컬 저장 이름:', localNameRef.current || 'MV Project');
            if (!name) return;
            const id = 'l_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            await saveProject(id, data, name);
            localIdRef.current = id; localNameRef.current = name;
            alert('로컬에 저장했습니다.');
        } catch (e) { alert('로컬 저장 실패: ' + e.message); }
    };
    const openLocalList = async () => {
        try { setLocalProjects((await listProjects()).filter(p => p.id !== autosaveKey)); }
        catch (e) { alert('로컬 목록 실패: ' + e.message); }
    };
    const doLocalOpen = async (id, name) => {
        try { const data = await loadProject(id); if (!data) { alert('데이터가 없습니다.'); return; } await restore(data); localIdRef.current = id; localNameRef.current = name || ''; setLocalProjects(null); }
        catch (e) { alert('로컬 열기 실패: ' + e.message); }
    };
    const doLocalDelete = async (id) => {
        if (!window.confirm('이 로컬 프로젝트를 삭제할까요?')) return;
        try { await deleteProject(id); if (localIdRef.current === id) { localIdRef.current = null; localNameRef.current = ''; } openLocalList(); }
        catch (e) { alert('삭제 실패: ' + e.message); }
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
            if (window.confirm(`이전에 자동저장된 작업이 있습니다${when ? ` (${when})` : ''}.\n복구할까요?`)) {
                restore(data);
            }
        }).catch(() => { }).finally(() => { didRecoverRef.current = true; });
        return () => { cancelled = true; };
    }, []);

    // Probe the project-storage API once; hide server menu when absent (static host / APK).
    useEffect(() => {
        let alive = true;
        fetch('/api/projects', { method: 'GET' }).then(r => { if (alive) setServerAvailable(r.ok); }).catch(() => { if (alive) setServerAvailable(false); });
        return () => { alive = false; };
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
                saveAutosave(data).then(() => setAutoSavedAt(Date.now())).catch(() => { });
            } catch { }
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
        setCuts(p => [...p, nc]); setCurrentCutId(nc.id); setCurrentTime(ns);
    };
    const handleDeleteCut = (id) => {
        const ids = (selectedCutIds.size > 1 && selectedCutIds.has(id)) ? new Set(selectedCutIds) : new Set([id]);
        const nc = cuts.filter(c => !ids.has(c.id));
        setCuts(nc);
        if (ids.has(currentCutId)) setCurrentCutId(nc.length > 0 ? nc[0].id : null);
        setSelectedCutIds(new Set());
    };
    // Clear all drawing + text in the current cut (every layer's strokes), keeping the layers.
    const handleClearCut = () => {
        if (!currentCutId) return;
        if (!window.confirm('현재 컷의 모든 그림과 텍스트를 지울까요?')) return;
        setCuts(p => p.map(c => c.id === currentCutId
            ? { ...c, texts: [], layers: c.layers.map(l => l.type === 'layer' ? { ...l, strokes: [], redoStrokes: [] } : l) }
            : c));
        cancelSelection();
        setSelectedText(null);
    };
    const updCutTime = (id, field, val) => { let v = Math.max(0, parseFloat(val) || 0); if (field === 'track') { v = Math.round(v); if (v >= numTracks) setNumTracks(v + 1); } setCuts(p => p.map(c => c.id === id ? { ...c, [field]: v } : c)); };
    const toggleCutSettings = (id) => setExpandedCuts(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
    const toggleCutCollapse = (id) => setCollapsedCutIds(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
    const renameCut = (id, name) => setCuts(p => p.map(c => c.id === id ? { ...c, name } : c));
    const updCutAnim = (id, patch) => setCuts(p => p.map(c => c.id === id ? { ...c, anim: { ...ANIM_DEFAULT, ...c.anim, ...patch } } : c));
    const updLayerAnim = (cutId, layerId, patch) => updLayers(cutId, c => ({ layers: c.layers.map(l => l.id === layerId ? { ...l, anim: { ...LAYER_ANIM_DEFAULT, ...l.anim, ...patch } } : l) }));
    const handleAddTrack = () => setNumTracks(p => p + 1);
    const handleDeleteTrack = (i) => { if (numTracks <= 1) return; if (!window.confirm(`Track ${i} 삭제?`)) return; setCuts(p => p.filter(c => c.track !== i).map(c => c.track > i ? { ...c, track: c.track - 1 } : c)); setNumTracks(p => p - 1); };
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
    const cloneCutContents = (srcCut) => {
        const idMap = new Map();
        let next = 1;
        srcCut.layers.forEach(l => idMap.set(l.id, next++));
        const bmpCache = new Map();
        const layers = srcCut.layers.map(l => {
            const cl = JSON.parse(JSON.stringify(l));
            cl.id = idMap.get(l.id);
            cl.parentId = (l.parentId != null && idMap.has(l.parentId)) ? idMap.get(l.parentId) : null;
            cl.redoStrokes = [];
            if (Array.isArray(cl.strokes)) {
                cl.strokes = cl.strokes.map(s => s.bitmapId ? { ...s, bitmapId: cloneBitmapId(s.bitmapId, bmpCache) } : s);
            }
            return cl;
        });
        const activeLayerId = idMap.get(srcCut.activeLayerId) ?? layers.find(l => l.type === 'layer')?.id ?? 1;
        const texts = safeArray(srcCut.texts).map(t => JSON.parse(JSON.stringify(t)));
        return { layers, activeLayerId, texts };
    };
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
        setCuts(p => [...p, ...made]);
        const last = made[made.length - 1];
        setCurrentCutId(last.id);
        setCurrentTime(last.startTime);
    };
    // Duplicate a cut as the *next frame*: clone it right after itself and push any
    // later cuts on the same track to make room. This is the core frame-by-frame flow.
    const handleDuplicateCut = (id) => {
        const cut = cuts.find(c => c.id === (id ?? currentCutId));
        if (!cut) return;
        const dur = cut.endTime - cut.startTime;
        const insertAt = cut.endTime;
        const newId = Date.now();
        const { layers, activeLayerId, texts } = cloneCutContents(cut);
        setCuts(prev => {
            const shifted = prev.map(c => (c.track === cut.track && c.id !== cut.id && c.startTime >= insertAt - 1e-9)
                ? { ...c, startTime: c.startTime + dur, endTime: c.endTime + dur } : c);
            const nc = { id: newId, name: `${cut.name}+`, startTime: insertAt, endTime: insertAt + dur, track: cut.track, layers, activeLayerId, texts };
            return [...shifted, nc];
        });
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
        setCuts(p => p.map(c => c.id === cutId ? { ...c, activeLayerId: layerId } : c));
    };
    const handleToggleFolder = (e, cutId, fid) => { e.stopPropagation(); updLayers(cutId, c => ({ layers: c.layers.map(l => l.id === fid ? { ...l, collapsed: !l.collapsed } : l) })); };

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
        updLayers(cutId, c => {
            const layers = [...c.layers];
            const di = layers.findIndex(l => l.id === layerId);
            const dragged = { ...layers[di] }; layers.splice(di, 1);
            const tl = layers.find(l => l.id === targetId); if (!tl) return c;
            if (position === 'inside' && tl.type === 'folder') {
                if (dragged.type === 'folder') return c;
                dragged.parentId = targetId;
                let ii = layers.findIndex(l => l.id === targetId) + 1;
                for (let i = ii; i < layers.length; i++) { if (layers[i].parentId === targetId) ii = i + 1; else break; }
                layers.splice(ii, 0, dragged);
            } else {
                dragged.parentId = tl.parentId;
                const ti = layers.findIndex(l => l.id === targetId);
                layers.splice(position === 'before' ? ti : ti + 1, 0, dragged);
            }
            return { layers };
        });
        setDragLayerInfo(null); setDropInfo(null);
    };
    const onLayerDragEnd = () => { setDragLayerInfo(null); setDropInfo(null); };

    const getPos = (e) => { const c = canvasRef.current, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), pressure: e.pressure > 0 ? e.pressure : 0.5 }; };

    // Touch navigation on the canvas (fingers never draw — palm rejection):
    //   1 finger  = pan the view,  2 fingers = pinch zoom (+ pan).
    const startCanvasPan = () => {
        const [a] = [...touchPtsRef.current.values()];
        pinchRef.current = { mode: 'pan', startPt: { x: a.x, y: a.y }, startView: { ...view } };
    };
    const onAreaPointerDown = (e) => {
        if (e.pointerType !== 'touch') return;
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
            setView({ zoom, x: p.startView.x + (mid.x - p.startMid.x), y: p.startView.y + (mid.y - p.startMid.y) });
            e.preventDefault();
        } else if (touchPtsRef.current.size === 1 && p?.mode === 'pan') {
            const [a] = [...touchPtsRef.current.values()];
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

    // Wheel zoom on the canvas (PC): anchored at the cursor so the point under it stays put.
    // Shift/Ctrl not required — plain wheel zooms, since the stage never scrolls.
    useEffect(() => {
        const el = canvasAreaRef.current; if (!el) return;
        const h = (e) => {
            e.preventDefault();
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

    const textFontOf = (t) => {
        const fontSize = Math.max(6, Math.min(400, t.fontSize ?? 32));
        return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${fontSize}px ${t.fontFamily ?? 'sans-serif'}`;
    };
    const measureTextBox = (t) => {
        const ctx = getTextMeasureCtx();
        const fontSize = Math.max(6, Math.min(400, t.fontSize ?? 32));
        ctx.font = textFontOf(t);
        const lineHeight = Math.round(fontSize * (t.lineHeight ?? 1.25));
        const lines = String(t.text ?? '').split('\n');
        let w = 0;
        for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
        w = Math.max(1, Math.ceil(w));
        const h = Math.max(1, Math.max(1, lines.length) * lineHeight);
        const align = t.align || 'left';
        const x = (t.x ?? 0) - (align === 'center' ? w / 2 : align === 'right' ? w : 0);
        return { x, y: t.y ?? 0, w, h };
    };

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

    const applyResize = (handle, startSel, dx, dy) => {
        const minSize = 2;
        let left = startSel.tx, top = startSel.ty, right = startSel.tx + startSel.tw, bottom = startSel.ty + startSel.th;

        const moveLeft = handle.includes('w');
        const moveRight = handle.includes('e');
        const moveTop = handle.includes('n');
        const moveBottom = handle.includes('s');

        if (moveLeft) left += dx;
        if (moveRight) right += dx;
        if (moveTop) top += dy;
        if (moveBottom) bottom += dy;

        if (handle === 'n' || handle === 's') { left = startSel.tx; right = startSel.tx + startSel.tw; }
        if (handle === 'w' || handle === 'e') { top = startSel.ty; bottom = startSel.ty + startSel.th; }

        const w = right - left;
        const h = bottom - top;
        if (w < minSize) {
            if (moveLeft && !moveRight) left = right - minSize;
            if (moveRight && !moveLeft) right = left + minSize;
        }
        if (h < minSize) {
            if (moveTop && !moveBottom) top = bottom - minSize;
            if (moveBottom && !moveTop) bottom = top + minSize;
        }

        return { tx: left, ty: top, tw: Math.max(minSize, right - left), th: Math.max(minSize, bottom - top) };
    };

    const startDraw = (e) => {
        // Palm rejection: only a stylus (S Pen) or mouse may draw — ignore finger/touch.
        if (e.pointerType === 'touch') return;
        const pos = getPos(e);
        // Recording a motion path for a part animation: capture the stroke as a path.
        if (pathCapture) {
            activePointerIdRef.current = e.pointerId;
            try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }
            isDrawing.current = true;
            pathPtsRef.current = [pos];
            e.preventDefault();
            return;
        }
        const currentCut = cuts.find(c => c.id === currentCutId);
        const activeLayer = currentCut?.layers.find(l => l.id === currentCut.activeLayerId);
        if (!activeLayer) return;

        if (textEdit) return;

        // Selection has priority over other interactions to avoid tool conflicts.
        if (selection) {
            const hit = hitTestSelection(pos);
            if (hit) {
                activePointerIdRef.current = e.pointerId;
                try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }
                isDrawing.current = true;
                selectionDragRef.current = { hit, startPos: { x: pos.x, y: pos.y }, startSel: { ...selection } };
                e.preventDefault();
                return;
            }
            // Click outside selection commits by default (standard behavior).
            commitSelectionImpl(selection);
        }

        if (tool === 'text') {
            const hit = hitTestText(pos, currentCut);
            if (hit) {
                setSelectedText({ cutId: currentCutId, textId: hit.text.id });
                activePointerIdRef.current = e.pointerId;
                try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }
                isDrawing.current = true;
                textDragRef.current = {
                    cutId: currentCutId,
                    textId: hit.text.id,
                    startPos: { x: pos.x, y: pos.y },
                    startText: { x: hit.text.x ?? 0, y: hit.text.y ?? 0 },
                    moved: false,
                    clickToEdit: true,
                };
                e.preventDefault();
                return;
            }
            // Position editor in CSS pixels relative to the displayed canvas.
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
            isDrawing.current = false;
            e.preventDefault();
            return;
        }

        if (tool === 'move') {
            const hit = hitTestText(pos, currentCut);
            if (hit) {
                setSelectedText({ cutId: currentCutId, textId: hit.text.id });
                activePointerIdRef.current = e.pointerId;
                try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }
                isDrawing.current = true;
                textDragRef.current = {
                    cutId: currentCutId,
                    textId: hit.text.id,
                    startPos: { x: pos.x, y: pos.y },
                    startText: { x: hit.text.x ?? 0, y: hit.text.y ?? 0 },
                    moved: true,
                    clickToEdit: false,
                };
                e.preventDefault();
                return;
            }
        }

        activePointerIdRef.current = e.pointerId;
        try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }
        if (tool !== 'move' && tool !== 'text' && selectedText) setSelectedText(null);

        isDrawing.current = true;
        switch (tool) {
            case 'lasso':
                setLassoPoints([pos]);
                break;
            case 'pen':
            case 'brush':
            case 'pencil':
            case 'soft':
            case 'marker':
            case 'calligraphy':
            case 'eraser':
                {
                    const newStroke = { id: Date.now(), tool, color, opacity, size: tool === 'eraser' ? eraserSize : brushSize, points: [pos] };
                    updLayers(currentCutId, c => ({
                        layers: c.layers.map(l => l.id === c.activeLayerId ? { ...l, strokes: [...l.strokes, newStroke] } : l)
                    }));
                    break;
                }
            case 'fill':
                {
                    isDrawing.current = false;
                    const tmpCanvas = document.createElement('canvas');
                    tmpCanvas.width = CANVAS_W;
                    tmpCanvas.height = CANVAS_H;
                    const tctx = tmpCanvas.getContext('2d');
                    tctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

                    // Base for fill: active layer, plus obstacle pixels from layers above (so lines on upper layers can act as boundaries).
                    const activeCanvas = layerCanvasCache[layerKey(currentCut.id, activeLayer.id)];
                    if (activeCanvas) tctx.drawImage(activeCanvas, 0, 0);
                    else drawStrokesOnCtx(tctx, activeLayer.strokes, false, bitmapStoreRef.current);

                    const stack = flattenLayersInUiOrder(currentCut?.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    const activeIndex = stack.findIndex(l => l.id === activeLayer.id);
                    if (activeIndex > 0) {
                        for (let i = 0; i < activeIndex; i++) {
                            const lc = layerCanvasCache[layerKey(currentCut.id, stack[i].id)];
                            if (lc) tctx.drawImage(lc, 0, 0);
                        }
                    }

                    const base = tctx.getImageData(0, 0, CANVAS_W, CANVAS_H);

                    const fillRgb = hexToRgb(color);
                    const fillAlpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
                    const region = bucketFillTransparentRegion(base, Math.round(pos.x), Math.round(pos.y), fillRgb, fillAlpha);
                    if (!region) break;

                    const bitmapId = storeBitmap(region.imageData);
                    const stroke = { id: Date.now(), tool: 'paste', bitmapId, x: region.x, y: region.y };
                    updLayers(currentCutId, c => ({
                        layers: c.layers.map(l => l.id === activeLayer.id ? { ...l, strokes: [...l.strokes, stroke] } : l)
                    }));
                    break;
                }
            case 'move':
                isDrawing.current = false;
                break;
        }
    };

    const onDraw = (e) => {
        if (!isDrawing.current) return;
        const pos = getPos(e);

        if (pathPtsRef.current) { pathPtsRef.current.push(pos); return; }

        if (textDragRef.current) {
            const { cutId, textId, startPos, startText, clickToEdit } = textDragRef.current;
            const dx = pos.x - startPos.x;
            const dy = pos.y - startPos.y;
            if (clickToEdit && !textDragRef.current.moved && Math.hypot(dx, dy) <= 4) return;
            textDragRef.current.moved = true;
            setCuts(p => p.map(c => {
                if (c.id !== cutId) return c;
                const texts = safeArray(c.texts);
                return { ...c, texts: texts.map(t => t.id === textId ? ({ ...t, x: Math.round(startText.x + dx), y: Math.round(startText.y + dy) }) : t) };
            }));
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

        switch (tool) {
            case 'lasso':
                setLassoPoints(p => [...p, pos]);
                break;
            case 'move':
                break;
            case 'pen':
            case 'brush':
            case 'pencil':
            case 'soft':
            case 'marker':
            case 'calligraphy':
            case 'eraser': {
                // Fast strokes get coalesced by the browser into one event; recover every
                // intermediate sample so quick curves stay curved instead of going polygonal.
                const raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
                const positions = raw && raw.length > 1 ? raw.map(getPos) : [pos];
                updLayers(currentCutId, c => ({
                    layers: c.layers.map(l => {
                        if (l.id !== c.activeLayerId) return l;
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
        // Finish recording a motion path → store it on the target layer's animation.
        if (pathPtsRef.current) {
            const pts = pathPtsRef.current;
            pathPtsRef.current = null;
            isDrawing.current = false;
            try { if (activePointerIdRef.current !== null) canvasRef.current?.releasePointerCapture(activePointerIdRef.current); } catch { }
            activePointerIdRef.current = null;
            if (pathCapture && pts.length > 1) {
                updLayerAnim(pathCapture.cutId, pathCapture.layerId, { path: pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) });
            }
            setPathCapture(null);
            return;
        }
        selectionDragRef.current = null;
        const endedTextDrag = textDragRef.current;
        textDragRef.current = null;
        if (!isDrawing.current) return;
        isDrawing.current = false;
        try {
            if (activePointerIdRef.current !== null) canvasRef.current?.releasePointerCapture(activePointerIdRef.current);
        } catch { }
        activePointerIdRef.current = null;

        if (endedTextDrag?.clickToEdit && !endedTextDrag.moved) {
            openEditText(endedTextDrag.cutId, endedTextDrag.textId);
            return;
        }

        if (tool === 'lasso' && lassoPoints.length > 1) {
            const currentCut = cuts.find(c => c.id === currentCutId);
            const activeLayer = currentCut?.layers.find(l => l.id === currentCut.activeLayerId);
            if (activeLayer) {
                // Render from the latest strokes to avoid stale cache mismatches.
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = CANVAS_W;
                tmpCanvas.height = CANVAS_H;
                const ctx = tmpCanvas.getContext('2d');
                drawStrokesOnCtx(ctx, activeLayer.strokes, true, bitmapStoreRef.current);
                let pts = lassoPoints;
                if (pts.length >= 2 && dist(pts[0], pts[pts.length - 1]) > 8) {
                    pts = [...pts, pts[0]];
                } else if (pts.length >= 2) {
                    pts = [...pts.slice(0, -1), pts[0]];
                }
                const poly = pts.map(p => [p.x, p.y]);
                const minX = Math.max(0, Math.floor(Math.min(...lassoPoints.map(p => p.x))));
                const minY = Math.max(0, Math.floor(Math.min(...lassoPoints.map(p => p.y))));
                const maxX = Math.min(CANVAS_W, Math.ceil(Math.max(...lassoPoints.map(p => p.x))));
                const maxY = Math.min(CANVAS_H, Math.ceil(Math.max(...lassoPoints.map(p => p.y))));
                const w = maxX - minX, h = maxY - minY;

                if (w > 0 && h > 0) {
                    const layerImageData = ctx.getImageData(minX, minY, w, h);
                    const selectionImageData = new ImageData(w, h);
                    const eraseMaskImageData = new ImageData(w, h);
                    let hasContent = false;
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const i = (y * w + x) * 4;
                            const inside = pointInPolygon([minX + x + 0.5, minY + y + 0.5], poly);
                            const a = layerImageData.data[i + 3];
                            if (!inside || a === 0) continue;
                            hasContent = true;
                            selectionImageData.data[i] = layerImageData.data[i];
                            selectionImageData.data[i + 1] = layerImageData.data[i + 1];
                            selectionImageData.data[i + 2] = layerImageData.data[i + 2];
                            selectionImageData.data[i + 3] = a;
                            eraseMaskImageData.data[i + 3] = 255;
                        }
                    }

                    if (hasContent) {
                        const selectionBitmapId = storeBitmap(selectionImageData);
                        const eraseMaskBitmapId = storeBitmap(eraseMaskImageData);
                        setSelection({
                            cutId: currentCutId,
                            sourceLayerId: activeLayer.id,
                            bitmapId: selectionBitmapId,
                            maskBitmapId: eraseMaskBitmapId,
                            x: minX,
                            y: minY,
                            w,
                            h,
                            tx: minX,
                            ty: minY,
                            tw: w,
                            th: h,
                        });
                    }
                }
            }
            setLassoPoints([]);
        }
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
            fontSize: textEdit.fontSize,
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
        };
        setCuts(p => p.map(c => {
            if (c.id !== textEdit.cutId) return c;
            const texts = safeArray(c.texts);
            const idx = texts.findIndex(tt => tt.id === id);
            const nextTexts = idx >= 0 ? texts.map(tt => tt.id === id ? { ...tt, ...obj } : tt) : [...texts, obj];
            return { ...c, texts: nextTexts };
        }));
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
        });
    };

    const deleteTextObject = (cutId, textId) => {
        setCuts(p => p.map(c => c.id === cutId ? ({ ...c, texts: safeArray(c.texts).filter(t => t.id !== textId) }) : c));
        if (selectedText?.cutId === cutId && selectedText?.textId === textId) setSelectedText(null);
    };

    const toggleTextVisible = (cutId, textId) => {
        setCuts(p => p.map(c => {
            if (c.id !== cutId) return c;
            return { ...c, texts: safeArray(c.texts).map(t => t.id === textId ? ({ ...t, visible: t.visible === false ? true : false }) : t) };
        }));
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
                const layerStrokes = strokeSig(layer.strokes);
                if (!canvas || canvas.dataset.strokes !== layerStrokes) {
                    // Skip (don't cache a blank) if a frame isn't decoded yet — the prefetch effect
                    // decodes it and repaints. Do NOT request a decode here (would loop with tick).
                    let notReady = false;
                    for (const st of safeArray(layer.strokes)) { if (st.tool === 'paste' && st.bitmapId) { const e = bitmapStoreRef.current.get(st.bitmapId); if (e && e.blob && !e.imageBitmap && !e.imageData) { notReady = true; break; } } }
                    if (notReady) continue;
                    const newCanvas = canvas || document.createElement('canvas');
                    newCanvas.width = CANVAS_W;
                    newCanvas.height = CANVAS_H;
                    drawStrokesOnCtx(newCanvas.getContext('2d'), layer.strokes, true, bitmapStoreRef.current);
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
        if (!activePartId) return; // 전체: leave decoded frames as-is; the LRU cap bounds memory
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
        const sig = strokeSig(layer.strokes);
        const cached = layerCanvasCache[key];
        if (cached && cached.dataset.strokes === sig) return cached;
        const map = fallbackCanvasRef.current;
        const hit = map.get(key);
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
        if (missing.length) { if (isPlayingRef.current) requestFrameDecode(missing); return cached || hit || null; }
        const cnv = hit || document.createElement('canvas');
        cnv.width = CANVAS_W; cnv.height = CANVAS_H;
        drawStrokesOnCtx(cnv.getContext('2d'), layer.strokes, true, bitmapStoreRef.current);
        cnv.dataset.strokes = sig;
        map.delete(key); map.set(key, cnv); // re-insert = most recently used
        while (map.size > 24) map.delete(map.keys().next().value);
        return cnv;
    };

    const paintFrame = useCallback((t, playing) => {
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
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
                    ctx.translate(la.px + la.tx, la.py + la.ty);
                    ctx.rotate(la.rot);
                    ctx.scale(la.sc, la.sc);
                    ctx.translate(-la.px, -la.py);
                }

                const shouldMask = selection?.maskBitmapId && selection.cutId === ac.id && selection.sourceLayerId === l.id;
                const maskEntry = shouldMask ? bitmapStoreRef.current.get(selection.maskBitmapId) : null;
                const mb = maskEntry?.imageBitmap;
                const mi = maskEntry?.imageData;

                if (!shouldMask || (!mb && !mi)) {
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
            for (const t of safeArray(ac.texts)) {
                if (!t || t.visible === false) continue;
                const fontSize = Math.max(6, Math.min(400, t.fontSize ?? 32));
                const lineHeight = Math.round(fontSize * (t.lineHeight ?? 1.25));
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = (t.opacity ?? 1) * (anim ? anim.alpha : 1);
                ctx.fillStyle = t.color ?? '#000';
                ctx.textBaseline = 'top';
                ctx.textAlign = t.align || 'left';
                ctx.font = textFontOf(t);
                const lines = String(t.text ?? '').split('\n');
                if (t.outline) {
                    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, fontSize / 6);
                    ctx.strokeStyle = t.outlineColor || '#ffffff';
                    for (let i = 0; i < lines.length; i++) ctx.strokeText(lines[i], t.x ?? 0, (t.y ?? 0) + i * lineHeight);
                }
                for (let i = 0; i < lines.length; i++) {
                    ctx.fillText(lines[i], t.x ?? 0, (t.y ?? 0) + i * lineHeight);
                }
                ctx.textAlign = 'left';
                ctx.globalAlpha = 1.0;
            }
            ctx.restore();
        });
    }, [cuts, currentCutId, onionPrev, onionNext, selection, layerCanvasCache, frameDecodeTick, videoOverlay]);

    const paintFrameRef = useRef(null);
    paintFrameRef.current = paintFrame;

    // Editing render: full frame + editing-only overlays. During playback the rAF loop
    // paints imperatively (see below), so this effect just draws overlays at rest.
    useEffect(() => {
        if (isPlaying) return;              // rAF loop owns the canvas during playback
        paintFrame(currentTime, false);
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');

                if (selectedText?.cutId === currentCutId) {
            const c = cuts.find(cc => cc.id === selectedText.cutId);
            const t = safeArray(c?.texts).find(tt => tt.id === selectedText.textId && tt.visible !== false);
            if (t) {
                const b = measureTextBox(t);
                ctx.save();
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
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
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
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
                ctx.strokeStyle = editing ? 'rgba(124,140,255,0.95)' : 'rgba(124,140,255,0.4)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = editing ? '#7c8cff' : 'rgba(124,140,255,0.5)';
                ctx.beginPath(); ctx.arc(path[0].x, path[0].y, 4, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
        }

        if (lassoPoints.length > 0) {
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            lassoPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, [paintFrame, cuts, currentCutId, isPlaying, currentTime, lassoPoints, selection, selectedText, animLayer]);

    const seekToClientX = (clientX) => {
        const el = timelineRef.current; if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left + el.scrollLeft - 60;
        const t = Math.min(maxTime, Math.max(0, x / pps));
        setCurrentTime(t);
        currentTimeRef.current = t;
        // Scrubbing while playing: hand the target to the loop (it re-seeks audio and keeps going).
        if (isPlayingRef.current) seekRef.current = t;
        else if (audioRef.current && audioUrl) { try { audioRef.current.currentTime = audioData ? Math.max(0, (t - audioData.startTime) + audioData.offset) : t; } catch { } }
        const active = cuts.filter(c => t >= c.startTime && t < c.endTime);
        if (active.length) setCurrentCutId(active.reduce((p, c) => p.track > c.track ? p : c).id);
    };
    // Seek the playhead to an absolute timeline time (used by scene-cut markers, prev/next scene).
    const seekToTime = (t) => {
        t = Math.min(maxTime, Math.max(0, t));
        setCurrentTime(t); currentTimeRef.current = t;
        if (isPlayingRef.current) seekRef.current = t;
        else if (audioRef.current && audioUrl) { try { audioRef.current.currentTime = audioData ? Math.max(0, (t - audioData.startTime) + audioData.offset) : t; } catch { } }
        const active = cuts.filter(c => t >= c.startTime && t < c.endTime);
        if (active.length) setCurrentCutId(active.reduce((p, c) => p.track > c.track ? p : c).id);
    };
    // Timeline times of the detected scene cuts (mapped from video time).
    const sceneTimelineTimes = () => safeArray(videoOverlay?.cuts).map(vt => (videoOverlay.cutStart || 0) + (vt - (videoOverlay.cutOffset || 0))).filter(t => t >= 0).sort((a, b) => a - b);
    const goToScene = (dir) => {
        const times = sceneTimelineTimes(); if (!times.length) return;
        const cur = currentTimeRef.current ?? currentTime;
        const target = dir > 0 ? times.find(t => t > cur + 0.02) : [...times].reverse().find(t => t < cur - 0.02);
        if (target != null) seekToTime(target);
    };
    // Drag-to-scrub the playhead. Clicking a cut/handle stops propagation, so this
    // only fires on the ruler and empty track space.
    const startTimelineScrub = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        seekToClientX(e.clientX);
        const mv = (ev) => seekToClientX(ev.clientX);
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
    };
    // Timeline touch: 1 finger drag = pan (scroll), 1 finger tap = seek playhead,
    // 2 fingers = pinch-zoom (pps) anchored under the fingers. Mouse/pen = window-listener scrub.
    // Drag on empty track area = rubber-band select cuts (like a file manager); a click without
    // dragging seeks the playhead. The ruler always scrubs.
    const startMarqueeOrSeek = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const el = timelineRef.current; if (!el) return;
        const rect = el.getBoundingClientRect();
        const sx = e.clientX - rect.left + el.scrollLeft, sy = e.clientY - rect.top + el.scrollTop;
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        const base = additive ? new Set(selectedCutIds) : new Set();
        let dragging = false;
        const mv = (ev) => {
            const cx = ev.clientX - rect.left + el.scrollLeft, cy = ev.clientY - rect.top + el.scrollTop;
            if (!dragging && Math.abs(cx - sx) < 5 && Math.abs(cy - sy) < 5) return;
            dragging = true;
            const x = Math.min(sx, cx), y = Math.min(sy, cy), w = Math.abs(cx - sx), h = Math.abs(cy - sy);
            setMarquee({ x, y, w, h });
            const mL = ev.clientX < e.clientX ? ev.clientX : e.clientX;
            const mR = ev.clientX < e.clientX ? e.clientX : ev.clientX;
            const mT = ev.clientY < e.clientY ? ev.clientY : e.clientY;
            const mB = ev.clientY < e.clientY ? e.clientY : ev.clientY;
            const sel = new Set(base);
            el.querySelectorAll('.cut-block[data-cutid]').forEach(node => {
                const r = node.getBoundingClientRect();
                if (r.right >= mL && r.left <= mR && r.bottom >= mT && r.top <= mB) {
                    const cut = cuts.find(c => String(c.id) === node.getAttribute('data-cutid'));
                    if (cut) { sel.add(cut.id); }
                }
            });
            setSelectedCutIds(sel);
            if (sel.size) { const first = [...sel][0]; if (first !== currentCutId) setCurrentCutId(first); }
        };
        const up = () => {
            window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
            setMarquee(null);
            if (!dragging) { if (!additive) setSelectedCutIds(new Set()); seekToClientX(e.clientX); }
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    };
    const onTimelinePointerDown = (e) => {
        if (e.pointerType !== 'touch') {
            if (e.target.closest?.('.ruler')) startTimelineScrub(e);   // ruler = scrub playhead
            else startMarqueeOrSeek(e);                                 // track area = marquee / click-seek
            return;
        }
        const el = timelineRef.current;
        tlTouchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (tlTouchRef.current.size === 2) {
            const [a, b] = [...tlTouchRef.current.values()];
            const midX = (a.x + b.x) / 2;
            const contentX = midX - el.getBoundingClientRect().left + el.scrollLeft - 60;
            tlPinchRef.current = { mode: 'pinch', startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startPps: pps, anchorTime: Math.max(0, contentX / pps) };
        } else if (tlTouchRef.current.size === 1) {
            tlPinchRef.current = { mode: 'pan', startClientX: e.clientX, startClientY: e.clientY, startScroll: el ? el.scrollLeft : 0, moved: false };
        }
    };
    const onTimelinePointerMove = (e) => {
        if (e.pointerType !== 'touch' || !tlTouchRef.current.has(e.pointerId)) return;
        tlTouchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const el = timelineRef.current; if (!el) return;
        const p = tlPinchRef.current;
        if (tlTouchRef.current.size >= 2 && p?.mode === 'pinch') {
            const [a, b] = [...tlTouchRef.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const np = Math.max(10, Math.min(300, p.startPps * (dist / p.startDist)));
            setPps(np);
            const midX = (a.x + b.x) / 2;
            el.scrollLeft = Math.max(0, p.anchorTime * np + 60 - (midX - el.getBoundingClientRect().left));
            e.preventDefault();
        } else if (tlTouchRef.current.size === 1 && p?.mode === 'pan') {
            const dx = e.clientX - p.startClientX;
            if (Math.abs(dx) > 4 || Math.abs(e.clientY - p.startClientY) > 4) p.moved = true;
            el.scrollLeft = Math.max(0, p.startScroll - dx);
            e.preventDefault();
        }
    };
    const onTimelinePointerUp = (e) => {
        if (e.pointerType !== 'touch') return;
        const p = tlPinchRef.current;
        const wasTap = tlTouchRef.current.size === 1 && p?.mode === 'pan' && !p.moved;
        const upX = e.clientX;
        tlTouchRef.current.delete(e.pointerId);
        if (wasTap) seekToClientX(upX);
        if (tlTouchRef.current.size === 1) {
            const el = timelineRef.current;
            const [a] = [...tlTouchRef.current.values()];
            tlPinchRef.current = { mode: 'pan', startClientX: a.x, startClientY: a.y, startScroll: el ? el.scrollLeft : 0, moved: true };
        } else if (tlTouchRef.current.size === 0) {
            tlPinchRef.current = null;
        }
    };
    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 100)).padStart(2, '0')}`;
    // Parse "m:ss", "h:mm:ss", or a plain seconds number into seconds.
    const parseClock = (str) => {
        const parts = String(str).trim().split(':').map(p => +p || 0);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
    };
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
            setVideoOverlay({ name: name || '영상', startTime: startAt, endTime: startAt + dur, offset, duration: v.duration, w: v.videoWidth, h: v.videoHeight });
            // Prime the first frame so a paused canvas shows something immediately.
            try { v.currentTime = offset; } catch { }
        };
        v.onseeked = () => { setFrameDecodeTick(t => t + 1); }; // repaint the (paused) overlay frame
        // Auto-detect scene cuts in the background so the timeline can mark where the video changes.
        setSceneDetect({ done: 0, total: 0 });
        detectSceneCuts(blob, { onProgress: (d, t) => setSceneDetect({ done: d, total: t }) })
            .then(cuts => setVideoOverlay(prev => prev ? { ...prev, cuts, cutStart: startAt, cutOffset: offset } : prev))
            .catch(() => { })
            .finally(() => setSceneDetect(null));
    };
    const removeVideoOverlay = () => {
        setVideoOverlay(null); videoBlobRef.current = null;
        const v = videoElRef.current; if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { } }
    };
    // Re-detect scene cuts with a chosen sensitivity, optionally only within a video-time range.
    const redetectScenes = () => {
        const blob = videoBlobRef.current; if (!blob) return;
        const rs = detectCfg.startText ? parseClock(detectCfg.startText) : 0;
        const re = detectCfg.endText ? parseClock(detectCfg.endText) : null;
        setSceneDetect({ done: 0, total: 0 });
        detectSceneCuts(blob, { threshold: detectCfg.threshold, start: rs, end: re && re > rs ? re : null, onProgress: (d, t) => setSceneDetect({ done: d, total: t }) })
            .then(cuts => setVideoOverlay(prev => prev ? { ...prev, cuts, cutStart: prev.startTime, cutOffset: prev.offset } : prev))
            .catch(() => { })
            .finally(() => setSceneDetect(null));
    };
    // Remember fetched/opened videos so they can be re-imported with different settings
    // without downloading again (session only — keeps at most 3 to bound memory).
    // Recents keep only the source key/link, never the video data — the downloaded file is
    // dropped right after extraction, so re-importing the same link re-downloads it.
    const openVideoImport = (file, name, src) => {
        const label = (name || file.name).replace(/\.[^.]+$/, '').slice(0, 24);
        const srcKey = src?.key || `f:${file.name}:${file.size}`;
        setRecentVideos(p => [{ id: 'rv_' + Date.now().toString(36), name: label, srcKey, url: src?.url || null },
        ...p.filter(v => v.srcKey !== srcKey)].slice(0, 3));
        setVideoImport({ file, srcKey, label, fps: 4, maxFrames: 60, scale: 0.5, whole: true, withAudio: true, dedupe: 'exact', quality: 'compressed', rangeOn: false, startText: '0:00', endText: '', parts: 1 });
        // Auto-suggest a part count from the video length (~1 part per 30s) so a long video comes
        // in already split. The user can still change it in the dialog.
        try {
            const v = document.createElement('video'); v.preload = 'metadata'; const u = URL.createObjectURL(file);
            v.onloadedmetadata = () => { const dur = v.duration || 0; URL.revokeObjectURL(u); const parts = Math.max(1, Math.min(30, Math.round(dur / 30)));
                setVideoImport(vi => (vi && vi.file === file) ? { ...vi, durationSec: dur, parts } : vi); };
            v.src = u;
        } catch { }
    };
    const reimportRecent = (v) => {
        if (v.url) loadYoutubeVideo(v.url);        // same link → download again
        else videoFileRef.current?.click();        // local file: the browser can't reopen it for us
    };

    // Imported frame sets, derived from the cuts themselves (so they survive save/load).
    const videoBatches = (() => {
        const m = new Map();
        for (const c of cuts) {
            if (!c.videoBatch) continue;
            const b = m.get(c.videoBatch) || { id: c.videoBatch, label: c.videoLabel || '영상', count: 0, start: c.startTime, end: c.endTime };
            b.count++; b.start = Math.min(b.start, c.startTime); b.end = Math.max(b.end, c.endTime);
            m.set(c.videoBatch, b);
        }
        return [...m.values()];
    })();
    const deleteVideoBatch = (batchId) => {
        const b = videoBatches.find(x => x.id === batchId);
        if (!b || !window.confirm(`"${b.label}" 프레임 ${b.count}컷을 삭제할까요?`)) return;
        setCuts(p => {
            const left = p.filter(c => c.videoBatch !== batchId);
            if (!left.some(c => c.id === currentCutId)) setCurrentCutId(left[0]?.id ?? null);
            return left;
        });
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
        if (!selectedCutIds.size) { alert('먼저 컷을 선택하세요 (타임라인에서 드래그 또는 Ctrl+클릭).'); return; }
        const name = window.prompt('새 파트 이름:', `파트 ${parts.length + 1}`);
        if (name == null) return;
        const pid = 'part_' + Date.now().toString(36);
        setCuts(p => p.map(c => selectedCutIds.has(c.id) ? { ...c, partId: pid, partName: name } : c));
        setActivePartId(pid);
    };
    const renamePart = (partId) => {
        const p = parts.find(x => x.id === partId); if (!p) return;
        const name = window.prompt('파트 이름 변경:', p.name);
        if (name == null) return;
        setCuts(prev => prev.map(c => c.partId === partId ? { ...c, partName: name } : c));
    };
    // Ungroup a part (cuts stay, just lose their part membership).
    const ungroupPart = (partId) => {
        setCuts(prev => prev.map(c => c.partId === partId ? { ...c, partId: undefined, partName: undefined } : c));
        if (activePartId === partId) setActivePartId(null);
    };

    // Local-only: pull a video by URL through the API, then reuse the frame-import dialog.
    const loadYoutubeVideo = async (presetUrl) => {
        const url = typeof presetUrl === 'string' ? presetUrl : window.prompt('유튜브(또는 영상) 링크:');
        if (!url) return;
        setVideoBusy({ done: 0, total: 0, fetching: true });
        try {
            const res = await fetch('/api/youtube-video?url=' + encodeURIComponent(url) + '&maxHeight=1080');
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
            const blob = await res.blob();
            const file = new File([blob], 'youtube.mp4', { type: blob.type || 'video/mp4' });
            openVideoImport(file, 'YT ' + (url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/)?.[1] || '영상'), { url, key: 'yt:' + url });
        } catch (e) {
            alert('영상 가져오기 실패: ' + e.message + '\n(서버에 yt-dlp 설치 필요)');
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
            const { frames, holds = [], skipped = 0, fps, width: fW, height: fH } = await extractVideoFrames(cfg.file, {
                fps: cfg.fps, maxFrames: cfg.whole ? 0 : cfg.maxFrames,
                start: useRange ? rStart : 0, end: useRange ? rEnd : null,
                scale: isNative ? 1 : cfg.scale, quality: q === 'lossless' ? 1 : q === 'high' ? 0.95 : 0.82,
                dedupe: cfg.dedupe ?? 'exact', nativeRes: isNative, format: q === 'lossless' ? 'png' : 'webp',
                width: CANVAS_W, height: CANVAS_H,
                onProgress: (done, total, skipped) => setVideoBusy({ done, total, skipped }),
                shouldStop: () => videoStopRef.current,
            });
            if (!frames.length) { alert('추출된 프레임이 없습니다.'); return; }
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
            const fit = (isNative && fW && fH) ? fitRect(fW, fH, CANVAS_W, CANVAS_H) : { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
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
            setCuts(p => [...p.filter(c => c.videoSrc !== srcKey), ...made]);
            setCurrentCutId(made[0].id);
            setCurrentTime(made[0].startTime);
            // Audio (if asked) is the only thing that keeps the video bytes alive past this point.
            // Aligned to the first imported frame; when only a range was imported, the audio is
            // clipped to that same range (offset rStart, duration rEnd-rStart).
            if (cfg.withAudio) loadAudioUrl(URL.createObjectURL(cfg.file), label + ' (영상 음원)', made[0].startTime, useRange ? rStart : 0, useRange ? (rEnd - rStart) : null);
            setVideoImport(null);
            setTimeout(gcBitmaps, 0); // replaced frames' bitmaps go too
        } catch (e) {
            alert('영상 가져오기 실패: ' + e.message);
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
    const loadYoutubeAudio = async () => {
        const url = window.prompt('유튜브(또는 음원) 링크:');
        if (!url) return;
        try {
            const res = await fetch('/api/youtube-audio?url=' + encodeURIComponent(url));
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
            const blob = await res.blob();
            loadAudioUrl(URL.createObjectURL(blob), '유튜브 음원');
        } catch (e) { alert('음원 추출 실패: ' + e.message + '\n(서버에 yt-dlp + ffmpeg 설치 필요)'); }
    };
    const handleExport = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (typeof canvas.captureStream !== 'function' || typeof window.MediaRecorder === 'undefined') {
            alert('이 환경에서는 내보내기를 지원하지 않습니다.\nPC 브라우저(Chrome 등)에서 실행해 주세요.'); return;
        }
        const ctMax = Math.max(...cuts.map(c => c.endTime), audioData?.endTime ?? 0);
        if (ctMax <= 0) { alert('내보낼 콘텐츠가 없습니다.'); return; }
        const candidates = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        const mimeType = candidates.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
        const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
        alert('녹화가 시작됩니다.'); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0;
        const stream = canvas.captureStream(30), tracks = [...stream.getVideoTracks()];
        if (audioRef.current && audioUrl && !audioSourceRef.current) { try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)(); audioDestRef.current = audioCtxRef.current.createMediaStreamDestination(); audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current); audioSourceRef.current.connect(audioDestRef.current); audioSourceRef.current.connect(audioCtxRef.current.destination); } catch (e) { } }
        if (audioDestRef.current) tracks.push(...audioDestRef.current.stream.getAudioTracks());
        let mr;
        try { mr = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined); }
        catch (e) { try { mr = new MediaRecorder(new MediaStream(tracks)); } catch (e2) { alert('녹화를 시작할 수 없습니다: ' + e2.message); return; } }
        const blobType = mimeType || 'video/webm';
        const chunks = [];
        mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        mr.onstop = () => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(chunks, { type: blobType })), download: `mv_export.${ext}`, style: 'display:none' }); document.body.appendChild(a); a.click(); document.body.removeChild(a); alert('완료!'); isExporting.current = false; };
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
                            <button className="icon-btn" style={{ color: layer.anim ? '#7c8cff' : undefined }} title="파츠 애니메이션"
                                onClick={e => { e.stopPropagation(); setAnimLayer(a => (a && a.cutId === cut.id && a.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id }); }}>
                                <Film size={11} />
                            </button>
                        )}
                        <button className="icon-btn del-btn" onClick={e => handleDeleteLayer(e, cut.id, layer.id)}><Trash2 size={11} /></button>
                    </div>
                    {!isFolder && animLayer && animLayer.cutId === cut.id && animLayer.layerId === layer.id && (
                        <LayerAnimPanel cut={cut} layer={layer} updLayerAnim={updLayerAnim} updLayers={updLayers} pathCapture={pathCapture} setPathCapture={setPathCapture} />
                    )}
                    {dt === 'after' && <div className="drop-line" />}
                    {isFolder && !layer.collapsed && renderLayers(cut, layer.id, depth + 1)}
                </div>
            );
        });
    };

    const currentCut = cuts.find(c => c.id === currentCutId);
    const isSelectionTool = tool === 'lasso' || !!selection;
    liveRef.current = { cuts, copiedCut, selection, audioData, numTracks }; // current GC + history sources

    return (
        <div className="app-container">
            <audio ref={audioRef} style={{ display: 'none' }} />
            <video ref={videoElRef} muted playsInline style={{ display: 'none' }} />

            {serverProjects !== null && <ProjectPicker title="서버에서 열기" items={serverProjects} onOpen={doServerOpen} onDelete={doServerDelete} onClose={() => setServerProjects(null)} />}
            {localProjects !== null && <ProjectPicker title="로컬에서 열기" items={localProjects} onOpen={doLocalOpen} onDelete={doLocalDelete} onClose={() => setLocalProjects(null)} />}
            {videoBusy?.fetching && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, padding: 20, color: '#ccc', fontSize: 13 }}>영상을 받는 중…</div>
                </div>
            )}
            {videoBusy && videoBusyBg && !videoBusy.fetching && (
                <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1000, background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', color: '#ccc', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}>
                    <span>프레임 추출 {videoBusy.done}/{videoBusy.total || '?'}</span>
                    <div style={{ width: 80, height: 6, background: '#2a2a3a', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${videoBusy.total ? (videoBusy.done / videoBusy.total * 100) : 0}%`, background: '#7c8cff' }} /></div>
                    <button className="button" style={{ height: 26, padding: '0 8px' }} onClick={() => setVideoBusyBg(false)}>열기</button>
                    <button className="button" style={{ height: 26, padding: '0 8px' }} onClick={() => { videoStopRef.current = true; }}>중지</button>
                </div>
            )}
            {videoImport && !videoBusyBg && (
                <div onClick={() => { if (!videoBusy) setVideoImport(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 420, background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, padding: 18, color: '#ccc', fontSize: 12.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <span className="panel-title">영상 → 프레임 컷</span>
                            {!videoBusy && <button className="icon-btn" onClick={() => setVideoImport(null)}>✕</button>}
                        </div>
                        <div style={{ marginBottom: 10, color: '#9aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{videoImport.file.name}</div>
                        {videoBusy ? (
                            <>
                                <div style={{ marginBottom: 8 }}>프레임 추출 중… {videoBusy.done}/{videoBusy.total || '?'}{videoBusy.skipped ? ` (중복 ${videoBusy.skipped}컷 통합)` : ''}</div>
                                <div style={{ height: 8, background: '#2a2a3a', borderRadius: 4, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${videoBusy.total ? (videoBusy.done / videoBusy.total * 100) : 0}%`, background: '#7c8cff' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                                    <span style={{ color: '#888', fontSize: 11 }}>백그라운드로 두고 다른 작업을 계속할 수 있어요.</span>
                                    <span style={{ display: 'flex', gap: 6 }}>
                                        <button className="button" onClick={() => setVideoBusyBg(true)}>백그라운드로</button>
                                        <button className="button" onClick={() => { videoStopRef.current = true; }}>중지</button>
                                    </span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <span style={{ width: 76 }}>초당 프레임</span>
                                    <select className="time-input" style={{ width: 80 }} value={videoImport.fps} onChange={e => setVideoImport(v => ({ ...v, fps: +e.target.value }))}>
                                        {[1, 2, 3, 4, 6, 8, 12, 15, 24].map(v => <option key={v} value={v}>{v} fps</option>)}
                                    </select>
                                    {videoImport.quality === 'compressed' && <>
                                        <span style={{ width: 50, marginLeft: 6 }}>배율</span>
                                        <select className="time-input" style={{ width: 80 }} value={videoImport.scale} onChange={e => setVideoImport(v => ({ ...v, scale: +e.target.value }))}>
                                            {[[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.35, '35%'], [0.25, '25%']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                        </select>
                                    </>}
                                </div>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <input type="checkbox" checked={videoImport.whole} onChange={e => setVideoImport(v => ({ ...v, whole: e.target.checked }))} /> 영상 전체
                                    </label>
                                    {!videoImport.whole && (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="가져올 컷 개수 (중복 병합분은 제외한 실제 컷 수)">
                                            <input type="number" className="time-input" style={{ width: 70 }} min={1} max={5000} value={videoImport.maxFrames}
                                                onChange={e => setVideoImport(v => ({ ...v, maxFrames: Math.max(1, Math.min(5000, Math.floor(+e.target.value) || 1)) }))} />
                                            <span style={{ color: '#888' }}>컷</span>
                                        </label>
                                    )}
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <input type="checkbox" checked={videoImport.withAudio} onChange={e => setVideoImport(v => ({ ...v, withAudio: e.target.checked }))} /> 음원도 같이
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="영상의 일부 구간만 가져오기 (mm:ss)">
                                        <input type="checkbox" checked={videoImport.rangeOn} onChange={e => setVideoImport(v => ({ ...v, rangeOn: e.target.checked }))} /> 구간만
                                    </label>
                                    {videoImport.rangeOn && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <input className="time-input" style={{ width: 60 }} placeholder="0:00" value={videoImport.startText} onChange={e => setVideoImport(v => ({ ...v, startText: e.target.value }))} />
                                            <span style={{ color: '#888' }}>~</span>
                                            <input className="time-input" style={{ width: 60 }} placeholder="끝" value={videoImport.endText} onChange={e => setVideoImport(v => ({ ...v, endText: e.target.value }))} />
                                        </span>
                                    )}
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="화질/용량 선택. 고화질=원본 해상도 WebP(거의 무손실, 용량 적당) / 무손실=PNG(픽셀 완전 보존, 용량 큼)">
                                        <span style={{ color: '#888' }}>화질</span>
                                        <select className="time-input" style={{ width: 118 }} value={videoImport.quality} onChange={e => setVideoImport(v => ({ ...v, quality: e.target.value }))}>
                                            <option value="compressed">압축(작음)</option>
                                            <option value="high">고화질 WebP</option>
                                            <option value="lossless">무손실 PNG</option>
                                        </select>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="긴 영상을 여러 파트로 나눠서 가져오기 (재생 시 파트별/전체 선택 가능)">
                                        <input type="number" className="time-input" style={{ width: 46 }} min={1} max={50} value={videoImport.parts}
                                            onChange={e => setVideoImport(v => ({ ...v, parts: Math.max(1, Math.min(50, Math.floor(+e.target.value) || 1)) }))} />
                                        <span style={{ color: '#888' }}>파트로 나누기</span>
                                    </label>
                                    <span style={{ marginLeft: 'auto' }}>중복 통합</span>
                                    <select className="time-input" style={{ width: 100 }} value={videoImport.dedupe} onChange={e => setVideoImport(v => ({ ...v, dedupe: e.target.value === 'exact' ? 'exact' : +e.target.value }))}>
                                        {[['0', '끄기'], ['exact', '완전 동일'], ['3', '거의 같음'], ['8', '느슨']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                    </select>
                                </div>
                                <div style={{ color: '#888', lineHeight: 1.6, marginBottom: 12 }}>
                                    캔버스({CANVAS_W}×{CANVAS_H})에 비율 유지로 넣고, 현재 트랙 뒤에 이어서 생성됩니다.<br />
                                    {videoImport.quality === 'lossless'
                                        ? <><b style={{ color: '#9cf' }}>무손실 PNG</b> — 픽셀 완전 보존, 장당 용량이 큽니다(수 MB). 긴 영상은 <b>고화질 WebP</b>를 권장.</>
                                        : videoImport.quality === 'high'
                                            ? <>원본 해상도 <b style={{ color: '#9cf' }}>고화질 WebP(거의 무손실)</b> — 무손실 대비 용량 약 1/5~1/8, 화질 차이는 거의 없음.</>
                                            : <>프레임은 <b style={{ color: '#9b9' }}>WebP로 압축 저장</b>되어 원본 대비 용량이 크게 줄어듭니다{videoImport.scale < 1 ? ` (배율 ${Math.round(videoImport.scale * 100)}%로 추가 절감)` : ''}.</>}
                                    {videoImport.dedupe === 'exact'
                                        ? <><br /><b style={{ color: '#9b9' }}>완전히 똑같은 프레임만</b> 한 컷으로 합칩니다 (픽셀 단위 비교).</>
                                        : videoImport.dedupe > 0 && <><br />이어지는 <b style={{ color: '#9b9' }}>비슷한 화면을 한 컷으로 합칩니다</b> — 정지 구간이 길수록 컷 수·용량이 줄어듭니다.</>}
                                    {!videoImport.whole && <><br />지정한 <b>{videoImport.maxFrames}컷</b>은 <b style={{ color: '#9b9' }}>중복 병합을 제외한 실제 컷 수</b>입니다 (합쳐진 프레임은 개수에 안 셉니다).</>}
                                    {videoImport.rangeOn && <><br /><b style={{ color: '#9cf' }}>{videoImport.startText || '0:00'} ~ {videoImport.endText || '끝'}</b> 구간만 가져옵니다 (mm:ss).</>}
                                    {videoImport.parts > 1 && <><br /><b style={{ color: '#9cf' }}>{videoImport.parts}개 파트</b>로 나눠 가져옵니다 — 재생 시 파트별 또는 전체로 볼 수 있습니다.</>}
                                    {videoImport.whole && <><br /><span style={{ color: '#c99' }}>전체 추출: 길이가 길면 컷이 매우 많아집니다. fps를 낮게(1~4) 두는 것을 권장합니다.</span></>}
                                </div>
                                <div style={{ background: '#12202b', border: '1px solid #1c3a4a', borderRadius: 6, padding: '8px 10px', marginBottom: 10, color: '#9cc', fontSize: 11.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                    <span><b style={{ color: '#8de' }}>영상 위에 덧그리기</b> — 프레임으로 쪼개지 않고 원본 영상을 트랙으로 깔고 그 위에 그림·텍스트. 24fps 장편도 매끄럽게 재생.</span>
                                    <button className="button" style={{ whiteSpace: 'nowrap' }} onClick={() => {
                                        const useRange = videoImport.rangeOn && parseClock(videoImport.endText) > parseClock(videoImport.startText);
                                        loadVideoOverlay(videoImport.file, videoImport.label || videoImport.file.name, 0, useRange ? parseClock(videoImport.startText) : 0, useRange ? (parseClock(videoImport.endText) - parseClock(videoImport.startText)) : null);
                                        // Always bring the video's audio (as a synced track) — the overlay is muted to avoid double.
                                        loadAudioUrl(URL.createObjectURL(videoImport.file), (videoImport.label || '영상') + ' (음원)', 0, useRange ? parseClock(videoImport.startText) : 0, useRange ? (parseClock(videoImport.endText) - parseClock(videoImport.startText)) : null);
                                        setVideoImport(null);
                                    }}>🎬 영상 그대로 깔기</button>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                                    <button className="button" onClick={() => setVideoImport(null)}>취소</button>
                                    <button className="button button-primary" onClick={runVideoImport}>프레임으로 가져오기</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {showHelp && (
                <div onClick={() => setShowHelp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 460, maxHeight: '80vh', overflow: 'auto', background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, padding: 18, fontSize: 12.5, color: '#ccc', lineHeight: 1.7 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span className="panel-title">단축키 · 제스처</span>
                            <button className="icon-btn" onClick={() => setShowHelp(false)}>✕</button>
                        </div>
                        <b style={{ color: '#9aa' }}>키보드</b>
                        <div>Ctrl+Z 실행취소 · Ctrl+Shift+Z / Ctrl+Y 다시실행</div>
                        <div>Ctrl+C 컷 복사 · Ctrl+V 붙여넣기 · Ctrl+D 다음 프레임 복제</div>
                        <div>Ctrl+S 저장 · Esc 선택 취소 · Enter 선택 적용</div>
                        <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>펜 / 손가락</b></div>
                        <div>펜(S펜)·마우스 = 그리기 / 손가락은 그려지지 않음(팜 리젝션)</div>
                        <div>캔버스: 손가락 1개 = 이동, 2개 = 핀치 줌 (우상단 ⟲ 초기화)</div>
                        <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>타임라인</b></div>
                        <div>1손가락 드래그 = 이동, 탭 = 재생위치 / 2손가락 = 확대·축소</div>
                        <div>컷: 길게 눌러 이동 · 가장자리 드래그로 길이조절 · 더블클릭 이름변경 · Ctrl/Shift+클릭 다중선택</div>
                        <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>팁</b></div>
                        <div>애니메이션(컷·파츠)은 ▶ 재생 시에만 보입니다. 올가미 → "파츠로 분리"로 부분 애니메이션.</div>
                    </div>
                </div>
            )}

            <div className="top-bar">
                <h1 className="title">Easy MV Maker</h1>
                <button className="icon-btn" onClick={() => setShowHelp(true)} title="단축키 · 도움말" style={{ fontSize: 13, fontWeight: 700, width: 22, height: 22 }}>?</button>
                {autoSavedAt && <span style={{ fontSize: 11, color: '#5a8', marginLeft: 4 }} title="브라우저에 자동저장됨">● 자동저장 {new Date(autoSavedAt).toLocaleTimeString()}</span>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }} ref={fileMenuRef}>
                        <button className="button" onClick={() => setShowFileMenu(v => !v)}>파일 <ChevronDown size={12} /></button>
                        {showFileMenu && (
                            <div className="file-menu">
                                <button className="file-menu-item" onClick={() => { doNew(); setShowFileMenu(false); }}>새 프로젝트</button>
                                <div className="file-menu-sep" />
                                <button className="file-menu-item" onClick={() => { doSave(false); setShowFileMenu(false); }}>저장 (Ctrl+S)</button>
                                <button className="file-menu-item" onClick={() => { doSave(true); setShowFileMenu(false); }}>다른 이름으로 저장...</button>
                                <div className="file-menu-sep" />
                                <button className="file-menu-item" onClick={() => { doOpen(); setShowFileMenu(false); }}>로컬 파일 열기...</button>
                                <div className="file-menu-sep" />
                                <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>로컬 (브라우저 저장)</div>
                                <button className="file-menu-item" onClick={() => { doLocalSave(false); setShowFileMenu(false); }}>로컬에 저장</button>
                                <button className="file-menu-item" onClick={() => { doLocalSave(true); setShowFileMenu(false); }}>로컬에 새 이름으로 저장...</button>
                                <button className="file-menu-item" onClick={() => { openLocalList(); setShowFileMenu(false); }}>로컬에서 열기...</button>
                                {serverAvailable && <>
                                    <div className="file-menu-sep" />
                                    <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>서버 (DB)</div>
                                    <button className="file-menu-item" onClick={() => { doServerSave(false); setShowFileMenu(false); }}>서버에 저장</button>
                                    <button className="file-menu-item" onClick={() => { doServerSave(true); setShowFileMenu(false); }}>서버에 새 이름으로 저장...</button>
                                    <button className="file-menu-item" onClick={() => { openServerList(); setShowFileMenu(false); }}>서버에서 열기...</button>
                                </>}
                            </div>
                        )}
                    </div>
                    <div style={{ width: 1, height: 24, background: '#444' }} />
                    <select className="time-input" style={{ height: 34, width: 116 }} title="캔버스 해상도"
                        value={`${CANVAS_W}x${CANVAS_H}`}
                        onChange={e => {
                            if (e.target.value === 'custom') {
                                const s = window.prompt('캔버스 크기 (가로x세로)', `${CANVAS_W}x${CANVAS_H}`);
                                if (!s) return;
                                const m = s.match(/(\d+)\s*[xX*,\s]\s*(\d+)/);
                                if (!m) { alert('예: 1920x1080'); return; }
                                setCanvasSize({ w: Math.max(64, Math.min(4096, +m[1])), h: Math.max(64, Math.min(4096, +m[2])) });
                            } else {
                                const [w, h] = e.target.value.split('x').map(Number);
                                setCanvasSize({ w, h });
                            }
                        }}>
                        {['854x480', '1280x720', '1920x1080', '2560x1440', '1080x1080', '1080x1920'].map(v => <option key={v} value={v}>{v}</option>)}
                        {!['854x480', '1280x720', '1920x1080', '2560x1440', '1080x1080', '1080x1920'].includes(`${CANVAS_W}x${CANVAS_H}`) && <option value={`${CANVAS_W}x${CANVAS_H}`}>{CANVAS_W}x{CANVAS_H}</option>}
                        <option value="custom">직접 입력…</option>
                    </select>
                    <button className="button button-primary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 34 }}><Download size={15} /> Export</button>
                    <label className="audio-input-label">
                        <Upload size={14} />{audioFile ? audioFile.name : 'Load Audio...'}
                        <input type="file" accept="audio/*" onChange={handleAudioUpload} style={{ display: 'none' }} />
                    </label>
                    {serverAvailable && <button className="button" onClick={loadYoutubeAudio} title="유튜브 링크에서 음원 추출 (로컬 서버, yt-dlp 필요)" style={{ height: 34 }}>YT 음원</button>}
                    {audioFile && <button className="icon-btn del-btn" onClick={handleDeleteAudio} title="오디오 삭제" style={{ height: 34, width: 30 }}><Trash2 size={14} /></button>}
                    <label className="audio-input-label" title="영상을 프레임별 컷으로 가져오기">
                        <Film size={14} /> 영상 프레임
                        <input type="file" accept="video/*" ref={videoFileRef} style={{ display: 'none' }}
                            onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) openVideoImport(f); }} />
                    </label>
                    {serverAvailable && <button className="button" onClick={loadYoutubeVideo} title="유튜브 링크에서 영상을 받아 프레임 추출 (로컬 서버, yt-dlp 필요)" style={{ height: 34 }}>YT 영상</button>}
                    {recentVideos.length > 0 && (
                        <select className="time-input" style={{ height: 34, width: 120 }} value="" title="같은 출처에서 다시 가져오기 (기존 프레임은 교체됨)"
                            onChange={e => { const v = recentVideos.find(x => x.id === e.target.value); e.target.value = ''; if (v) reimportRecent(v); }}>
                            <option value="">다시 가져오기…</option>
                            {recentVideos.map(v => <option key={v.id} value={v.id}>{v.name.slice(0, 20)}</option>)}
                        </select>
                    )}
                </div>
            </div>

            <div className="main-content">
                {showLeft && (
                    <div className="toolbar" style={{ width: 96, flexShrink: 0 }}>
                        <button onClick={() => setShowLeft(false)} className="icon-btn" style={{ width: '100%', padding: '4px 0', marginBottom: 4 }}><ChevronLeft size={14} /></button>
                        <div className="tool-grid">
                            {TOOL_TYPES.map(pt => (
                                <button key={pt.id} className={`tool-btn${tool === pt.id ? ' active' : ''}`} onClick={() => handleSetTool(pt.id)} title={pt.label}>
                                    <pt.Icon size={15} />
                                    <span className="tool-label">{pt.label}</span>
                                </button>
                            ))}
                            <button className={`tool-btn${onionPrev ? ' onion-prev-active' : ''}`} onClick={() => setOnionPrev(v => !v)} title="이전 프레임 표시 (연보라)"><Layers size={15} /><span className="tool-label">◀Onion</span></button>
                            <button className={`tool-btn${onionNext ? ' onion-next-active' : ''}`} onClick={() => setOnionNext(v => !v)} title="다음 프레임 표시 (원본색)"><Layers size={15} /><span className="tool-label">Onion▶</span></button>
                            <button className="tool-btn" onClick={globalUndo} title="Undo"><Undo size={15} /><span className="tool-label">Undo</span></button>
                            <button className="tool-btn" onClick={globalRedo} title="Redo"><Redo size={15} /><span className="tool-label">Redo</span></button>
                            <button className="tool-btn" onClick={handleClearCut} title="현재 컷 전체 비우기"><Trash size={15} /><span className="tool-label">비우기</span></button>
                            {hasLassoClip && <button className="tool-btn" onClick={pasteLassoSelection} title="복사한 올가미 선택을 현재 레이어에 붙여넣기"><ClipboardPaste size={15} /><span className="tool-label">올가미↓</span></button>}
                        </div>
                        <div className="tool-divider" />
                        <input type="color" className="color-picker" value={color} onChange={e => setColor(e.target.value)} title="색상" disabled={isSelectionTool} />
                        <div className="slider-wrap">
                            {(() => {
                                const curSize = tool === 'eraser' ? eraserSize : brushSize;
                                const setSize = (v) => { const n = Math.max(1, Math.min(200, Math.round(v) || 1)); tool === 'eraser' ? setEraserSize(n) : setBrushSize(n); };
                                return (<>
                                    <span className="slider-label">{tool === 'eraser' ? '지우개' : 'Size'}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                                        <input type="number" min="1" max="200" value={curSize} disabled={isSelectionTool}
                                            onChange={e => setSize(+e.target.value)} style={{ width: 46, textAlign: 'center' }} className="time-input" />
                                        <span style={{ fontSize: 10, color: '#888' }}>px</span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', margin: '4px 0' }}>
                                        {[2, 4, 8, 12, 20, 32, 48, 70].map(s => {
                                            const d = Math.max(2, Math.min(18, s));
                                            return (
                                                <button key={s} onClick={() => setSize(s)} disabled={isSelectionTool} title={`${s}px`}
                                                    style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, borderRadius: 4, background: curSize === s ? '#3a3a5c' : '#222', border: curSize === s ? '1px solid #7c8cff' : '1px solid #333', cursor: 'pointer' }}>
                                                    <span style={{ width: d, height: d, borderRadius: '50%', background: '#ddd', display: 'block' }} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <input type="range" min="1" max="80" value={Math.min(80, curSize)} onChange={e => setSize(+e.target.value)} className="v-slider" disabled={isSelectionTool} />
                                </>);
                            })()}
                        </div>
                        <div className="slider-wrap">
                            <span className="slider-label">Opacity</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                                <input type="number" min="0" max="100" value={Math.round(opacity * 100)} disabled={isSelectionTool}
                                    onChange={e => setOpacity(Math.max(0, Math.min(100, Math.round(+e.target.value) || 0)) / 100)}
                                    style={{ width: 46, textAlign: 'center' }} className="time-input" />
                                <span style={{ fontSize: 10, color: '#888' }}>%</span>
                            </div>
                            <input type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={e => setOpacity(+e.target.value / 100)} className="v-slider" disabled={isSelectionTool} />
                        </div>
                    </div>
                )}
                {!showLeft && <button onClick={() => setShowLeft(true)} className="icon-btn" style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: '#1e1e2e', border: 'none', borderRight: '1px solid #333' }}><ChevronRight size={14} /></button>}

                <div className="canvas-area" ref={canvasAreaRef} style={{ touchAction: 'none', position: 'relative' }}
                    onPointerDown={onAreaPointerDown} onPointerMove={onAreaPointerMove} onPointerUp={onAreaPointerUp} onPointerCancel={onAreaPointerUp}>
                    {pathCapture && (
                        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 31, background: '#7c8cff', color: '#fff', fontSize: 12, padding: '6px 12px', borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                            펜으로 이동 경로를 그리세요
                            <button className="button" style={{ height: 24, padding: '0 8px' }} onClick={() => setPathCapture(null)}>취소</button>
                        </div>
                    )}
                    {(view.zoom !== 1 || view.x !== 0 || view.y !== 0) && (
                        <button className="button" onClick={resetView} title="줌 초기화"
                            style={{ position: 'absolute', top: 8, right: 8, zIndex: 30, height: 28, padding: '0 10px' }}>
                            {Math.round(view.zoom * 100)}% ⟲
                        </button>
                    )}
                    <div className="canvas-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, maxWidth: '100%', maxHeight: '100%' }}>
                        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
                            onPointerDown={startDraw} onPointerMove={onDraw} onPointerUp={stopDraw} onPointerCancel={stopDraw} onPointerLeave={onPointerLeaveCanvas}
                            style={{ cursor: selection ? 'move' : tool === 'fill' ? 'cell' : tool === 'lasso' ? 'crosshair' : 'crosshair', touchAction: 'none' }} />
                        {selection && (
                            <div className="selection-actions">
                                <button className="button button-primary" onClick={extractSelectionToPart} style={{ height: 30, padding: '0 10px' }} title="선택 영역을 별도 레이어(파츠)로 분리해 애니메이션">파츠로 분리</button>
                                <button className="button" onClick={copyLassoSelection} style={{ height: 30, padding: '0 10px' }} title="선택 영역 복사 (다른 컷/레이어에 붙여넣기)">복사</button>
                                <button className="button" onClick={commitSelection} style={{ height: 30, padding: '0 10px' }} title="제자리에 적용(이동/크기)">완료</button>
                                <button className="button" onClick={cancelSelection} style={{ height: 30, padding: '0 10px' }}>취소</button>
                            </div>
                        )}
                        {textEdit && (
                            <div className="text-editor" style={{ left: Math.round(textEdit.cssX), top: Math.round(textEdit.cssY) }}>
                                <textarea
                                    ref={textAreaRef}
                                    value={textEdit.text}
                                    onChange={e => setTextEdit(te => te ? ({ ...te, text: e.target.value }) : te)}
                                    onKeyDown={e => {
                                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelText(); }
                                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commitText(); }
                                    }}
                                    placeholder="텍스트 입력 (Ctrl+Enter 완료, Esc 취소)"
                                />
                                <div className="text-editor-row">
                                    <label className="text-editor-label">Size</label>
                                    <input
                                        type="number"
                                        min="6"
                                        max="400"
                                        value={textEdit.fontSize}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, fontSize: Math.max(6, Math.min(400, +e.target.value || 6)) }) : te)}
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
                                                    title="폰트"
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
                                                        title="커스텀 폰트"
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
                                        title="색상"
                                    />
                                    <button className="button" title="굵게" onClick={() => setTextEdit(te => te ? ({ ...te, bold: !te.bold }) : te)}
                                        style={{ height: 26, width: 28, padding: 0, fontWeight: 800, background: textEdit.bold ? '#3a3a5c' : undefined }}>B</button>
                                    <button className="button" title="기울임" onClick={() => setTextEdit(te => te ? ({ ...te, italic: !te.italic }) : te)}
                                        style={{ height: 26, width: 28, padding: 0, fontStyle: 'italic', background: textEdit.italic ? '#3a3a5c' : undefined }}>I</button>
                                    <select className="time-input" style={{ width: 52 }} title="정렬" value={textEdit.align || 'left'}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, align: e.target.value }) : te)}>
                                        <option value="left">◧</option><option value="center">▣</option><option value="right">◨</option>
                                    </select>
                                    <select className="time-input" style={{ width: 54 }} title="줄간격" value={textEdit.lineHeight ?? 1.25}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, lineHeight: +e.target.value }) : te)}>
                                        {[1, 1.15, 1.25, 1.5, 1.8, 2].map(v => <option key={v} value={v}>{v}x</option>)}
                                    </select>
                                    <label style={{ fontSize: 11, color: '#aaa', display: 'flex', alignItems: 'center', gap: 3 }} title="가독성용 외곽선">
                                        <input type="checkbox" checked={!!textEdit.outline} onChange={e => setTextEdit(te => te ? ({ ...te, outline: e.target.checked }) : te)} />테두리
                                    </label>
                                    {textEdit.outline && <input type="color" value={textEdit.outlineColor || '#ffffff'} onChange={e => setTextEdit(te => te ? ({ ...te, outlineColor: e.target.value }) : te)} className="text-editor-color" title="테두리 색" />}
                                    <div style={{ flex: 1 }} />
                                    <button className="button button-primary" onClick={commitText} style={{ height: 28, padding: '0 10px' }}>완료</button>
                                    <button className="button" onClick={cancelText} style={{ height: 28, padding: '0 10px' }}>취소</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {showRight && <div className="splitter-v" style={{ touchAction: 'none' }} onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); setSplitter({ type: 'right', startX: e.clientX, startW: rightW }); }} />}

                {showRight && (
                    <div className="right-panel" style={{ width: rightW, flexShrink: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span className="panel-title">CUT / LAYER</span>
                            <button className="icon-btn" onClick={() => setShowRight(false)}><ChevronRight size={14} /></button>
                        </div>
                        <div className="cut-list">
                            {[...cuts].sort((a, b) => (a.track || 0) - (b.track || 0) || a.startTime - b.startTime).map((cut, _i, _arr) => { const isCur = currentCutId === cut.id; const collapsed = collapsedCutIds.has(cut.id); const layerCount = cut.layers.filter(l => l.type === 'layer').length; const showTrackHeader = _i === 0 || (_arr[_i - 1].track || 0) !== (cut.track || 0); return (
                                <React.Fragment key={cut.id}>
                                {showTrackHeader && <div className="track-group-header">Track {cut.track || 0}</div>}
                                <div className={`cut-item${currentCutId === cut.id ? ' cut-active' : ''}${selectedCutIds.has(cut.id) && selectedCutIds.size > 1 ? ' cut-multi' : ''}`} onClick={e => handleCutClick(e, cut.id)}>
                                    <div className="cut-header">
                                        {isCur
                                            ? <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleCutCollapse(cut.id); }} title={collapsed ? '펼치기' : '접기'}>{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>
                                            : <span style={{ width: 22, flexShrink: 0, fontSize: 9, color: '#666', textAlign: 'center' }}>L{layerCount}</span>}
                                        {renamingCutId === cut.id
                                            ? <input className="time-input" style={{ flex: 1, minWidth: 0 }} autoFocus defaultValue={cut.name}
                                                onClick={e => e.stopPropagation()}
                                                onBlur={e => { renameCut(cut.id, e.target.value.trim() || cut.name); setRenamingCutId(null); }}
                                                onKeyDown={e => { if (e.key === 'Enter') { renameCut(cut.id, e.target.value.trim() || cut.name); setRenamingCutId(null); } if (e.key === 'Escape') setRenamingCutId(null); }} />
                                            : <span className="cut-name" onDoubleClick={e => { e.stopPropagation(); setRenamingCutId(cut.id); }} title="더블클릭으로 이름 변경">{cut.name}</span>}
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button className="icon-btn" onClick={e => { e.stopPropagation(); handleDuplicateCut(cut.id); }} title="다음 프레임으로 복제 (Ctrl+D)"><CopyPlus size={12} /></button>
                                            <button className="icon-btn" onClick={e => { e.stopPropagation(); handleCopyCut(cut.id); }} title="컷 복사 (Ctrl+C)"><Copy size={12} /></button>
                                            <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleCutSettings(cut.id); }} title="설정"><Settings size={12} /></button>
                                            <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteCut(cut.id); }}><Trash2 size={12} /></button>
                                        </div>
                                    </div>
                                    {isCur && !collapsed && (<>
                                    {expandedCuts.has(cut.id) && (
                                        <div className="cut-settings" onClick={e => e.stopPropagation()}>
                                            <div className="time-row">
                                                <label>Start<input type="number" step="0.5" min="0" className="time-input" value={cut.startTime} onChange={e => updCutTime(cut.id, 'startTime', e.target.value)} /></label>
                                                <label>End<input type="number" step="0.5" min="0" className="time-input" value={cut.endTime} onChange={e => updCutTime(cut.id, 'endTime', e.target.value)} /></label>
                                            </div>
                                            <CutAnimPanel cut={cut} updCutAnim={updCutAnim} />
                                        </div>
                                    )}
                                    <div className="layer-list" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragLayerInfo && dragLayerInfo.cutId === cut.id) { updLayers(cut.id, c => { const layers = [...c.layers], di = layers.findIndex(l => l.id === dragLayerInfo.layerId), dragged = { ...layers[di], parentId: null }; layers.splice(di, 1); layers.push(dragged); return { layers }; }); setDragLayerInfo(null); setDropInfo(null); } }}>
                                        {renderLayers(cut)}
                                    </div>
                                    {cut.id === currentCutId && (
                                        <div className="text-panel">
                                            <div className="text-panel-title">
                                                <span>TEXT</span>
                                                <button className="small-btn" onClick={e => { e.stopPropagation(); handleSetTool('text'); }}>+ Text</button>
                                            </div>
                                            {safeArray(cut.texts).length === 0 && (
                                                <div style={{ fontSize: 11, color: '#666', padding: '6px 2px' }}>텍스트 없음</div>
                                            )}
                                            {safeArray(cut.texts).map(t => (
                                                <div
                                                    key={t.id}
                                                    className={`text-item${selectedText?.cutId === cut.id && selectedText?.textId === t.id ? ' active' : ''}`}
                                                    onClick={e => { e.stopPropagation(); setSelectedText({ cutId: cut.id, textId: t.id }); }}
                                                >
                                                    <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleTextVisible(cut.id, t.id); }} title="표시">
                                                        {t.visible === false ? <EyeOff size={10} style={{ color: '#555' }} /> : <Eye size={10} />}
                                                    </button>
                                                    <div className="text-item-name">{String(t.text ?? '').split('\n')[0] || '(빈 텍스트)'}</div>
                                                    <button className="icon-btn" onClick={e => { e.stopPropagation(); openEditText(cut.id, t.id); }} title="편집"><Settings size={11} /></button>
                                                    <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); deleteTextObject(cut.id, t.id); }} title="삭제"><Trash2 size={11} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                        <button className="small-btn" onClick={e => handleAddLayer(e, cut.id)}><Plus size={11} /> 레이어</button>
                                        <button className="small-btn" onClick={e => handleAddFolder(e, cut.id)}><FolderPlus size={11} /> 폴더</button>
                                    </div>
                                    </>)}
                                </div>
                                </React.Fragment>
                            ); })}
                        </div>
                        <button className="button button-primary" style={{ width: '100%', marginTop: 10, opacity: currentCutId ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }} onClick={() => handleDuplicateCut(currentCutId)} disabled={!currentCutId} title="현재 컷을 다음 프레임으로 복제 (Ctrl+D)"><CopyPlus size={14} /> 다음 프레임 복제</button>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button className="button" style={{ flex: 1, minWidth: 0 }} onClick={handleAddCut}><Plus size={14} /> Add Cut</button>
                            <button className="button" style={{ flex: 1, minWidth: 0, opacity: copiedCut ? 1 : 0.4 }} onClick={handlePasteCut} disabled={!copiedCut} title="컷 붙여넣기 (Ctrl+V)"><ClipboardPaste size={14} /> Paste</button>
                        </div>
                        {selectedCutIds.size > 1 && (
                            <button className="button del-btn" style={{ width: '100%', marginTop: 6 }} onClick={() => handleDeleteCut(currentCutId)} title="선택한 컷 삭제 (Delete)">
                                <Trash2 size={14} /> 선택 {selectedCutIds.size}컷 삭제
                            </button>
                        )}
                        {videoBatches.length > 0 && (
                            <div style={{ marginTop: 10, borderTop: '1px solid #2a2a3a', paddingTop: 8 }}>
                                <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>가져온 영상 프레임</div>
                                {videoBatches.map(b => (
                                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#bbb', padding: '3px 0' }}>
                                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
                                        <span style={{ color: '#777' }}>{b.count}컷</span>
                                        <button className="icon-btn del-btn" title="이 영상 프레임 전체 삭제" onClick={() => deleteVideoBatch(b.id)}><Trash2 size={11} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {!showRight && <button onClick={() => setShowRight(true)} className="icon-btn" style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: '#1e1e2e', border: 'none', borderLeft: '1px solid #333' }}><ChevronRight size={14} /></button>}
            </div>

            {showBottom && <div className="splitter-h" style={{ touchAction: 'none' }} onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); setSplitter({ type: 'bottom', startY: e.clientY, startH: timelineH }); }} />}

            <div className="timeline" style={{ height: showBottom ? timelineH : 44, flexShrink: 0 }}>
                <div className="tl-controls">
                    <button className="icon-btn" onClick={() => setShowBottom(v => !v)}>{showBottom ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
                    {showBottom && <>
                        <div className="time-display">{fmt(currentTime)}</div>
                        <button className="button button-primary" onClick={handlePlayPause}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
                        <button className="button" onClick={handleStop}><Square size={16} /></button>
                        <button className={`button${loopPlay ? ' button-primary' : ''}`} onClick={() => setLoopPlay(v => !v)} title="반복 재생"><Repeat size={16} /></button>
                        {videoOverlay?.cuts?.length > 0 && <>
                            <button className="button" onClick={() => goToScene(-1)} title="이전 장면(컷)">◀컷</button>
                            <button className="button" onClick={() => goToScene(1)} title="다음 장면(컷)">컷▶</button>
                        </>}
                        {videoOverlay && <button className={`button${detectCfg.open ? ' button-primary' : ''}`} onClick={() => setDetectCfg(v => ({ ...v, open: !v.open }))} title="장면(컷) 감지 설정">컷감지</button>}
                        <select className="time-input" style={{ width: 60, marginLeft: 8 }} value={playbackRate} onChange={e => { const r = +e.target.value; setPlaybackRate(r); if (audioRef.current) audioRef.current.playbackRate = r; }} title="재생 속도">
                            {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map(v => <option key={v} value={v}>{v}x</option>)}
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 12 }} title="타임라인 확대/축소 (마우스 휠은 커서 기준)">
                            <button className="icon-btn" onClick={() => { const el = timelineRef.current; const r = el?.getBoundingClientRect(); zoomTimelineAt(r ? r.left + el.clientWidth / 2 : 0, 1 / 1.25); }}>−</button>
                            <span style={{ fontSize: 11, color: '#888', minWidth: 30, textAlign: 'center' }}>{Math.round(pps)}</span>
                            <button className="icon-btn" onClick={() => { const el = timelineRef.current; const r = el?.getBoundingClientRect(); zoomTimelineAt(r ? r.left + el.clientWidth / 2 : 0, 1.25); }}>＋</button>
                        </div>
                        <span style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>Max: {fmt(maxTime)}</span>
                    </>}
                </div>
                {showBottom && videoOverlay && detectCfg.open && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: '1px solid #2a2a3a', flexShrink: 0, fontSize: 11.5, color: '#bcd', flexWrap: 'wrap' }}>
                        <span style={{ color: '#8ac' }}>장면(컷) 감지</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="민감도: 낮을수록 작은 변화도 컷으로 잡음">
                            민감도
                            <input type="range" min={8} max={45} value={50 - detectCfg.threshold + 8} onChange={e => setDetectCfg(v => ({ ...v, threshold: 50 - (+e.target.value) + 8 }))} style={{ width: 90 }} />
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="이 구간만 감지 (mm:ss). 비우면 전체">
                            구간
                            <input className="time-input" style={{ width: 56 }} placeholder="0:00" value={detectCfg.startText} onChange={e => setDetectCfg(v => ({ ...v, startText: e.target.value }))} />
                            <span>~</span>
                            <input className="time-input" style={{ width: 56 }} placeholder="끝" value={detectCfg.endText} onChange={e => setDetectCfg(v => ({ ...v, endText: e.target.value }))} />
                        </span>
                        <button className="button" disabled={!!sceneDetect} onClick={redetectScenes}>{sceneDetect ? `감지 중 ${sceneDetect.total ? Math.round(sceneDetect.done / sceneDetect.total * 100) : 0}%` : '다시 감지'}</button>
                        <span style={{ color: '#789' }}>{videoOverlay.cuts?.length ? `${videoOverlay.cuts.length}개 컷 표시됨` : ''}</span>
                    </div>
                )}
                {showBottom && (parts.length > 0 || selectedCutIds.size > 0) && (
                    <div className="parts-bar" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderBottom: '1px solid #2a2a3a', overflowX: 'auto', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, color: '#777', marginRight: 2, flexShrink: 0 }}>파트</span>
                        <button className={`chip${!activePartId ? ' chip-active' : ''}`} onClick={() => selectPart(null)} title="전체 재생" style={{ flexShrink: 0 }}>전체</button>
                        {parts.map((p, i) => (
                            <button key={p.id} className={`chip${activePartId === p.id ? ' chip-active' : ''}`} style={{ flexShrink: 0 }}
                                onClick={() => selectPart(p.id)} onDoubleClick={() => renamePart(p.id)}
                                title={`${p.name} · ${p.count}컷 (클릭: 이 파트만 재생 / 더블클릭: 이름변경)`}>
                                {p.name.slice(0, 14)} <span style={{ opacity: 0.6 }}>·{p.count}</span>
                                <span onClick={e => { e.stopPropagation(); ungroupPart(p.id); }} title="파트 해제 (컷은 유지)" style={{ marginLeft: 4, opacity: 0.5, cursor: 'pointer' }}>✕</span>
                            </button>
                        ))}
                        {selectedCutIds.size > 0 && (
                            <button className="chip" onClick={makePartFromSelection} title="선택한 컷을 새 파트로 묶기" style={{ flexShrink: 0, color: '#9cf' }}>+ 선택 {selectedCutIds.size}컷 → 새 파트</button>
                        )}
                    </div>
                )}
                {showBottom && (
                    <div className="tl-tracks" ref={timelineRef} onPointerDown={onTimelinePointerDown} onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp} onPointerCancel={onTimelinePointerUp} style={{ position: 'relative', touchAction: 'none' }}>
                        <div style={{ minWidth: '100%', width: `${Math.max(100, maxTime * pps + 150)}px`, position: 'relative' }}>
                            <div className="ruler" style={{ position: 'sticky', top: 0, left: 0, right: 0, height: 20, background: '#1a1a2e', borderBottom: '1px solid #2e2e4a', zIndex: 20 }}>
                                <div style={{ position: 'sticky', left: 0, width: 60, height: '100%', background: '#1a1a2e', zIndex: 21, float: 'left' }} />
                                {(() => {
                                    const iMin = Math.max(0, Math.floor((tlWin.left - 60) / pps));
                                    const iMax = Math.min(Math.ceil(maxTime), Math.ceil((tlWin.right - 60) / pps));
                                    const ticks = [];
                                    for (let i = iMin; i <= iMax; i++) ticks.push(
                                        <div key={i} style={{ position: 'absolute', left: `${i * pps + 60}px`, borderLeft: '1px solid #333', height: i % 5 === 0 ? 20 : 10, fontSize: 10, paddingLeft: 2, top: 0, color: '#555' }}>{i % 5 === 0 ? i : ''}</div>
                                    );
                                    return ticks;
                                })()}
                            </div>
                            <div style={{ marginTop: 8 }}>
                                {Array.from({ length: numTracks }).map((_, ti) => (
                                    <div key={ti} className="tl-track"
                                        onDoubleClick={e => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = e.clientX - rect.left - 60;
                                            if (x < 0) return;
                                            const t = x / pps;
                                            const hit = cuts.find(c => c.track === ti && t >= c.startTime && t < c.endTime);
                                            if (hit) return;
                                            e.stopPropagation();
                                            const trackCuts = cuts.filter(c => c.track === ti).sort((a, b) => a.startTime - b.startTime);
                                            let gapStart = 0, gapEnd = t + 1;
                                            for (const c of trackCuts) { if (c.endTime <= t) gapStart = c.endTime; }
                                            for (const c of trackCuts) { if (c.startTime > t) { gapEnd = c.startTime; break; } }
                                            if (gapEnd - gapStart < 0.05) return;
                                            const newCut = { id: Date.now(), name: `Cut ${cuts.length + 1}`, startTime: gapStart, endTime: gapEnd, track: ti, layers: [mkLayer(1)], activeLayerId: 1 };
                                            setCuts(p => [...p, newCut]);
                                            setCurrentCutId(newCut.id);
                                            setCurrentTime(gapStart);
                                        }}
                                    >
                                        <div className="tl-track-label">
                                            <span>Track {ti}</span>
                                            <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteTrack(ti); }}><Trash2 size={9} /></button>
                                        </div>
                                        {cuts.filter(c => (c.track || 0) === ti).filter(cut => { const l = cut.startTime * pps + 60, r = l + (cut.endTime - cut.startTime) * pps; return r >= tlWin.left && l <= tlWin.right; }).map(cut => (
                                            <div key={cut.id} data-cutid={cut.id}
                                                className={`cut-block${currentCutId === cut.id ? ' cut-block-active' : ''}${selectedCutIds.has(cut.id) ? ' cut-block-selected' : ''}`}
                                                style={{ left: `${cut.startTime * pps + 60}px`, width: `${(cut.endTime - cut.startTime) * pps}px`, cursor: draggingCutData?.cutId === cut.id ? 'grabbing' : 'grab', touchAction: 'none', opacity: activePartId && cut.partId !== activePartId ? 0.3 : 1 }}
                                                onClick={e => { e.stopPropagation(); if (cutDragMovedRef.current || e.shiftKey || e.ctrlKey || e.metaKey) return; setCurrentCutId(cut.id); setSelectedCutIds(new Set([cut.id])); }}
                                                onPointerDown={e => {
                                                    e.stopPropagation();
                                                    if (e.shiftKey || e.ctrlKey || e.metaKey) { // add/remove from selection, no drag
                                                        setSelectedCutIds(p => { const s = new Set(p); s.has(cut.id) ? s.delete(cut.id) : s.add(cut.id); return s; });
                                                        setCurrentCutId(cut.id); cutDragMovedRef.current = false; return;
                                                    }
                                                    setCurrentCutId(cut.id);
                                                    // Pressing a cut that's part of a multi-selection keeps the group (so it can be
                                                    // dragged together); pressing any other cut selects just that one.
                                                    const inGroup = selectedCutIds.has(cut.id) && selectedCutIds.size > 1;
                                                    const group = inGroup ? cuts.filter(c => selectedCutIds.has(c.id)).map(c => ({ id: c.id, startTime: c.startTime, endTime: c.endTime, track: c.track })) : null;
                                                    if (!inGroup) setSelectedCutIds(new Set([cut.id]));
                                                    cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350);
                                                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
                                                    setDraggingCutData({ cutId: cut.id, startX: e.clientX, startY: e.clientY, initialStart: cut.startTime, initialTrack: cut.track, group });
                                                }}>
                                                <div className="rh rh-left" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setResizingData({ cutId: cut.id, edge: 'left', startX: e.clientX, initialStart: cut.startTime, initialEnd: cut.endTime }); }} />
                                                {cut.name}
                                                <div className="rh rh-right" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setResizingData({ cutId: cut.id, edge: 'right', startX: e.clientX, initialStart: cut.startTime, initialEnd: cut.endTime }); }} />
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {audioFile && audioData && (
                                <div className="tl-track" style={{ background: '#161628' }}>
                                    <div className="tl-track-label" style={{ background: '#161628' }}><span>Audio</span><button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteAudio(); }} title="오디오 삭제"><Trash2 size={9} /></button></div>
                                    <div className="cut-block" style={{ left: `${audioData.startTime * pps + 60}px`, width: `${(audioData.endTime - audioData.startTime) * pps}px`, background: '#374151', borderColor: '#4b5563', cursor: draggingCutData?.cutId === 'audio' ? 'grabbing' : 'grab', touchAction: 'none' }}
                                        onPointerDown={e => { e.stopPropagation(); cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350); e.currentTarget.setPointerCapture(e.pointerId); setDraggingCutData({ cutId: 'audio', startX: e.clientX, startY: e.clientY, initialStart: audioData.startTime, initialTrack: 0 }); }}>
                                        <div className="rh rh-left" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setResizingData({ cutId: 'audio', edge: 'left', startX: e.clientX, initialStart: audioData.startTime, initialEnd: audioData.endTime, initialOffset: audioData.offset }); }} />
                                        🎵 Audio
                                        <div className="rh rh-right" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setResizingData({ cutId: 'audio', edge: 'right', startX: e.clientX, initialStart: audioData.startTime, initialEnd: audioData.endTime, initialOffset: audioData.offset }); }} />
                                    </div>
                                </div>
                            )}
                            {videoOverlay && (
                                <div className="tl-track" style={{ background: '#0f1e2a' }}>
                                    <div className="tl-track-label" style={{ background: '#0f1e2a' }}><span>영상</span>
                                        {sceneDetect ? <span style={{ fontSize: 9, color: '#7aa' }}>컷감지 {sceneDetect.total ? Math.round(sceneDetect.done / sceneDetect.total * 100) : 0}%</span>
                                            : videoOverlay.cuts?.length ? <span style={{ fontSize: 9, color: '#7aa' }}>{videoOverlay.cuts.length}컷</span> : null}
                                        <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); removeVideoOverlay(); }} title="영상 트랙 삭제"><Trash2 size={9} /></button></div>
                                    <div className="cut-block" style={{ left: `${videoOverlay.startTime * pps + 60}px`, width: `${(videoOverlay.endTime - videoOverlay.startTime) * pps}px`, background: '#155e75', borderColor: '#22d3ee55', cursor: draggingCutData?.cutId === 'video' ? 'grabbing' : 'grab', touchAction: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        onPointerDown={e => { e.stopPropagation(); cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } setDraggingCutData({ cutId: 'video', startX: e.clientX, startY: e.clientY, initialStart: videoOverlay.startTime, initialTrack: 0 }); }}>
                                        🎬 {videoOverlay.name}
                                        {/* scene-cut markers: click to jump the playhead to that scene */}
                                        {safeArray(videoOverlay.cuts).map((vt, i) => {
                                            const rel = (vt - (videoOverlay.cutOffset || 0));
                                            if (rel < 0 || rel > (videoOverlay.endTime - videoOverlay.startTime)) return null;
                                            return <div key={i} title={`장면 ${i + 1} (${fmt((videoOverlay.cutStart || 0) + rel)})`}
                                                onPointerDown={e => { e.stopPropagation(); }}
                                                onClick={e => { e.stopPropagation(); seekToTime((videoOverlay.cutStart || 0) + rel); }}
                                                style={{ position: 'absolute', top: 0, bottom: 0, left: `${rel * pps}px`, width: 2, background: '#fde047', boxShadow: '0 0 3px rgba(253,224,71,.7)', cursor: 'pointer' }} />;
                                        })}
                                    </div>
                                </div>
                            )}
                            <div style={{ marginTop: 8, paddingLeft: 60 }}>
                                <button className="small-btn" onClick={handleAddTrack}><Plus size={11} /> Add Track</button>
                            </div>
                            {marquee && (
                                <div style={{ position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, background: 'rgba(124,140,255,0.15)', border: '1px solid rgba(124,140,255,0.8)', zIndex: 16, pointerEvents: 'none' }} />
                            )}
                            <div className="playhead" ref={playheadRef} style={{ left: `${currentTime * pps + 60}px` }}><div className="playhead-dot" /></div>
                            {snapLinePos !== null && (
                                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${snapLinePos}px`, width: 2, background: '#888', opacity: 0.85, zIndex: 15, pointerEvents: 'none', boxShadow: '0 0 6px rgba(136,136,136,.5)' }} />
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
