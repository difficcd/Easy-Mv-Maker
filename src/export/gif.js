// A GIF89a encoder, enough of one to write an animation with a transparent background.
//
// This exists because a transparent animation is what was asked for and no browser API produces
// one. MediaRecorder loses the alpha channel above about 480p - measured - and WebCodecs reports
// `alpha: 'keep'` unsupported for every codec it offers. GIF is the one animated format a browser
// can be made to write, and writing it is only arithmetic.
//
// What GIF costs, and it is worth knowing before choosing it:
//
//   - transparency is one bit. A pixel is either fully transparent or fully opaque, so the soft
//     edge of an anti-aliased line becomes a hard one. A PNG sequence keeps the soft edge; this
//     gives one file that plays.
//   - 256 colours a frame, one of which is spent on the transparent index, so 255 for the
//     drawing. Line art and flat colour are comfortable inside that; a photographic frame is not.
//   - delays are in hundredths of a second, so the frame rate is quantised.

/**
 * A growable byte buffer.
 *
 * The obvious thing is to collect bytes in a plain array and convert at the end, and for a small
 * picture it is fine. A full-size frame is two million pixels, and a JS array holds each byte as
 * a number - eight bytes of heap for one byte of output - so a handful of frames turns into
 * hundreds of megabytes before anything is written. This doubles a Uint8Array instead.
 */
class ByteWriter {
    constructor(capacity = 1 << 16) {
        this.buf = new Uint8Array(capacity);
        this.len = 0;
    }
    _room(n) {
        if (this.len + n <= this.buf.length) return;
        let size = this.buf.length;
        while (size < this.len + n) size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
    }
    u8(v) { this._room(1); this.buf[this.len++] = v & 255; }
    u16(v) { this._room(2); this.buf[this.len++] = v & 255; this.buf[this.len++] = (v >> 8) & 255; }
    str(text) { this._room(text.length); for (let i = 0; i < text.length; i++) this.buf[this.len++] = text.charCodeAt(i); }
    bytes(arr) { this._room(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
    /** @returns {Uint8Array<ArrayBuffer>} backed by a plain ArrayBuffer, ready for a Blob. */
    done() {
        const out = new Uint8Array(new ArrayBuffer(this.len));
        out.set(this.buf.subarray(0, this.len));
        return out;
    }
}

const TRANSPARENT = 0;   // palette slot 0 is reserved for it, so every frame agrees where it is.

/**
 * Colours actually used, and a lookup from packed RGB to palette index.
 *
 * Exact rather than quantised while the count fits, because this app's frames are flat colour on
 * a transparent ground and an exact palette is both smaller and sharper than a quantised one.
 * Past the limit the least-used colours are folded into their nearest neighbour, which is the
 * cheap answer and the right one for a drawing that has a few flat colours plus anti-aliasing.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {number} alphaCutoff a pixel at or below this alpha becomes the transparent index
 * @param {number} [limit] palette entries available for colour, not counting transparent
 * @returns {{ palette: number[], indexOf: Map<number, number> }} palette as packed 0xRRGGBB
 */
export function buildPalette(rgba, alphaCutoff = 128, limit = 255) {
    /** @type {Map<number, number>} */
    const counts = new Map();
    for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] <= alphaCutoff) continue;
        const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    // Most-used first, so what survives the cut is what the eye actually sees.
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const palette = ordered.slice(0, limit);
    const indexOf = new Map();
    palette.forEach((rgb, i) => indexOf.set(rgb, i + 1));   // +1: slot 0 is transparent

    // Anything cut goes to its nearest survivor. Nearest in plain RGB distance - a perceptual
    // space would be better and is not worth the size here, given what got cut is by definition
    // rare.
    for (const rgb of ordered.slice(limit)) {
        const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
        let best = 1, bestD = Infinity;
        for (let i = 0; i < palette.length; i++) {
            const p = palette[i];
            const dr = ((p >> 16) & 255) - r, dg = ((p >> 8) & 255) - g, db = (p & 255) - b;
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; best = i + 1; }
        }
        indexOf.set(rgb, best);
    }
    return { palette, indexOf };
}

/**
 * One frame's pixels as palette indices.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {Map<number, number>} indexOf
 * @param {number} alphaCutoff
 * @returns {Uint8Array}
 */
export function toIndices(rgba, indexOf, alphaCutoff = 128) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
        if (rgba[i + 3] <= alphaCutoff) { out[p] = TRANSPARENT; continue; }
        const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
        out[p] = indexOf.get(key) ?? 1;
    }
    return out;
}

/**
 * GIF's variable-width LZW, with the clear and end codes the format requires.
 *
 * Codes grow from `minCodeSize + 1` bits and the table is cleared when it fills, which is what
 * makes this GIF's LZW rather than any other - a decoder that did not expect the clear would
 * read garbage from the first full table onward.
 *
 * @param {Uint8Array} indices
 * @param {number} minCodeSize bits per pixel, at least 2
 * @returns {Uint8Array} the LZW byte stream, before sub-blocking
 */
