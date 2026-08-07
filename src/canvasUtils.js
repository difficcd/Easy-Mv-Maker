// Pure helpers extracted from App.jsx: constants, geometry, colour, canvas drawing,
// layer flattening, and animation math. Kept free of React/component state so App.jsx
// stays smaller (cheaper to read/edit) and these stay unit-testable.

// --- Shape (distance-field) morphing for tweening ---
// Felzenszwalb 1D squared Euclidean distance transform (f: 0 at seeds, INF elsewhere).
function edt1d(f, n) {
    const INF = 1e20;
    const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dd = q - v[k]; d[q] = dd * dd + f[v[k]]; }
    return d;
}
function edt2d(seed, w, h) {
    const INF = 1e20;
    const grid = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) grid[i] = seed[i] ? 0 : INF;
    const col = new Float64Array(h);
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) col[y] = grid[y * w + x]; const d = edt1d(col, h); for (let y = 0; y < h; y++) grid[y * w + x] = d[y]; }
    const row = new Float64Array(w);
    for (let y = 0; y < h; y++) { const off = y * w; for (let x = 0; x < w; x++) row[x] = grid[off + x]; const d = edt1d(row, w); for (let x = 0; x < w; x++) grid[off + x] = Math.sqrt(d[x]); }
    return grid; // Euclidean distance to nearest seed
}
function signedDist(mask, w, h) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
    const dOut = edt2d(mask, w, h);  // 0 inside, >0 outside
    const dIn = edt2d(inv, w, h);    // 0 outside, >0 inside
    const s = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) s[i] = dOut[i] - dIn[i]; // <0 inside shape
    return s;
}

// Morph the whole pixel distribution of A into B at t (0..1) via signed-distance-field
// interpolation: the shape itself moves/grows between frames (not an A/B crossfade).
// Filled with the A->B average ink colour; soft 1px edge.
export function morphFrames(aImg, bImg, t) {
    const w = aImg.width, h = aImg.height, N = w * h;
    const A = aImg.data, B = bImg.data;
    const mA = new Uint8Array(N), mB = new Uint8Array(N);
    let ar = 0, ag = 0, ab = 0, an = 0, br = 0, bg = 0, bb = 0, bn = 0;
    for (let i = 0; i < N; i++) {
        const o = i * 4;
        if (A[o + 3] > 16) { mA[i] = 1; ar += A[o]; ag += A[o + 1]; ab += A[o + 2]; an++; }
        if (B[o + 3] > 16) { mB[i] = 1; br += B[o]; bg += B[o + 1]; bb += B[o + 2]; bn++; }
    }
    const sA = signedDist(mA, w, h), sB = signedDist(mB, w, h);
    const cr = an ? ar / an : 0, cg = an ? ag / an : 0, cb = an ? ab / an : 0;
    const dr = bn ? br / bn : cr, dg = bn ? bg / bn : cg, db = bn ? bb / bn : cb;
    const R = Math.round(cr + (dr - cr) * t), G = Math.round(cg + (dg - cg) * t), Bl = Math.round(cb + (db - cb) * t);
    const out = new ImageData(w, h), O = out.data;
    for (let i = 0; i < N; i++) {
        const s = (1 - t) * sA[i] + t * sB[i];
        if (s < 1) {
            const o = i * 4;
            O[o] = R; O[o + 1] = G; O[o + 2] = Bl;
            O[o + 3] = s <= 0 ? 255 : Math.round((1 - s) * 255);
        }
    }
    return out;
}

export const DEFAULT_CUT_DURATION = 1;
export const CANVAS_W = 1920, CANVAS_H = 1080;
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

