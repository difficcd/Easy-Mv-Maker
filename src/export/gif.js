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

import { ByteWriter } from './byteWriter.js';

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
 * A GIF being written, one frame at a time.
 *
 * The whole-animation version had to be handed every frame before it could start. That is fine
 * for one project and wrong for a queue of them (#123), which works by never holding more than
 * one piece - so an encoder that wants them all at once takes that back.
 *
 * Streaming is unusually easy here, and worth saying why: this encoder already gives **every
 * frame its own local colour table**. Nothing is shared between frames, so a frame written now
 * and a frame written after the next piece is loaded are encoded identically to two frames of
 * one animation. There is no seam. (Stitching finished GIF *files* together would have a palette
 * problem; writing frames into one file does not.)
 */
export class GifWriter {
    /**
     * @param {{width: number, height: number, delayMs?: number, loop?: boolean, alphaCutoff?: number}} opts
     */
    constructor({ width, height, delayMs = 100, loop = true, alphaCutoff = 128 }) {
        this.width = width;
        this.height = height;
        this.delayMs = delayMs;
        this.alphaCutoff = alphaCutoff;
        this.frames = 0;
        this.finished = false;
        const out = this.out = new ByteWriter();

        out.str('GIF89a');
        out.u16(width); out.u16(height);
        // No global colour table: every frame brings its own, so this byte only says how deep the
        // screen is. Background index and pixel aspect are both zero.
        out.u8(0x70); out.u8(0); out.u8(0);

        if (loop) {
            // The Netscape extension. Not in the specification, universally implemented, and the
            // only way to say "repeat forever".
            out.u8(0x21); out.u8(0xff); out.u8(11);
            out.str('NETSCAPE2.0');
            out.u8(3); out.u8(1); out.u16(0); out.u8(0);
        }
    }

    /**
     * Add one frame. Its pixels are encoded immediately, so the caller may release them after -
     * which is the whole point: a queue drops each piece's frames as it goes.
     *
     * @param {Uint8ClampedArray} rgba
     * @param {{delayMs?: number}} [opts]
     */
    addFrame(rgba, { delayMs } = {}) {
        if (this.finished) throw new Error('gif already finished');
        const out = this.out;
        const { palette, indexOf } = buildPalette(rgba, this.alphaCutoff);
        const indices = toIndices(rgba, indexOf, this.alphaCutoff);
        const bits = paletteBits(palette.length + 1);   // +1 for the transparent slot
        const tableSize = 1 << bits;

        // Graphic control: the delay, the transparent index, and disposal 2 so the frame is
        // cleared rather than left underneath the next one.
        out.u8(0x21); out.u8(0xf9); out.u8(4);
        out.u8((2 << 2) | 1);                                        // disposal 2, transparency on
        out.u16(Math.max(1, Math.round((delayMs ?? this.delayMs) / 10)));   // hundredths
        out.u8(TRANSPARENT);
        out.u8(0);

        out.u8(0x2c);                                                // image descriptor
        out.u16(0); out.u16(0); out.u16(this.width); out.u16(this.height);
        out.u8(0x80 | (bits - 1));                                   // local colour table, its size

        // Slot 0 is the transparent one. Its colour is never drawn, but it has to be present.
        out.u8(0); out.u8(0); out.u8(0);
        for (let i = 0; i < tableSize - 1; i++) {
            const rgb = palette[i] ?? 0;
            out.u8((rgb >> 16) & 255); out.u8((rgb >> 8) & 255); out.u8(rgb & 255);
        }

        const minCodeSize = Math.max(2, bits);
        out.u8(minCodeSize);
        writeSubBlocks(out, lzwEncode(indices, minCodeSize));
        this.frames++;
    }

    /**
     * Write the trailer and hand back the file.
     * @returns {Uint8Array<ArrayBuffer>}
     */
    finish() {
        if (this.finished) throw new Error('gif already finished');
        // Guarded here rather than at the caller, so it covers a queue that turned out to have
        // nothing in it as well as an encodeGif handed an empty list. A GIF with no frames is a
        // header and a trailer: something a viewer will open and show nothing for.
        if (!this.frames) throw new Error('a GIF needs at least one frame');
        this.finished = true;
        this.out.u8(0x3b);   // trailer
        return this.out.done();
    }
}

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
    const gif = new GifWriter({ width, height, delayMs, loop, alphaCutoff });
    for (const frame of frames) gif.addFrame(frame.rgba, { delayMs: frame.delayMs });
    return gif.finish();
}
