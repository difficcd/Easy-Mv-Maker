import { tr } from '../i18n.js';
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
    return morphSequence(aImg, bImg, [t])[0];
}

// Several in-between frames at once. Computing the distance fields (sA/sB) is most of the
// work and does not depend on t, so it is done once and reused - calling morphFrames per
// frame would be N times slower.
export function morphSequence(aImg, bImg, ts) {
    const f = morphPrepare(aImg, bImg);
    return ts.map(f);
}
// Computes the distance fields once and returns a function that produces a single frame,
// so the caller can update progress or yield to the UI between frames.
export function morphPrepare(aImg, bImg) {
    const w = aImg.width, h = aImg.height, N = w * h;
    const A = aImg.data, B = bImg.data;
    const mA = new Uint8Array(N), mBraw = new Uint8Array(N);
    let ar = 0, ag = 0, ab = 0, an = 0, br = 0, bg = 0, bb = 0, bn = 0;
    let ax = 0, ay = 0, bx = 0, by = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, o = i * 4;
        if (A[o + 3] > 16) { mA[i] = 1; ar += A[o]; ag += A[o + 1]; ab += A[o + 2]; ax += x; ay += y; an++; }
        if (B[o + 3] > 16) { mBraw[i] = 1; br += B[o]; bg += B[o + 1]; bb += B[o + 2]; bx += x; by += y; bn++; }
    }
    const cr = an ? ar / an : 0, cg = an ? ag / an : 0, cb = an ? ab / an : 0;
    const dr = bn ? br / bn : cr, dg = bn ? bg / bn : cg, db = bn ? bb / bn : cb;
    // With one side empty there is no shape to morph, so fall back to an alpha crossfade.
    if (!an || !bn) {
        return (t) => {
            const out = new ImageData(w, h), O = out.data;
            for (let i = 0; i < N; i++) {
                const o = i * 4;
                const aA = A[o + 3] * (1 - t), aB = B[o + 3] * t;
                const al = aA + aB; if (al < 1) continue;
                O[o] = (A[o] * aA + B[o] * aB) / al; O[o + 1] = (A[o + 1] * aA + B[o + 1] * aB) / al;
                O[o + 2] = (A[o + 2] * aA + B[o + 2] * aB) / al; O[o + 3] = Math.min(255, al);
            }
            return out;
        };
    }
    // When the two drawings are far apart, blending the distance fields directly leaves the
    // middle empty: every point in between is outside both shapes, so the interpolated value
    // stays positive and nothing is drawn. Aligning the centroids first morphs only the shape,
    // and the translation is interpolated separately, so the in-betweens actually travel.
    const cax = ax / an, cay = ay / an, cbx = bx / bn, cby = by / bn;
    const shx = Math.round(cax - cbx), shy = Math.round(cay - cby);
    const mB = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = x - shx, sy = y - shy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        if (mBraw[sy * w + sx]) mB[y * w + x] = 1;
    }
    const sA = signedDist(mA, w, h);
    const sB = signedDist(mB, w, h);
    const dxTot = cbx - cax, dyTot = cby - cay;
    return (t) => {
        const R = Math.round(cr + (dr - cr) * t), G = Math.round(cg + (dg - cg) * t), Bl = Math.round(cb + (db - cb) * t);
        const ox = dxTot * t, oy = dyTot * t;
        const out = new ImageData(w, h), O = out.data;
        for (let y = 0; y < h; y++) {
            const sy = Math.round(y - oy);
            if (sy < 0 || sy >= h) continue;
            for (let x = 0; x < w; x++) {
                const sx = Math.round(x - ox);
                if (sx < 0 || sx >= w) continue;
                const i = sy * w + sx;
                const s = (1 - t) * sA[i] + t * sB[i];
                if (s < 1) {
                    const o = (y * w + x) * 4;
                    O[o] = R; O[o + 1] = G; O[o + 2] = Bl;
                    O[o + 3] = s <= 0 ? 255 : Math.round((1 - s) * 255);
                }
            }
        }
        return out;
    };
}