// Remove hand/sampling jitter before drawing: weighted moving average over position and
// pressure, keeping the endpoints fixed. Without this the curve wobbles unnaturally.
const _lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: (a.pressure ?? 0.5) + ((b.pressure ?? 0.5) - (a.pressure ?? 0.5)) * t });
// Resample a polyline to ~uniform arc-length spacing so clustered/sparse samples smooth evenly.
function resamplePts(pts, spacing) {
    if (pts.length < 2) return pts.slice();
    const out = [pts[0]]; let acc = 0, a = pts[0];
    for (let i = 1; i < pts.length; i++) {
        let b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
        while (seg > 0 && acc + seg >= spacing) {
            const t = (spacing - acc) / seg, np = _lerpPt(a, b, t);
            out.push(np); a = np; seg = Math.hypot(b.x - a.x, b.y - a.y); acc = 0;
        }
        acc += seg; a = b;
    }
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - out[out.length - 1].x, last.y - out[out.length - 1].y) > 0.4) out.push(last);
    return out;
}
// Chaikin corner-cutting: replaces each corner with two points at 1/4 and 3/4, rounding the
// polyline. A couple of iterations turn a shaky hand path into a smooth curve.
function chaikin(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; out.push(_lerpPt(a, b, 0.25), _lerpPt(a, b, 0.75)); }
    out.push(pts[pts.length - 1]);
    return out;
}
// Smooth a raw hand stroke: resample to uniform spacing, then round corners with Chaikin. The
// caller renders the result as a Catmull-Rom spline, so the final curve is genuinely smooth.
function smoothPoints(pts, passes) {
    if (!pts || pts.length < 3) return pts || [];
    let cur = resamplePts(pts, 2);
    if (cur.length < 3) cur = pts.slice();
    const iters = passes != null ? passes : 3; // one more corner-cut pass = smoother
    for (let k = 0; k < iters; k++) cur = chaikin(cur);
    return cur;
}

// 선 자글자글 효과: 매끄러운 경로를 법선 방향으로 흔들어 손그림 같은 떨림을 줌.
// seed로 결정론적(리페인트마다 동일) — timeSeed를 더하면 재생 중 프레임마다 boil.
function roughenPoints(pts, amp = 2.2, seed = 0) {
    const n = pts && pts.length;
    if (!n || n < 3) return pts || [];
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const freq = 0.14; // 파형 밀도
    const phase = rnd() * Math.PI * 2;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let nx = -(b.y - a.y), ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
        // 두 옥타브 사인 + 약간의 난수 → 자연스러운 자글거림, 양 끝은 0으로 수렴.
        const taper = Math.min(1, Math.min(i, n - 1 - i) / 6);
        const w = (Math.sin(i * freq + phase) + 0.5 * Math.sin(i * freq * 2.7 + phase * 1.7) + (rnd() - 0.5) * 0.6) * amp * taper;
        out[i] = { x: pts[i].x + nx * w, y: pts[i].y + ny * w, pressure: pts[i].pressure };
    }
    return out;
}

// Catmull-Rom control points for the segment p1->p2 (converted to a cubic Bezier). The
// curve passes exactly through every sample and stays smooth across segment joins, which
// quadratic-through-midpoints does not (it flattens when samples are far apart).
function crControls(p0, p1, p2, p3, tension = 1) {
    const k = tension / 6;
    return [
        { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k },
        { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k },
    ];
}

// Draw the stroke as a Catmull-Rom spline. Uniform width renders as one continuous path
// (no seams); variable width renders per segment with already-smoothed widths.
function smoothStroke(ctx, pts, widths, applyStyle) {
    const n = pts.length;
    if (!n) return;
    if (n === 1) {
        applyStyle(0);
        ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, Math.max(0.3, widths[0] / 2), 0, Math.PI * 2); ctx.fill();
        return;
    }
    if (n === 2) {
        applyStyle(1);
        ctx.lineWidth = Math.max(0.3, widths[1]);
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
        return;
    }
    const at = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    let uniform = true;
    for (let i = 2; i < n; i++) if (Math.abs(widths[i] - widths[1]) > 0.2) { uniform = false; break; }
    if (uniform) {
        applyStyle(1);
        ctx.lineWidth = Math.max(0.3, widths[1]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 0; i < n - 1; i++) {
            const [c1, c2] = crControls(at(i - 1), at(i), at(i + 1), at(i + 2));
            ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, at(i + 1).x, at(i + 1).y);
        }
        ctx.stroke();
        return;
    }
    for (let i = 0; i < n - 1; i++) {
        const [c1, c2] = crControls(at(i - 1), at(i), at(i + 1), at(i + 2));
        applyStyle(i + 1);
        ctx.lineWidth = Math.max(0.3, widths[i + 1]);
        ctx.beginPath();
        ctx.moveTo(at(i).x, at(i).y);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, at(i + 1).x, at(i + 1).y);
        ctx.stroke();
    }
}
const pressureAt = (pts, i) => ((pts[i - 1]?.pressure ?? 0.5) + (pts[i]?.pressure ?? 0.5)) / 2;
// Thin the first/last few segments so strokes taper instead of ending bluntly.
const taperAt = (i, n) => { const t = Math.min(6, Math.max(2, Math.floor(n / 4))); return Math.min(1, i / t, (n - i) / t) * 0.75 + 0.25; };

