// Pure helpers extracted from App.jsx: constants, geometry, colour, canvas drawing,
// layer flattening, and animation math. Kept free of React/component state so App.jsx
// stays smaller (cheaper to read/edit) and these stay unit-testable.

export const DEFAULT_CUT_DURATION = 1;
export const CANVAS_W = 854, CANVAS_H = 480;
export const FONT_PRESETS = [
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

export function pointInPolygon(point, vs) {
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

export function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

export function safeArray(v) {
    return Array.isArray(v) ? v : [];
}

export function hexToRgb(hex) {
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

export function bucketFillTransparentRegion(baseImageData, startX, startY, fillRgb, fillAlpha) {
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

// Cache canvases are keyed per (cut, layer) because layer ids are NOT unique
// across cuts (each cut starts numbering at 1). Keying by layer id alone caused
// cross-cut collisions and an infinite cache-rebuild loop.
export const layerKey = (cutId, layerId) => `${cutId}:${layerId}`;

export function imageDataToDataURL(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width;
    c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    return c.toDataURL('image/png');
}

export function dataURLToImageData(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, c.width, c.height));
        };
        img.onerror = reject;
        img.src = url;
    });
}

export function drawStrokesOnCtx(ctx, strokes, clear = true, bitmapStore = null) {
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
        if (!s.points?.length) return;
        // Dot pen: hard square stamps (pixel-art look), no anti-aliased round stroke.
        if (s.tool === 'pen') {
            const size = Math.max(1, Math.round(s.size));
            const half = size / 2;
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = s.opacity ?? 1;
            ctx.fillStyle = s.color;
            const stamp = (x, y) => ctx.fillRect(Math.round(x - half), Math.round(y - half), size, size);
            if (s.points.length === 1) {
                stamp(s.points[0].x, s.points[0].y);
            } else {
                for (let i = 1; i < s.points.length; i++) {
                    const a = s.points[i - 1], b = s.points[i];
                    const d = Math.hypot(b.x - a.x, b.y - a.y);
                    const steps = Math.max(1, Math.ceil(d / Math.max(1, size / 2)));
                    for (let t = 0; t <= steps; t++) {
                        stamp(a.x + (b.x - a.x) * t / steps, a.y + (b.y - a.y) * t / steps);
                    }
                }
            }
            ctx.globalAlpha = 1.0;
            return;
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const hasPressure = s.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);
        const baseColor = s.color;
        const baseOpacity = s.opacity ?? 1;
        // Marker: draw the whole stroke opaque on a temp canvas, then composite once.
        // Compositing per-segment with a translucent multiply darkens every overlap,
        // which showed up as black dots at the joints under pressure rendering.
        if (s.tool === 'marker') {
            const tmp = document.createElement('canvas');
            tmp.width = ctx.canvas.width; tmp.height = ctx.canvas.height;
            const tctx = tmp.getContext('2d');
            tctx.lineCap = 'round'; tctx.lineJoin = 'round'; tctx.strokeStyle = baseColor;
            if (hasPressure && s.points.length > 1) {
                for (let i = 1; i < s.points.length; i++) {
                    const p1 = s.points[i - 1], p2 = s.points[i];
                    const pr = ((p1.pressure ?? 0.5) + (p2.pressure ?? 0.5)) / 2;
                    tctx.lineWidth = Math.max(0.3, s.size * pr * 2);
                    tctx.beginPath(); tctx.moveTo(p1.x, p1.y); tctx.lineTo(p2.x, p2.y); tctx.stroke();
                }
            } else {
                tctx.lineWidth = Math.max(0.3, s.size);
                tctx.beginPath();
                s.points.forEach((p, i) => i === 0 ? tctx.moveTo(p.x, p.y) : tctx.lineTo(p.x, p.y));
                tctx.stroke();
            }
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = baseOpacity * 0.6;
            ctx.drawImage(tmp, 0, 0);
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1.0;
            return;
        }
        const setStyle = (width) => {
            if (s.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.globalAlpha = 1.0;
            } else if (s.tool === 'marker') {
                ctx.globalCompositeOperation = 'multiply'; ctx.strokeStyle = baseColor; ctx.globalAlpha = baseOpacity * 0.6;
            } else if (s.tool === 'calligraphy') {
                ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = baseColor; ctx.globalAlpha = baseOpacity;
                width *= 3;
            } else {
                ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = baseColor; ctx.globalAlpha = baseOpacity;
            }
            ctx.lineWidth = Math.max(0.3, width);
        };
        if (hasPressure && s.points.length > 1) {
            for (let i = 1; i < s.points.length; i++) {
                const p1 = s.points[i - 1], p2 = s.points[i];
                const pr = ((p1.pressure ?? 0.5) + (p2.pressure ?? 0.5)) / 2;
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                setStyle(s.size * pr * 2);
                ctx.stroke();
            }
        } else {
            ctx.beginPath();
            s.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            const avgPressure = s.points.reduce((sum, p) => sum + (p.pressure ?? 0.5), 0) / s.points.length;
            setStyle(s.size * (hasPressure ? avgPressure * 2 : 1));
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1.0;
    });
}