export const DEFAULT_CUT_DURATION = 1;
export const CANVAS_W = 1920, CANVAS_H = 1080;
// Fonts offered for text objects, grouped by script because a flat list of twenty is harder to
// use than a short one.
//
// The CJK families cost less than their size suggests: Google Fonts serves them split by
// unicode-range, so the browser fetches only the subsets whose glyphs actually appear. Loading
// the app with no Japanese on screen downloads no Japanese.
export const FONT_PRESETS = [
    { value: 'sans-serif', label: 'Sans', group: 'Basic' },
    { value: 'serif', label: 'Serif', group: 'Basic' },
    { value: 'monospace', label: 'Mono', group: 'Basic' },

    { value: '"Pretendard", sans-serif', label: 'Pretendard', group: '한국어' },
    { value: '"Noto Sans KR", sans-serif', label: 'Noto Sans KR', group: '한국어' },
    { value: '"Nanum Gothic", sans-serif', label: 'Nanum Gothic', group: '한국어' },
    { value: '"Gowun Dodum", sans-serif', label: 'Gowun Dodum', group: '한국어' },
    { value: '"Noto Serif KR", serif', label: 'Noto Serif KR', group: '한국어' },
    { value: '"Malgun Gothic", sans-serif', label: 'Malgun Gothic', group: '한국어' },
    { value: '"Apple SD Gothic Neo", sans-serif', label: 'Apple SD Gothic Neo', group: '한국어' },

    // Gothic, mincho, two rounded weights, and one heavy face for titles.
    { value: '"Noto Sans JP", sans-serif', label: 'Noto Sans JP ゴシック', group: '日本語' },
    { value: '"Noto Serif JP", serif', label: 'Noto Serif JP 明朝', group: '日本語' },
    { value: '"Zen Maru Gothic", sans-serif', label: 'Zen Maru Gothic 丸ゴシック', group: '日本語' },
    { value: '"M PLUS Rounded 1c", sans-serif', label: 'M PLUS Rounded 1c', group: '日本語' },
    { value: '"Shippori Mincho", serif', label: 'Shippori Mincho しっぽり明朝', group: '日本語' },
    { value: '"Dela Gothic One", sans-serif', label: 'Dela Gothic One 太字', group: '日本語' },
    { value: '"Yusei Magic", sans-serif', label: 'Yusei Magic 手書き', group: '日本語' },

    { value: '"Anton", sans-serif', label: 'Anton', group: 'Display' },
    { value: '"Bebas Neue", sans-serif', label: 'Bebas Neue', group: 'Display' },
];

/**
 * The presets in the order they should appear, as [group, fonts] pairs.
 * @param {typeof FONT_PRESETS} [presets]
 * @returns {[string, typeof FONT_PRESETS][]}
 */
export function fontGroups(presets = FONT_PRESETS) {
    /** @type {[string, typeof FONT_PRESETS][]} */
    const out = [];
    for (const f of presets) {
        const name = f.group || '';
        const last = out[out.length - 1];
        if (last && last[0] === name) last[1].push(f);
        else out.push([name, [f]]);
    }
    return out;
}

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

/**
 * Grow a bitmask outwards by r pixels (square structuring element, done separably so it stays
 * O(w*h) whatever r is).
 *
 * Used to bleed a bucket fill under the line that bounds it. A filled region stops exactly at
 * the ink, which is fine while the ink holds still - but a boiling layer displaces the ink and
 * leaves the paint behind, opening a gap along every edge that wobbles outwards. Traditional
 * ink-and-paint has the same problem and the same answer: spread the paint a little past the
 * line and let the line cover it.
 */
export function dilateMask(mask, w, h, r) {
    if (!(r > 0)) return mask;
    const pass = (src, dst, stride, outer, inner) => {
        for (let o = 0; o < outer; o++) {
            const base = o * (stride === 1 ? w : 1);
            let since = -1; // pixels travelled since the last set one; -1 = none seen yet
            for (let i = 0; i < inner; i++) {
                const idx = base + i * stride;
                if (src[idx]) since = 0; else if (since >= 0) since++;
                if (since >= 0 && since <= r) dst[idx] = 1;
            }
            since = -1;
            for (let i = inner - 1; i >= 0; i--) {
                const idx = base + i * stride;
                if (src[idx]) since = 0; else if (since >= 0) since++;
                if (since >= 0 && since <= r) dst[idx] = 1;
            }
        }
    };
    const tmp = new Uint8Array(w * h);
    pass(mask, tmp, 1, h, w);   // horizontal
    const out = new Uint8Array(w * h);
    pass(tmp, out, w, w, h);    // vertical
    return out;
}