// Deterministic alpha-noise tile — punched into a pencil stroke (destination-in) to fake the
// grain of paper tooth. Deterministic so a redraw of the same stroke looks identical.
let _grainTile = null;
function grainTile() {
    if (_grainTile) return _grainTile;
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    let seed = 0x1a2b3c;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < img.data.length; i += 4) {
        // mostly-opaque speckle: keeps the stroke but bites small light gaps into it
        const a = rnd() < 0.72 ? 255 : 90 + (rnd() * 110 | 0);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; img.data[i + 3] = a;
    }
    g.putImageData(img, 0, 0);
    _grainTile = c; return c;
}
// Reusable soft radial stamp in a given rgb, for the airbrush spray.
function softStamp(r, g, b, radius) {
    const s = Math.max(2, Math.ceil(radius * 2)), c = document.createElement('canvas'); c.width = c.height = s;
    const cx = c.getContext('2d'), grd = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, `rgba(${r},${g},${b},0.16)`);
    grd.addColorStop(0.5, `rgba(${r},${g},${b},0.06)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    cx.fillStyle = grd; cx.fillRect(0, 0, s, s);
    return c;
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
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // crisp video-frame scaling
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
            tctx.lineCap = 'round'; tctx.lineJoin = 'round'; tctx.strokeStyle = baseColor; tctx.fillStyle = baseColor;
            const mp = smoothPoints(s.points);
            const mw = mp.map((_, i) => hasPressure && mp.length > 1 ? s.size * pressureAt(mp, Math.max(1, i)) * 2 : s.size);
            smoothStroke(tctx, mp, mw, () => { });
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = baseOpacity * 0.6;
            ctx.drawImage(tmp, 0, 0);
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1.0;
            return;
        }
        // Pencil: a smooth core stroke with paper-grain bitten out of it (destination-in), so it
        // reads as a textured graphite line rather than a flat vector stroke. Pressure = darkness.
        if (s.tool === 'pencil') {
            const tmp = document.createElement('canvas'); tmp.width = ctx.canvas.width; tmp.height = ctx.canvas.height;
            const tctx = tmp.getContext('2d');
            tctx.lineCap = 'round'; tctx.lineJoin = 'round'; tctx.strokeStyle = baseColor; tctx.fillStyle = baseColor;
            const pp = smoothPoints(s.points), pn = pp.length;
            const pw = pp.map((_, idx) => { const i = Math.max(1, idx); const pr = hasPressure && pn > 1 ? pressureAt(pp, i) : 0.5; return s.size * (0.65 + 0.35 * Math.min(1, pr * 2)); });
            smoothStroke(tctx, pp, pw, (i) => { const pr = hasPressure && pn > 1 ? pressureAt(pp, Math.max(1, i)) : 0.5; tctx.globalAlpha = 0.5 + 0.5 * Math.min(1, pr * 2); });
            tctx.globalAlpha = 1; tctx.globalCompositeOperation = 'destination-in';
            const pat = tctx.createPattern(grainTile(), 'repeat'); if (pat) { tctx.fillStyle = pat; tctx.fillRect(0, 0, tmp.width, tmp.height); }
            tctx.globalCompositeOperation = 'source-over';
            ctx.save(); ctx.globalAlpha = baseOpacity * 0.9; ctx.drawImage(tmp, 0, 0); ctx.restore();
            ctx.globalAlpha = 1;
            return;
        }
        // Airbrush: a real soft spray — dense radial stamps along the path that build up density on
        // overlap and feather at the edges (instead of a plain blurred line).
        if (s.tool === 'soft') {
            const isErase = false; // airbrush erase falls through to the default eraser elsewhere
            const { r, g, b } = hexToRgb(baseColor);
            const R = Math.max(2, s.size * 0.9);
            const stamp = softStamp(r, g, b, R), half = stamp.width / 2;
            ctx.save();
            ctx.globalAlpha = baseOpacity;
            const put = (x, y) => ctx.drawImage(stamp, x - half, y - half);
            const P = s.points;
            if (P.length === 1) put(P[0].x, P[0].y);
            for (let i = 1; i < P.length; i++) {
                const a = P[i - 1], c = P[i], d = Math.hypot(c.x - a.x, c.y - a.y);
                const steps = Math.max(1, Math.ceil(d / Math.max(1, R * 0.28)));
                for (let t = 0; t <= steps; t++) put(a.x + (c.x - a.x) * t / steps, a.y + (c.y - a.y) * t / steps);
            }
            ctx.restore();
            ctx.globalAlpha = 1;
            return;
        }
        const isEraser = s.tool === 'eraser';
        ctx.save();
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : baseColor;
        ctx.fillStyle = ctx.strokeStyle;
        let pts = smoothPoints(s.points);
        // 자글 펜: 매끈한 경로를 흔들어 손그림 떨림. s.roughAmp/roughSeed로 세기·시드 조절.
        if (s.tool === 'rough') pts = roughenPoints(pts, s.roughAmp ?? Math.max(1.5, s.size * 0.35), s.roughSeed ?? s.id ?? 0);
        const n = pts.length;
        const widths = pts.map((_, idx) => {
            const i = Math.max(1, idx);
            const pr = hasPressure && n > 1 ? pressureAt(pts, i) : 0.5;
            if (s.tool === 'pencil') return s.size * (0.85 + 0.15 * pr * 2);
            if (s.tool === 'brush') return s.size * (hasPressure ? pr * 2 : 1) * taperAt(i, n);
            return s.size * (hasPressure ? pr * 2 : 1);
        });
        const alphas = pts.map((_, idx) => {
            const i = Math.max(1, idx);
            const pr = hasPressure && n > 1 ? pressureAt(pts, i) : 0.5;
            if (isEraser) return 1;
            // Pencil: pressure drives darkness rather than thickness.
            if (s.tool === 'pencil') return baseOpacity * (0.45 + 0.55 * Math.min(1, pr * 2));
            if (s.tool === 'soft') return baseOpacity * 0.5;
            return baseOpacity;
        });
        smoothStroke(ctx, pts, widths, (i) => { ctx.globalAlpha = alphas[i]; });
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1.0;
    });
}

// Letterbox rect: fit source into destination preserving aspect ratio.
export function fitRect(sw, sh, dw, dh) {
    const s = Math.min(dw / sw, dh / sh);
    const w = sw * s, h = sh * s;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

// Decode a video file into evenly spaced frames (ImageData at the project resolution) by
// seeking. Returns { frames, fps, duration }. onProgress(done, total) for UI feedback.
export async function extractVideoFrames(file, { fps = 6, maxFrames = 0, start = 0, end = null, width, height, scale = 1, quality = 0.82, dedupe = 'exact', nativeRes = false, format = 'webp', onProgress, shouldStop } = {}) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
    try {
        await new Promise((res, rej) => {
            video.onloadedmetadata = () => res();
            video.onerror = () => rej(new Error('영상을 읽을 수 없습니다 (형식 미지원)'));
        });
        const duration = video.duration;
        if (!isFinite(duration) || duration <= 0) throw new Error('영상 길이를 알 수 없습니다');
        const to = Math.min(end ?? duration, duration);
        const step = 1 / Math.max(0.1, fps);
        const count = Math.max(1, Math.ceil((to - start) / step));
        // maxFrames now means "number of KEPT (distinct) cuts": we scan the whole range but stop
        // once that many non-duplicate frames are collected, so merged duplicates don't use up the
        // budget. total (progress denominator) is the kept target, else the whole scan.
        const keepTarget = maxFrames > 0 ? maxFrames : 0;
        const total = keepTarget || count;
        // Frames are stored compressed (WebP keeps the letterbox transparent) instead of raw
        // ImageData — ~20x less memory and much smaller project files.
        // Original-quality mode captures each frame at the video's NATIVE resolution (no down/up
        // scaling) and stores it losslessly, so imported frames match the source exactly.
        const vW = video.videoWidth || Math.round(width * scale), vH = video.videoHeight || Math.round(height * scale);
        const useNative = nativeRes && video.videoWidth && video.videoHeight;
        const fw = useNative ? vW : Math.max(1, Math.round(width * scale));
        const fh = useNative ? vH : Math.max(1, Math.round(height * scale));
        const cnv = document.createElement('canvas');
        cnv.width = fw; cnv.height = fh;
        const ctx = cnv.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // crisp resampling when scaling
        const r = useNative ? { x: 0, y: 0, w: fw, h: fh } : fitRect(vW, vH, fw, fh);
        const seek = (t) => new Promise((res) => {
            const on = () => { video.removeEventListener('seeked', on); res(); };
            video.addEventListener('seeked', on);
            video.currentTime = t;
        });
        const toBlob = format === 'png'
            ? () => new Promise((res) => cnv.toBlob(res, 'image/png'))                    // lossless
            : () => new Promise((res) => cnv.toBlob(b => b ? res(b) : cnv.toBlob(res, 'image/jpeg', quality), 'image/webp', quality));
        // Cheap similarity signature: the frame downscaled to 32x32 grayscale. Comparing these
        // lets a still shot skip encoding entirely — the previous frame just gets held longer.
        const sw = 32, sh = 32;
        const sig = document.createElement('canvas');
        sig.width = sw; sig.height = sh;
        const sctx = sig.getContext('2d', { willReadFrequently: true });
        const signature = () => {
            sctx.clearRect(0, 0, sw, sh);
            sctx.drawImage(cnv, 0, 0, sw, sh);
            const d = sctx.getImageData(0, 0, sw, sh).data;
            const out = new Uint8Array(sw * sh);
            for (let i = 0, j = 0; j < out.length; i += 4, j++) {
                const a = d[i + 3] / 255;
                out[j] = ((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * a + 255 * (1 - a)) | 0;
            }
            return out;
        };
        // Mean absolute difference per pixel (0-255). ~2 tolerates codec noise on a still shot.
        const diff = (a, b) => {
            let s = 0;
            for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
            return s / a.length;
        };

        // Byte-exact equality of two full-resolution frames (early-exit on first difference).
        const bytesEqual = (a, b) => {
            if (!a || !b || a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
            return true;
        };
        const on = dedupe && dedupe !== 0;
        const exact = dedupe === 'exact'; // skip ONLY pixel-identical frames (default)

        const frames = [], holds = [];
        let prevSig = null, prevFull = null, skipped = 0;
        for (let i = 0; i < count; i++) {
            if (shouldStop?.()) break;
            if (keepTarget && frames.length >= keepTarget) break; // enough distinct cuts collected
            await seek(Math.min(start + i * step, Math.max(0, duration - 0.01)));
            ctx.clearRect(0, 0, fw, fh);
            ctx.drawImage(video, r.x, r.y, r.w, r.h);
            // Compared against the last KEPT frame, so a slow pan still emits a new frame once
            // it has drifted far enough, instead of being swallowed step by step.
            const cur = on ? signature() : null;
            let dup = false;
            if (cur && prevSig) {
                if (exact) {
                    // 32x32 signature is a cheap prefilter; a match triggers a full-res byte compare,
                    // so only truly identical frames are merged (a static shot, a hard-held frame).
                    if (diff(prevSig, cur) === 0) {
                        const full = ctx.getImageData(0, 0, fw, fh).data;
                        dup = bytesEqual(prevFull, full);
                        if (!dup) prevFull = full;
                    }
                } else {
                    dup = diff(prevSig, cur) <= dedupe;
                }
            }
            if (dup) {
                holds[holds.length - 1]++; // identical picture: hold the previous cut one step longer
                skipped++;
                onProgress?.(frames.length, total, skipped);
                continue;
            }
            prevSig = cur;
            if (exact) prevFull = ctx.getImageData(0, 0, fw, fh).data;
            frames.push(await toBlob());
            holds.push(1);
            onProgress?.(frames.length, total, skipped);
        }
        return { frames, holds, skipped, fps, duration, width: fw, height: fh };
    } finally {
        URL.revokeObjectURL(url);
        video.src = '';
    }
}

// Detect scene-cut times in a video file by seeking through it and comparing 32x32 grayscale
// signatures — a big jump = a scene change. Returns sorted times (seconds). Own hidden <video>,
// so it doesn't disturb the overlay's display element.
export async function detectSceneCuts(file, { start = 0, end = null, step = 0.2, threshold = 14, refine = true, onProgress, shouldStop } = {}) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
    try {
        await new Promise((res, rej) => { video.onloadedmetadata = () => res(); video.onerror = () => rej(new Error('scene-detect: cannot read video')); });
        const dur = video.duration; if (!isFinite(dur) || dur <= 0) return [];
        const to = Math.min(end ?? dur, dur), from = Math.max(0, Math.min(start, to - 0.05));
        const sw = 48, sh = 48, c = document.createElement('canvas'); c.width = sw; c.height = sh; // finer signature = more accurate
        const cx = c.getContext('2d', { willReadFrequently: true });
        const sig = () => { cx.drawImage(video, 0, 0, sw, sh); const d = cx.getImageData(0, 0, sw, sh).data, o = new Uint8Array(sw * sh); for (let i = 0, j = 0; j < o.length; i += 4, j++) o[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; return o; };
        const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
        const seek = (t) => new Promise((res) => { const on = () => { video.removeEventListener('seeked', on); res(); }; video.addEventListener('seeked', on); video.currentTime = Math.max(0, Math.min(t, dur - 0.02)); });
        // Binary-search the exact moment the picture stops matching the pre-cut frame → precise boundary.
        const refineCut = async (refSig, a, b) => {
            for (let k = 0; k < 6; k++) { const mid = (a + b) / 2; await seek(mid); if (diff(refSig, sig()) > threshold) b = mid; else a = mid; }
            return b;
        };
        const cuts = [];
        if (from <= 0.06) cuts.push(0); // the opening frame is a scene start
        let prev = null, prevT = from;
        const n = Math.max(1, Math.ceil((to - from) / step));
        for (let i = 0; i <= n; i++) {
            if (shouldStop?.()) break;
            const t = Math.min(to, from + i * step); await seek(t);
            const s = sig();
            if (prev && diff(prev, s) > threshold) {
                const cutT = refine ? await refineCut(prev, prevT, t) : t;
                if (cutT - (cuts.length ? cuts[cuts.length - 1] : -1) > 0.12) cuts.push(+cutT.toFixed(2));
                await seek(t); // restore position for the next step's comparison
            }
            prev = sig(); prevT = t;
            onProgress?.(i + 1, n + 1);
            if (t >= to) break;
        }
        return cuts;
    } finally { URL.revokeObjectURL(url); video.src = ''; }
}

export function flattenForCanvas(layers) {
    return layers.filter(l => l.type !== 'folder' && l.visible !== false);
}

// Cheap change signature for a layer's strokes (strokes are append/replace only here),
// used to invalidate the layer canvas cache without stringifying the whole array.
export function strokeSig(strokes) {
    if (!strokes || !strokes.length) return '0';
    const last = strokes[strokes.length - 1];
    return strokes.length + '|' + (last.id ?? '') + '|' + (last.points ? last.points.length : 0) + '|' + (last.bitmapId ?? '') + '|' + (last.tool ?? '');
}

export const ANIM_DEFAULT = { inType: 'none', inDur: 0.4, inDir: 'left', outType: 'none', outDur: 0.4, outDir: 'right', deformAxis: 'x', deformAmount: 0, deformReturn: false, deformSpeed: 1, deformCount: 0, moveX: 0, moveY: 0, moveReturn: false, moveSpeed: 1, moveCount: 0, ease: 'linear', easePower: 2 };

// Per-cut animation state at a given absolute time. Returns null when the cut is
// at rest (no transform), so callers can skip the save/transform fast-path.
export function computeCutAnim(ac, time, cw = CANVAS_W, ch = CANVAS_H) {
    const a = ac.anim;
    if (!a) return null;
    const dur = Math.max(0.0001, ac.endTime - ac.startTime);
    const lt = time - ac.startTime;
    let alpha = 1, sx = 1, sy = 1, tx = 0, ty = 0;
    // Slide travels a full canvas dimension so the cut clearly enters from off-screen.
    const dirOff = (dir, frac) => dir === 'left' ? [-cw * frac, 0] : dir === 'right' ? [cw * frac, 0] : dir === 'up' ? [0, -ch * frac] : [0, ch * frac];
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

export const LAYER_ANIM_DEFAULT = { mode: 'progress', speed: 1, count: 0, tx: 0, ty: 0, rot: 0, scale: 0, pivotX: 0.5, pivotY: 0.5, path: null, ease: 'linear', easePower: 2, swayAmount: 0, swaySpeed: 1 };

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
export function computeLayerAnim(layer, ac, time, cw = CANVAS_W, ch = CANVAS_H) {
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
    // Continuous sway (hair/cloth): a horizontal shear that oscillates by absolute time and grows
    // toward the far end from the pivot — anchor the pivot at the top of the hair for a natural swing.
    const sway = a.swayAmount || 0;
    const shear = sway ? (sway / 100) * Math.sin(2 * Math.PI * (a.swaySpeed || 1) * time) : 0;
    if (tx === 0 && ty === 0 && rot === 0 && sc === 1 && shear === 0) return null;
    return { tx, ty, rot, sc, shear, px: (a.pivotX ?? 0.5) * cw, py: (a.pivotY ?? 0.5) * ch };
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