export function flattenForCanvas(layers) {
    return layers.filter(l => l.type !== 'folder' && l.visible !== false);
}

export const ANIM_DEFAULT = { inType: 'none', inDur: 0.4, inDir: 'left', outType: 'none', outDur: 0.4, outDir: 'right', deformAxis: 'x', deformAmount: 0, deformReturn: false, deformSpeed: 1, deformCount: 0, moveX: 0, moveY: 0, moveReturn: false, moveSpeed: 1, moveCount: 0, ease: 'linear', easePower: 2 };

// Per-cut animation state at a given absolute time. Returns null when the cut is
// at rest (no transform), so callers can skip the save/transform fast-path.
export function computeCutAnim(ac, time) {
    const a = ac.anim;
    if (!a) return null;
    const dur = Math.max(0.0001, ac.endTime - ac.startTime);
    const lt = time - ac.startTime;
    let alpha = 1, sx = 1, sy = 1, tx = 0, ty = 0;
    // Slide travels a full canvas dimension so the cut clearly enters from off-screen.
    const dirOff = (dir, frac) => dir === 'left' ? [-CANVAS_W * frac, 0] : dir === 'right' ? [CANVAS_W * frac, 0] : dir === 'up' ? [0, -CANVAS_H * frac] : [0, CANVAS_H * frac];
    if (a.inType && a.inType !== 'none' && a.inDur > 0 && lt < a.inDur) {
        const p = applyEase(lt / a.inDur, a.ease, a.easePower);
        if (a.inType === 'fade') alpha *= p;
        else if (a.inType === 'scale') { alpha *= p; const s = 0.5 + 0.5 * p; sx *= s; sy *= s; }
        else if (a.inType === 'slide') { const [dx, dy] = dirOff(a.inDir, (1 - p)); tx += dx; ty += dy; }
    }
    if (a.outType && a.outType !== 'none' && a.outDur > 0 && lt > dur - a.outDur) {
        const p = 1 - applyEase((lt - (dur - a.outDur)) / a.outDur, a.ease, a.easePower);
        if (a.outType === 'fade') alpha *= p;
        else if (a.outType === 'scale') { alpha *= p; const s = 0.5 + 0.5 * p; sx *= s; sy *= s; }
        else if (a.outType === 'slide') { const [dx, dy] = dirOff(a.outDir, (1 - p)); tx += dx; ty += dy; }
    }
    if (a.deformAmount) {
        const t = Math.max(0, Math.min(1, lt / dur));
        // 왕복(return): oscillate back to original; speed = cycles over the cut, count caps cycles.
        let prog;
        if (a.deformReturn) { const cyc = (a.deformSpeed || 1) * t; prog = (a.deformCount > 0 && cyc >= a.deformCount) ? 0 : Math.sin(2 * Math.PI * cyc); }
        else prog = applyEase(t, a.ease, a.easePower);
        const f = 1 + a.deformAmount * prog;
        if (a.deformAxis === 'x') sx *= f; else sy *= f;
    }
    if (a.moveX || a.moveY) {
        // Whole-cut movement across its lifetime. One-way ramps to the target; 왕복 goes
        // out and back (0→1→0) at `speed` cycles, capped by `count`.
        const t = Math.max(0, Math.min(1, lt / dur));
        let prog;
        if (a.moveReturn) { const cyc = (a.moveSpeed || 1) * t; prog = (a.moveCount > 0 && cyc >= a.moveCount) ? 0 : (1 - Math.cos(2 * Math.PI * cyc)) / 2; }
        else prog = applyEase(t, a.ease, a.easePower);
        tx += (a.moveX || 0) * prog; ty += (a.moveY || 0) * prog;
    }
    if (alpha === 1 && sx === 1 && sy === 1 && tx === 0 && ty === 0) return null;
    return { alpha: Math.max(0, alpha), sx, sy, tx, ty };
}