export function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let next = endCode + 1;
    // Keyed by (prefix code, next pixel) packed into one integer. The first version built a
    // string key per pixel; at seven million pixels for a short animation that was twenty
    // seconds of making garbage, and the strings were the whole cost.
    /** @type {Map<number, number>} */
    let table = new Map();

    const out = new ByteWriter(Math.max(1024, indices.length >> 1));
    let cur = 0, curBits = 0;
    const emit = (code) => {
        cur |= code << curBits;
        curBits += codeSize;
        while (curBits >= 8) { out.u8(cur); cur >>= 8; curBits -= 8; }
    };

    emit(clearCode);
    if (indices.length) {
        // A single pixel's code is the pixel itself: the table starts with one entry per value.
        let prefix = indices[0];
        for (let i = 1; i < indices.length; i++) {
            const pixel = indices[i];
            const key = (prefix << 8) | pixel;
            const known = table.get(key);
            if (known !== undefined) { prefix = known; continue; }
            emit(prefix);
            table.set(key, next++);
            if (next > (1 << codeSize)) {
                if (codeSize < 12) codeSize++;
                else {
                    // The table is full. Tell the decoder to start again, or the codes we hand
                    // out next would mean something else to it.
                    emit(clearCode);
                    table = new Map();
                    next = endCode + 1;
                    codeSize = minCodeSize + 1;
                }
            }
            prefix = pixel;
        }
        emit(prefix);
    }
    emit(endCode);
    if (curBits > 0) out.u8(cur);
    return out.done();
}

/** GIF carries data in sub-blocks of at most 255 bytes, each preceded by its length. */
function writeSubBlocks(out, data) {
    for (let i = 0; i < data.length; i += 255) {
        const n = Math.min(255, data.length - i);
        out.u8(n);
        out.bytes(data.subarray(i, i + n));
    }
    out.u8(0);   // block terminator
}

/** The smallest power-of-two palette size that holds `n` entries, and its bit width. */
export function paletteBits(n) {
    let bits = 1;
    while ((1 << bits) < n) bits++;
    return Math.max(2, Math.min(8, bits));
}

/**
 * @typedef {object} GifFrame
 * @property {Uint8ClampedArray} rgba the frame, width * height * 4
 * @property {number} [delayMs] how long to hold it; defaults to the encoder's
 */

/**
 * Assemble an animated GIF.
 *
 * Each frame carries its own palette (a local colour table), so a colour that appears in one
 * frame and not another costs nothing elsewhere. Disposal method 2 - restore to background -
 * is what keeps a transparent animation from smearing: without it every frame would be composited
 * onto the last and the transparent parts would show the previous drawing rather than nothing.
 *
 * @param {GifFrame[]} frames
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} [opts.delayMs] default hold per frame
 * @param {boolean} [opts.loop] repeat forever; true by default
 * @param {number} [opts.alphaCutoff] alpha at or below which a pixel is transparent
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeGif(frames, { width, height, delayMs = 100, loop = true, alphaCutoff = 128 }) {
    if (!frames.length) throw new Error('a GIF needs at least one frame');
    const out = new ByteWriter();
    const u8 = (v) => out.u8(v);
    const u16 = (v) => out.u16(v);
    const str = (s) => out.str(s);

    str('GIF89a');
    u16(width); u16(height);
    // No global colour table: every frame brings its own, so this byte only says how deep the
    // screen is. Background index and pixel aspect are both zero.
    u8(0x70); u8(0); u8(0);

    if (loop) {
        // The Netscape extension. Not in the specification, universally implemented, and the
        // only way to say "repeat forever".
        u8(0x21); u8(0xff); u8(11);
        str('NETSCAPE2.0');
        u8(3); u8(1); u16(0); u8(0);
    }

    for (const frame of frames) {
        const { palette, indexOf } = buildPalette(frame.rgba, alphaCutoff);
        const indices = toIndices(frame.rgba, indexOf, alphaCutoff);
        const bits = paletteBits(palette.length + 1);   // +1 for the transparent slot
        const tableSize = 1 << bits;

        // Graphic control: the delay, the transparent index, and disposal 2 so the frame is
        // cleared rather than left underneath the next one.
        u8(0x21); u8(0xf9); u8(4);
        u8((2 << 2) | 1);                                     // disposal 2, transparency on
        u16(Math.max(1, Math.round((frame.delayMs ?? delayMs) / 10)));   // hundredths
        u8(TRANSPARENT);
        u8(0);

        u8(0x2c);                                             // image descriptor
        u16(0); u16(0); u16(width); u16(height);
        u8(0x80 | (bits - 1));                                // local colour table, its size

        // Slot 0 is the transparent one. Its colour is never drawn, but it has to be present.
        u8(0); u8(0); u8(0);
        for (let i = 0; i < tableSize - 1; i++) {
            const rgb = palette[i] ?? 0;
            u8((rgb >> 16) & 255); u8((rgb >> 8) & 255); u8(rgb & 255);
        }

        const minCodeSize = Math.max(2, bits);
        u8(minCodeSize);
        writeSubBlocks(out, lzwEncode(indices, minCodeSize));
    }

    u8(0x3b);   // trailer
    return out.done();
}
