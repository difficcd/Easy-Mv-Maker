// Decoding a video file into frames, and finding its scene cuts.

import { tr } from '../i18n.js';
import { makeCanvas } from './canvasFactory.ts';

// Letterbox rect: fit source into destination preserving aspect ratio.
export function fitRect(sw, sh, dw, dh) {
    const s = Math.min(dw / sw, dh / sh);
    const w = sw * s, h = sh * s;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

// Decode a video file into evenly spaced frames (ImageData at the project resolution) by
// seeking. Returns { frames, fps, duration }. onProgress(done, total) for UI feedback.
/**
 * Where a seek should actually land.
 *
 * Never the very last frame: seeking to exactly `duration` fires no `seeked` event in some
 * browsers, and the promise waiting for one then never settles - an import that stops halfway
 * with no error. The scene detector had learnt this and clamped; the frame extractor had not,
 * and it steps right up to the end of the range it was given.
 *
 * @param {number} t
 * @param {number} duration
 * @returns {number}
 */
export function seekTarget(t, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.max(0, Math.min(t, duration - 0.02));
}

/**
 * Open a video file for frame-by-frame reading.
 *
 * Both readers - the frame importer and the scene detector - set up the same element the same
 * way, waited for metadata the same way, and tore it down the same way. Two copies of an object
 * URL's lifetime is two chances to leak one, and they had already drifted over the seek clamp
 * above.
 *
 * The caller decides what an unusable duration means: the importer treats it as an error, the
 * detector shrugs and reports no cuts, and that difference is deliberate.
 *
 * @param {File|Blob} file
 * @returns {Promise<{video: HTMLVideoElement, duration: number,
 *   seek: (t: number) => Promise<void>, release: () => void}>}
 */
export async function openVideoFile(file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
    const release = () => { URL.revokeObjectURL(url); video.src = ''; };
    try {
        await /** @type {Promise<void>} */ (new Promise((res, rej) => {
            video.onloadedmetadata = () => res();
            video.onerror = () => rej(new Error(tr('영상을 읽을 수 없습니다 (형식 미지원)')));
        }));
    } catch (e) {
        release();          // the element never became usable, so nothing else will free the URL
        throw e;
    }
    const duration = video.duration;
    const seek = (t) => /** @type {Promise<void>} */ (new Promise((res) => {
        const on = () => { video.removeEventListener('seeked', on); res(); };
        video.addEventListener('seeked', on);
        video.currentTime = seekTarget(t, duration);
    }));
    return { video, duration, seek, release };
}

/**
 * @param {File|Blob} file
 * @param {{fps?:number, maxFrames?:number, start?:number, end?:number|null, scale?:number,
 *   quality?:number, dedupe?:string|number, nativeRes?:boolean, format?:string,
 *   width?:number, height?:number, onProgress?:Function, shouldStop?:Function}} [opts]
 */
export async function extractVideoFrames(file, { fps = 6, maxFrames = 0, start = 0, end = null, width, height, scale = 1, quality = 0.82, dedupe = 'exact', nativeRes = false, format = 'webp', onProgress, shouldStop } = {}) {
    const { video, duration, seek, release } = await openVideoFile(file);
    try {
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
        const cnv = makeCanvas();
        cnv.width = fw; cnv.height = fh;
        const ctx = cnv.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // crisp resampling when scaling
        const r = useNative ? { x: 0, y: 0, w: fw, h: fh } : fitRect(vW, vH, fw, fh);
        const toBlob = format === 'png'
            ? () => new Promise((res) => cnv.toBlob(res, 'image/png'))                    // lossless
            : () => new Promise((res) => cnv.toBlob(b => b ? res(b) : cnv.toBlob(res, 'image/jpeg', quality), 'image/webp', quality));
        // Cheap similarity signature: the frame downscaled to 32x32 grayscale. Comparing these
        // lets a still shot skip encoding entirely — the previous frame just gets held longer.
        const sw = 32, sh = 32;
        const sig = makeCanvas();
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
        release();
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
    const { video, duration: dur, seek, release } = await openVideoFile(file);
    try {
        if (!isFinite(dur) || dur <= 0) return [];
        const to = Math.min(end ?? dur, dur), from = Math.max(0, Math.min(start, to - 0.05));
        const sw = 48, sh = 48, c = makeCanvas(); c.width = sw; c.height = sh; // finer signature = more accurate
        const cx = c.getContext('2d', { willReadFrequently: true });
        const sig = () => { cx.drawImage(video, 0, 0, sw, sh); const d = cx.getImageData(0, 0, sw, sh).data, o = new Uint8Array(sw * sh); for (let i = 0, j = 0; j < o.length; i += 4, j++) o[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; return o; };
        const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
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
    } finally { release(); }
}