export const LAYER_ANIM_DEFAULT = { mode: 'progress', speed: 1, count: 0, tx: 0, ty: 0, rot: 0, scale: 0, pivotX: 0.5, pivotY: 0.5, path: null, ease: 'linear', easePower: 2 };

// Easing applied to a 0..1 progress. type: linear | in (slow→fast) | out (fast→slow)
// | inout. power (>=1) is the user-adjustable strength/weight.
export function applyEase(t, type, power = 2) {
    t = Math.max(0, Math.min(1, t));
    if (!type || type === 'linear') return t;
    const p = Math.max(1, power || 1);
    if (type === 'in') return Math.pow(t, p);
    if (type === 'out') return 1 - Math.pow(1 - t, p);
    if (type === 'inout') return t < 0.5 ? Math.pow(2 * t, p) / 2 : 1 - Math.pow(2 * (1 - t), p) / 2;
    return t;
}

// Triangle wave 0->1->0 (period 2); used for ping-pong path following.
export function triwave(x) { const m = ((x % 2) + 2) % 2; return m < 1 ? m : 2 - m; }
// Sample a polyline path at normalized position s in [0,1].
export function samplePath(path, s) {
    const n = path.length;
    if (n === 1) return path[0];
    const idx = Math.max(0, Math.min(1, s)) * (n - 1);
    const i = Math.floor(idx), f = idx - i;
    if (i >= n - 1) return path[n - 1];
    return { x: path[i].x + (path[i + 1].x - path[i].x) * f, y: path[i].y + (path[i + 1].y - path[i].y) * f };
}

// Per-layer ("part") transform animated across the cut's local time. Enables cutout /
// puppet-style motion: move/rotate/scale a part, optionally along a drawn path, with
// one-way or ping-pong(왕복) playback at a given speed and (optional) repeat count.
export function computeLayerAnim(layer, ac, time) {
    const a = layer.anim;
    if (!a) return null;
    const dur = Math.max(0.0001, ac.endTime - ac.startTime);
    const t = Math.max(0, Math.min(1, (time - ac.startTime) / dur));
    const speed = a.speed || 1, count = a.count || 0;
    let prog;
    if (a.mode === 'return') { const cyc = speed * t; prog = (count > 0 && cyc >= count) ? 0 : Math.sin(2 * Math.PI * cyc); }
    else prog = applyEase(t, a.ease, a.easePower);
    let tx = (a.tx || 0) * prog, ty = (a.ty || 0) * prog;
    const rot = (a.rot || 0) * prog * Math.PI / 180;
    const sc = 1 + (a.scale || 0) * prog;
    if (a.path && a.path.length > 1) {
        let s;
        if (a.mode === 'return') { let x = 2 * speed * t; if (count > 0 && x >= 2 * count) x = 0; s = triwave(x); }
        else s = applyEase(t, a.ease, a.easePower);
        const p0 = a.path[0], pt = samplePath(a.path, s);
        tx += pt.x - p0.x; ty += pt.y - p0.y;
    }
    if (tx === 0 && ty === 0 && rot === 0 && sc === 1) return null;
    return { tx, ty, rot, sc, px: (a.pivotX ?? 0.5) * CANVAS_W, py: (a.pivotY ?? 0.5) * CANVAS_H };
}

export function flattenLayersInUiOrder(layers, parentId = null, out = []) {
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