export function bucketFillTransparentRegion(baseImageData, startX, startY, fillRgb, fillAlpha, tolerance = 24, spread = 0) {
    const w = baseImageData.width;
    const h = baseImageData.height;
    const data = baseImageData.data;
    const sx = startX | 0;
    const sy = startY | 0;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

    // Fills the connected region matching the colour of the clicked pixel. This used to fill
    // only transparent areas, which made painting over an already-filled region - the basic
    // behaviour of a bucket tool - impossible.
    const startOff = (sy * w + sx) * 4;
    const s0 = data[startOff], s1 = data[startOff + 1], s2 = data[startOff + 2], s3 = data[startOff + 3];
    const tol = Math.max(0, tolerance);
    // Between transparent pixels the colour channels are meaningless, so only alpha is compared.
    const matches = (o) => {
        const a = data[o + 3];
        if (s3 < 8) return a < 8;
        if (a < 8) return false;
        return Math.abs(data[o] - s0) <= tol && Math.abs(data[o + 1] - s1) <= tol
            && Math.abs(data[o + 2] - s2) <= tol && Math.abs(a - s3) <= tol;
    };
    // Already the target colour: nothing to do, and this prevents an endless refill.
    if (s3 >= 8 && Math.abs(s0 - fillRgb.r) < 2 && Math.abs(s1 - fillRgb.g) < 2
        && Math.abs(s2 - fillRgb.b) < 2 && Math.abs(s3 - fillAlpha) < 2) return null;

    const mask = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    let qh = 0;
    let qt = 0;
    // Pixels must be marked visited on enqueue, not on dequeue. Marking on dequeue lets one
    // pixel be queued by all four neighbours, the queue grows past w*h, and a typed array drops
    // out-of-range writes silently - the fill then stopped partway and painted only the diamond
    // shape the BFS had reached.
    const push = (i) => { if (!mask[i]) { mask[i] = 1; q[qt++] = i; } };
    push(sy * w + sx);

    let minX = w, minY = h, maxX = -1, maxY = -1;
    while (qh < qt) {
        const idx = q[qh++];
        const x = idx % w;
        const y = (idx / w) | 0;
        if (!matches(idx * 4)) continue; // A different colour (the boundary): visit it but do not cross it.

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;

        if (x > 0) push(idx - 1);
        if (x + 1 < w) push(idx + 1);
        if (y > 0) push(idx - w);
        if (y + 1 < h) push(idx + w);
    }

    if (maxX < minX || maxY < minY) return null;

    // The BFS marks a pixel on enqueue, so `mask` already carries a one-pixel rim of boundary
    // pixels that `matches` then rejects below. Painting spreads out from the region proper.
    const paint = new Uint8Array(w * h);
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = y * w + x;
            if (mask[idx] && matches(idx * 4)) paint[idx] = 1;
        }
    }
    const grown = spread > 0 ? dilateMask(paint, w, h, spread) : paint;
    if (spread > 0) {
        minX = Math.max(0, minX - spread); minY = Math.max(0, minY - spread);
        maxX = Math.min(w - 1, maxX + spread); maxY = Math.min(h - 1, maxY + spread);
    }

    const cw = (maxX - minX + 1) | 0;
    const ch = (maxY - minY + 1) | 0;
    const out = new ImageData(cw, ch);
    const outData = out.data;
    const { r, g, b } = fillRgb;
    const a = Math.max(0, Math.min(255, fillAlpha | 0));

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = y * w + x;
            if (!grown[idx]) continue;
            const o = ((y - minY) * cw + (x - minX)) * 4;
            outData[o] = r;
            outData[o + 1] = g;
            outData[o + 2] = b;
            outData[o + 3] = a;
        }
    }

    // overPaint distinguishes the two things a bucket does: colouring blank space inside line
    // art, where the paint belongs under the ink, and recolouring something already painted,
    // where it has to go on top or it would be hidden by what it is meant to replace.
    return { imageData: out, x: minX, y: minY, overPaint: s3 >= 8 };
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

// Boiling-line effect: displaces a smooth path along its normal to give a hand-drawn wobble.
// Deterministic from the seed, so repaints match; adding timeSeed makes it boil during playback.
//
// Two things make the wobble round rather than spiky:
//  1) The wavelength is measured in real length (px), not in number of points. A smoothed path
//     has points less than 1px apart, so an index-based frequency becomes ultrasonic and jagged.
//  2) No independent white noise per point. Value noise - coarsely spaced control values
//     interpolated with smoothstep - ripples smoothly instead of turning into corners.
function roughenPoints(pts, amp = 2.2, seed = 0, wave = 1) {
    const n = pts && pts.length;
    if (!n || n < 3) return pts || [];
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

    // Cumulative length along the path: both the noise coordinate and the basis for the end taper.
    const arc = new Float64Array(n);
    for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const total = arc[n - 1] || 1;

    // One control value every wl pixels, interpolated with smoothstep, gives a soft ripple.
    const makeOctave = (wl) => {
        const m = Math.max(2, Math.ceil(total / wl) + 2);
        const ctrl = new Array(m);
        for (let i = 0; i < m; i++) ctrl[i] = rnd() * 2 - 1;
        return (d) => {
            const u = d / wl, k = Math.floor(u), f = u - k;
            const t = f * f * (3 - 2 * f);
            const a = ctrl[Math.min(k, m - 1)], b = ctrl[Math.min(k + 1, m - 1)];
            return a + (b - a) * t;
        };
    };
    const wl = Math.max(0.2, wave);
    const big = makeOctave(95 * wl);   // the broad swell
    const small = makeOctave(38 * wl); // the ripple, kept faint

    // The normal is estimated over a wide window; a narrow one makes its direction jitter and
    // the result look rough.
    const span = Math.max(1, Math.round(n / Math.max(8, total / 6)));
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - span)], b = pts[Math.min(n - 1, i + span)];
        let nx = -(b.y - a.y), ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
        // The outer 12px taper to zero so the stroke ends do not flick. The ramp is itself a
        // smoothstep, so it does not kink at the boundary the way a linear ramp visibly does.
        const d = arc[i];
        const edge = Math.min(1, Math.min(d, total - d) / 12);
        const taper = edge * edge * (3 - 2 * edge);
        const w = (big(d) + 0.3 * small(d)) * amp * taper;
        out[i] = { x: pts[i].x + nx * w, y: pts[i].y + ny * w, pressure: pts[i].pressure };
    }
    return out;
}

