// The bucket fill: flood a region of an ImageData and the mask around it.

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
    // One line of the mask, walked from one end. Set pixels reset the counter and every pixel
    // within r of one is marked, so walking both ways covers a set pixel's neighbours on both
    // sides. Written once and called twice rather than the loop appearing twice with only its
    // bounds changed.
    const sweep = (src, dst, base, stride, from, to, step) => {
        let since = -1;   // pixels travelled since the last set one; -1 = none seen yet
        for (let i = from; i !== to; i += step) {
            const idx = base + i * stride;
            if (src[idx]) since = 0; else if (since >= 0) since++;
            if (since >= 0 && since <= r) dst[idx] = 1;
        }
    };
    const pass = (src, dst, stride, outer, inner) => {
        for (let o = 0; o < outer; o++) {
            const base = o * (stride === 1 ? w : 1);
            sweep(src, dst, base, stride, 0, inner, 1);
            sweep(src, dst, base, stride, inner - 1, -1, -1);
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
