import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Repeat, Plus, Trash2, Download, Upload, PenLine, Pen, Feather, Eraser, Droplets, Undo, Redo, Layers, Trash, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FolderPlus, Folder, FolderOpen, Settings, Eye, EyeOff, Copy, ClipboardPaste, GitBranch, Move, Type, Map as MapIcon, RefreshCw, CircleDot, ToggleLeft, ToggleRight, GripVertical } from 'lucide-react';
import './App.css';

const DEFAULT_CUT_DURATION = 1;
const CANVAS_W = 854, CANVAS_H = 480;
const DEFAULT_CUT_ANIM_DUR = 0.25;
const CUT_ANIM_IN_TYPES = [
    { value: 'none', label: 'None' },
    { value: 'slideFromRight', label: 'Slide In (Right)' },
    { value: 'slideFromLeft', label: 'Slide In (Left)' },
    { value: 'fade', label: 'Fade In' },
];
const CUT_ANIM_OUT_TYPES = [
    { value: 'none', label: 'None' },
    { value: 'slideToRight', label: 'Slide Out (Right)' },
    { value: 'slideToLeft', label: 'Slide Out (Left)' },
    { value: 'fade', label: 'Fade Out' },
];
const FONT_PRESETS = [
    { value: 'sans-serif', label: 'Sans' },
    { value: 'serif', label: 'Serif' },
    { value: 'monospace', label: 'Mono' },
    { value: '"Pretendard", sans-serif', label: 'Pretendard' },
    { value: '"Noto Sans KR", sans-serif', label: 'Noto Sans KR' },
    { value: '"Nanum Gothic", sans-serif', label: 'Nanum Gothic' },
    { value: '"Gowun Dodum", sans-serif', label: 'Gowun Dodum' },
    { value: '"Noto Serif KR", serif', label: 'Noto Serif KR' },
    { value: '"Malgun Gothic", sans-serif', label: 'Malgun Gothic' },
    { value: '"Apple SD Gothic Neo", sans-serif', label: 'Apple SD Gothic Neo' },
];
const PEN_TYPES = [
    { id: 'pen', label: 'Pen', Icon: PenLine },
    { id: 'dot', label: 'Dot', Icon: CircleDot },
    { id: 'marker', label: 'Marker', Icon: Pen },
    { id: 'calligraphy', label: 'Calli', Icon: Feather },
    { id: 'eraser', label: 'Eraser', Icon: Eraser },
    { id: 'fill', label: 'Fill', Icon: Droplets },
];
const TOOL_TYPES = [
    { id: 'lasso', label: 'Lasso', Icon: GitBranch },
    { id: 'move', label: 'Move', Icon: Move },
    { id: 'text', label: 'Text', Icon: Type },
    ...PEN_TYPES,
];

function pointInPolygon(point, vs) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const [xi, yi] = vs[i];
        const [xj, yj] = vs[j];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function easeOutCubic(t) {
    const x = clamp(t, 0, 1);
    return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(t) {
    const x = clamp(t, 0, 1);
    return x * x * x;
}

function safeArray(v) {
    return Array.isArray(v) ? v : [];
}

function layerCacheKey(cutId, layerId) {
    return `${cutId}:${layerId}`;
}

function hexToRgb(hex) {
    const h = String(hex || '').trim();
    if (!h.startsWith('#')) return { r: 0, g: 0, b: 0 };
    const s = h.slice(1);
    if (s.length === 3) {
        const r = parseInt(s[0] + s[0], 16);
        const g = parseInt(s[1] + s[1], 16);
        const b = parseInt(s[2] + s[2], 16);
        return { r: r | 0, g: g | 0, b: b | 0 };
    }
    if (s.length === 6) {
        const r = parseInt(s.slice(0, 2), 16);
        const g = parseInt(s.slice(2, 4), 16);
        const b = parseInt(s.slice(4, 6), 16);
        return { r: r | 0, g: g | 0, b: b | 0 };
    }
    return { r: 0, g: 0, b: 0 };
}

function rgbToHex({ r, g, b }) {
    const to2 = (n) => n.toString(16).padStart(2, '0');
    return `#${to2(clamp(r | 0, 0, 255))}${to2(clamp(g | 0, 0, 255))}${to2(clamp(b | 0, 0, 255))}`;
}

function rgbToHsv({ r, g, b }) {
    const rr = (r / 255), gg = (g / 255), bb = (b / 255);
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === rr) h = ((gg - bb) / d) % 6;
        else if (max === gg) h = (bb - rr) / d + 2;
        else h = (rr - gg) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
}

function hsvToRgb(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = v - c;
    let rr = 0, gg = 0, bb = 0;
    if (hh < 60) { rr = c; gg = x; bb = 0; }
    else if (hh < 120) { rr = x; gg = c; bb = 0; }
    else if (hh < 180) { rr = 0; gg = c; bb = x; }
    else if (hh < 240) { rr = 0; gg = x; bb = c; }
    else if (hh < 300) { rr = x; gg = 0; bb = c; }
    else { rr = c; gg = 0; bb = x; }
    return { r: Math.round((rr + m) * 255), g: Math.round((gg + m) * 255), b: Math.round((bb + m) * 255) };
}

function bucketFillTransparentRegion(baseImageData, startX, startY, fillRgb, fillAlpha) {
    const w = baseImageData.width;
    const h = baseImageData.height;
    const data = baseImageData.data;
    const sx = startX | 0;
    const sy = startY | 0;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

    const alphaThreshold = 8;
    const startOff = (sy * w + sx) * 4;
    const startA = data[startOff + 3];
    // Clicking on an existing stroke/boundary: do nothing (standard paint-bucket feel).
    if (startA >= alphaThreshold) return null;

    const mask = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    let qh = 0;
    let qt = 0;
    q[qt++] = sy * w + sx;

    let minX = w, minY = h, maxX = -1, maxY = -1;
    while (qh < qt) {
        const idx = q[qh++];
        if (mask[idx]) continue;
        mask[idx] = 1;
        const x = idx % w;
        const y = (idx / w) | 0;
        const off = idx * 4;
        if (data[off + 3] >= alphaThreshold) continue;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;

        if (x > 0) q[qt++] = idx - 1;
        if (x + 1 < w) q[qt++] = idx + 1;
        if (y > 0) q[qt++] = idx - w;
        if (y + 1 < h) q[qt++] = idx + w;
    }

    if (maxX < minX || maxY < minY) return null;

    const cw = (maxX - minX + 1) | 0;
    const ch = (maxY - minY + 1) | 0;
    const out = new ImageData(cw, ch);
    const outData = out.data;
    const { r, g, b } = fillRgb;
    const a = Math.max(0, Math.min(255, fillAlpha | 0));

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = y * w + x;
            const off = idx * 4;
            if (data[off + 3] >= alphaThreshold) continue;
            if (!mask[idx]) continue;
            const ox = x - minX;
            const oy = y - minY;
            const o = (oy * cw + ox) * 4;
            outData[o] = r;
            outData[o + 1] = g;
            outData[o + 2] = b;
            outData[o + 3] = a;
        }
    }

    return { imageData: out, x: minX, y: minY };
}

function drawStrokesOnCtx(ctx, strokes, clear = true, bitmapStore = null) {
    if (clear) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    strokes.forEach(s => {
        if (s.tool === 'text') {
            const fontSize = Math.max(6, Math.min(220, s.fontSize ?? 32));
            const fontFamily = s.fontFamily ?? 'sans-serif';
            const lineHeight = Math.round(fontSize * 1.25);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = s.opacity ?? 1;
            ctx.fillStyle = s.color ?? '#000';
            ctx.textBaseline = 'top';
            ctx.font = `${fontSize}px ${fontFamily}`;
            const lines = String(s.text ?? '').split('\n');
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], s.x ?? 0, (s.y ?? 0) + i * lineHeight);
            }
            ctx.globalAlpha = 1.0;
            return;
        }
        if (s.tool === 'eraseBitmap') {
            const entry = bitmapStore?.get(s.bitmapId);
            const bmp = entry?.imageBitmap;
            const img = entry?.imageData;
            const legacyImg = s.imageData;
            if (!bmp && !img && !legacyImg) return;

            ctx.globalCompositeOperation = 'destination-out';
            ctx.globalAlpha = 1.0;
            if (bmp) {
                ctx.drawImage(bmp, s.x, s.y);
            } else if (img || legacyImg) {
                const src = img || legacyImg;
                const tmp = document.createElement('canvas');
                tmp.width = src.width;
                tmp.height = src.height;
                const tctx = tmp.getContext('2d');
                tctx.putImageData(src, 0, 0);
                ctx.drawImage(tmp, s.x, s.y);
            }
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1.0;
            return;
        }
        if (s.tool === 'paste') {
            const entry = bitmapStore?.get(s.bitmapId);
            const bmp = entry?.imageBitmap;
            const img = entry?.imageData;
            if (bmp) {
                if (typeof s.w === 'number' && typeof s.h === 'number') ctx.drawImage(bmp, s.x, s.y, s.w, s.h);
                else ctx.drawImage(bmp, s.x, s.y);
            } else if (img) {
                if (typeof s.w === 'number' && typeof s.h === 'number' && (s.w !== img.width || s.h !== img.height)) {
                    const tmp = document.createElement('canvas');
                    tmp.width = img.width;
                    tmp.height = img.height;
                    const tctx = tmp.getContext('2d');
                    tctx.putImageData(img, 0, 0);
                    ctx.drawImage(tmp, s.x, s.y, s.w, s.h);
                } else {
                    ctx.putImageData(img, s.x, s.y);
                }
            }
            else if (s.imageData) ctx.putImageData(s.imageData, s.x, s.y);
            return;
        }
        if (s.tool === 'fill') {
            ctx.fillStyle = s.color; ctx.globalAlpha = s.opacity ?? 1;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.globalAlpha = 1.0; return;
        }
        if (s.tool === 'dot' || s.tool === 'dotEraser') {
            if (!s.points?.length) return;
            const isErase = s.tool === 'dotEraser';
            const baseColor = s.color;
            const baseOpacity = s.opacity ?? 1;
            const hasPressure = s.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);

            // Draw opaque stamps then apply opacity once to avoid dark "blotches" from alpha accumulation.
            const dst = ctx;
            const needsUniformAlpha = !isErase && baseOpacity < 0.999;
            const tctx = needsUniformAlpha ? (() => {
                const tmp = document.createElement('canvas');
                tmp.width = ctx.canvas.width;
                tmp.height = ctx.canvas.height;
                return tmp.getContext('2d');
            })() : dst;

            tctx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
            tctx.globalAlpha = 1.0;
            tctx.fillStyle = isErase ? 'rgba(0,0,0,1)' : baseColor;
            tctx.imageSmoothingEnabled = false;

            const stamp = (x, y, pr) => {
                const factor = hasPressure ? (pr * 2) : 1;
                const sz = Math.max(1, Math.round(s.size * factor));
                const hx = (sz / 2);
                tctx.fillRect(Math.round(x - hx), Math.round(y - hx), sz, sz);
            };

            // Stamp along the polyline with interpolation so fast moves still draw continuous dots.
            const pts = s.points;
            stamp(pts[0].x, pts[0].y, pts[0].pressure ?? 0.5);
            for (let i = 1; i < pts.length; i++) {
                const p1 = pts[i - 1], p2 = pts[i];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const d = Math.hypot(dx, dy);
                const pr = ((p1.pressure ?? 0.5) + (p2.pressure ?? 0.5)) / 2;
                const factor = hasPressure ? (pr * 2) : 1;
                const sz = Math.max(1, Math.round(s.size * factor));
                const step = Math.max(1, sz * 0.45);
                const n = Math.max(1, Math.floor(d / step));
                for (let j = 1; j <= n; j++) {
                    const t = j / n;
                    stamp(p1.x + dx * t, p1.y + dy * t, pr);
                }
            }
            tctx.imageSmoothingEnabled = true;

            if (needsUniformAlpha) {
                dst.save();
                dst.globalCompositeOperation = 'source-over';
                dst.globalAlpha = baseOpacity;
                dst.drawImage(tctx.canvas, 0, 0);
                dst.restore();
            }
            return;
        }
        if (!s.points?.length) return;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const tool = s.tool;
        const hasPressure = s.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);
        const baseColor = s.color;
        const baseOpacity = s.opacity ?? 1;

        const setStyleOn = (dc, width, { alpha = baseOpacity, markerMultiply = true } = {}) => {
            if (tool === 'eraser') {
                dc.globalCompositeOperation = 'destination-out';
                dc.strokeStyle = 'rgba(0,0,0,1)';
                dc.globalAlpha = 1.0;
            } else if (tool === 'marker') {
                dc.globalCompositeOperation = markerMultiply ? 'multiply' : 'source-over';
                dc.strokeStyle = baseColor;
                dc.globalAlpha = markerMultiply ? (alpha * 0.6) : 1.0;
            } else if (tool === 'calligraphy') {
                dc.globalCompositeOperation = 'source-over';
                dc.strokeStyle = baseColor;
                dc.globalAlpha = alpha;
                width *= 3;
            } else {
                dc.globalCompositeOperation = 'source-over';
                dc.strokeStyle = baseColor;
                dc.globalAlpha = alpha;
            }
            dc.lineWidth = Math.max(0.3, width);
        };

        const drawStrokeShape = (dc, { alpha = baseOpacity, markerMultiply = true } = {}) => {
            dc.lineCap = 'round';
            dc.lineJoin = 'round';
            if (hasPressure && s.points.length > 1) {
                for (let i = 1; i < s.points.length; i++) {
                    const p1 = s.points[i - 1], p2 = s.points[i];
                    const pr = ((p1.pressure ?? 0.5) + (p2.pressure ?? 0.5)) / 2;
                    dc.beginPath();
                    dc.moveTo(p1.x, p1.y);
                    dc.lineTo(p2.x, p2.y);
                    setStyleOn(dc, s.size * pr * 2, { alpha, markerMultiply });
                    dc.stroke();
                }
            } else {
                dc.beginPath();
                s.points.forEach((p, i) => i === 0 ? dc.moveTo(p.x, p.y) : dc.lineTo(p.x, p.y));
                const avgPressure = s.points.reduce((sum, p) => sum + (p.pressure ?? 0.5), 0) / s.points.length;
                setStyleOn(dc, s.size * (hasPressure ? avgPressure * 2 : 1), { alpha, markerMultiply });
                dc.stroke();
            }
        };

        // When drawing per-segment with low opacity, alpha can accumulate at joints and produce blotches.
        // Fix: render an opaque stroke shape, then apply opacity once during compositing.
        const needsUniformAlpha = tool !== 'eraser' && hasPressure && s.points.length > 1 && baseOpacity < 0.999;
        if (needsUniformAlpha) {
            const tmp = document.createElement('canvas');
            tmp.width = ctx.canvas.width;
            tmp.height = ctx.canvas.height;
            const tctx = tmp.getContext('2d');

            // For marker, render the shape with source-over, then multiply onto destination.
            drawStrokeShape(tctx, { alpha: 1.0, markerMultiply: false });

            ctx.save();
            if (tool === 'marker') ctx.globalCompositeOperation = 'multiply';
            else ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = (tool === 'marker') ? (baseOpacity * 0.6) : baseOpacity;
            ctx.drawImage(tmp, 0, 0);
            ctx.restore();
        } else {
            drawStrokeShape(ctx, { alpha: baseOpacity, markerMultiply: true });
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1.0;
        }
    });
}