// Boiling redraws the layer on every phase change, but smoothPoints (resample plus three
// Chaikin passes, roughly eight times the points) returns the same thing regardless of phase.
// Caching it per stroke removes that recomputation, which was most of the cost of rendering a
// boiling layer. The cache is a WeakMap, so it is reclaimed with the stroke.
// The path used for boiling also does not need to be dense: the wobble wavelength is tens of
// pixels while a smoothed path has points under 1px apart, oversampling it 15-20x. Resampling
// coarsely at 6px before displacing, and letting the renderer's Catmull-Rom spline smooth it
// back out, is both rounder-looking and more than twenty times cheaper.
const JITTER_SPACING = 6;
const _smoothCache = new WeakMap();
function jitterBasePoints(stroke) {
    const hit = _smoothCache.get(stroke);
    if (hit && hit.n === stroke.points.length) return hit.pts;
    const pts = resamplePts(smoothPoints(stroke.points), JITTER_SPACING);
    _smoothCache.set(stroke, { n: stroke.points.length, pts });
    return pts;
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

/**
 * Give a canvas these dimensions, reallocating only if it does not already have them.
 *
 * Assigning canvas.width reallocates the backing store even when the value is unchanged - the
 * spec says so, and at 1920x1080 that is 8.3MB thrown away and replaced per assignment. A
 * boiling layer is redrawn ten times a second, and `cnv.width = CANVAS_W` on the reused canvas
 * was measured churning 79MB a second per boiling layer, which is what ran the tab out of
 * memory. It was not even clearing anything the caller needed: drawStrokesOnCtx clears first.
 *
 * @returns {boolean} true if the canvas was resized, and so is already blank
 */
export function sizeCanvas(cnv, w, h) {
    if (cnv.width === w && cnv.height === h) return false;
    cnv.width = w;
    cnv.height = h;
    return true;
}

// One scratch canvas, reused. Marker and pencil each need a full-size temporary layer to
// composite through, and creating one per stroke meant a fresh 8MB allocation per stroke on every
// repaint - with boiling redrawing ten times a second, that is gigabytes a second for a layer
// with a handful of marker strokes. Every use here is strictly sequential (take it, draw, blend
// it in, done) and never nested, so a single shared canvas is enough.
let _scratch = null;

/** A cleared, full-size scratch canvas with a context in its default state. */
function takeScratch(w, h) {
    if (!_scratch) _scratch = document.createElement('canvas');
    const cx = sizeCanvas(_scratch, w, h)
        ? _scratch.getContext('2d')                        // a resize already blanked it
        : (() => { const c = _scratch.getContext('2d'); c.clearRect(0, 0, w, h); return c; })();
    // A resize resets these; a reuse does not, and the last user leaves them dirty. Marker in
    // particular sets no alpha of its own, so it would inherit whatever pencil left behind.
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
    cx.filter = 'none';
    cx.shadowBlur = 0; cx.shadowColor = 'transparent';
    return cx;
}

export function drawStrokesOnCtx(ctx, strokes, clear = true, bitmapStore = null, opts = {}) {
    if (clear) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    // Layer-level boiling: displaces already-drawn strokes at render time, non-destructively.
    // Advancing roughPhase over time turns it into motion - the strokes shimmer in place.
    const layerRough = opts.roughen ? (typeof opts.roughen === 'number' ? opts.roughen : 2.4) : 0;
    const roughPhase = opts.roughPhase || 0;
    const roughWave = opts.roughWave || 1;
    const roughMinSize = opts.roughMinSize || 0; // strokes thinner than this are left alone
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
        // Boiling, from either the per-stroke "rough" pen or the layer effect (layerRough).
        // The dot pen uses this below, so it has to be computed before the pen branch.
        // Strokes under the minimum width are skipped: the thinner the line, the more violent
        // the same amplitude looks.
        const tooThin = roughMinSize > 0 && (s.size || 0) < roughMinSize;
        const roughAmp = (s.tool === 'rough') ? (s.roughAmp ?? Math.max(1.5, s.size * 0.35)) : ((layerRough && s.tool !== 'eraser' && !tooThin) ? layerRough : 0);
        // Seed = a per-stroke value plus the time phase, so each frame wobbles differently and
        // strokes stay independent of one another.
        const roughSeed = (s.id || 0) + roughPhase * 7919;
        // The cache is only used when boiling. A plain layer already caches its canvas and draws
        // once per change, so caching there buys nothing and only costs memory.
        const smooth = (p) => {
            if (!roughAmp) return smoothPoints(p);
            return roughenPoints(jitterBasePoints(s), roughAmp, roughSeed, roughWave);
        };
        // Dot pen: hard square stamps (pixel-art look), no anti-aliased round stroke.
        if (s.tool === 'pen') {
            const base = Math.max(1, Math.round(s.size));
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = s.opacity ?? 1;
            ctx.fillStyle = s.color;
            // The dot pen follows pressure too, through the stamp size. It used to be a fixed
            // size, so drawing with a tablet showed no pressure at all; the stamp itself stays
            // the same hard-edged pixel shape.
            const dotHasPr = s.pen === true || s.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);
            const sizeAt = (pr) => Math.max(1, Math.round(base * (dotHasPr ? Math.min(2, Math.max(0.15, pr * 2)) : 1)));
            const stamp = (x, y, size) => { const half = size / 2; ctx.fillRect(Math.round(x - half), Math.round(y - half), size, size); };
            const P = roughAmp ? roughenPoints(jitterBasePoints(s), roughAmp, roughSeed, roughWave) : s.points;
            if (P.length === 1) {
                stamp(P[0].x, P[0].y, sizeAt(P[0].pressure ?? 0.5));
            } else {
                for (let i = 1; i < P.length; i++) {
                    const a = P[i - 1], b = P[i];
                    const d = Math.hypot(b.x - a.x, b.y - a.y);
                    const sz = sizeAt(((a.pressure ?? 0.5) + (b.pressure ?? 0.5)) / 2);
                    const steps = Math.max(1, Math.ceil(d / Math.max(1, sz / 2)));
                    for (let t = 0; t <= steps; t++) {
                        stamp(a.x + (b.x - a.x) * t / steps, a.y + (b.y - a.y) * t / steps, sz);
                    }
                }
            }
            ctx.globalAlpha = 1.0;
            return;
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // Strokes drawn with a tablet or S Pen (s.pen) always trust the pressure values. If they
        // happen to hover near 0.5, the heuristic below reads that as "no pressure" and the whole
        // width variation disappears.
        const hasPressure = s.pen === true || s.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);
        const baseColor = s.color;
        const baseOpacity = s.opacity ?? 1;
        // Marker: draw the whole stroke opaque on a temp canvas, then composite once.
        // Compositing per-segment with a translucent multiply darkens every overlap,
        // which showed up as black dots at the joints under pressure rendering.
        if (s.tool === 'marker') {
            const tctx = takeScratch(ctx.canvas.width, ctx.canvas.height);
            const tmp = tctx.canvas;
            tctx.lineCap = 'round'; tctx.lineJoin = 'round'; tctx.strokeStyle = baseColor; tctx.fillStyle = baseColor;
            const mp = smooth(s.points);
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
            const tctx = takeScratch(ctx.canvas.width, ctx.canvas.height);
            const tmp = tctx.canvas;
            tctx.lineCap = 'round'; tctx.lineJoin = 'round'; tctx.strokeStyle = baseColor; tctx.fillStyle = baseColor;
            const pp = smooth(s.points), pn = pp.length;
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
            const P = roughAmp ? roughenPoints(jitterBasePoints(s), roughAmp, roughSeed, roughWave) : s.points;
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
        let pts = smooth(s.points);
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
/**
 * @param {File|Blob} file
 * @param {{fps?:number, maxFrames?:number, start?:number, end?:number|null, scale?:number,
 *   quality?:number, dedupe?:string|number, nativeRes?:boolean, format?:string,
 *   width?:number, height?:number, onProgress?:Function, shouldStop?:Function}} [opts]
 */
export async function extractVideoFrames(file, { fps = 6, maxFrames = 0, start = 0, end = null, width, height, scale = 1, quality = 0.82, dedupe = 'exact', nativeRes = false, format = 'webp', onProgress, shouldStop } = {}) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
    try {
        await new Promise((res, rej) => {
            video.onloadedmetadata = () => res();
            video.onerror = () => rej(new Error(tr('영상을 읽을 수 없습니다 (형식 미지원)')));
        });
        const duration = video.duration;
        if (!isFinite(duration) || duration <= 0) throw new Error(tr('영상 길이를 알 수 없습니다'));
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
        // dedupe takes either "exact" (drop only pixel-identical frames) or a numeric threshold.
        /** @type {any} */ const dd = dedupe;
        const on = dd && dd !== 0;
        const exact = dd === 'exact'; // skip ONLY pixel-identical frames (default)

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
                    dup = diff(prevSig, cur) <= dd;
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
/**
 * @param {File|Blob} file
 * @param {{start?:number, end?:number|null, step?:number, threshold?:number,
 *   refine?:boolean, onProgress?:Function, shouldStop?:Function}} [opts]
 */
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
        // Ping-pong (return): oscillates back to the original; speed is cycles across the cut,
        // count caps how many.
        let prog;
        if (a.deformReturn) { const cyc = (a.deformSpeed || 1) * t; prog = (a.deformCount > 0 && cyc >= a.deformCount) ? 0 : Math.sin(2 * Math.PI * cyc); }
        else prog = applyEase(t, a.ease, a.easePower);
        const f = 1 + a.deformAmount * prog;
        if (a.deformAxis === 'x') sx *= f; else sy *= f;
    }
    if (a.moveX || a.moveY) {
        // Whole-cut movement across its lifetime. One-way ramps to the target; ping-pong goes
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

export const LAYER_ANIM_DEFAULT = { mode: 'progress', speed: 1, count: 0, tx: 0, ty: 0, rot: 0, scale: 0, pivotX: 0.5, pivotY: 0.5, path: null, ease: 'linear', easePower: 2, swayAmount: 0, swaySpeed: 1, swayCurve: null, swayProfile: null, swayAxis: 'y', keys: null };

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
// one-way or ping-pong playback at a given speed and an optional repeat count.
// Sway from a drawn curve: converts what the user drew into a sway waveform.
// Progress is the drawing order (cumulative length) and the value is the deviation normal to
// the line from start to end, so anything from a scribble that doubles back to a gentle wave
// sways exactly as it was drawn.
// The returned amp (px) is how far that curve actually swung, and is used as the default strength.
export function curveToWave(pts, samples = 64) {
    if (!pts || pts.length < 3) return null;
    const a = pts[0], b = pts[pts.length - 1];
    let ux = b.x - a.x, uy = b.y - a.y;
    const blen = Math.hypot(ux, uy);
    if (blen < 1) { ux = 1; uy = 0; } else { ux /= blen; uy /= blen; }
    const nx = -uy, ny = ux; // normal of the baseline
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = arc[arc.length - 1] || 1;
    const out = new Array(samples);
    let j = 0;
    for (let k = 0; k < samples; k++) {
        const target = (k / (samples - 1)) * total;
        while (j < pts.length - 2 && arc[j + 1] < target) j++;
        const seg = Math.max(1e-6, arc[j + 1] - arc[j]);
        const f = Math.min(1, Math.max(0, (target - arc[j]) / seg));
        const x = pts[j].x + (pts[j + 1].x - pts[j].x) * f - a.x;
        const y = pts[j].y + (pts[j + 1].y - pts[j].y) * f - a.y;
        out[k] = x * nx + y * ny;
    }
    const mean = out.reduce((s, v) => s + v, 0) / samples;
    let amp = 0;
    for (let k = 0; k < samples; k++) { out[k] -= mean; amp = Math.max(amp, Math.abs(out[k])); }
    if (amp < 0.5) return null; // effectively a straight line: nothing to sway
    for (let k = 0; k < samples; k++) out[k] /= amp;
    // Match the end to the start so looped playback does not jump.
    const drift = out[samples - 1] - out[0];
    for (let k = 0; k < samples; k++) out[k] -= drift * (k / (samples - 1));
    return { wave: out.map(v => Math.round(v * 1000) / 1000), amp: Math.round(amp) };
}
// Sway profile: smoothly interpolates the weights (-1..1) of control points along the axis.
// Zero holds that point still; a negative weight bends it the other way, so one stretch can
// bend one direction while the next bends back.
export function swayWeightAt(profile, p) {
    const n = profile?.length || 0;
    if (!n) return 1;
    if (n === 1) return profile[0];
    const x = Math.min(1, Math.max(0, p)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    const t = f * f * (3 - 2 * f); // smoothstep, so the gaps between control points do not turn into corners
    return profile[i] + (profile[i + 1] - profile[i]) * t;
}
// Samples the waveform cyclically over 0..1 with linear interpolation.
export function sampleWave(wave, u) {
    const n = wave.length;
    if (!n) return 0;
    const x = (((u % 1) + 1) % 1) * n;
    const i = Math.floor(x), f = x - i;
    const a = wave[i % n], b = wave[(i + 1) % n];
    return a + (b - a) * f;
}

// Text animation, for MV subtitles. Takes the progress through the cut and returns just the
// values needed to draw.
//  - in/out: entrance and exit (fade/up/down/scale/blur)
//  - typing: reveals a character at a time by slicing the string
//  - emphasis: a looping accent (pulse/shake/wave)
export const TEXT_ANIM_DEFAULT = {
    inType: 'none', inDur: 0.4, outType: 'none', outDur: 0.4,
    typing: false, typeSpeed: 18, emphasis: 'none', emAmount: 20, emSpeed: 2,
};
export function computeTextAnim(t, ac, time) {
    const a = t.anim;
    if (!a) return null;
    const local = time - ac.startTime;
    const dur = Math.max(0.0001, ac.endTime - ac.startTime);
    let alpha = 1, dx = 0, dy = 0, scale = 1, blur = 0, rot = 0;

    const inDur = Math.max(0.0001, a.inDur ?? 0.4);
    if (a.inType && a.inType !== 'none' && local < inDur) {
        const u = Math.max(0, Math.min(1, local / inDur));
        const e = 1 - Math.pow(1 - u, 3); // ease-out
        if (a.inType === 'fade') alpha *= e;
        else if (a.inType === 'up') { alpha *= e; dy += (1 - e) * 40; }
        else if (a.inType === 'down') { alpha *= e; dy -= (1 - e) * 40; }
        else if (a.inType === 'scale') { alpha *= e; scale *= 0.6 + 0.4 * e; }
        else if (a.inType === 'blur') { alpha *= e; blur = (1 - e) * 10; }
    }
    const outDur = Math.max(0.0001, a.outDur ?? 0.4);
    const tailStart = dur - outDur;
    if (a.outType && a.outType !== 'none' && local > tailStart) {
        const u = Math.max(0, Math.min(1, (local - tailStart) / outDur));
        const e = u * u; // ease-in
        if (a.outType === 'fade') alpha *= (1 - e);
        else if (a.outType === 'up') { alpha *= (1 - e); dy -= e * 40; }
        else if (a.outType === 'down') { alpha *= (1 - e); dy += e * 40; }
        else if (a.outType === 'scale') { alpha *= (1 - e); scale *= 1 - 0.4 * e; }
        else if (a.outType === 'blur') { alpha *= (1 - e); blur = e * 10; }
    }
    // Emphasis runs on absolute time, so its rhythm stays constant whatever the cut length.
    const em = a.emAmount ?? 20, es = a.emSpeed ?? 2;
    if (a.emphasis === 'pulse') scale *= 1 + (em / 100) * 0.5 * Math.sin(2 * Math.PI * es * time);
    else if (a.emphasis === 'shake') { dx += (em / 10) * Math.sin(2 * Math.PI * es * 3.1 * time); dy += (em / 14) * Math.sin(2 * Math.PI * es * 2.3 * time + 1.1); }
    else if (a.emphasis === 'swing') rot += (em / 10) * Math.sin(2 * Math.PI * es * time);

    // Typing reveals typeSpeed characters per second; null means no slicing.
    let chars = null;
    if (a.typing) chars = Math.max(0, Math.floor(Math.max(0, local) * (a.typeSpeed || 18)));
    return { alpha, dx, dy, scale, blur, rot, chars };
}

// Keyframe tweening: interpolates between the times you set, with per-segment easing.
// This is tweening in the original animation sense of the word.
export function sampleKeys(keys, p) {
    const n = keys.length;
    if (p <= keys[0].p) return keys[0];
    if (p >= keys[n - 1].p) return keys[n - 1];
    for (let i = 0; i < n - 1; i++) {
        const k0 = keys[i], k1 = keys[i + 1];
        if (p >= k0.p && p <= k1.p) {
            const span = Math.max(1e-6, k1.p - k0.p);
            const u = applyEase((p - k0.p) / span, k0.ease || 'linear', k0.easePower ?? 2);
            const mix = (x, y) => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * u;
            return {
                tx: mix(k0.tx, k1.tx), ty: mix(k0.ty, k1.ty), rot: mix(k0.rot, k1.rot),
                scale: mix(k0.scale, k1.scale), op: mix(k0.op ?? 1, k1.op ?? 1),
            };
        }
    }
    return keys[n - 1];
}

export function computeLayerAnim(layer, ac, time, cw = CANVAS_W, ch = CANVAS_H) {
    const a = layer.anim;
    if (!a) return null;
    const dur = Math.max(0.0001, ac.endTime - ac.startTime);
    const t = Math.max(0, Math.min(1, (time - ac.startTime) / dur));
    const speed = a.speed || 1, count = a.count || 0;
    const keys = Array.isArray(a.keys) && a.keys.length >= 2 ? a.keys : null;
    let tx, ty, rot, sc, alpha = 1, prog;
    if (keys) {
        // When keyframes exist they take over move, rotate, scale and opacity; the speed
        // multiplier only changes how fast they play.
        const k = sampleKeys(keys, Math.max(0, Math.min(1, t * speed)));
        tx = k.tx || 0; ty = k.ty || 0;
        rot = (k.rot || 0) * Math.PI / 180;
        sc = 1 + (k.scale || 0);
        alpha = Math.max(0, Math.min(1, k.op ?? 1));
        prog = t;
    } else {
        if (a.mode === 'return') { const cyc = speed * t; prog = (count > 0 && cyc >= count) ? 0 : Math.sin(2 * Math.PI * cyc); }
        else prog = applyEase(t, a.ease, a.easePower);
        tx = (a.tx || 0) * prog; ty = (a.ty || 0) * prog;
        rot = (a.rot || 0) * prog * Math.PI / 180;
        sc = 1 + (a.scale || 0) * prog;
    }
    if (!keys && a.path && a.path.length > 1) {
        let s;
        if (a.mode === 'return') { let x = 2 * speed * t; if (count > 0 && x >= 2 * count) x = 0; s = triwave(x); }
        else s = applyEase(t, a.ease, a.easePower);
        const p0 = a.path[0], pt = samplePath(a.path, s);
        tx += pt.x - p0.x; ty += pt.y - p0.y;
    }
    // Continuous sway (hair/cloth): a horizontal shear that oscillates by absolute time and grows
    // toward the far end from the pivot — anchor the pivot at the top of the hair for a natural swing.
    // Sway 1 is a plain sine wave; sway 2 follows the waveform of a curve the user drew.
    const sway = a.swayAmount || 0;
    const wave = !sway ? 0
        : (a.swayCurve && a.swayCurve.length > 1)
            ? sampleWave(a.swayCurve, (a.swaySpeed || 1) * time)
            : Math.sin(2 * Math.PI * (a.swaySpeed || 1) * time);
    const shear = (sway / 100) * wave;
    // With a per-point profile, the bend varies along the axis instead of being a single shear.
    // The renderer handles it as a slice warp, so only the values it needs are passed on.
    const prof = (sway && Array.isArray(a.swayProfile) && a.swayProfile.length > 1) ? a.swayProfile : null;
    const axis = a.swayAxis === 'x' ? 'x' : 'y';
    // A profile weight of 1 equals the displacement the old shear produced at the end of the
    // axis, so the feel is unchanged.
    const swayDisp = prof ? (sway / 100) * wave * (axis === 'y' ? ch : cw) : 0;
    if (tx === 0 && ty === 0 && rot === 0 && sc === 1 && shear === 0 && !prof && alpha === 1) return null;
    return {
        tx, ty, rot, sc, alpha, shear: prof ? 0 : shear, px: (a.pivotX ?? 0.5) * cw, py: (a.pivotY ?? 0.5) * ch,
        swayProfile: prof, swayAxis: axis, swayDisp,
    };
}

export function flattenLayersInUiOrder(layers, parentId = null, out = []) {
    const pid = parentId ?? null;
    const list = layers.filter(l => (l.parentId ?? null) === pid);
    for (const layer of list) {
        if (layer.type === 'folder') {
            if (layer.visible === false) continue; // a hidden folder hides everything under it, nesting included
            flattenLayersInUiOrder(layers, layer.id, out);
        } else {
            out.push(layer);
        }
    }
    return out;
}

// A 2D canvas context cannot read CSS variables, so the computed value is read out instead.
// That keeps on-canvas furniture such as selection outlines and paths on the theme colour.
export const accentSoft = (alpha = 1) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || '#7c8cff';
    if (alpha >= 1) return v;
    return v.startsWith('hsl(') ? v.replace(/\)$/, ` / ${alpha})`) : v;
};

// Which canvas a video import should land in. A vertical clip dropped into a landscape canvas
// is mostly empty margin, so the import can either match the source or be pinned to one of the
// two shapes people actually publish.
export const targetCanvasFor = (cfg, curW, curH) => {
    const mode = cfg?.canvasMode || 'source';
    if (mode === 'landscape') return { w: 1920, h: 1080 };
    if (mode === 'portrait') return { w: 1080, h: 1920 };
    if (mode === 'source' && cfg?.srcW > 0 && cfg?.srcH > 0) {
        // Even dimensions keep the frames off half-pixel resampling.
        return { w: Math.round(cfg.srcW / 2) * 2, h: Math.round(cfg.srcH / 2) * 2 };
    }
    return { w: curW, h: curH };
};
