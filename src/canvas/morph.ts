// Shape (distance-field) morphing for tweening: one drawing becomes another.

// --- Shape (distance-field) morphing for tweening ---
// Felzenszwalb 1D squared Euclidean distance transform (f: 0 at seeds, INF elsewhere).
function edt1d(f: Float64Array, n: number): Float64Array {
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

function edt2d(seed: Uint8Array, w: number, h: number): Float64Array {
    const INF = 1e20;
    const grid = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) grid[i] = seed[i] ? 0 : INF;
    const col = new Float64Array(h);
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) col[y] = grid[y * w + x]; const d = edt1d(col, h); for (let y = 0; y < h; y++) grid[y * w + x] = d[y]; }
    const row = new Float64Array(w);
    for (let y = 0; y < h; y++) { const off = y * w; for (let x = 0; x < w; x++) row[x] = grid[off + x]; const d = edt1d(row, w); for (let x = 0; x < w; x++) grid[off + x] = Math.sqrt(d[x]); }
    return grid; // Euclidean distance to nearest seed
}

function signedDist(mask: Uint8Array, w: number, h: number): Float32Array {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
    const dOut = edt2d(mask, w, h);  // 0 inside, >0 outside
    const dIn = edt2d(inv, w, h);    // 0 outside, >0 inside
    const s = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) s[i] = dOut[i] - dIn[i]; // <0 inside shape
    return s;
}

// Morph the whole pixel distribution of A into B via signed-distance-field interpolation: the
// shape itself moves and grows between the two frames, rather than one crossfading into the
// other. Filled with the A->B average ink colour, with a soft 1px edge.
//
// The distance fields are most of the work and do not depend on t, so this computes them once
// and returns a function that produces a single in-between frame. The caller drives it, which is
// what lets the tweening dialog show progress and yield to the UI between frames.
//
// There used to be morphFrames(a, b, t) and morphSequence(a, b, ts) in front of this. Nothing
// called either - morphSequence only ever had morphFrames as a caller, and morphFrames had none -
// and their own comment said calling them per frame would be N times slower than this. An unused
// wrapper that is also the slow way to do the thing is worse than no wrapper: it reads like the
// entry point.
export function morphPrepare(aImg: ImageData, bImg: ImageData): (t: number) => ImageData {
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
        return (t: number) => {
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
    return (t: number) => {
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
