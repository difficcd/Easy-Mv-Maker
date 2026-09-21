// Drawing strokes: smoothing a hand path, the boiling line, and rendering every brush onto a
// context. The one place a stroke's points become pixels.

import { imageDataCanvas, resetCtx, sizeCanvas } from './scratch.js';
import { hexToRgb } from '../core/colour.js';
import { drawWarped, isWarped } from './warpRender.js';
import { catmullThrough } from '../core/catmullRom.ts';
import { makeCanvas } from './canvasFactory.js';

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

// Raw samples further apart than this, on average, are "sparse": a stroke drawn zoomed out,
// where one screen pixel of pen travel is several canvas pixels, or a fast one.
const SPARSE_SPACING = 4;

/**
 * Smooth a raw hand stroke: resample to uniform spacing, then round corners with Chaikin. The
 * caller renders the result as a Catmull-Rom spline, so the final curve is genuinely smooth.
 *
 * Sparse input is run through a Catmull-Rom spline first. The resample puts points every 2px
 * *along the polyline*, so with raw samples 30px apart it lays fourteen points down each
 * straight run between them - and Chaikin, which cuts corners by a quarter of the neighbouring
 * segments, then rounds each corner by half a pixel and leaves the runs straight. That is the
 * "curve made of straight lines" a stroke drawn zoomed out came out as: the smoothing was
 * running at the resample's scale, not the stroke's. Interpolating through the raw samples
 * before resampling gives the corner-cutting a curve to work on. Catmull-Rom rather than
 * Chaikin on the raw points because it passes through them - a circle stays the size it was
 * drawn, where corner-cutting would pull it inward.
 *
 * @param {Array<{x: number, y: number, pressure?: number}>} pts
 * @param {number} [passes]
 */
export function smoothPoints(pts, passes) {
    if (!pts || pts.length < 3) return pts || [];
    let raw = pts;
    const mean = strokeLength(pts) / (pts.length - 1);
    if (mean > SPARSE_SPACING) raw = catmullThrough(pts, Math.min(16, Math.ceil(mean / 2)));
    let cur = resamplePts(raw, 2);
    if (cur.length < 3) cur = pts.slice();
    const iters = passes != null ? passes : 3; // one more corner-cut pass = smoother
    for (let k = 0; k < iters; k++) cur = chaikin(cur);
    return cur;
}

/** Length of a polyline. */
function strokeLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
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
    const N = 128, c = makeCanvas(); c.width = c.height = N;
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
    const s = Math.max(2, Math.ceil(radius * 2)), c = makeCanvas(); c.width = c.height = s;
    const cx = c.getContext('2d'), grd = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, `rgba(${r},${g},${b},0.16)`);
    grd.addColorStop(0.5, `rgba(${r},${g},${b},0.06)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    cx.fillStyle = grd; cx.fillRect(0, 0, s, s);
    return c;
}

// One scratch canvas, reused. Marker and pencil each need a full-size temporary layer to
// composite through, and creating one per stroke meant a fresh 8MB allocation per stroke on every
// repaint - with boiling redrawing ten times a second, that is gigabytes a second for a layer
// with a handful of marker strokes. Every use here is strictly sequential (take it, draw, blend
// it in, done) and never nested, so a single shared canvas is enough.
let _scratch = null;

/** A cleared, full-size scratch canvas with a context in its default state. */
function takeScratch(w, h) {
    if (!_scratch) _scratch = makeCanvas();
    const cx = sizeCanvas(_scratch, w, h)
        ? _scratch.getContext('2d')                        // a resize already blanked it
        : (() => { const c = _scratch.getContext('2d'); c.clearRect(0, 0, w, h); return c; })();
    return resetCtx(cx);
}

/**
 * The pixels a stroke points at: the display bitmap if one is decoded, else the ImageData, else
 * the inline ImageData a stroke from before the store existed carries. Null when none of the
 * three is there - a frame that has not decoded yet, or pixels that were evicted.
 *
 * @param {{bitmapId?: string, imageData?: ImageData}} s
 * @param {Map<string, any> | undefined} bitmapStore
 * @returns {CanvasImageSource | null}
 */
function strokePixels(s, bitmapStore) {
    const entry = bitmapStore?.get(s.bitmapId);
    if (entry?.imageBitmap) return entry.imageBitmap;
    const img = entry?.imageData || s.imageData;
    return img ? imageDataCanvas(img) : null;
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
            const src = strokePixels(s, bitmapStore);
            if (!src) return;
            ctx.globalCompositeOperation = 'destination-out';
            ctx.globalAlpha = 1.0;
            ctx.drawImage(src, s.x, s.y);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1.0;
            return;
        }
        if (s.tool === 'paste') {
            const entry = bitmapStore?.get(s.bitmapId);
            const bmp = entry?.imageBitmap;
            const img = entry?.imageData;
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // crisp video-frame scaling
            // A skewed or bent paste cannot go through drawImage's rectangle; warpRender slices
            // it. Only pastes that carry the fields take this path, so nothing older changes.
            if (isWarped(s)) {
                const src = bmp || (img && imageDataCanvas(img));
                if (src) drawWarped(ctx, src, src.width, src.height, { x: s.x, y: s.y, w: s.w ?? src.width, h: s.h ?? src.height, rot: s.rot, skew: s.skew, bend: s.bend });
                return;
            }
            if (bmp) {
                if (typeof s.w === 'number' && typeof s.h === 'number') ctx.drawImage(bmp, s.x, s.y, s.w, s.h);
                else ctx.drawImage(bmp, s.x, s.y);
            } else if (img) {
                if (typeof s.w === 'number' && typeof s.h === 'number' && (s.w !== img.width || s.h !== img.height)) {
                    ctx.drawImage(imageDataCanvas(img), s.x, s.y, s.w, s.h);
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
        //
        // The rough pen has had no button since the layer effect replaced it, so no new stroke
        // can be made with it - but projects saved before that still contain some, and dropping
        // this branch would redraw them as plain lines with nothing to say so. Read it as a file
        // format rather than as a tool.
        //
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
        // Pressure at a point of a smoothed path, or the neutral 0.5 when the stroke has none.
        // Every tool below asked this question in its own words.
        const prAt = (pts, i) => hasPressure && pts.length > 1 ? pressureAt(pts, Math.max(1, i)) : 0.5;
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
            const mw = mp.map((_, i) => hasPressure ? s.size * prAt(mp, i) * 2 : s.size);
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
            const pp = smooth(s.points);
            const pw = pp.map((_, i) => s.size * (0.65 + 0.35 * Math.min(1, prAt(pp, i) * 2)));
            smoothStroke(tctx, pp, pw, (i) => { tctx.globalAlpha = 0.5 + 0.5 * Math.min(1, prAt(pp, i) * 2); });
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
        // The pencil, marker and airbrush have all returned by here; what is left is the brush,
        // the eraser and anything older that never got its own branch. This used to carry pencil
        // and airbrush cases too, which could not be reached and said otherwise.
        const widths = pts.map((_, i) => {
            const w = s.size * (hasPressure ? prAt(pts, i) * 2 : 1);
            return s.tool === 'brush' ? w * taperAt(Math.max(1, i), n) : w;
        });
        smoothStroke(ctx, pts, widths, () => { ctx.globalAlpha = isEraser ? 1 : baseOpacity; });
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1.0;
    });
}