function flattenForCanvas(layers) {
    return layers.filter(l => l.type !== 'folder' && l.visible !== false);
}

function flattenLayersInUiOrder(layers, parentId = null, out = []) {
    const pid = parentId ?? null;
    const list = layers.filter(l => (l.parentId ?? null) === pid);
    for (const layer of list) {
        if (layer.type === 'folder') {
            flattenLayersInUiOrder(layers, layer.id, out);
        } else {
            out.push(layer);
        }
    }
    return out;
}

function LayerThumbnail({ cutId, layer, layerCanvasCache }) {
    const ref = useRef(null);
    useEffect(() => {
        const c = ref.current; if (!c) return;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 56, 31);
        const layerCanvas = layerCanvasCache[layerCacheKey(cutId, layer.id)];
        if (layerCanvas) {
            ctx.drawImage(layerCanvas, 0, 0, 56, 31);
        }
    }, [cutId, layer, layerCanvasCache]);
    return <canvas ref={ref} width={56} height={31} style={{ width: 42, height: 23, borderRadius: 3, background: '#fff', flexShrink: 0, border: '1px solid #2e2e40' }} />;
}

export default function App() {
    const mkLayer = (id) => ({ id, name: `L${id}`, type: 'layer', strokes: [], redoStrokes: [], visible: true, parentId: null });
    const [cuts, setCuts] = useState([{
        id: 1,
        name: 'Cut 1',
        startTime: 0,
        endTime: 1,
        track: 0,
        layers: [mkLayer(1)],
        activeLayerId: 1,
        texts: [],
        animIn: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
        animOut: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
        textCollapsed: true,
    }]);
    const [numTracks, setNumTracks] = useState(2);
    const [onionPrev, setOnionPrev] = useState(false);
    const [onionNext, setOnionNext] = useState(false);
    const [resizingData, setResizingData] = useState(null);
    const [draggingCutData, setDraggingCutData] = useState(null);
    const [pendingTimelineOp, setPendingTimelineOp] = useState(null);
    const [currentCutId, setCurrentCutId] = useState(1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [loopPlayback, setLoopPlayback] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [leftW, setLeftW] = useState(96);
    const [rightW, setRightW] = useState(270);
    const [timelineH, setTimelineH] = useState(240);
    const [showLeft, setShowLeft] = useState(true);
    const [showRight, setShowRight] = useState(true);
    const [showBottom, setShowBottom] = useState(true);
    const [defaultCutDuration, setDefaultCutDuration] = useState(DEFAULT_CUT_DURATION);
    // Splitter drag should be delta-based (not absolute screen position) to avoid jumpiness on touch devices.
    const [splitter, setSplitter] = useState(null); // { kind:'left'|'right'|'bottom', pointerId, startX, startY, startLeftW, startRightW, startTimelineH }

    // Canvas pinch zoom (touch only): scale the canvas via CSS transform, keeping drawing coordinates stable.
    const [canvasScale, setCanvasScale] = useState(1);
    const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
    const canvasScaleRef = useRef(1);
    const canvasOffsetRef = useRef({ x: 0, y: 0 });
    const canvasTouchPointsRef = useRef(new Map()); // pointerId -> { x, y }
    const canvasPinchRef = useRef(null); // { lastDist }
    const isCanvasPinchingRef = useRef(false);
    const canvasPanRef = useRef(null); // { pointerId, startX, startY, startOffset }
    const isCanvasPanningRef = useRef(false);

    // Timeline pinch zoom (touch only): adjust pps.
    const timelineTouchPointsRef = useRef(new Map()); // pointerId -> { x, y }
    const timelinePinchRef = useRef(null); // { startDist, startPps }
    const isTimelinePinchingRef = useRef(false);
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
    const lastInkToolRef = useRef('pen'); // pen|dot|marker|calligraphy (used for contextual behaviors like dot-eraser)
    const [palette, setPalette] = useState([null, null, null]);
    const [activePaletteIndex, setActivePaletteIndex] = useState(0);
    const [color, setColor] = useState('#111111');
    const BRUSH_SLIDER_MAX = 20;
    const BRUSH_NUM_MAX = 200;
    const [brushSize, setBrushSize] = useState(3);
    const [opacity, setOpacity] = useState(1.0);
    const [pressureEnabled, setPressureEnabled] = useState(true);

    const [colorPicker, setColorPicker] = useState(null); // { slotIndex, hex, h, s, v }
    const svCanvasRef = useRef(null);
    const svDragPointerIdRef = useRef(null);
    const [expandedCuts, setExpandedCuts] = useState(new Set());
    const [cutListGroupByTrack, setCutListGroupByTrack] = useState(true);
    const [collapsedTrackIds, setCollapsedTrackIds] = useState(new Set());
    const [collapsedCutIds, setCollapsedCutIds] = useState(new Set());
    const [showFileMenu, setShowFileMenu] = useState(false);
    const fileHandleRef = useRef(null);
    const [dragLayerInfo, setDragLayerInfo] = useState(null);
    const [dropInfo, setDropInfo] = useState(null);
    const [pendingLayerOp, setPendingLayerOp] = useState(null); // { cutId, layerId, pointerId, startX, startY, pointerType, t0 }
    const layerDragMovedRef = useRef(false);
    const suppressNextLayerClickRef = useRef(false);
    const layerHoldTimerRef = useRef(null);
    const suppressGlobalClickRef = useRef(false);
    const ignoreTimelineUntilRef = useRef(0);
    const [selectedLayerRow, setSelectedLayerRow] = useState(null); // { cutId, layerId }
    const canvasRef = useRef(null);
    const isDrawing = useRef(false);
    const reqRef = useRef(null);
    const fileMenuRef = useRef(null);
    const timelineRef = useRef(null);
    const [pps, setPps] = useState(50);
    const [copiedCuts, setCopiedCuts] = useState(null); // { cuts: Cut[], minStart: number }
    const [selectedCutIds, setSelectedCutIds] = useState(new Set([1]));
    const selectedCutIdsRef = useRef(new Set([1]));
    const [lassoPoints, setLassoPoints] = useState([]);
    const [selection, setSelection] = useState(null);
    const [selectionClipboard, setSelectionClipboard] = useState(null); // { bitmapId, w, h }
    const selectionPasteNudgeRef = useRef(0);
    const [textEdit, setTextEdit] = useState(null);
    const [selectedText, setSelectedText] = useState(null);
    const [layerCanvasCache, setLayerCanvasCache] = useState({});
    const bitmapStoreRef = useRef(new Map());
    const selectionDragRef = useRef(null);
    const activePointerIdRef = useRef(null);
    const textAreaRef = useRef(null);
    const textDragRef = useRef(null);
    const textMeasureCtxRef = useRef(null);
    const canvasStageRef = useRef(null);
    const canvasAreaRef = useRef(null);
    const navCanvasRef = useRef(null);
    const [navEnabled, setNavEnabled] = useState(true);

    useEffect(() => { selectedCutIdsRef.current = selectedCutIds; }, [selectedCutIds]);

    useEffect(() => {
        // Keep multi-selection valid as cuts are added/removed.
        const existing = new Set(cuts.map(c => c.id));
        const next = new Set(Array.from(selectedCutIdsRef.current).filter(id => existing.has(id)));
        let nextCurrent = currentCutId;
        if (!existing.has(nextCurrent)) nextCurrent = null;
        if (next.size === 0) {
            const first = cuts[0]?.id ?? null;
            if (first != null) next.add(first);
            nextCurrent = first;
        }
        // Only set state when changes are needed (avoid loops).
        const sameSel = next.size === selectedCutIdsRef.current.size && Array.from(next).every(id => selectedCutIdsRef.current.has(id));
        if (!sameSel) setSelectedCutIds(next);
        if (nextCurrent != null && nextCurrent !== currentCutId) setCurrentCutId(nextCurrent);
        if (cuts.length === 0) setCopiedCuts(null);
        setCollapsedCutIds(prev => {
            const kept = new Set(Array.from(prev).filter(id => existing.has(id)));
            return kept.size === prev.size ? prev : kept;
        });
    }, [cuts, currentCutId]);

    useEffect(() => { canvasScaleRef.current = canvasScale; }, [canvasScale]);
    useEffect(() => { canvasOffsetRef.current = canvasOffset; }, [canvasOffset]);

    const resetCanvasView = () => {
        setCanvasScale(1);
        setCanvasOffset({ x: 0, y: 0 });
        isCanvasPinchingRef.current = false;
        isCanvasPanningRef.current = false;
        canvasPinchRef.current = null;
        canvasPanRef.current = null;
        canvasTouchPointsRef.current.clear();
    };

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

    const historyRef = useRef([]);
    const historyIndexRef = useRef(-1);
    const isUndoRedoRef = useRef(false);
    const isDraggingOrResizingRef = useRef(false);

    useEffect(() => {
        // Keep current color in sync with the selected palette slot.
        const c = palette?.[activePaletteIndex];
        if (typeof c === 'string' && c && c !== color) setColor(c);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePaletteIndex]);

    const openCustomColorPicker = (slotIndex) => {
        const base = palette?.[slotIndex] || color || '#000000';
        const rgb = hexToRgb(base);
        const hsv = rgbToHsv(rgb);
        setColorPicker({ slotIndex, hex: rgbToHex(rgb), h: hsv.h, s: hsv.s, v: hsv.v });
    };

    const commitCustomColorPicker = () => {
        if (!colorPicker) return;
        const { slotIndex, hex } = colorPicker;
        const v = String(hex || '').trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
        setPalette(p => p.map((cc, idx) => idx === slotIndex ? v : cc));
        setActivePaletteIndex(slotIndex);
        setColor(v);
        setColorPicker(null);
    };

    const cancelCustomColorPicker = () => setColorPicker(null);

    const setColorPickerFromHsv = (next) => {
        setColorPicker(cp => {
            if (!cp) return cp;
            const h = clamp(next.h ?? cp.h, 0, 360);
            const s = clamp(next.s ?? cp.s, 0, 1);
            const vv = clamp(next.v ?? cp.v, 0, 1);
            const rgb = hsvToRgb(h, s, vv);
            return { ...cp, h, s, v: vv, hex: rgbToHex(rgb) };
        });
    };

    const updateSvFromClient = (clientX, clientY) => {
        const c = svCanvasRef.current;
        if (!c) return;
        const r = c.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const x = clamp(clientX - r.left, 0, r.width);
        const y = clamp(clientY - r.top, 0, r.height);
        const s = x / r.width;
        const v = 1 - (y / r.height);
        setColorPickerFromHsv({ s, v });
    };

    useEffect(() => {
        if (!colorPicker) return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelCustomColorPicker();
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                commitCustomColorPicker();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [colorPicker]);

    useEffect(() => {
        if (!colorPicker) return;
        const c = svCanvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        const w = c.width, h = c.height;
        const hueRgb = hsvToRgb(colorPicker.h, 1, 1);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
        ctx.fillRect(0, 0, w, h);

        const g1 = ctx.createLinearGradient(0, 0, w, 0);
        g1.addColorStop(0, 'rgba(255,255,255,1)');
        g1.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, w, h);

        const g2 = ctx.createLinearGradient(0, 0, 0, h);
        g2.addColorStop(0, 'rgba(0,0,0,0)');
        g2.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);

        // Cursor
        const cx = clamp(colorPicker.s, 0, 1) * w;
        const cy = (1 - clamp(colorPicker.v, 0, 1)) * h;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }, [colorPicker?.h, colorPicker?.s, colorPicker?.v]);

    useEffect(() => {
        // Prevent "click-through" to other UI (e.g., selecting a cut block) after a layer drag ends.
        const onClickCapture = (e) => {
            if (!suppressGlobalClickRef.current) return;
            suppressGlobalClickRef.current = false;
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener('click', onClickCapture, true);
        return () => document.removeEventListener('click', onClickCapture, true);
    }, []);

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

    const copySelectionToClipboard = () => {
        const sel = selection;
        if (!sel) return;
        const entry = bitmapStoreRef.current.get(sel.bitmapId);
        const img = entry?.imageData;
        if (!img) return;
        const copied = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
        const id = storeBitmap(copied);
        setSelectionClipboard({ bitmapId: id, w: img.width, h: img.height });
        selectionPasteNudgeRef.current = 0;
    };

    const pasteSelectionFromClipboard = () => {
        if (!selectionClipboard?.bitmapId) return;
        const cc = cuts.find(c => c.id === currentCutId);
        if (!cc) return;
        const paintLayers = safeArray(cc.layers).filter(l => l.type !== 'folder' && l.visible !== false);
        const activeLayerId = paintLayers.some(l => l.id === cc.activeLayerId) ? cc.activeLayerId : (paintLayers[0]?.id ?? 1);

        const w = Math.max(1, selectionClipboard.w | 0);
        const h = Math.max(1, selectionClipboard.h | 0);
        const nudge = (selectionPasteNudgeRef.current++ % 10) * 10;

        // Prefer pasting near the current selection box if it exists; otherwise center-ish with a small nudge.
        const baseX = selection ? Math.round(selection.tx) : Math.round(CANVAS_W / 2 - w / 2);
        const baseY = selection ? Math.round(selection.ty) : Math.round(CANVAS_H / 2 - h / 2);
        const x = clamp(baseX + nudge, -CANVAS_W * 2, CANVAS_W * 3);
        const y = clamp(baseY + nudge, -CANVAS_H * 2, CANVAS_H * 3);

        updLayers(currentCutId, c => ({
            layers: c.layers.map(l => {
                if (l.id !== activeLayerId) return l;
                return {
                    ...l,
                    strokes: [
                        ...l.strokes,
                        { id: Date.now(), tool: 'paste', bitmapId: selectionClipboard.bitmapId, x, y, w, h },
                    ]
                };
            }),
            activeLayerId,
        }));
    };

    const handleSetTool = (newTool) => {
        if (selection) return;
        if (textEdit) return;
        if (newTool === 'pen' || newTool === 'dot' || newTool === 'marker' || newTool === 'calligraphy') {
            lastInkToolRef.current = newTool;
        }
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

    // maxTime is used for timeline layout, while playEndTime is used for playback stop/loop.
    const playEndTime = Math.max(0.05, audioData?.endTime ?? audioDuration, ...cuts.map(c => c.endTime));
    const maxTime = Math.max(60, playEndTime) + 60;

    useEffect(() => {
        const h = (e) => { if (fileMenuRef.current && !fileMenuRef.current.contains(e.target)) setShowFileMenu(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); globalUndo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); globalRedo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                if (selection) { e.preventDefault(); copySelectionToClipboard(); return; }
                const ids = Array.from(selectedCutIdsRef.current);
                if (ids.length) { e.preventDefault(); handleCopyCuts(ids); }
                else if (currentCutId) { e.preventDefault(); handleCopyCut(currentCutId); }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                if (selectionClipboard?.bitmapId) { e.preventDefault(); pasteSelectionFromClipboard(); return; }
                if (copiedCuts?.cuts?.length) { e.preventDefault(); handlePasteCut(); }
            }
            if (e.key === 'Escape') { if (selection) { e.preventDefault(); cancelSelection(); } }
            if (e.key === 'Enter') { if (selection) { e.preventDefault(); commitSelection(); } }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [cuts, currentCutId, copiedCuts, selection, selectionClipboard]);

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
                let next = prev + delta;
                const endT = playEndTime;

                if (!isExporting.current && loopPlayback && endT > 0.05 && next >= endT) {
                    // Wrap time; keep any small overshoot so the loop feels continuous.
                    next = (next - endT);
                    if (next < 0) next = 0;
                    // Force re-sync audio on loop boundary.
                    if (audioRef.current && audioUrl) {
                        try { audioRef.current.currentTime = next; } catch { }
                    }
                }

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
                if (!isExporting.current && !loopPlayback && next >= endT) { setIsPlaying(false); if (audioRef.current) audioRef.current.pause(); return endT; }
                return next;
            });
            reqRef.current = requestAnimationFrame(step);
        };
        reqRef.current = requestAnimationFrame(step);
        return () => cancelAnimationFrame(reqRef.current);
    }, [isPlaying, playEndTime, audioUrl, audioData, loopPlayback]);

    useEffect(() => {
        if (!isPlaying && audioRef.current && audioUrl && Math.abs(audioRef.current.currentTime - currentTime) > 0.1)
            audioRef.current.currentTime = currentTime;
    }, [currentTime, isPlaying, audioUrl]);

    useEffect(() => {
        if (!splitter) return;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const mv = (e) => {
            if (e.pointerId !== splitter.pointerId) return;
            if (splitter.kind === 'left') {
                // Dragging right should increase the left panel width.
                const next = splitter.startLeftW + (e.clientX - splitter.startX);
                setLeftW(clamp(next, 72, 240));
            } else if (splitter.kind === 'right') {
                // Dragging left should increase the right panel width.
                const next = splitter.startRightW + (splitter.startX - e.clientX);
                setRightW(clamp(next, 200, 600));
            } else if (splitter.kind === 'bottom') {
                // Dragging up should increase the timeline height.
                const next = splitter.startTimelineH + (splitter.startY - e.clientY);
                setTimelineH(clamp(next, 100, 600));
            }
        };
        const up = (e) => {
            if (e.pointerId !== splitter.pointerId) return;
            setSplitter(null);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        };
    }, [splitter]);

    useEffect(() => {
        const h = (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setPps(p => Math.max(10, Math.min(300, p * (e.deltaY > 0 ? 0.9 : 1.1)))); } };
        const t = timelineRef.current;
        if (t) t.addEventListener('wheel', h, { passive: false });
        return () => { if (t) t.removeEventListener('wheel', h); };
    }, []);

    useEffect(() => {
        if (!resizingData && !draggingCutData && !pendingTimelineOp) return;
        isDraggingOrResizingRef.current = !!(resizingData || draggingCutData);
        const mv = (e) => {
            if (pendingTimelineOp && !resizingData && !draggingCutData) {
                const dx0 = e.clientX - pendingTimelineOp.startX;
                const dy0 = e.clientY - pendingTimelineOp.startY;
                const elapsed = performance.now() - (pendingTimelineOp.t0 ?? performance.now());
                const pointerType = pendingTimelineOp.pointerType ?? 'mouse';
                const holdMs = pointerType === 'touch' ? 180 : 0;
                const threshold = pointerType === 'touch' ? 14 : pointerType === 'pen' ? 6 : 3;
                if (elapsed < holdMs) return;
                if (Math.hypot(dx0, dy0) <= threshold) return;

                if (pendingTimelineOp.kind === 'resize') {
                    const dt = (e.clientX - pendingTimelineOp.startX) / pps;
                    if (pendingTimelineOp.cutId === 'audio') {
                        setAudioData(prev => {
                            if (!prev) return prev;
                            if (pendingTimelineOp.edge === 'left') {
                                const ns = Math.max(0, Math.min(prev.endTime - 0.1, prev.startTime + dt));
                                return { ...prev, startTime: ns, offset: Math.max(0, prev.offset + (ns - prev.startTime)) };
                            }
                            return { ...prev, endTime: Math.max(prev.startTime + 0.1, prev.endTime + dt) };
                        });
                    } else {
                        setCuts(prev => {
                            const tc = prev.find(c => c.id === pendingTimelineOp.cutId); if (!tc) return prev;
                            const others = prev.filter(o => o.id !== tc.id && o.track === tc.track);
                            const edges = [0, ...others.flatMap(o => [o.startTime, o.endTime])];
                            const snap = (v) => { for (const ee of edges) { if (Math.abs((v - ee) * pps) <= 8) return ee; } return v; };
                            if (pendingTimelineOp.edge === 'left') {
                                let ns = snap(Math.max(0, tc.startTime + dt));
                                for (const o of others) if (ns < o.endTime && tc.startTime >= o.endTime) ns = o.endTime;
                                ns = Math.min(ns, tc.endTime - 0.05);
                                setSnapLinePos(ns * pps + 60);
                                return prev.map(c => c.id === tc.id ? { ...c, startTime: ns } : c);
                            } else {
                                let ne = snap(Math.max(tc.startTime + 0.05, tc.endTime + dt));
                                for (const o of others) if (ne > o.startTime && tc.endTime <= o.startTime) ne = o.startTime;
                                ne = Math.max(ne, tc.startTime + 0.05);
                                setSnapLinePos(ne * pps + 60);
                                return prev.map(c => c.id === tc.id ? { ...c, endTime: ne } : c);
                            }
                        });
                    }
                    setPendingTimelineOp(null);
                    setResizingData({ cutId: pendingTimelineOp.cutId, edge: pendingTimelineOp.edge, startX: e.clientX });
                    return;
                }

                if (pendingTimelineOp.kind === 'drag') {
                    const dt = (e.clientX - pendingTimelineOp.startX) / pps;
                    const trackOff = Math.round((e.clientY - pendingTimelineOp.startY) / 60);
                    if (pendingTimelineOp.cutId === 'audio') {
                        setAudioData(prev => { if (!prev) return prev; const ns = Math.max(0, pendingTimelineOp.initialStart + dt); return { ...prev, startTime: ns, endTime: ns + (prev.endTime - prev.startTime) }; });
                    } else {
                        setCuts(prev => {
                            const ids = Array.isArray(pendingTimelineOp.cutIds) && pendingTimelineOp.cutIds.length ? pendingTimelineOp.cutIds : [pendingTimelineOp.cutId];
                            if (ids.length <= 1) {
                                const tc = prev.find(c => c.id === pendingTimelineOp.cutId); if (!tc) return prev;
                                let ns = Math.max(0, pendingTimelineOp.initialStart + dt), dur = tc.endTime - tc.startTime;
                                const nt = Math.max(0, Math.min(numTracks - 1, pendingTimelineOp.initialTrack + trackOff));
                                const others = prev.filter(o => o.id !== tc.id && o.track === nt);
                                const edges = [0, ...others.flatMap(o => [o.startTime, o.endTime])];
                                for (const ee of edges) { if (Math.abs((ns - ee) * pps) <= 8) { ns = ee; setSnapLinePos(ns * pps + 60); break; } }
                                for (const o of others) {
                                    if (ns < o.endTime && ns + dur > o.startTime) {
                                        const sideL = o.startTime - dur, sideR = o.endTime;
                                        ns = Math.abs(ns - sideL) < Math.abs(ns - sideR) ? sideL : sideR;
                                        setSnapLinePos(null);
                                    }
                                }
                                ns = Math.max(0, ns);
                                return prev.map(c => c.id === tc.id ? { ...c, startTime: ns, endTime: ns + dur, track: nt } : c);
                            }

                            const sel = new Set(ids);
                            const initials = Array.isArray(pendingTimelineOp.initials) && pendingTimelineOp.initials.length ? pendingTimelineOp.initials : ids.map(id => {
                                const c0 = prev.find(c => c.id === id);
                                return c0 ? ({ id, startTime: c0.startTime, endTime: c0.endTime, track: c0.track }) : ({ id, startTime: 0, endTime: 0, track: 0 });
                            });
                            const baseId = pendingTimelineOp.cutId;
                            const baseInit = initials.find(it => it.id === baseId) ?? initials[0];

                            let dt2 = dt;
                            // Clamp so no cut starts before 0.
                            const minStart = Math.min(...initials.map(it => it.startTime + dt2));
                            if (minStart < 0) dt2 -= minStart;

                            // Snap based on the base cut in its target track, then apply the same delta to all.
                            const baseTrack = clamp((baseInit.track | 0) + trackOff, 0, numTracks - 1);
                            const baseDur = (baseInit.endTime - baseInit.startTime);
                            const others = prev.filter(o => !sel.has(o.id) && o.track === baseTrack);
                            const edges = [0, ...others.flatMap(o => [o.startTime, o.endTime])];
                            const snap = (v) => { for (const ee of edges) { if (Math.abs((v - ee) * pps) <= 8) return ee; } return v; };
                            const proposedBaseStart = baseInit.startTime + dt2;
                            const snStart = snap(proposedBaseStart);
                            const snEnd = snap(proposedBaseStart + baseDur);
                            const dS = Math.abs((snStart - proposedBaseStart) * pps);
                            const dE = Math.abs((snEnd - (proposedBaseStart + baseDur)) * pps);
                            if (dS <= 8 || dE <= 8) {
                                const useStart = dS <= dE;
                                const target = useStart ? snStart : (snEnd - baseDur);
                                dt2 += (target - proposedBaseStart);
                            }
                            const minStart2 = Math.min(...initials.map(it => it.startTime + dt2));
                            if (minStart2 < 0) dt2 -= minStart2;

                            const nextById = new Map();
                            for (const it of initials) {
                                const nt = clamp((it.track | 0) + trackOff, 0, numTracks - 1);
                                nextById.set(it.id, { startTime: it.startTime + dt2, endTime: it.endTime + dt2, track: nt });
                            }

                            // Prevent overlaps with non-selected cuts in each destination track.
                            for (const [id, nx] of nextById.entries()) {
                                const dur = nx.endTime - nx.startTime;
                                if (dur < 0.05) return prev;
                                const colliders = prev.filter(o => !sel.has(o.id) && o.track === nx.track);
                                for (const o of colliders) {
                                    if (nx.startTime < o.endTime && nx.endTime > o.startTime) return prev;
                                }
                            }

                            setSnapLinePos((baseInit.startTime + dt2) * pps + 60);
                            return prev.map(c => {
                                const nx = nextById.get(c.id);
                                return nx ? ({ ...c, startTime: Math.max(0, nx.startTime), endTime: Math.max(0.05, nx.endTime), track: nx.track }) : c;
                            });
                        });
                    }
                    setPendingTimelineOp(null);
                    setDraggingCutData({
                        cutId: pendingTimelineOp.cutId,
                        cutIds: Array.isArray(pendingTimelineOp.cutIds) && pendingTimelineOp.cutIds.length ? pendingTimelineOp.cutIds : [pendingTimelineOp.cutId],
                        initials: Array.isArray(pendingTimelineOp.initials) ? pendingTimelineOp.initials : null,
                        startX: e.clientX,
                        startY: e.clientY,
                        initialStart: pendingTimelineOp.initialStart,
                        initialTrack: pendingTimelineOp.initialTrack,
                    });
                    return;
                }
            }

            if (resizingData) {
                const dt = (e.clientX - resizingData.startX) / pps;
                if (resizingData.cutId === 'audio') {
                    setAudioData(prev => {
                        if (!prev) return prev;
                        if (resizingData.edge === 'left') { const ns = Math.max(0, Math.min(prev.endTime - 0.1, prev.startTime + dt)); return { ...prev, startTime: ns, offset: Math.max(0, prev.offset + (ns - prev.startTime)) }; }
                        return { ...prev, endTime: Math.max(prev.startTime + 0.1, prev.endTime + dt) };
                    });
                    setResizingData(p => ({ ...p, startX: e.clientX })); return;
                }
                setCuts(prev => {
                    const tc = prev.find(c => c.id === resizingData.cutId); if (!tc) return prev;
                    const others = prev.filter(o => o.id !== tc.id && o.track === tc.track);
                    const edges = [0, ...others.flatMap(o => [o.startTime, o.endTime])];
                    const snap = (v) => { for (const e of edges) { if (Math.abs((v - e) * pps) <= 8) return e; } return v; };
                    if (resizingData.edge === 'left') {
                        let ns = snap(Math.max(0, tc.startTime + dt));
                        for (const o of others) if (ns < o.endTime && tc.startTime >= o.endTime) ns = o.endTime;
                        ns = Math.min(ns, tc.endTime - 0.05);
                        setSnapLinePos(ns * pps + 60);
                        return prev.map(c => c.id === tc.id ? { ...c, startTime: ns } : c);
                    } else {
                        let ne = snap(Math.max(tc.startTime + 0.05, tc.endTime + dt));
                        for (const o of others) if (ne > o.startTime && tc.endTime <= o.startTime) ne = o.startTime;
                        setSnapLinePos(ne * pps + 60);
                        return prev.map(c => c.id === tc.id ? { ...c, endTime: ne } : c);
                    }
                });
                setResizingData(p => ({ ...p, startX: e.clientX }));
            } else if (draggingCutData) {
                const dt = (e.clientX - draggingCutData.startX) / pps, trackOff = Math.round((e.clientY - draggingCutData.startY) / 60);
                if (draggingCutData.cutId === 'audio') {
                    setAudioData(prev => { if (!prev) return prev; const ns = Math.max(0, draggingCutData.initialStart + dt); return { ...prev, startTime: ns, endTime: ns + (prev.endTime - prev.startTime) }; }); return;
                }
                setCuts(prev => {
                    const ids = Array.isArray(draggingCutData.cutIds) && draggingCutData.cutIds.length ? draggingCutData.cutIds : [draggingCutData.cutId];
                    if (ids.length <= 1) {
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
                    }

                    const sel = new Set(ids);
                    const initials = Array.isArray(draggingCutData.initials) && draggingCutData.initials.length ? draggingCutData.initials : ids.map(id => {
                        const c0 = prev.find(c => c.id === id);
                        return c0 ? ({ id, startTime: c0.startTime, endTime: c0.endTime, track: c0.track }) : ({ id, startTime: 0, endTime: 0, track: 0 });
                    });
                    const baseId = draggingCutData.cutId;
                    const baseInit = initials.find(it => it.id === baseId) ?? initials[0];

                    let dt2 = dt;
                    const minStart = Math.min(...initials.map(it => it.startTime + dt2));
                    if (minStart < 0) dt2 -= minStart;

                    const baseTrack = clamp((baseInit.track | 0) + trackOff, 0, numTracks - 1);
                    const baseDur = (baseInit.endTime - baseInit.startTime);
                    const others = prev.filter(o => !sel.has(o.id) && o.track === baseTrack);
                    const edges = [0, ...others.flatMap(o => [o.startTime, o.endTime])];
                    const snap = (v) => { for (const ee of edges) { if (Math.abs((v - ee) * pps) <= 8) return ee; } return v; };
                    const proposedBaseStart = baseInit.startTime + dt2;
                    const snStart = snap(proposedBaseStart);
                    const snEnd = snap(proposedBaseStart + baseDur);
                    const dS = Math.abs((snStart - proposedBaseStart) * pps);
                    const dE = Math.abs((snEnd - (proposedBaseStart + baseDur)) * pps);
                    if (dS <= 8 || dE <= 8) {
                        const useStart = dS <= dE;
                        const target = useStart ? snStart : (snEnd - baseDur);
                        dt2 += (target - proposedBaseStart);
                    }
                    const minStart2 = Math.min(...initials.map(it => it.startTime + dt2));
                    if (minStart2 < 0) dt2 -= minStart2;

                    const nextById = new Map();
                    for (const it of initials) {
                        const nt = clamp((it.track | 0) + trackOff, 0, numTracks - 1);
                        nextById.set(it.id, { startTime: it.startTime + dt2, endTime: it.endTime + dt2, track: nt });
                    }

                    for (const [id, nx] of nextById.entries()) {
                        const colliders = prev.filter(o => !sel.has(o.id) && o.track === nx.track);
                        for (const o of colliders) {
                            if (nx.startTime < o.endTime && nx.endTime > o.startTime) return prev;
                        }
                    }

                    setSnapLinePos((baseInit.startTime + dt2) * pps + 60);
                    return prev.map(c => {
                        const nx = nextById.get(c.id);
                        return nx ? ({ ...c, startTime: Math.max(0, nx.startTime), endTime: Math.max(0.05, nx.endTime), track: nx.track }) : c;
                    });
                });
            }
        };
        const up = () => {
            isDraggingOrResizingRef.current = false;
            setResizingData(null); setDraggingCutData(null); setPendingTimelineOp(null); setSnapLinePos(null);
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
    }, [resizingData, draggingCutData, pendingTimelineOp, pps, numTracks]);

    const buildData = () => ({
        version: '1.2',
        appName: 'EasyMVMaker',
        savedAt: new Date().toISOString(),
        numTracks,
        onionPrev,
        onionNext,
        pps,
        defaultCutDuration,
        palette,
        activePaletteIndex,
        cuts: cuts.map(c => ({ ...c, layers: c.layers.map(l => ({ ...l, redoStrokes: [] })) }))
    });
    const restore = (data) => {
        if (data.appName !== 'EasyMVMaker') { alert('올바른 .emv 파일이 아닙니다.'); return; }
        if (typeof data.defaultCutDuration === 'number') {
            setDefaultCutDuration(clamp(data.defaultCutDuration, 0.05, 3600));
        } else if (typeof data.defaultCutDuration === 'string') {
            setDefaultCutDuration(clamp(parseFloat(data.defaultCutDuration) || DEFAULT_CUT_DURATION, 0.05, 3600));
        } else {
            setDefaultCutDuration(DEFAULT_CUT_DURATION);
        }
        const pal = Array.isArray(data.palette) ? data.palette.slice(0, 3) : null;
        if (pal) {
            const fixed = [pal[0] ?? null, pal[1] ?? null, pal[2] ?? null].map(v => (typeof v === 'string' && v.startsWith('#')) ? v : null);
            setPalette(fixed);
            const idx = typeof data.activePaletteIndex === 'number' ? Math.max(0, Math.min(2, data.activePaletteIndex | 0)) : 0;
            setActivePaletteIndex(idx);
            if (fixed[idx]) setColor(fixed[idx]);
        } else {
            setPalette([null, null, null]);
            setActivePaletteIndex(0);
        }
        setCuts(data.cuts.map(c => ({
            ...c,
            texts: safeArray(c.texts).map(t => ({
                ...t,
                animIn: t?.animIn ? ({ type: t.animIn.type ?? 'none', dur: typeof t.animIn.dur === 'number' ? t.animIn.dur : DEFAULT_CUT_ANIM_DUR }) : ({ type: 'none', dur: DEFAULT_CUT_ANIM_DUR }),
                animOut: t?.animOut ? ({ type: t.animOut.type ?? 'none', dur: typeof t.animOut.dur === 'number' ? t.animOut.dur : DEFAULT_CUT_ANIM_DUR }) : ({ type: 'none', dur: DEFAULT_CUT_ANIM_DUR }),
                visible: t?.visible !== false,
            })),
            animIn: c.animIn ? ({ type: c.animIn.type ?? 'none', dur: typeof c.animIn.dur === 'number' ? c.animIn.dur : DEFAULT_CUT_ANIM_DUR }) : ({ type: 'none', dur: DEFAULT_CUT_ANIM_DUR }),
            animOut: c.animOut ? ({ type: c.animOut.type ?? 'none', dur: typeof c.animOut.dur === 'number' ? c.animOut.dur : DEFAULT_CUT_ANIM_DUR }) : ({ type: 'none', dur: DEFAULT_CUT_ANIM_DUR }),
            textCollapsed: c.textCollapsed ?? true,
            layers: c.layers.map(l => ({ type: 'layer', parentId: null, ...l, redoStrokes: [] }))
        })));
        setNumTracks(data.numTracks || 2); setCurrentCutId(data.cuts[0]?.id || 1); setCurrentTime(0);
        setOnionPrev(data.onionPrev ?? false); setOnionNext(data.onionNext ?? false); setPps(data.pps ?? 50); setExpandedCuts(new Set());
        setLayerCanvasCache({}); // Clear cache on new project
    };

    const parseProjectJson = (raw) => {
        // Android/desktop file pickers sometimes introduce BOM/NUL/control chars or wrap JSON strangely.
        // Try a few recovery strategies before failing.
        let txt = String(raw ?? '');
        txt = txt.replace(/^\uFEFF/, '');
        txt = txt.replace(/^\u0000+/, '');
        txt = txt.replace(/^[\u0000-\u001F]+/, '');
        txt = txt.trim();
        if (!txt) throw new SyntaxError('Empty file');

        const tryParse = (s) => {
            const t = String(s ?? '').trim();
            if (!t) throw new SyntaxError('Empty file');
            if (t[0] === '<') throw new SyntaxError('Not a JSON project');
            return JSON.parse(t);
        };

        try {
            // Normal JSON.
            if (txt[0] === '{' || txt[0] === '[') return tryParse(txt);
        } catch (_) { /* continue */ }

        try {
            // Some environments might give a JSON string containing JSON.
            if (txt[0] === '"') {
                const inner = tryParse(txt);
                if (typeof inner === 'string') return tryParse(inner);
                return inner;
            }
        } catch (_) { /* continue */ }

        // Extract the first JSON object-like block.
        const firstBrace = txt.indexOf('{');
        const lastBrace = txt.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            try { return tryParse(txt.slice(firstBrace, lastBrace + 1)); } catch (_) { /* continue */ }
        }

        // Final attempt: strip leading garbage until we hit a plausible JSON start.
        const m = txt.match(/[\{\[]/);
        if (m && typeof m.index === 'number') {
            try { return tryParse(txt.slice(m.index)); } catch (_) { /* continue */ }
        }

        // Let the real error surface for debugging.
        return tryParse(txt);
    };
    const doSave = async (asNew = false) => {
        const json = JSON.stringify(buildData(), null, 2);

        let desiredName = 'project.emv';
        if (asNew) {
            const suggested = (fileHandleRef.current && typeof fileHandleRef.current.name === 'string') ? fileHandleRef.current.name : 'project.emv';
            const input = window.prompt('저장할 파일 이름을 입력하세요 (.emv)', suggested);
            if (input === null) return;
            const nm = String(input || '').trim();
            if (nm) desiredName = nm.toLowerCase().endsWith('.emv') ? nm : `${nm}.emv`;
        }

        if ('showSaveFilePicker' in window && (asNew || !fileHandleRef.current)) {
            try {
                const h = await window.showSaveFilePicker({
                    suggestedName: desiredName,
                    types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }]
                });
                fileHandleRef.current = h;
                const w = await h.createWritable();
                await w.write(json);
                await w.close();
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        } else if ('showSaveFilePicker' in window && fileHandleRef.current) {
            try {
                const w = await fileHandleRef.current.createWritable();
                await w.write(json);
                await w.close();
                return;
            } catch (e) { }
        }

        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
            download: desiredName,
        });
        a.click();
    };
    const doOpen = async () => {
        if ('showOpenFilePicker' in window) {
            try {
                const [h] = await window.showOpenFilePicker({ types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] });
                fileHandleRef.current = h;
                const txt = await (await h.getFile()).text();
                restore(parseProjectJson(txt));
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
                alert('파일 오류: ' + (e?.message || String(e)));
            }
        }
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.emv';
        inp.onchange = e => {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = ev => {
                try { restore(parseProjectJson(ev.target.result)); }
                catch (err) { alert('파일 오류: ' + (err?.message || String(err))); }
            };
            r.readAsText(f);
        };
        inp.click();
    };
    const doNew = () => {
        if (!window.confirm('새 프로젝트? 저장되지 않은 내용은 사라집니다.')) return;
        fileHandleRef.current = null;
        setCuts([{
            id: 1,
            name: 'Cut 1',
            startTime: 0,
            endTime: clamp(parseFloat(defaultCutDuration) || DEFAULT_CUT_DURATION, 0.05, 3600),
            track: 0,
            layers: [mkLayer(1)],
            activeLayerId: 1,
            texts: [],
            animIn: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
            animOut: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
            textCollapsed: true,
        }]);
        setNumTracks(2); setCurrentCutId(1); setCurrentTime(0); setExpandedCuts(new Set());
        setLayerCanvasCache({});
    };

    const handlePlayPause = () => {
        if (!isPlaying) {
            const hasActive = cuts.some(c => currentTime >= c.startTime && currentTime < c.endTime);
            if (!hasActive || currentTime >= playEndTime) {
                const t = cuts.filter(c => c.startTime > currentTime).length ? Math.min(...cuts.filter(c => c.startTime > currentTime).map(c => c.startTime)) : Math.min(...cuts.map(c => c.startTime), 0);
                setCurrentTime(t); if (audioRef.current) audioRef.current.currentTime = t;
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
        const nc = {
            id: Date.now(),
            name: `Cut ${cuts.length + 1}`,
            startTime: ns,
            endTime: ns + clamp(parseFloat(defaultCutDuration) || DEFAULT_CUT_DURATION, 0.05, 3600),
            track: trk,
            layers: [mkLayer(1)],
            activeLayerId: 1,
            texts: [],
            animIn: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
            animOut: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
            textCollapsed: true,
        };
        setCuts(p => [...p, nc]);
        setSingleCutSelection(nc.id);
        setCurrentTime(ns);
    };
    const handleDeleteCut = (id) => { const nc = cuts.filter(c => c.id !== id); setCuts(nc); if (currentCutId === id) setCurrentCutId(nc.length > 0 ? nc[0].id : null); };
    const updCutTime = (id, field, val) => { let v = Math.max(0, parseFloat(val) || 0); if (field === 'track') { v = Math.round(v); if (v >= numTracks) setNumTracks(v + 1); } setCuts(p => p.map(c => c.id === id ? { ...c, [field]: v } : c)); };
    const updCutAnim = (id, which, field, val) => {
        setCuts(p => p.map(c => {
            if (c.id !== id) return c;
            const cur = which === 'in' ? (c.animIn || { type: 'none', dur: DEFAULT_CUT_ANIM_DUR }) : (c.animOut || { type: 'none', dur: DEFAULT_CUT_ANIM_DUR });
            const next = { ...cur };
            if (field === 'type') next.type = String(val || 'none');
            if (field === 'dur') next.dur = clamp(parseFloat(val) || DEFAULT_CUT_ANIM_DUR, 0, 5);
            return which === 'in' ? { ...c, animIn: next } : { ...c, animOut: next };
        }));
    };
    const toggleCutSettings = (id) => setExpandedCuts(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
    const handleAddTrack = () => setNumTracks(p => p + 1);
    const handleDeleteTrack = (i) => { if (numTracks <= 1) return; if (!window.confirm(`Track ${i} 삭제?`)) return; setCuts(p => p.filter(c => c.track !== i).map(c => c.track > i ? { ...c, track: c.track - 1 } : c)); setNumTracks(p => p - 1); };

    const setSingleCutSelection = (id) => {
        setSelectedCutIds(new Set([id]));
        setCurrentCutId(id);
        setCollapsedCutIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const toggleCutSelection = (id) => {
        setSelectedCutIds(prev => {
            const s = new Set(prev);
            if (s.has(id)) s.delete(id); else s.add(id);
            if (s.size === 0) s.add(id);
            return s;
        });
        setCurrentCutId(id);
        setCollapsedCutIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const handleDeleteSelectedCuts = () => {
        const ids = Array.from(selectedCutIdsRef.current);
        if (ids.length === 0) return;
        if (!window.confirm(`${ids.length}개 Cut 삭제?`)) return;
        setCuts(prev => prev.filter(c => !selectedCutIdsRef.current.has(c.id)));
        setCopiedCuts(prev => prev); // keep clipboard
    };

    const normalizeCutForInsert = (cut) => {
        const c = JSON.parse(JSON.stringify(cut));
        c.layers = safeArray(c.layers).map(l => ({ ...l, type: l.type ?? 'layer', parentId: l.parentId ?? null, redoStrokes: [] }));
        c.texts = safeArray(c.texts);
        c.animIn = c.animIn ? ({ type: c.animIn.type ?? 'none', dur: typeof c.animIn.dur === 'number' ? c.animIn.dur : DEFAULT_CUT_ANIM_DUR }) : ({ type: 'none', dur: DEFAULT_CUT_ANIM_DUR });
        c.animOut = c.animOut ? ({ type: c.animOut.type ?? 'none', dur: typeof c.animOut.dur === 'number' ? c.animOut.dur : DEFAULT_CUT_ANIM_DUR }) : ({ type: 'none', dur: DEFAULT_CUT_ANIM_DUR });
        c.textCollapsed = c.textCollapsed ?? true;
        const paintLayers = c.layers.filter(l => l.type !== 'folder');
        const firstPaintId = paintLayers[0]?.id ?? 1;
        const activeOk = paintLayers.some(l => l.id === c.activeLayerId);
        c.activeLayerId = activeOk ? c.activeLayerId : firstPaintId;
        return c;
    };

    const handleCopyCuts = (ids) => {
        const uniq = Array.from(new Set(ids)).filter(Boolean);
        const list = uniq.map(id => cuts.find(c => c.id === id)).filter(Boolean);
        if (!list.length) return;
        const cloned = list.map(c => normalizeCutForInsert(c));
        const minStart = Math.min(...list.map(c => c.startTime));
        setCopiedCuts({ cuts: cloned, minStart });
    };

    const handleCopyCut = (id) => {
        const curSel = selectedCutIdsRef.current;
        if (curSel.has(id) && curSel.size > 1) handleCopyCuts(Array.from(curSel));
        else handleCopyCuts([id]);
    };

    const handlePasteCut = () => {
        if (!copiedCuts?.cuts?.length) return;
        const src = cuts.find(c => c.id === currentCutId);
        const anchor = src ? src.endTime : (cuts.length ? Math.max(...cuts.map(c => c.endTime)) : 0);
        const baseStart = copiedCuts.minStart ?? Math.min(...copiedCuts.cuts.map(c => c.startTime));
        const stamp = Date.now();
        const toInsert = copiedCuts.cuts.map((oc, i) => {
            const dur = (oc.endTime - oc.startTime);
            const rel = oc.startTime - baseStart;
            const id = stamp + i;
            const nc = normalizeCutForInsert(oc);
            nc.id = id;
            nc.name = `${oc.name} (copy)`;
            nc.startTime = anchor + rel;
            nc.endTime = anchor + rel + dur;
            // Track info included as-is. Expand tracks if needed.
            nc.track = Math.max(0, oc.track | 0);
            return nc;
        });
        const maxTrack = Math.max(numTracks - 1, ...toInsert.map(c => c.track));
        if (maxTrack >= numTracks) setNumTracks(maxTrack + 1);
        setCuts(p => [...p, ...toInsert]);
        const newActive = toInsert[0]?.id;
        if (newActive != null) setSingleCutSelection(newActive);
        setCurrentTime(anchor);
    };

    const nextLayerId = (c) => Math.max(...c.layers.map(l => l.id), 0) + 1;
    const handleAddLayer = (e, cutId) => {
        e.stopPropagation();
        updLayers(cutId, c => {
            const id = nextLayerId(c);
            const newLayer = mkLayer(id);
            const layers = [...c.layers];

            const sel = selectedLayerRow?.cutId === cutId ? layers.find(l => l.id === selectedLayerRow.layerId) : null;
            if (sel) {
                if (sel.type === 'folder') {
                    newLayer.parentId = sel.id;
                    // Insert after the last child of that folder (end of folder group).
                    let ii = layers.findIndex(l => l.id === sel.id) + 1;
                    for (let i = ii; i < layers.length; i++) {
                        if (layers[i].parentId === sel.id) ii = i + 1;
                        else break;
                    }
                    layers.splice(ii, 0, newLayer);
                    return { layers: layers.map(l => l.id === sel.id ? ({ ...l, collapsed: false }) : l), activeLayerId: id };
                }

                // Selected is a layer: create a sibling right below it.
                newLayer.parentId = sel.parentId ?? null;
                const si = layers.findIndex(l => l.id === sel.id);
                layers.splice(si + 1, 0, newLayer);
                return { layers, activeLayerId: id };
            }

            // Default: append to root end.
            newLayer.parentId = null;
            layers.push(newLayer);
            return { layers, activeLayerId: id };
        });
    };
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

    const applyLayerDropImpl = (cutId, draggedId, targetId, position) => {
        updLayers(cutId, c => {
            const layers = [...c.layers];
            const di = layers.findIndex(l => l.id === draggedId);
            if (di < 0) return c;
            const dragged = { ...layers[di] };
            layers.splice(di, 1);

            if (targetId == null) {
                // Drop at end of the root.
                dragged.parentId = null;
                layers.push(dragged);
                return { layers };
            }

            const tl = layers.find(l => l.id === targetId);
            if (!tl) return c;

            if (position === 'inside' && tl.type === 'folder') {
                if (dragged.type === 'folder') return c; // don't nest folders
                dragged.parentId = targetId;
                let ii = layers.findIndex(l => l.id === targetId) + 1;
                for (let i = ii; i < layers.length; i++) {
                    if (layers[i].parentId === targetId) ii = i + 1;
                    else break;
                }
                layers.splice(ii, 0, dragged);
            } else {
                dragged.parentId = tl.parentId ?? null;
                const ti = layers.findIndex(l => l.id === targetId);
                layers.splice(position === 'before' ? ti : ti + 1, 0, dragged);
            }
            return { layers };
        });
    };

    const getPos = (e) => {
        const c = canvasRef.current, r = c.getBoundingClientRect();
        const pr = pressureEnabled ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
        return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), pressure: pr };
    };

    const timelineInputBlocked = () => performance.now() < (ignoreTimelineUntilRef.current || 0);

    useEffect(() => {
        if (!pendingLayerOp && !dragLayerInfo) return;
        const mv = (e) => {
            const op = pendingLayerOp;
            const dragging = dragLayerInfo;
            const pointerId = op?.pointerId ?? dragging?.pointerId;
            if (pointerId != null && e.pointerId !== pointerId) return;

            const active = dragging || op;
            if (!active) return;

            // When dragging layers, always preventDefault to avoid scroll and long-press callouts.
            if (dragging) {
                try { e.preventDefault(); } catch { }
            }

            // Start drag only after a small threshold; for touch require a short hold to preserve scrolling/taps.
            if (!dragging && op) {
                const dx0 = e.clientX - op.startX;
                const dy0 = e.clientY - op.startY;
                const pt = op.pointerType ?? 'mouse';
                const threshold = pt === 'touch' ? 10 : pt === 'pen' ? 5 : 3;
                if (Math.hypot(dx0, dy0) <= threshold) return;
                layerDragMovedRef.current = true;
                suppressNextLayerClickRef.current = true;
                suppressGlobalClickRef.current = true;
                ignoreTimelineUntilRef.current = performance.now() + 500;
                setDragLayerInfo({ cutId: op.cutId, layerId: op.layerId, pointerId: op.pointerId });
                setPendingLayerOp(null);
            }

            const curDrag = dragLayerInfo || (op ? null : null);
            const drag = curDrag || dragLayerInfo;
            if (!drag) return;

            const el = document.elementFromPoint(e.clientX, e.clientY);
            const row = el?.closest?.('[data-layer-row="1"]');
            if (row) {
                const cutId = Number(row.getAttribute('data-cut-id'));
                const layerId = Number(row.getAttribute('data-layer-id'));
                const layerType = row.getAttribute('data-layer-type') || 'layer';
                if (cutId !== drag.cutId) {
                    setDropInfo(null);
                    return;
                }
                if (layerId === drag.layerId) {
                    setDropInfo(null);
                    return;
                }
                const r = row.getBoundingClientRect();
                const y01 = (e.clientY - r.top) / Math.max(1, r.height);
                let pos = (y01 < 0.5) ? 'before' : 'after';
                if (layerType === 'folder') {
                    if (y01 < 0.25) pos = 'before';
                    else if (y01 > 0.75) pos = 'after';
                    else pos = 'inside';
                }
                setDropInfo({ layerId, position: pos });
                e.preventDefault();
                return;
            }

            // If dragging over the list background for the same cut, allow dropping to the end.
            const list = el?.closest?.('[data-layer-list="1"]');
            if (list) {
                const cutId = Number(list.getAttribute('data-cut-id'));
                if (cutId === drag.cutId) {
                    setDropInfo({ layerId: null, position: 'end' });
                    e.preventDefault();
                    return;
                }
            }
            setDropInfo(null);
        };

        const up = (e) => {
            const op = pendingLayerOp;
            const dragging = dragLayerInfo;
            const pointerId = op?.pointerId ?? dragging?.pointerId;
            if (pointerId != null && e.pointerId !== pointerId) return;

            if (layerHoldTimerRef.current) {
                clearTimeout(layerHoldTimerRef.current);
                layerHoldTimerRef.current = null;
            }

            const drag = dragLayerInfo;
            const drop = dropInfo;
            if (drag && drag.cutId != null) {
                const targetId = drop?.position === 'end' ? null : (drop?.layerId ?? null);
                const pos = drop?.position === 'end' ? 'after' : (drop?.position ?? 'after');
                if (targetId !== drag.layerId) {
                    applyLayerDropImpl(drag.cutId, drag.layerId, targetId, pos);
                }
            }

            setPendingLayerOp(null);
            setDragLayerInfo(null);
            setDropInfo(null);
            suppressGlobalClickRef.current = true;
            ignoreTimelineUntilRef.current = performance.now() + 500;

            // Reset suppress on next tick so it only affects the click generated by this pointer interaction.
            setTimeout(() => { suppressNextLayerClickRef.current = false; layerDragMovedRef.current = false; }, 0);
        };

        window.addEventListener('pointermove', mv, { passive: false });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        };
    }, [pendingLayerOp, dragLayerInfo, dropInfo]);

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
        const pos = getPos(e);
        const currentCut = cuts.find(c => c.id === currentCutId);
        const activeLayer = currentCut?.layers.find(l => l.id === currentCut.activeLayerId);
        if (!activeLayer) return;

        if (textEdit) return;

        // Touch UX: finger drag pans the view; two fingers pinch-zoom. Pen/mouse keep drawing semantics.
        if (e.pointerType === 'touch') {
            const existingCount = canvasTouchPointsRef.current.size;
            canvasTouchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { }

            if (canvasTouchPointsRef.current.size >= 2) {
                // Promote to pinch (cancel pan).
                isCanvasPanningRef.current = false;
                canvasPanRef.current = null;
                const pts = [...canvasTouchPointsRef.current.values()];
                const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                canvasPinchRef.current = { lastDist: Math.max(1, d) };
                isCanvasPinchingRef.current = true;
                isDrawing.current = false;
                activePointerIdRef.current = null;
                selectionDragRef.current = null;
                textDragRef.current = null;
                e.preventDefault();
                return;
            }

            // Single-finger pan starts immediately; taps still work on UI outside the canvas.
            // We skip selection/text hit testing on touch to avoid accidental moves while panning.
            if (existingCount === 0) {
                isCanvasPinchingRef.current = false;
                canvasPinchRef.current = null;
                isCanvasPanningRef.current = true;
                canvasPanRef.current = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    startOffset: { ...(canvasOffsetRef.current || { x: 0, y: 0 }) }
                };
                isDrawing.current = false;
                activePointerIdRef.current = null;
                selectionDragRef.current = null;
                textDragRef.current = null;
                e.preventDefault();
                return;
            }
        }

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
            // On touch devices we avoid auto-commit because a two-finger pinch is common.
            if (e.pointerType !== 'touch') commitSelectionImpl(selection);
        }

        // Galaxy Tab touch UX: finger touches should not draw/erase/fill by accident.
        if (e.pointerType === 'touch' && (tool === 'pen' || tool === 'dot' || tool === 'marker' || tool === 'calligraphy' || tool === 'eraser' || tool === 'lasso' || tool === 'fill')) {
            return;
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
                animIn: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
                animOut: { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
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
            case 'dot':
            case 'marker':
            case 'calligraphy':
            case 'eraser':
                {
                    const effectiveTool = (tool === 'eraser' && lastInkToolRef.current === 'dot') ? 'dotEraser' : tool;
                    const newStroke = { id: Date.now(), tool: effectiveTool, color, opacity, size: brushSize, points: [pos] };
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
                    const activeCanvas = layerCanvasCache[layerCacheKey(currentCutId, activeLayer.id)];
                    if (activeCanvas) tctx.drawImage(activeCanvas, 0, 0);
                    else drawStrokesOnCtx(tctx, activeLayer.strokes, false, bitmapStoreRef.current);

                    const stack = flattenLayersInUiOrder(currentCut?.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    const activeIndex = stack.findIndex(l => l.id === activeLayer.id);
                    if (activeIndex > 0) {
                        for (let i = 0; i < activeIndex; i++) {
                            const lc = layerCanvasCache[layerCacheKey(currentCutId, stack[i].id)];
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
        // Allow touch pinch zoom even when we are not in a drawing gesture.
        if (e.pointerType === 'touch' && (isCanvasPinchingRef.current || canvasTouchPointsRef.current.has(e.pointerId))) {
            if (canvasTouchPointsRef.current.has(e.pointerId)) {
                canvasTouchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }
            if (canvasTouchPointsRef.current.size >= 2) {
                const pts = [...canvasTouchPointsRef.current.values()];
                const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (!canvasPinchRef.current) canvasPinchRef.current = { lastDist: Math.max(1, d) };

                const stage = canvasStageRef.current;
                const r = stage?.getBoundingClientRect();
                if (r) {
                    const midX = (pts[0].x + pts[1].x) / 2 - r.left;
                    const midY = (pts[0].y + pts[1].y) / 2 - r.top;
                    const s0 = canvasScaleRef.current || 1;
                    const t0 = canvasOffsetRef.current || { x: 0, y: 0 };
                    const lastDist = canvasPinchRef.current.lastDist || Math.max(1, d);
                    const factor = d / Math.max(1, lastDist);
                    const s1 = clamp(s0 * factor, 0.25, 6);

                    // Keep the content under the current pinch midpoint stable:
                    // screen = scale * world + offset  => world = (screen - offset) / scale
                    const wx = (midX - t0.x) / s0;
                    const wy = (midY - t0.y) / s0;
                    const t1 = { x: midX - s1 * wx, y: midY - s1 * wy };
                    setCanvasScale(s1);
                    setCanvasOffset(t1);
                    canvasPinchRef.current.lastDist = Math.max(1, d);
                } else {
                    // Fallback: scale around origin.
                    const s0 = canvasScaleRef.current || 1;
                    const lastDist = canvasPinchRef.current.lastDist || Math.max(1, d);
                    const factor = d / Math.max(1, lastDist);
                    const s1 = clamp(s0 * factor, 0.25, 6);
                    setCanvasScale(s1);
                    canvasPinchRef.current.lastDist = Math.max(1, d);
                }
                isCanvasPinchingRef.current = true;
                e.preventDefault();
                return;
            }
            // If pinch ended (only 1 finger left), just keep the tracking until pointerup clears it.
        }

        // One-finger pan (touch only).
        if (e.pointerType === 'touch' && isCanvasPanningRef.current && canvasPanRef.current?.pointerId === e.pointerId) {
            const p = canvasPanRef.current;
            const dx = e.clientX - p.startX;
            const dy = e.clientY - p.startY;
            setCanvasOffset({ x: p.startOffset.x + dx, y: p.startOffset.y + dy });
            e.preventDefault();
            return;
        }

        if (!isDrawing.current) return;
        const pos = getPos(e);

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
            case 'dot':
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

    const stopDraw = (e) => {
        // Touch pinch cleanup.
        if (e?.pointerType === 'touch') {
            if (canvasTouchPointsRef.current.has(e.pointerId)) {
                canvasTouchPointsRef.current.delete(e.pointerId);
            }
            if (canvasTouchPointsRef.current.size < 2) {
                isCanvasPinchingRef.current = false;
                canvasPinchRef.current = null;
            }
            if (isCanvasPanningRef.current && canvasPanRef.current?.pointerId === e.pointerId) {
                isCanvasPanningRef.current = false;
                canvasPanRef.current = null;
            }
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
            animIn: textEdit.animIn ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
            animOut: textEdit.animOut ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
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
            animIn: t.animIn ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
            animOut: t.animOut ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR },
        });
    };

    useEffect(() => {
        // Keep the text editor pinned to the same canvas coordinate when zoom/pan changes.
        if (!textEdit || !canvasRef.current) return;
        const c = canvasRef.current;
        const r = c.getBoundingClientRect();
        const sx = r.width / c.width;
        const sy = r.height / c.height;
        setTextEdit(te => te ? ({ ...te, cssX: (te.x * sx), cssY: (te.y * sy) }) : te);
    }, [canvasScale, canvasOffset]);

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

    const toggleTextCollapsed = (cutId) => {
        setCuts(p => p.map(c => c.id === cutId ? ({ ...c, textCollapsed: !(c.textCollapsed ?? true) }) : c));
    };

    useEffect(() => {
        const newCache = { ...layerCanvasCache };
        let changed = false;
        for (const cut of cuts) {
            for (const layer of cut.layers) {
                if (layer.type !== 'layer') continue;
                const k = layerCacheKey(cut.id, layer.id);
                const canvas = newCache[k];
                const layerStrokes = JSON.stringify(layer.strokes);
                if (!canvas || canvas.dataset.strokes !== layerStrokes) {
                    const newCanvas = canvas || document.createElement('canvas');
                    newCanvas.width = CANVAS_W;
                    newCanvas.height = CANVAS_H;
                    drawStrokesOnCtx(newCanvas.getContext('2d'), layer.strokes, true, bitmapStoreRef.current);
                    newCanvas.dataset.strokes = layerStrokes;
                    newCache[k] = newCanvas;
                    changed = true;
                }
            }
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

        const animForCut = (ac) => {
            if (!isPlaying) return { dx: 0, dy: 0, a: 1 };
            const t = currentTime;
            let dx = 0;
            let dy = 0;
            let a = 1;

            const ai = ac.animIn || { type: 'none', dur: DEFAULT_CUT_ANIM_DUR };
            const ao = ac.animOut || { type: 'none', dur: DEFAULT_CUT_ANIM_DUR };

            if (ai.type !== 'none' && (ai.dur || 0) > 0) {
                const p = clamp((t - ac.startTime) / ai.dur, 0, 1);
                const e = easeOutCubic(p);
                if (ai.type === 'slideFromRight') dx += (1 - e) * CANVAS_W;
                else if (ai.type === 'slideFromLeft') dx += -(1 - e) * CANVAS_W;
                else if (ai.type === 'fade') a *= e;
            }

            if (ao.type !== 'none' && (ao.dur || 0) > 0) {
                const startOut = ac.endTime - ao.dur;
                const p = clamp((t - startOut) / ao.dur, 0, 1);
                const e = easeInCubic(p);
                if (ao.type === 'slideToRight') dx += e * CANVAS_W;
                else if (ao.type === 'slideToLeft') dx += -e * CANVAS_W;
                else if (ao.type === 'fade') a *= (1 - e);
            }

            return { dx, dy, a };
        };

        const animById = new Map();
        for (const ac of activeCuts) animById.set(ac.id, animForCut(ac));

        if (!isPlaying && primary) {
            if (onionPrev) {
                const prevCut = cuts.filter(c => c.startTime < primary.startTime && c.track === primary.track).sort((a, b) => b.startTime - a.startTime)[0];
                if (prevCut) {
                    const order = flattenLayersInUiOrder(prevCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = layerCanvasCache[layerCacheKey(prevCut.id, order[i].id)];
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
                }
            }
            if (onionNext) {
                const nextCut = cuts.filter(c => c.startTime >= primary.endTime && c.track === primary.track).sort((a, b) => a.startTime - b.startTime)[0];
                if (nextCut) {
                    const order = flattenLayersInUiOrder(nextCut.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
                    for (let i = order.length - 1; i >= 0; i--) {
                        const lc = layerCanvasCache[layerCacheKey(nextCut.id, order[i].id)];
                        if (lc) { ctx.globalAlpha = 0.35; ctx.drawImage(lc, 0, 0); ctx.globalAlpha = 1.0; }
                    }
                }
            }
        }

        activeCuts.forEach(ac => {
            const tr = animById.get(ac.id) || { dx: 0, dy: 0, a: 1 };
            ctx.save();
            ctx.translate(tr.dx, tr.dy);
            ctx.globalAlpha = ctx.globalAlpha * tr.a;

            const order = flattenLayersInUiOrder(ac.layers || []).filter(l => l.type === 'layer' && l.visible !== false);
            // Draw bottom -> top so the topmost layer (UI top) is visually on top.
            for (let i = order.length - 1; i >= 0; i--) {
                const l = order[i];
                const layerCanvas = layerCanvasCache[layerCacheKey(ac.id, l.id)];
                if (!layerCanvas) continue;

                const shouldMask = selection?.maskBitmapId && selection.cutId === ac.id && selection.sourceLayerId === l.id;
                if (!shouldMask) {
                    ctx.drawImage(layerCanvas, 0, 0);
                    continue;
                }

                const maskEntry = bitmapStoreRef.current.get(selection.maskBitmapId);
                const mb = maskEntry?.imageBitmap;
                const mi = maskEntry?.imageData;
                const mx = Math.round(selection.x);
                const my = Math.round(selection.y);
                if (!mb && !mi) {
                    ctx.drawImage(layerCanvas, 0, 0);
                    continue;
                }

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
        });

        // Text objects live outside paint layers ("text layer").
        activeCuts.forEach(ac => {
            const tr = animById.get(ac.id) || { dx: 0, dy: 0, a: 1 };
            const baseAlpha = tr.a;
            ctx.save();
            ctx.translate(tr.dx, tr.dy);
            ctx.globalAlpha = ctx.globalAlpha * baseAlpha;

            for (const t of safeArray(ac.texts)) {
                if (!t || t.visible === false) continue;

                // Per-text animation (relative to the cut time range).
                let tx = 0;
                let ty = 0;
                let ta = 1;
                if (isPlaying) {
                    const slide = 80;
                    const ai = t.animIn || { type: 'none', dur: DEFAULT_CUT_ANIM_DUR };
                    const ao = t.animOut || { type: 'none', dur: DEFAULT_CUT_ANIM_DUR };
                    const tt = currentTime;
                    if (ai.type !== 'none' && (ai.dur || 0) > 0) {
                        const p = clamp((tt - ac.startTime) / ai.dur, 0, 1);
                        const e = easeOutCubic(p);
                        if (ai.type === 'slideFromRight') tx += (1 - e) * slide;
                        else if (ai.type === 'slideFromLeft') tx += -(1 - e) * slide;
                        else if (ai.type === 'fade') ta *= e;
                    }
                    if (ao.type !== 'none' && (ao.dur || 0) > 0) {
                        const startOut = ac.endTime - ao.dur;
                        const p = clamp((tt - startOut) / ao.dur, 0, 1);
                        const e = easeInCubic(p);
                        if (ao.type === 'slideToRight') tx += e * slide;
                        else if (ao.type === 'slideToLeft') tx += -e * slide;
                        else if (ao.type === 'fade') ta *= (1 - e);
                    }
                }

                const fontSize = Math.max(6, Math.min(220, t.fontSize ?? 32));
                const fontFamily = t.fontFamily ?? 'sans-serif';
                const lineHeight = Math.round(fontSize * 1.25);
                ctx.globalCompositeOperation = 'source-over';
                ctx.save();
                ctx.translate(tx, ty);
                ctx.globalAlpha = baseAlpha * ta * (t.opacity ?? 1);
                ctx.fillStyle = t.color ?? '#000';
                ctx.textBaseline = 'top';
                ctx.font = `${fontSize}px ${fontFamily}`;
                const lines = String(t.text ?? '').split('\n');
                for (let i = 0; i < lines.length; i++) {
                    ctx.fillText(lines[i], t.x ?? 0, (t.y ?? 0) + i * lineHeight);
                }
                ctx.restore();
                ctx.globalAlpha = baseAlpha;
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

        if (lassoPoints.length > 0) {
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            lassoPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, [cuts, currentCutId, isPlaying, currentTime, onionPrev, onionNext, lassoPoints, selection, selectedText, layerCanvasCache]);

    useEffect(() => {
        // Navigator (minimap) overlay for touch panning when zoomed in.
        if (!navEnabled) return;
        const nav = navCanvasRef.current;
        const src = canvasRef.current;
        const area = canvasAreaRef.current;
        const stage = canvasStageRef.current;
        if (!nav || !src || !area || !stage) return;

        const show = canvasScaleRef.current > 1.01 || Math.hypot(canvasOffsetRef.current.x, canvasOffsetRef.current.y) > 0.5;
        if (!show) return;

        const ctx = nav.getContext('2d');
        const w = nav.width;
        const h = nav.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(12, 12, 20, 0.92)';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(src, 0, 0, w, h);

        const areaRect = area.getBoundingClientRect();
        const canvasRect = src.getBoundingClientRect();
        const s = canvasScaleRef.current || 1;

        const visL = Math.max(areaRect.left, canvasRect.left);
        const visT = Math.max(areaRect.top, canvasRect.top);
        const visR = Math.min(areaRect.right, canvasRect.right);
        const visB = Math.min(areaRect.bottom, canvasRect.bottom);
        if (visR <= visL || visB <= visT) return;

        const worldX = (visL - canvasRect.left) / s;
        const worldY = (visT - canvasRect.top) / s;
        const worldW = (visR - visL) / s;
        const worldH = (visB - visT) / s;

        const rx = clamp((worldX / CANVAS_W) * w, 0, w);
        const ry = clamp((worldY / CANVAS_H) * h, 0, h);
        const rw = clamp((worldW / CANVAS_W) * w, 0, w);
        const rh = clamp((worldH / CANVAS_H) * h, 0, h);

        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, Math.max(2, rw - 2), Math.max(2, rh - 2));
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, rw, rh);
    }, [navEnabled, canvasScale, canvasOffset, cuts, currentCutId, isPlaying, currentTime, onionPrev, onionNext, lassoPoints, selection, selectedText, layerCanvasCache]);

    const handleTimelineClick = (e) => {
        if (timelineInputBlocked()) return;
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left - 60; if (x < 0) return;
        const t = Math.min(maxTime, Math.max(0, x / pps)); setCurrentTime(t);
        const active = cuts.filter(c => t >= c.startTime && t < c.endTime);
        if (active.length) setCurrentCutId(active.reduce((p, c) => p.track > c.track ? p : c).id);
    };

    const handleTimelinePointerDownCapture = (e) => {
        if (e.pointerType !== 'touch') return;
        timelineTouchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }

        if (timelineTouchPointsRef.current.size >= 2) {
            const pts = [...timelineTouchPointsRef.current.values()];
            const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            timelinePinchRef.current = { startDist: Math.max(1, d), startPps: pps };
            isTimelinePinchingRef.current = true;
            // Cancel any pending timeline drag/resize so pinch doesn't fight with it.
            setPendingTimelineOp(null);
            setResizingData(null);
            setDraggingCutData(null);
            setSnapLinePos(null);
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const handleTimelinePointerMoveCapture = (e) => {
        if (e.pointerType !== 'touch') return;
        if (!timelineTouchPointsRef.current.has(e.pointerId)) return;
        timelineTouchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!isTimelinePinchingRef.current) return;
        if (timelineTouchPointsRef.current.size < 2 || !timelinePinchRef.current) return;
        const pts = [...timelineTouchPointsRef.current.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const next = Math.max(10, Math.min(300, timelinePinchRef.current.startPps * (d / timelinePinchRef.current.startDist)));
        setPps(next);
        e.preventDefault();
        e.stopPropagation();
    };

    const handleTimelinePointerUpCapture = (e) => {
        if (e.pointerType !== 'touch') return;
        if (timelineTouchPointsRef.current.has(e.pointerId)) {
            timelineTouchPointsRef.current.delete(e.pointerId);
        }
        if (timelineTouchPointsRef.current.size < 2) {
            isTimelinePinchingRef.current = false;
            timelinePinchRef.current = null;
        }
        if (isTimelinePinchingRef.current) {
            e.preventDefault();
            e.stopPropagation();
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
                        className={`layer-row${!isFolder && cut.activeLayerId === layer.id ? ' layer-active' : ''}${selectedLayerRow?.cutId === cut.id && selectedLayerRow?.layerId === layer.id ? ' layer-selected' : ''}${isFolder ? ' layer-folder' : ''}${dt === 'inside' ? ' drop-inside' : ''}`}
                        style={{ paddingLeft: depth * 14 + 6 }}
                        data-layer-row="1"
                        data-cut-id={cut.id}
                        data-layer-id={layer.id}
                        data-layer-type={layer.type}
                        onContextMenu={e => { e.preventDefault(); }}
                        onPointerDown={e => {
                            // Touch: long-press anywhere on the row (except buttons) to start dragging.
                            if (e.pointerType !== 'touch') return;
                            if (e.target?.closest?.('button,input,select,textarea,.layer-drag-handle')) return;
                            e.stopPropagation();
                            const op = { cutId: cut.id, layerId: layer.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, t0: performance.now() };
                            setPendingLayerOp(op);
                            if (layerHoldTimerRef.current) clearTimeout(layerHoldTimerRef.current);
                            layerHoldTimerRef.current = setTimeout(() => {
                                suppressNextLayerClickRef.current = true;
                                suppressGlobalClickRef.current = true;
                                ignoreTimelineUntilRef.current = performance.now() + 500;
                                setDragLayerInfo({ cutId: op.cutId, layerId: op.layerId, pointerId: op.pointerId });
                                setPendingLayerOp(null);
                                layerHoldTimerRef.current = null;
                            }, 180);
                        }}
                        onClick={e => {
                            if (suppressNextLayerClickRef.current) { e.preventDefault(); e.stopPropagation(); return; }
                            setSelectedLayerRow({ cutId: cut.id, layerId: layer.id });
                            if (!isFolder) handleSetActive(e, cut.id, layer.id);
                        }}
                    >
                        <span
                            className="layer-drag-handle"
                            title="드래그"
                            onPointerDown={e => {
                                // Custom pointer-based drag so it works reliably on touch/pen.
                                if (e.button != null && e.button !== 0) return;
                                e.stopPropagation();
                                e.preventDefault();
                                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }

                                const op = { cutId: cut.id, layerId: layer.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, t0: performance.now() };
                                setPendingLayerOp(op);
                                suppressGlobalClickRef.current = true;

                                if (layerHoldTimerRef.current) clearTimeout(layerHoldTimerRef.current);
                                if (e.pointerType === 'touch') {
                                    // Enter drag mode on hold, even before movement, to block the system long-press menu.
                                    layerHoldTimerRef.current = setTimeout(() => {
                                        layerDragMovedRef.current = true;
                                        suppressNextLayerClickRef.current = true;
                                        suppressGlobalClickRef.current = true;
                                        ignoreTimelineUntilRef.current = performance.now() + 500;
                                        setDragLayerInfo({ cutId: op.cutId, layerId: op.layerId, pointerId: op.pointerId });
                                        setPendingLayerOp(null);
                                        layerHoldTimerRef.current = null;
                                    }, 140);
                                }
                            }}
                        >
                            <GripVertical size={14} />
                        </span>
                        {isFolder
                            ? <button className="icon-btn" onClick={e => handleToggleFolder(e, cut.id, layer.id)}>{layer.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}</button>
                            : <span style={{ width: 11, flexShrink: 0, display: 'inline-block' }} />}
                        {isFolder
                            ? (layer.collapsed ? <Folder size={13} style={{ color: '#888', marginRight: 4, flexShrink: 0 }} /> : <FolderOpen size={13} style={{ color: '#aaa', marginRight: 4, flexShrink: 0 }} />)
                            : <LayerThumbnail cutId={cut.id} layer={layer} layerCanvasCache={layerCanvasCache} />}
                        <button className="icon-btn" style={{ marginLeft: 4 }} onClick={e => handleToggleVisible(e, cut.id, layer.id)}>
                            {layer.visible ? <Eye size={10} /> : <EyeOff size={10} style={{ color: '#555' }} />}
                        </button>
                        <span className="layer-name">{layer.name}</span>
                        <button className="icon-btn del-btn" onClick={e => handleDeleteLayer(e, cut.id, layer.id)}><Trash2 size={11} /></button>
                    </div>
                    {dt === 'after' && <div className="drop-line" />}
                    {isFolder && !layer.collapsed && renderLayers(cut, layer.id, depth + 1)}
                </div>
            );
        });
    };

    const currentCut = cuts.find(c => c.id === currentCutId);
    const isSelectionTool = tool === 'lasso' || !!selection;
    const isColorPickerHexValid = !!colorPicker && /^#[0-9a-fA-F]{6}$/.test(String(colorPicker.hex || '').trim());

    const toggleCutCollapsed = (cutId) => {
        setCollapsedCutIds(prev => {
            const s = new Set(prev);
            s.has(cutId) ? s.delete(cutId) : s.add(cutId);
            return s;
        });
    };

    const renderCutRow = (cut) => {
        const isCollapsed = collapsedCutIds.has(cut.id);
        return (
            <div
                key={cut.id}
                className={`cut-item${currentCutId === cut.id ? ' cut-active' : ''}${selectedCutIds.has(cut.id) ? ' cut-selected' : ''}${isCollapsed ? ' cut-collapsed' : ''}`}
                onClick={(e) => {
                    // Desktop: ctrl/meta toggle, shift range. Tablet: use checkbox button.
                    if (e.shiftKey) {
                        const arr = cuts.map(c => c.id);
                        const a = arr.indexOf(currentCutId);
                        const b = arr.indexOf(cut.id);
                        if (a !== -1 && b !== -1) {
                            const lo = Math.min(a, b), hi = Math.max(a, b);
                            setSelectedCutIds(new Set(arr.slice(lo, hi + 1)));
                            setCurrentCutId(cut.id);
                            return;
                        }
                    }
                    if (e.ctrlKey || e.metaKey) { toggleCutSelection(cut.id); return; }
                    setSingleCutSelection(cut.id);
                }}
            >
                <div className="cut-header">
                    <button
                        className={`icon-btn cut-select-btn${selectedCutIds.has(cut.id) ? ' active' : ''}`}
                        onClick={e => { e.stopPropagation(); toggleCutSelection(cut.id); }}
                        title="선택/해제"
                    >
                        {selectedCutIds.has(cut.id) ? '✓' : '□'}
                    </button>
                    <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleCutCollapsed(cut.id); }} title="컷 접기/펼치기">
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <input
                        className="cut-name-input"
                        value={cut.name}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setCuts(p => p.map(c => c.id === cut.id ? ({ ...c, name: e.target.value }) : c))}
                        spellCheck={false}
                        title="컷 이름"
                    />
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button className="icon-btn" onClick={e => { e.stopPropagation(); handleCopyCut(cut.id); }} title="컷 복사 (Ctrl+C)"><Copy size={12} /></button>
                        <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleCutSettings(cut.id); }} title="설정"><Settings size={12} /></button>
                        <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteCut(cut.id); }}><Trash2 size={12} /></button>
                    </div>
                </div>

                {!isCollapsed && expandedCuts.has(cut.id) && (
                    <div className="cut-settings">
                        <div className="time-row">
                            <label>Start<input type="number" step="0.5" min="0" className="time-input" value={cut.startTime} onChange={e => updCutTime(cut.id, 'startTime', e.target.value)} /></label>
                            <label>End<input type="number" step="0.5" min="0" className="time-input" value={cut.endTime} onChange={e => updCutTime(cut.id, 'endTime', e.target.value)} /></label>
                        </div>
                        <div className="time-row" style={{ marginTop: 8 }}>
                            <label>
                                In
                                <select className="time-input" value={(cut.animIn?.type ?? 'none')} onChange={e => updCutAnim(cut.id, 'in', 'type', e.target.value)}>
                                    {CUT_ANIM_IN_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </label>
                            <label>
                                Out
                                <select className="time-input" value={(cut.animOut?.type ?? 'none')} onChange={e => updCutAnim(cut.id, 'out', 'type', e.target.value)}>
                                    {CUT_ANIM_OUT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className="time-row" style={{ marginTop: 8 }}>
                            <label>
                                In Dur
                                <input type="number" step="0.05" min="0" max="5" className="time-input" value={cut.animIn?.dur ?? DEFAULT_CUT_ANIM_DUR} onChange={e => updCutAnim(cut.id, 'in', 'dur', e.target.value)} />
                            </label>
                            <label>
                                Out Dur
                                <input type="number" step="0.05" min="0" max="5" className="time-input" value={cut.animOut?.dur ?? DEFAULT_CUT_ANIM_DUR} onChange={e => updCutAnim(cut.id, 'out', 'dur', e.target.value)} />
                            </label>
                        </div>
                    </div>
                )}

                {!isCollapsed && (
                    <>
                        <div className="layer-list" data-layer-list="1" data-cut-id={cut.id} onContextMenu={e => { e.preventDefault(); }}>
                            {renderLayers(cut)}
                            <div
                                className={`layer-row layer-folder text-layer-header${(cut.textCollapsed ?? true) ? '' : ' layer-active'}`}
                                style={{ paddingLeft: 6 }}
                                onClick={e => { e.stopPropagation(); toggleTextCollapsed(cut.id); }}
                                draggable={false}
                            >
                                <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleTextCollapsed(cut.id); }} title="접기/펼치기">
                                    {(cut.textCollapsed ?? true) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                </button>
                                <Type size={12} style={{ marginLeft: 2, marginRight: 4, color: '#a7a7d6' }} />
                                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#a7a7d6' }}>TEXT</span>
                                <span style={{ marginLeft: 6, fontSize: 11, color: '#666' }}>{safeArray(cut.texts).length}</span>
                                <div style={{ flex: 1 }} />
                                <button className="icon-btn" onClick={e => { e.stopPropagation(); handleSetTool('text'); setCurrentCutId(cut.id); if (cut.textCollapsed) toggleTextCollapsed(cut.id); }} title="텍스트 추가">
                                    <Plus size={12} />
                                </button>
                            </div>
                            {!(cut.textCollapsed ?? true) && safeArray(cut.texts).map(t => (
                                <div
                                    key={t.id}
                                    className={`layer-row text-layer-row${selectedText?.cutId === cut.id && selectedText?.textId === t.id ? ' layer-active' : ''}`}
                                    style={{ paddingLeft: 22 }}
                                    onClick={e => { e.stopPropagation(); setSelectedText({ cutId: cut.id, textId: t.id }); }}
                                    draggable={false}
                                >
                                    <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleTextVisible(cut.id, t.id); }} title="표시">
                                        {t.visible === false ? <EyeOff size={10} style={{ color: '#555' }} /> : <Eye size={10} />}
                                    </button>
                                    <div className="text-item-name" style={{ flex: 1, fontSize: 11, color: '#bbb' }}>
                                        {String(t.text ?? '').split('\n')[0] || '(빈 텍스트)'}
                                    </div>
                                    <button className="icon-btn" onClick={e => { e.stopPropagation(); openEditText(cut.id, t.id); }} title="편집"><Settings size={11} /></button>
                                    <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); deleteTextObject(cut.id, t.id); }} title="삭제"><Trash2 size={11} /></button>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button className="small-btn" onClick={e => handleAddLayer(e, cut.id)}><Plus size={11} /> 레이어</button>
                            <button className="small-btn" onClick={e => handleAddFolder(e, cut.id)}><FolderPlus size={11} /> 폴더</button>
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="app-container">
            <audio ref={audioRef} style={{ display: 'none' }} />

            <div className="top-bar">
                <h1 className="title">Easy MV Maker</h1>
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
                                <button className="file-menu-item" onClick={() => { doOpen(); setShowFileMenu(false); }}>열기...</button>
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
                        <div className="toolbar" style={{ width: leftW, flexShrink: 0 }}>
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
                            <button className={`tool-btn${navEnabled ? ' active' : ''}`} onClick={() => setNavEnabled(v => !v)} title="줌 네비게이션(미니맵)">
                                <MapIcon size={15} />
                                <span className="tool-label">Nav</span>
                            </button>
                            <button className="tool-btn" onClick={resetCanvasView} title="뷰 리셋 (100%)">
                                <RefreshCw size={15} />
                                <span className="tool-label">Reset</span>
                            </button>
                            <button className={`tool-btn${pressureEnabled ? ' active' : ''}`} onClick={() => setPressureEnabled(v => !v)} title="필압 on/off">
                                {pressureEnabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                                <span className="tool-label">Pressure</span>
                            </button>
                        </div>
                        <div className="tool-divider" />
                        <div className={`palette${isSelectionTool ? ' palette-disabled' : ''}`}>
                            {palette.map((c, i) => (
                                <button
                                    key={i}
                                    className={`swatch${activePaletteIndex === i ? ' swatch-active' : ''}${!c ? ' swatch-empty' : ''}`}
                                    style={{ background: c || 'transparent' }}
                                    onClick={() => {
                                        if (isSelectionTool) return;
                                        openCustomColorPicker(i);
                                    }}
                                    title="색상 선택"
                                />
                            ))}
                        </div>

                        <div className="h-control">
                            <div className="h-control-top">
                                <span className="h-control-label">Size</span>
                                <input
                                    className="h-num"
                                    type="number"
                                    min="1"
                                    max={BRUSH_NUM_MAX}
                                    value={brushSize}
                                    onChange={e => setBrushSize(clamp(+e.target.value || 1, 1, BRUSH_NUM_MAX))}
                                    disabled={isSelectionTool}
                                    title="브러시 크기 (숫자)"
                                />
                            </div>
                            <input
                                type="range"
                                min="1"
                                max={BRUSH_SLIDER_MAX}
                                value={Math.min(BRUSH_SLIDER_MAX, Math.max(1, brushSize))}
                                onChange={e => setBrushSize(+e.target.value)}
                                className="h-slider"
                                disabled={isSelectionTool}
                                title="브러시 크기 (슬라이더)"
                            />
                        </div>

                        <div className="h-control">
                            <div className="h-control-top">
                                <span className="h-control-label">Opacity</span>
                                <span className="h-control-val">{Math.round(opacity * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={Math.round(opacity * 100)}
                                onChange={e => setOpacity(+e.target.value / 100)}
                                className="h-slider"
                                disabled={isSelectionTool}
                                title="Opacity"
                            />
                        </div>
                        </div>
                    )}

                    {showLeft && (
                        <button
                            onClick={() => setShowLeft(false)}
                            className="icon-btn left-collapse-outside"
                            style={{ left: Math.round(leftW + 2) }}
                            title="툴바 접기"
                        >
                            <ChevronLeft size={14} />
                        </button>
                    )}

                    {showLeft && (
                        <div
                            className="splitter-v splitter-v-left"
                            onPointerDown={e => {
                                e.preventDefault();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                setSplitter({ kind: 'left', pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startLeftW: leftW, startRightW: rightW, startTimelineH: timelineH });
                            }}
                        />
                    )}
                    {!showLeft && <button onClick={() => setShowLeft(true)} className="icon-btn" style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: '#1e1e2e', border: 'none', borderRight: '1px solid #333' }}><ChevronRight size={14} /></button>}

                <div className="canvas-area" ref={canvasAreaRef}>
                    <div className="canvas-stage" ref={canvasStageRef}>
                        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
                            onPointerDown={startDraw} onPointerMove={onDraw} onPointerUp={stopDraw} onPointerCancel={stopDraw} onPointerLeave={onPointerLeaveCanvas}
                            style={{
                                cursor: selection ? 'move' : tool === 'fill' ? 'cell' : tool === 'lasso' ? 'crosshair' : 'crosshair',
                                touchAction: 'none',
                                transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})`,
                                transformOrigin: 'top left',
                                    willChange: 'transform'
                                }} />
                        {navEnabled && (canvasScale > 1.01 || Math.hypot(canvasOffset.x, canvasOffset.y) > 0.5) && (
                            <div className="canvas-navigator" onPointerDown={e => {
                                // Tap on the minimap to recenter the view around that point.
                                const nav = navCanvasRef.current;
                                const src = canvasRef.current;
                                const area = canvasAreaRef.current;
                                if (!nav || !src || !area) return;
                                const nr = nav.getBoundingClientRect();
                                const ax = e.clientX - nr.left;
                                const ay = e.clientY - nr.top;
                                const wx = clamp((ax / nr.width) * CANVAS_W, 0, CANVAS_W);
                                const wy = clamp((ay / nr.height) * CANVAS_H, 0, CANVAS_H);

                                const areaRect = area.getBoundingClientRect();
                                const canvasRect = src.getBoundingClientRect();
                                const s = canvasScaleRef.current || 1;
                                const centerX = areaRect.left + areaRect.width / 2;
                                const centerY = areaRect.top + areaRect.height / 2;
                                const curX = canvasRect.left + s * wx;
                                const curY = canvasRect.top + s * wy;
                                const dx = centerX - curX;
                                const dy = centerY - curY;
                                setCanvasOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
                                e.preventDefault();
                                e.stopPropagation();
                            }}>
                                <canvas ref={navCanvasRef} width={210} height={118} />
                                <div className="canvas-navigator-label">{Math.round(canvasScale * 100)}%</div>
                            </div>
                        )}
                        {selection && (
                            <div className="selection-actions">
                                <button className="button button-primary" onClick={commitSelection} style={{ height: 30, padding: '0 10px' }}>완료</button>
                                <button className="button" onClick={copySelectionToClipboard} style={{ height: 30, padding: '0 10px' }} title="선택 영역 복사 (Ctrl+C)">복사</button>
                                <button className="button" onClick={pasteSelectionFromClipboard} style={{ height: 30, padding: '0 10px', opacity: selectionClipboard?.bitmapId ? 1 : 0.4 }} disabled={!selectionClipboard?.bitmapId} title="붙여넣기 (Ctrl+V)">붙여넣기</button>
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
                                <div className="text-editor-row" style={{ marginTop: 8, gap: 10 }}>
                                    <label className="text-editor-label" style={{ minWidth: 18 }}>In</label>
                                    <select
                                        className="text-editor-font"
                                        value={textEdit.animIn?.type ?? 'none'}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, animIn: { ...(te.animIn ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR }), type: e.target.value } }) : te)}
                                        title="텍스트 In 효과"
                                    >
                                        {CUT_ANIM_IN_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                    <input
                                        type="number"
                                        step="0.05"
                                        min="0"
                                        max="5"
                                        value={textEdit.animIn?.dur ?? DEFAULT_CUT_ANIM_DUR}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, animIn: { ...(te.animIn ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR }), dur: clamp(+e.target.value || 0, 0, 5) } }) : te)}
                                        className="text-editor-num"
                                        title="In duration (s)"
                                    />
                                    <label className="text-editor-label" style={{ minWidth: 24 }}>Out</label>
                                    <select
                                        className="text-editor-font"
                                        value={textEdit.animOut?.type ?? 'none'}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, animOut: { ...(te.animOut ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR }), type: e.target.value } }) : te)}
                                        title="텍스트 Out 효과"
                                    >
                                        {CUT_ANIM_OUT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                    <input
                                        type="number"
                                        step="0.05"
                                        min="0"
                                        max="5"
                                        value={textEdit.animOut?.dur ?? DEFAULT_CUT_ANIM_DUR}
                                        onChange={e => setTextEdit(te => te ? ({ ...te, animOut: { ...(te.animOut ?? { type: 'none', dur: DEFAULT_CUT_ANIM_DUR }), dur: clamp(+e.target.value || 0, 0, 5) } }) : te)}
                                        className="text-editor-num"
                                        title="Out duration (s)"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {showRight && (
                    <div
                        className="splitter-v"
                        onPointerDown={e => {
                            e.preventDefault();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            setSplitter({ kind: 'right', pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startLeftW: leftW, startRightW: rightW, startTimelineH: timelineH });
                        }}
                    />
                )}

                {showRight && (
                    <div className="right-panel" style={{ width: rightW, flexShrink: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span className="panel-title">CUT / LAYER</span>
                            <button className="icon-btn" onClick={() => setShowRight(false)}><ChevronRight size={14} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: '#777' }}>Selected: {selectedCutIds.size}</span>
                            <button className="small-btn" onClick={() => handleCopyCuts(Array.from(selectedCutIds))} disabled={selectedCutIds.size === 0} title="선택한 컷 복사"><Copy size={11} /> Copy</button>
                            <button className="small-btn" onClick={handleDeleteSelectedCuts} disabled={selectedCutIds.size === 0} title="선택한 컷 삭제"><Trash2 size={11} /> Delete</button>
                            <button className="small-btn" onClick={() => setCutListGroupByTrack(v => !v)} title="트랙별 그룹/해제">
                                {cutListGroupByTrack ? 'Track' : 'Flat'}
                            </button>
                            <button className="small-btn" onClick={() => setCollapsedCutIds(new Set(cuts.map(c => c.id)))} title="컷 전체 접기">접기</button>
                            <button className="small-btn" onClick={() => setCollapsedCutIds(new Set())} title="컷 전체 펼치기">펼치기</button>
                        </div>
                        <div className="cut-list">
                            {cutListGroupByTrack ? (
                                Array.from({ length: Math.max(1, numTracks) }).map((_, ti) => {
                                    const items = cuts.filter(c => (c.track || 0) === ti).sort((a, b) => (a.startTime - b.startTime) || (a.id - b.id));
                                    if (items.length === 0) return null;
                                    const collapsed = collapsedTrackIds.has(ti);
                                    return (
                                        <div key={`trk-${ti}`} className="cut-track-group">
                                            <div
                                                className="cut-track-header"
                                                onClick={() => setCollapsedTrackIds(prev => {
                                                    const s = new Set(prev);
                                                    s.has(ti) ? s.delete(ti) : s.add(ti);
                                                    return s;
                                                })}
                                            >
                                                <span style={{ fontWeight: 900 }}>Track {ti}</span>
                                                <span style={{ marginLeft: 6, color: '#666' }}>{items.length}</span>
                                                <div style={{ flex: 1 }} />
                                                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                            </div>
                                            {!collapsed && items.map(renderCutRow)}
                                        </div>
                                    );
                                })
                            ) : (
                                cuts.map(renderCutRow)
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                            <button className="button" style={{ flex: 1 }} onClick={handleAddCut}><Plus size={14} /> Add Cut</button>
                            <button
                                className="button"
                                style={{ flex: 1, opacity: (copiedCuts?.cuts?.length ? 1 : 0.4) }}
                                onClick={handlePasteCut}
                                disabled={!copiedCuts?.cuts?.length}
                                title="컷 붙여넣기 (Ctrl+V)"
                            >
                                <ClipboardPaste size={14} /> Paste{copiedCuts?.cuts?.length ? ` (${copiedCuts.cuts.length})` : ''}
                            </button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                            <span style={{ fontSize: 11, color: '#888', fontWeight: 800, letterSpacing: 0.2 }}>기본 길이</span>
                            <input
                                type="number"
                                step="0.05"
                                min="0.05"
                                max="3600"
                                className="time-input"
                                style={{ width: 86 }}
                                value={defaultCutDuration}
                                onChange={e => setDefaultCutDuration(clamp(parseFloat(e.target.value) || DEFAULT_CUT_DURATION, 0.05, 3600))}
                                title="새 Cut 기본 길이 (초)"
                            />
                            <span style={{ fontSize: 11, color: '#666' }}>sec</span>
                        </div>
                    </div>
                )}
                {!showRight && <button onClick={() => setShowRight(true)} className="icon-btn" style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: '#1e1e2e', border: 'none', borderLeft: '1px solid #333' }}><ChevronRight size={14} /></button>}
            </div>

            {showBottom && (
                <div
                    className="splitter-h"
                    onPointerDown={e => {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setSplitter({ kind: 'bottom', pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startLeftW: leftW, startRightW: rightW, startTimelineH: timelineH });
                    }}
                />
            )}

            <div className="timeline" style={{ height: showBottom ? timelineH : 44, flexShrink: 0 }}>
                <div className="tl-controls">
                    <button className="icon-btn" onClick={() => setShowBottom(v => !v)}>{showBottom ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
                    {showBottom && <>
                        <div className="time-display">{fmt(currentTime)}</div>
                        <button className="button button-primary" onClick={handlePlayPause}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
                        <button className="button" onClick={handleStop}><Square size={16} /></button>
                        <button className={loopPlayback ? 'button button-primary' : 'button'} onClick={() => setLoopPlayback(v => !v)} title="반복 재생">
                            <Repeat size={16} /> Loop
                        </button>
                        <span style={{ fontSize: 11, color: '#666', marginLeft: 16 }}>End: {fmt(playEndTime)}</span>
                    </>}
                </div>
                {showBottom && (
                    <div
                        className="tl-tracks"
                        ref={timelineRef}
                        onClick={handleTimelineClick}
                        onPointerDownCapture={handleTimelinePointerDownCapture}
                        onPointerMoveCapture={handleTimelinePointerMoveCapture}
                        onPointerUpCapture={handleTimelinePointerUpCapture}
                        onPointerCancelCapture={handleTimelinePointerUpCapture}
                        style={{ position: 'relative', touchAction: 'none' }}
                    >
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
                                            const newCut = { id: Date.now(), name: `Cut ${cuts.length + 1}`, startTime: gapStart, endTime: gapEnd, track: ti, layers: [mkLayer(1)], activeLayerId: 1, texts: [] };
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
                                                    style={{ left: `${cut.startTime * pps + 60}px`, width: `${(cut.endTime - cut.startTime) * pps}px`, cursor: draggingCutData?.cutId === cut.id ? 'grabbing' : 'grab' }}
                                                    onClick={e => { if (timelineInputBlocked()) { e.preventDefault(); e.stopPropagation(); return; } e.stopPropagation(); setSingleCutSelection(cut.id); }}
                                                    onPointerDown={e => {
                                                        if (timelineInputBlocked()) { e.preventDefault(); e.stopPropagation(); return; }
                                                        // Prevent mobile tap highlight / click-through focus behavior.
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        const curSel = selectedCutIdsRef.current;
                                                        const groupIds = (curSel && curSel.has(cut.id)) ? Array.from(curSel) : [cut.id];
                                                        if (!curSel || !curSel.has(cut.id)) setSelectedCutIds(new Set([cut.id]));
                                                        setCurrentCutId(cut.id);
                                                        e.currentTarget.setPointerCapture(e.pointerId);
                                                        const initials = groupIds.map(id => {
                                                            const c0 = cuts.find(cc => cc.id === id);
                                                            return c0 ? ({ id, startTime: c0.startTime, endTime: c0.endTime, track: c0.track }) : ({ id, startTime: 0, endTime: 0, track: 0 });
                                                        });
                                                        setPendingTimelineOp({ kind: 'drag', cutId: cut.id, cutIds: groupIds, initials, startX: e.clientX, startY: e.clientY, initialStart: cut.startTime, initialTrack: cut.track, pointerType: e.pointerType, t0: performance.now() });
                                                    }}>
                                                <div className="rh rh-left" onPointerDown={e => { if (timelineInputBlocked()) { e.preventDefault(); e.stopPropagation(); return; } e.preventDefault(); e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setPendingTimelineOp({ kind: 'resize', cutId: cut.id, edge: 'left', startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, t0: performance.now() }); }} />
                                                    {cut.name}
                                                <div className="rh rh-right" onPointerDown={e => { if (timelineInputBlocked()) { e.preventDefault(); e.stopPropagation(); return; } e.preventDefault(); e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setPendingTimelineOp({ kind: 'resize', cutId: cut.id, edge: 'right', startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, t0: performance.now() }); }} />
                                                </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {audioFile && audioData && (
                                <div className="tl-track" style={{ background: '#161628' }}>
                                    <div className="tl-track-label" style={{ background: '#161628' }}><span>Audio</span></div>
                                    <div className="cut-block" style={{ left: `${audioData.startTime * pps + 60}px`, width: `${(audioData.endTime - audioData.startTime) * pps}px`, background: '#374151', borderColor: '#4b5563', cursor: draggingCutData?.cutId === 'audio' ? 'grabbing' : 'grab' }}
                                        onPointerDown={e => { if (timelineInputBlocked()) { e.preventDefault(); e.stopPropagation(); return; } e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setPendingTimelineOp({ kind: 'drag', cutId: 'audio', startX: e.clientX, startY: e.clientY, initialStart: audioData.startTime, initialTrack: 0, pointerType: e.pointerType, t0: performance.now() }); }}>
                                        <div className="rh rh-left" onPointerDown={e => { if (timelineInputBlocked()) { e.preventDefault(); e.stopPropagation(); return; } e.preventDefault(); e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setPendingTimelineOp({ kind: 'resize', cutId: 'audio', edge: 'left', startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, t0: performance.now() }); }} />
                                        🎵 Audio
                                        <div className="rh rh-right" onPointerDown={e => { if (timelineInputBlocked()) { e.preventDefault(); e.stopPropagation(); return; } e.preventDefault(); e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setPendingTimelineOp({ kind: 'resize', cutId: 'audio', edge: 'right', startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, t0: performance.now() }); }} />
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

            {colorPicker && (
                <div
                    className="color-picker-overlay"
                    onPointerDown={e => {
                        // Click outside to cancel (standard modal behavior).
                        if (e.target === e.currentTarget) cancelCustomColorPicker();
                    }}
                >
                    <div className="color-picker-modal" onPointerDown={e => { e.stopPropagation(); }}>
                        <div className="color-picker-header">
                            <div className="color-picker-title">맞춤 색상</div>
                            <button className="icon-btn color-picker-close" onClick={cancelCustomColorPicker} title="닫기">×</button>
                        </div>
                        <div className="color-picker-body">
                            <canvas
                                ref={svCanvasRef}
                                className="color-picker-sv"
                                width={240}
                                height={240}
                                onPointerDown={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    svDragPointerIdRef.current = e.pointerId;
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                    updateSvFromClient(e.clientX, e.clientY);
                                }}
                                onPointerMove={e => {
                                    if (svDragPointerIdRef.current !== e.pointerId) return;
                                    e.preventDefault();
                                    updateSvFromClient(e.clientX, e.clientY);
                                }}
                                onPointerUp={e => {
                                    if (svDragPointerIdRef.current === e.pointerId) svDragPointerIdRef.current = null;
                                }}
                                onPointerCancel={e => {
                                    if (svDragPointerIdRef.current === e.pointerId) svDragPointerIdRef.current = null;
                                }}
                            />

                            <div className="color-picker-side">
                                <div className="color-picker-preview-row">
                                    <div className="color-picker-preview" style={{ background: colorPicker.hex }} />
                                    <input
                                        className="color-picker-hex"
                                        value={colorPicker.hex}
                                        onChange={e => {
                                            const raw = String(e.target.value || '').trim();
                                            let hexStr = raw;
                                            if (!hexStr.startsWith('#')) hexStr = `#${hexStr.replace(/^#+/, '')}`;
                                            if (hexStr.length > 7) hexStr = hexStr.slice(0, 7);
                                            setColorPicker(cp => {
                                                if (!cp) return cp;
                                                if (/^#[0-9a-fA-F]{6}$/.test(hexStr)) {
                                                    const rgb = hexToRgb(hexStr);
                                                    const hsv = rgbToHsv(rgb);
                                                    return { ...cp, hex: rgbToHex(rgb), h: hsv.h, s: hsv.s, v: hsv.v };
                                                }
                                                return { ...cp, hex: hexStr };
                                            });
                                        }}
                                        inputMode="text"
                                        spellCheck={false}
                                        placeholder="#RRGGBB"
                                    />
                                </div>

                                <div className="color-picker-row">
                                    <div className="color-picker-row-label">Hue</div>
                                    <input
                                        className="color-picker-hue"
                                        type="range"
                                        min="0"
                                        max="360"
                                        value={Math.round(colorPicker.h)}
                                        onChange={e => setColorPickerFromHsv({ h: +e.target.value })}
                                    />
                                </div>

                                <div className="color-picker-actions">
                                    <button className="button button-primary" onClick={commitCustomColorPicker} disabled={!isColorPickerHexValid}>적용</button>
                                    <button className="button" onClick={cancelCustomColorPicker}>취소</button>
                                </div>
                                <div className="color-picker-hint">SV 영역 드래그, Hue 슬라이더, 또는 Hex 입력으로 설정합니다. (Ctrl+Enter 적용, Esc 취소)</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
