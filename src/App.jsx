import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Plus, Trash2, Download, Upload, PenLine, Pen, Feather, Eraser, Droplets, Undo, Redo, Layers, Trash, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FolderPlus, Folder, FolderOpen, Settings, Eye, EyeOff, Copy, CopyPlus, ClipboardPaste, GitBranch, Move, Type, Server, Cloud, CloudDownload, Film, Repeat } from 'lucide-react';
import './App.css';
import { saveAutosave, loadAutosave } from './db';
import { CutAnimPanel, LayerAnimPanel } from './AnimPanels';
import {
    DEFAULT_CUT_DURATION, CANVAS_W, CANVAS_H, FONT_PRESETS,
    pointInPolygon, dist, safeArray, hexToRgb, bucketFillTransparentRegion,
    layerKey, imageDataToDataURL, dataURLToImageData, drawStrokesOnCtx,
    flattenForCanvas, flattenLayersInUiOrder,
    ANIM_DEFAULT, computeCutAnim, LAYER_ANIM_DEFAULT, computeLayerAnim,
} from './canvasUtils';

const PEN_TYPES = [
    { id: 'pen', label: 'Dot', Icon: PenLine },
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
    const lassoClipRef = useRef(null); // copied lasso pixels: { bitmapId, w, h }
    const [hasLassoClip, setHasLassoClip] = useState(false);
    const [showFileMenu, setShowFileMenu] = useState(false);
    const fileHandleRef = useRef(null);
    const [dragLayerInfo, setDragLayerInfo] = useState(null);
    const [dropInfo, setDropInfo] = useState(null);
    const canvasRef = useRef(null);
    const isDrawing = useRef(false);
    const reqRef = useRef(null);
    const fileMenuRef = useRef(null);
    const timelineRef = useRef(null);
    const [pps, setPps] = useState(50);
    const [copiedCut, setCopiedCut] = useState(null);
    const [lassoPoints, setLassoPoints] = useState([]);
    const [selection, setSelection] = useState(null);
    const [textEdit, setTextEdit] = useState(null);
    const [selectedText, setSelectedText] = useState(null);
    const [layerCanvasCache, setLayerCanvasCache] = useState({});
    const bitmapStoreRef = useRef(new Map());
    const dataUrlCacheRef = useRef(new Map()); // id -> {imageData, url}; avoids re-encoding bitmaps each autosave
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
    const [serverBusy, setServerBusy] = useState(false);
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
        const snapshot = JSON.stringify(cuts);
        if (historyRef.current.length > 0 && JSON.stringify(historyRef.current[historyIndexRef.current]) === snapshot) return;
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current.push(JSON.parse(snapshot));
        historyIndexRef.current = historyRef.current.length - 1;
        if (historyRef.current.length > 150) { historyRef.current.shift(); historyIndexRef.current--; }
    }, [cuts]);

    const globalUndo = () => {
        if (historyIndexRef.current <= 0) return;
        historyIndexRef.current--;
        isUndoRedoRef.current = true;
        setCuts(JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current])));
    };
    const globalRedo = () => {
        if (historyIndexRef.current >= historyRef.current.length - 1) return;
        historyIndexRef.current++;
        isUndoRedoRef.current = true;
        setCuts(JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current])));
    };

    const maxTime = Math.max(60, audioData?.endTime ?? audioDuration, ...cuts.map(c => c.endTime)) + 60;
    // Actual content bounds (where cuts/audio live) — playback & loop run between these,
    // not out to maxTime (which has empty padding for the timeline ruler).
    const contentEnd = Math.max(0, audioData?.endTime ?? 0, ...cuts.map(c => c.endTime));
    const contentStart = cuts.length ? Math.max(0, Math.min(...cuts.map(c => c.startTime), audioData?.startTime ?? Infinity)) : 0;

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
        if (!isPlaying) { if (audioRef.current) audioRef.current.pause(); cancelAnimationFrame(reqRef.current); return; }
        let last = performance.now();
        const step = (now) => {
            const delta = (now - last) / 1000; last = now;
            setCurrentTime(prev => {
                const next = prev + delta;
                if (audioRef.current && audioUrl) {
                    if (audioData) {
                        if (next >= audioData.startTime && next < audioData.endTime) {
                            if (audioRef.current.paused) audioRef.current.play().catch(() => { });
                            const exp = (next - audioData.startTime) + audioData.offset;
                            if (Math.abs(audioRef.current.currentTime - exp) > 0.15) audioRef.current.currentTime = exp;
                        } else if (!audioRef.current.paused) audioRef.current.pause();
                    } else { if (audioRef.current.paused) audioRef.current.play().catch(() => { }); }
                }
                if (isExporting.current && next >= exportEndRef.current) {
                    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
                    isExporting.current = false; setIsPlaying(false); if (audioRef.current) audioRef.current.pause(); return next;
                }
                const endAt = isExporting.current ? maxTime : contentEnd;
                if (next >= endAt) {
                    if (loopPlay && !isExporting.current) {
                        if (audioRef.current) audioRef.current.currentTime = contentStart;
                        return contentStart; // repeat from the first cut's start
                    }
                    setIsPlaying(false); if (audioRef.current) audioRef.current.pause(); return endAt;
                }
                return next;
            });
            reqRef.current = requestAnimationFrame(step);
        };
        reqRef.current = requestAnimationFrame(step);
        return () => cancelAnimationFrame(reqRef.current);
    }, [isPlaying, maxTime, audioUrl, loopPlay, contentStart, contentEnd]);

    useEffect(() => {
        if (!isPlaying && audioRef.current && audioUrl && Math.abs(audioRef.current.currentTime - currentTime) > 0.1)
            audioRef.current.currentTime = currentTime;
    }, [currentTime, isPlaying, audioUrl]);

    useEffect(() => {
        if (!splitter) return;
        const mv = (e) => {
            if (splitter === 'right') setRightW(Math.max(200, Math.min(600, window.innerWidth - e.clientX)));
            else if (splitter === 'bottom') setTimelineH(Math.max(100, Math.min(600, window.innerHeight - e.clientY)));
        };
        const up = () => setSplitter(null);
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    }, [splitter]);

    useEffect(() => {
        const h = (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setPps(p => Math.max(10, Math.min(300, p * (e.deltaY > 0 ? 0.9 : 1.1)))); } };
        const t = timelineRef.current;
        if (t) t.addEventListener('wheel', h, { passive: false });
        return () => { if (t) t.removeEventListener('wheel', h); };
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
                const snapshot = JSON.stringify(prev);
                if (historyRef.current.length > 0 && JSON.stringify(historyRef.current[historyIndexRef.current]) === snapshot) return prev;
                historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
                historyRef.current.push(JSON.parse(snapshot));
                historyIndexRef.current = historyRef.current.length - 1;
                if (historyRef.current.length > 150) { historyRef.current.shift(); historyIndexRef.current--; }
                return prev;
            });
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    }, [resizingData, draggingCutData, pps, numTracks]);

    const buildData = () => {
        // Persist the pixel data behind fill/lasso/paste strokes; otherwise reopening
        // a saved project loses everything that lives only in the in-memory bitmap store.
        const usedIds = new Set();
        cuts.forEach(c => c.layers.forEach(l => safeArray(l.strokes).forEach(s => { if (s.bitmapId) usedIds.add(s.bitmapId); })));
        const bitmaps = {};
        // Cache PNG encodes per bitmap id — imageData is immutable once stored, so the
        // (frequent) autosave doesn't re-encode every fill/part each time.
        const cache = dataUrlCacheRef.current;
        usedIds.forEach(id => {
            const entry = bitmapStoreRef.current.get(id);
            if (!entry?.imageData) return;
            const c = cache.get(id);
            if (c && c.imageData === entry.imageData) { bitmaps[id] = c.url; return; }
            const url = imageDataToDataURL(entry.imageData);
            cache.set(id, { imageData: entry.imageData, url });
            bitmaps[id] = url;
        });
        return {
            version: '1.3', appName: 'EasyMVMaker', savedAt: new Date().toISOString(), numTracks, onionPrev, onionNext, pps, bitmaps,
            cuts: cuts.map(c => ({ ...c, layers: c.layers.map(l => ({ ...l, redoStrokes: [] })) }))
        };
    };
    const restore = async (data) => {
        if (data.appName !== 'EasyMVMaker') { alert('올바른 .emv 파일이 아닙니다.'); return; }
        // Rebuild the bitmap store before swapping cuts in, so fill/lasso/paste render correctly.
        const store = bitmapStoreRef.current;
        store.clear();
        if (data.bitmaps) {
            const entries = await Promise.all(Object.entries(data.bitmaps).map(async ([id, url]) => {
                try {
                    const imageData = await dataURLToImageData(url);
                    let imageBitmap = null;
                    try { imageBitmap = await createImageBitmap(imageData); } catch { }
                    return [id, { imageData, imageBitmap }];
                } catch { return null; }
            }));
            entries.forEach(e => { if (e) store.set(e[0], e[1]); });
        }
        setCuts(data.cuts.map(c => ({
            ...c,
            texts: safeArray(c.texts),
            layers: c.layers.map(l => ({ type: 'layer', parentId: null, ...l, redoStrokes: [] }))
        })));
        setNumTracks(data.numTracks || 2); setCurrentCutId(data.cuts[0]?.id || 1); setCurrentTime(0);
        setOnionPrev(data.onionPrev ?? false); setOnionNext(data.onionNext ?? false); setPps(data.pps ?? 50); setExpandedCuts(new Set());
        setCopiedCut(null); // clipboard may reference bitmaps from the old project
        setLayerCanvasCache({}); // Clear cache on new project
    };
    const doSave = async (asNew = false) => {
        const json = JSON.stringify(buildData(), null, 2);
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
    };

    // --- Server-side project storage (separate from local download / .emv file) ---
    const apiFetch = async (url, opts) => {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    };
    const doServerSave = async (forceNew = false) => {
        setServerBusy(true);
        try {
            const data = buildData();
            if (!forceNew && serverIdRef.current) {
                await apiFetch(`/api/projects/${serverIdRef.current}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: serverNameRef.current || 'Untitled', data }),
                });
                alert('서버에 저장했습니다.');
                return;
            }
            const name = window.prompt('서버에 저장할 프로젝트 이름:', serverNameRef.current || 'MV Project');
            if (!name) return;
            const r = await apiFetch('/api/projects', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data }),
            });
            serverIdRef.current = r.id; serverNameRef.current = r.name;
            alert('서버에 저장했습니다.');
        } catch (e) {
            alert('서버 저장 실패: ' + e.message + '\n(API 서버가 실행 중인지 확인하세요: npm run dev)');
        } finally { setServerBusy(false); }
    };
    const openServerList = async () => {
        try { setServerProjects(await apiFetch('/api/projects')); }
        catch (e) { alert('서버 목록을 불러오지 못했습니다: ' + e.message + '\n(API 서버 실행 확인: npm run dev)'); }
    };
    const doServerOpen = async (id, name) => {
        try {
            const data = await apiFetch(`/api/projects/${id}`);
            await restore(data);
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

    // Debounced autosave to IndexedDB so a refresh/crash never loses work.
    useEffect(() => {
        if (!didRecoverRef.current) return;
        if (isDrawing.current || isDraggingOrResizingRef.current) return;
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => {
            try {
                const data = buildData();
                saveAutosave(data).then(() => setAutoSavedAt(Date.now())).catch(() => { });
            } catch { }
        }, 1500);
        return () => clearTimeout(autosaveTimerRef.current);
    }, [cuts, numTracks, onionPrev, onionNext, pps]);

    const handlePlayPause = () => {
        if (!isPlaying) {
            // Starting from the end (or before the content) rewinds to the first cut's start.
            if (currentTime >= contentEnd - 0.001 || currentTime < contentStart) {
                setCurrentTime(contentStart);
                if (audioRef.current) audioRef.current.currentTime = contentStart;
            }
        }
        setIsPlaying(!isPlaying);
    };
    const handleStop = () => {
        // Stop should pause at the current position (do not rewind).
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

    const getTextMeasureCtx = () => {
        if (!textMeasureCtxRef.current) {
            const c = document.createElement('canvas');
            c.width = 16;
            c.height = 16;
            textMeasureCtxRef.current = c.getContext('2d');
        }
        return textMeasureCtxRef.current;
    };

    const measureTextBox = (t) => {
        const ctx = getTextMeasureCtx();
        const fontSize = Math.max(6, Math.min(220, t.fontSize ?? 32));
        const fontFamily = t.fontFamily ?? 'sans-serif';
        ctx.font = `${fontSize}px ${fontFamily}`;
        const lineHeight = Math.round(fontSize * 1.25);
        const lines = String(t.text ?? '').split('\n');
        let w = 0;
        for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
        const h = Math.max(1, lines.length) * lineHeight;
        return { x: t.x ?? 0, y: t.y ?? 0, w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
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
                cssX: (pos.x * sx),
                cssY: (pos.y * sy),
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
            case 'marker':
            case 'calligraphy':
            case 'eraser':
                updLayers(currentCutId, c => ({
                    layers: c.layers.map(l => {
                        if (l.id !== c.activeLayerId) return l;
                        const newStrokes = [...l.strokes];
                        const currentStroke = newStrokes[newStrokes.length - 1];
                        if (currentStroke && currentStroke.tool !== 'paste' && currentStroke.tool !== 'fill') {
                            currentStroke.points.push(pos);
                        }
                        return { ...l, strokes: newStrokes };
                    })
                }));
                break;
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
            cssX: ((t.x ?? 0) * sx),
            cssY: ((t.y ?? 0) * sy),
            text: t.text ?? '',
            fontSize: t.fontSize ?? 36,
            fontFamily: t.fontFamily ?? 'sans-serif',
            color: t.color ?? color,
            opacity: t.opacity ?? opacity,
            visible: t.visible !== false,
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
        for (const cut of cuts) {
            for (const layer of cut.layers) {
                if (layer.type !== 'layer') continue;
                const key = layerKey(cut.id, layer.id);
                validKeys.add(key);
                const canvas = newCache[key];
                const layerStrokes = JSON.stringify(layer.strokes);
                if (!canvas || canvas.dataset.strokes !== layerStrokes) {
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
    }, [cuts]);

    useEffect(() => {
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const primary = cuts.find(c => c.id === currentCutId);
        let activeCuts = cuts.filter(c => currentTime >= c.startTime && currentTime < c.endTime);
        if (!activeCuts.find(c => c.id === currentCutId) && primary && !isPlaying) activeCuts.push(primary);
        activeCuts.sort((a, b) => a.track - b.track);

        if (!isPlaying && primary) {
            if (onionPrev) {
                const prevCut = cuts.filter(c => c.startTime < primary.startTime && c.track === primary.track).sort((a, b) => b.startTime - a.startTime)[0];
                if (prevCut) {
                    const order = flattenLayersInUiOrder(prevCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = layerCanvasCache[layerKey(prevCut.id, order[i].id)];
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
                }
            }
            if (onionNext) {
                const nextCut = cuts.filter(c => c.startTime >= primary.endTime && c.track === primary.track).sort((a, b) => a.startTime - b.startTime)[0];
                if (nextCut) {
                    const order = flattenLayersInUiOrder(nextCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = layerCanvasCache[layerKey(nextCut.id, order[i].id)];
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
                }
            }
        }

        activeCuts.forEach(ac => {
            const order = flattenLayersInUiOrder(ac.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
            // Cut-level animation (enter/exit/deform) applies only during playback/export,
            // so editing stays at rest. Transform about the canvas centre.
            const anim = isPlaying ? computeCutAnim(ac, currentTime) : null;
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
                const layerCanvas = layerCanvasCache[layerKey(ac.id, l.id)];
                if (!layerCanvas) continue;

                // Per-layer ("part") transform nests inside the cut transform.
                const la = isPlaying ? computeLayerAnim(l, ac, currentTime) : null;
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
            const anim = isPlaying ? computeCutAnim(ac, currentTime) : null;
            ctx.save();
            if (anim) {
                ctx.translate(CANVAS_W / 2 + anim.tx, CANVAS_H / 2 + anim.ty);
                ctx.scale(anim.sx, anim.sy);
                ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
            }
            for (const t of safeArray(ac.texts)) {
                if (!t || t.visible === false) continue;
                const fontSize = Math.max(6, Math.min(220, t.fontSize ?? 32));
                const fontFamily = t.fontFamily ?? 'sans-serif';
                const lineHeight = Math.round(fontSize * 1.25);
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = (t.opacity ?? 1) * (anim ? anim.alpha : 1);
                ctx.fillStyle = t.color ?? '#000';
                ctx.textBaseline = 'top';
                ctx.font = `${fontSize}px ${fontFamily}`;
                const lines = String(t.text ?? '').split('\n');
                for (let i = 0; i < lines.length; i++) {
                    ctx.fillText(lines[i], t.x ?? 0, (t.y ?? 0) + i * lineHeight);
                }
                ctx.globalAlpha = 1.0;
            }
            ctx.restore();
        });

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
    }, [cuts, currentCutId, isPlaying, currentTime, onionPrev, onionNext, lassoPoints, selection, selectedText, layerCanvasCache, animLayer]);

    const seekToClientX = (clientX) => {
        const el = timelineRef.current; if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left + el.scrollLeft - 60;
        const t = Math.min(maxTime, Math.max(0, x / pps));
        setCurrentTime(t);
        const active = cuts.filter(c => t >= c.startTime && t < c.endTime);
        if (active.length) setCurrentCutId(active.reduce((p, c) => p.track > c.track ? p : c).id);
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
    const onTimelinePointerDown = (e) => {
        if (e.pointerType !== 'touch') { startTimelineScrub(e); return; }
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
    const handleAudioUpload = (e) => {
        const file = e.target.files[0]; if (!file) return;
        setAudioFile(file); const url = URL.createObjectURL(file); setAudioUrl(url);
        const audio = new Audio(url);
        audio.onloadedmetadata = () => { setAudioDuration(audio.duration); setAudioData({ startTime: 0, endTime: audio.duration, offset: 0 }); if (audioRef.current) audioRef.current.src = url; };
    };
    const handleExport = () => {
        if (!canvasRef.current) return;
        const ctMax = Math.max(...cuts.map(c => c.endTime), audioData?.endTime ?? 0);
        if (ctMax <= 0) { alert('내보낼 콘텐츠가 없습니다.'); return; }
        alert('녹화가 시작됩니다.'); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0;
        const stream = canvasRef.current.captureStream(30), tracks = [...stream.getVideoTracks()];
        if (audioRef.current && audioUrl && !audioSourceRef.current) { try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)(); audioDestRef.current = audioCtxRef.current.createMediaStreamDestination(); audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current); audioSourceRef.current.connect(audioDestRef.current); audioSourceRef.current.connect(audioCtxRef.current.destination); } catch (e) { } }
        if (audioDestRef.current) tracks.push(...audioDestRef.current.stream.getAudioTracks());
        let mr; try { mr = new MediaRecorder(new MediaStream(tracks), { mimeType: 'video/webm' }); } catch (e) { mr = new MediaRecorder(new MediaStream(tracks)); }
        const chunks = [];
        mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        mr.onstop = () => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), download: 'mv_export.webm', style: 'display:none' }); document.body.appendChild(a); a.click(); document.body.removeChild(a); alert('완료!'); isExporting.current = false; };
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

    return (
        <div className="app-container">
            <audio ref={audioRef} style={{ display: 'none' }} />

            {serverProjects !== null && (
                <div onClick={() => setServerProjects(null)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()}
                        style={{ width: 420, maxHeight: '70vh', overflow: 'auto', background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span className="panel-title">서버에서 열기</span>
                            <button className="icon-btn" onClick={() => setServerProjects(null)}>✕</button>
                        </div>
                        {serverProjects.length === 0 && <div style={{ fontSize: 12, color: '#888', padding: '12px 2px' }}>저장된 프로젝트가 없습니다.</div>}
                        {serverProjects.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid #2a2a3a' }}>
                                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => doServerOpen(p.id, p.name)}>
                                    <div style={{ fontSize: 13, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                    <div style={{ fontSize: 10, color: '#777' }}>{p.savedAt ? new Date(p.savedAt).toLocaleString() : ''}</div>
                                </div>
                                <button className="button" style={{ height: 28, padding: '0 10px' }} onClick={() => doServerOpen(p.id, p.name)}>열기</button>
                                <button className="icon-btn del-btn" onClick={() => doServerDelete(p.id)}><Trash2 size={13} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="top-bar">
                <h1 className="title">Easy MV Maker</h1>
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
                                <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>서버 (DB)</div>
                                <button className="file-menu-item" onClick={() => { doServerSave(false); setShowFileMenu(false); }}>서버에 저장</button>
                                <button className="file-menu-item" onClick={() => { doServerSave(true); setShowFileMenu(false); }}>서버에 새 이름으로 저장...</button>
                                <button className="file-menu-item" onClick={() => { openServerList(); setShowFileMenu(false); }}>서버에서 열기...</button>
                            </div>
                        )}
                    </div>
                    <div style={{ width: 1, height: 24, background: '#444' }} />
                    <button className="button button-primary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 34 }}><Download size={15} /> Export</button>
                    <label className="audio-input-label">
                        <Upload size={14} />{audioFile ? audioFile.name : 'Load Audio...'}
                        <input type="file" accept="audio/*" onChange={handleAudioUpload} style={{ display: 'none' }} />
                    </label>
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
                            <span className="slider-label">{tool === 'eraser' ? '지우개' : 'Size'} <b>{tool === 'eraser' ? eraserSize : brushSize}</b></span>
                            <input type="range" min="1" max="80" value={tool === 'eraser' ? eraserSize : brushSize} onChange={e => tool === 'eraser' ? setEraserSize(+e.target.value) : setBrushSize(+e.target.value)} className="v-slider" disabled={isSelectionTool} />
                        </div>
                        <div className="slider-wrap">
                            <span className="slider-label">Opacity <b>{Math.round(opacity * 100)}%</b></span>
                            <input type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={e => setOpacity(+e.target.value / 100)} className="v-slider" disabled={isSelectionTool} />
                        </div>
                    </div>
                )}
                {!showLeft && <button onClick={() => setShowLeft(true)} className="icon-btn" style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: '#1e1e2e', border: 'none', borderRight: '1px solid #333' }}><ChevronRight size={14} /></button>}

                <div className="canvas-area" style={{ touchAction: 'none', position: 'relative' }}
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
                    <div className="canvas-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
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
                                        max="220"
                                        value={textEdit.fontSize}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, fontSize: Math.max(6, Math.min(220, +e.target.value || 6)) }) : te)}
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
                                    <div style={{ flex: 1 }} />
                                    <button className="button button-primary" onClick={commitText} style={{ height: 28, padding: '0 10px' }}>완료</button>
                                    <button className="button" onClick={cancelText} style={{ height: 28, padding: '0 10px' }}>취소</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {showRight && <div className="splitter-v" style={{ touchAction: 'none' }} onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); setSplitter('right'); }} />}

                {showRight && (
                    <div className="right-panel" style={{ width: rightW, flexShrink: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span className="panel-title">CUT / LAYER</span>
                            <button className="icon-btn" onClick={() => setShowRight(false)}><ChevronRight size={14} /></button>
                        </div>
                        <div className="cut-list">
                            {[...cuts].sort((a, b) => (a.track || 0) - (b.track || 0) || a.startTime - b.startTime).map((cut, _i, _arr) => { const collapsed = collapsedCutIds.has(cut.id); const showTrackHeader = _i === 0 || (_arr[_i - 1].track || 0) !== (cut.track || 0); return (
                                <React.Fragment key={cut.id}>
                                {showTrackHeader && <div className="track-group-header">Track {cut.track || 0}</div>}
                                <div className={`cut-item${currentCutId === cut.id ? ' cut-active' : ''}${selectedCutIds.has(cut.id) && selectedCutIds.size > 1 ? ' cut-multi' : ''}`} onClick={e => handleCutClick(e, cut.id)}>
                                    <div className="cut-header">
                                        <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleCutCollapse(cut.id); }} title={collapsed ? '펼치기' : '접기'}>{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>
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
                                    {!collapsed && (<>
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
                    </div>
                )}
                {!showRight && <button onClick={() => setShowRight(true)} className="icon-btn" style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: '#1e1e2e', border: 'none', borderLeft: '1px solid #333' }}><ChevronRight size={14} /></button>}
            </div>

            {showBottom && <div className="splitter-h" style={{ touchAction: 'none' }} onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); setSplitter('bottom'); }} />}

            <div className="timeline" style={{ height: showBottom ? timelineH : 44, flexShrink: 0 }}>
                <div className="tl-controls">
                    <button className="icon-btn" onClick={() => setShowBottom(v => !v)}>{showBottom ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
                    {showBottom && <>
                        <div className="time-display">{fmt(currentTime)}</div>
                        <button className="button button-primary" onClick={handlePlayPause}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
                        <button className="button" onClick={handleStop}><Square size={16} /></button>
                        <button className={`button${loopPlay ? ' button-primary' : ''}`} onClick={() => setLoopPlay(v => !v)} title="반복 재생"><Repeat size={16} /></button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 12 }} title="타임라인 확대/축소">
                            <button className="icon-btn" onClick={() => setPps(p => Math.max(10, p / 1.25))}>−</button>
                            <span style={{ fontSize: 11, color: '#888', minWidth: 30, textAlign: 'center' }}>{Math.round(pps)}</span>
                            <button className="icon-btn" onClick={() => setPps(p => Math.min(300, p * 1.25))}>＋</button>
                        </div>
                        <span style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>Max: {fmt(maxTime)}</span>
                    </>}
                </div>
                {showBottom && (
                    <div className="tl-tracks" ref={timelineRef} onPointerDown={onTimelinePointerDown} onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp} onPointerCancel={onTimelinePointerUp} style={{ position: 'relative', touchAction: 'none' }}>
                        <div style={{ minWidth: '100%', width: `${Math.max(100, maxTime * pps + 150)}px`, position: 'relative' }}>
                            <div className="ruler" style={{ position: 'sticky', top: 0, left: 0, right: 0, height: 20, background: '#1a1a2e', borderBottom: '1px solid #2e2e4a', zIndex: 20 }}>
                                <div style={{ position: 'sticky', left: 0, width: 60, height: '100%', background: '#1a1a2e', zIndex: 21, float: 'left' }} />
                                {Array.from({ length: Math.ceil(maxTime) + 1 }).map((_, i) => (
                                    <div key={i} style={{ position: 'absolute', left: `${i * pps + 60}px`, borderLeft: '1px solid #333', height: i % 5 === 0 ? 20 : 10, fontSize: 10, paddingLeft: 2, top: 0, color: '#555' }}>{i % 5 === 0 ? i : ''}</div>
                                ))}
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
                                        {cuts.filter(c => (c.track || 0) === ti).map(cut => (
                                            <div key={cut.id}
                                                className={`cut-block${currentCutId === cut.id ? ' cut-block-active' : ''}`}
                                                style={{ left: `${cut.startTime * pps + 60}px`, width: `${(cut.endTime - cut.startTime) * pps}px`, cursor: draggingCutData?.cutId === cut.id ? 'grabbing' : 'grab', touchAction: 'none' }}
                                                onClick={e => { e.stopPropagation(); setCurrentCutId(cut.id); setSelectedCutIds(new Set([cut.id])); }}
                                                onPointerDown={e => { e.stopPropagation(); setCurrentCutId(cut.id); setSelectedCutIds(new Set([cut.id])); cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350); e.currentTarget.setPointerCapture(e.pointerId); setDraggingCutData({ cutId: cut.id, startX: e.clientX, startY: e.clientY, initialStart: cut.startTime, initialTrack: cut.track }); }}>
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
                                    <div className="tl-track-label" style={{ background: '#161628' }}><span>Audio</span></div>
                                    <div className="cut-block" style={{ left: `${audioData.startTime * pps + 60}px`, width: `${(audioData.endTime - audioData.startTime) * pps}px`, background: '#374151', borderColor: '#4b5563', cursor: draggingCutData?.cutId === 'audio' ? 'grabbing' : 'grab', touchAction: 'none' }}
                                        onPointerDown={e => { e.stopPropagation(); cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350); e.currentTarget.setPointerCapture(e.pointerId); setDraggingCutData({ cutId: 'audio', startX: e.clientX, startY: e.clientY, initialStart: audioData.startTime, initialTrack: 0 }); }}>
                                        <div className="rh rh-left" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setResizingData({ cutId: 'audio', edge: 'left', startX: e.clientX, initialStart: audioData.startTime, initialEnd: audioData.endTime, initialOffset: audioData.offset }); }} />
                                        🎵 Audio
                                        <div className="rh rh-right" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setResizingData({ cutId: 'audio', edge: 'right', startX: e.clientX, initialStart: audioData.startTime, initialEnd: audioData.endTime, initialOffset: audioData.offset }); }} />
                                    </div>
                                </div>
                            )}
                            <div style={{ marginTop: 8, paddingLeft: 60 }}>
                                <button className="small-btn" onClick={handleAddTrack}><Plus size={11} /> Add Track</button>
                            </div>
                            <div className="playhead" style={{ left: `${currentTime * pps + 60}px` }}><div className="playhead-dot" /></div>
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
