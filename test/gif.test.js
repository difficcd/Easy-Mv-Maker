import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPalette, toIndices, lzwEncode, paletteBits, encodeGif } from '../src/export/gif.js';

const rgba = (...px) => new Uint8ClampedArray(px.flat());
const OPAQUE_RED = [255, 0, 0, 255];
const OPAQUE_BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

/**
 * GIF's LZW, decoded. Written from the format's description rather than from the encoder, so a
 * mistake in bit packing or table growth shows up as pixels that differ rather than as two
 * copies of the same misunderstanding agreeing with each other.
 */
function lzwDecode(bytes, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let table = [];
    const resetTable = () => {
        table = [];
        for (let i = 0; i < clearCode; i++) table.push([i]);
        table.push([], []);          // clear and end occupy their slots
        codeSize = minCodeSize + 1;
    };
    resetTable();

    const out = [];
    let bitPos = 0, prev = null;
    const readCode = () => {
        let code = 0;
        for (let i = 0; i < codeSize; i++) {
            const byte = bytes[bitPos >> 3];
            if (byte === undefined) return endCode;
            code |= ((byte >> (bitPos & 7)) & 1) << i;
            bitPos++;
        }
        return code;
    };

    for (;;) {
        const code = readCode();
        if (code === endCode) break;
        if (code === clearCode) { resetTable(); prev = null; continue; }
        let entry;
        if (code < table.length && table[code].length) entry = table[code];
        else if (code === table.length && prev) entry = [...prev, prev[0]];
        else if (prev === null && code < clearCode) entry = table[code];
        else break;
        out.push(...entry);
        if (prev) {
            table.push([...prev, entry[0]]);
            if (table.length === (1 << codeSize) && codeSize < 12) codeSize++;
        }
        prev = entry;
    }
    return out;
}

// --- the palette --------------------------------------------------------------------------------

test('the palette holds the colours actually used, transparent pixels aside', () => {
    const { palette } = buildPalette(rgba(OPAQUE_RED, CLEAR, OPAQUE_BLUE));
    assert.equal(palette.length, 2);
    assert.ok(palette.includes(0xff0000));
    assert.ok(palette.includes(0x0000ff));
});

test('a fully transparent frame needs no colours at all', () => {
    assert.deepEqual(buildPalette(rgba(CLEAR, CLEAR)).palette, []);
});

test('the most-used colours are the ones that survive a cut', () => {
    // Two of a common colour, one of a rare one, room for one.
    const px = rgba(OPAQUE_RED, OPAQUE_RED, OPAQUE_BLUE);
    const { palette } = buildPalette(px, 128, 1);
    assert.deepEqual(palette, [0xff0000]);
});

test('a colour that was cut still maps somewhere, to its nearest survivor', () => {
    const nearRed = [250, 5, 5, 255];
    const px = rgba(OPAQUE_RED, OPAQUE_RED, OPAQUE_BLUE, OPAQUE_BLUE, nearRed);
    const { indexOf } = buildPalette(px, 128, 2);
    const nearIdx = indexOf.get((250 << 16) | (5 << 8) | 5);
    const redIdx = indexOf.get(0xff0000);
    assert.equal(nearIdx, redIdx, 'a near-red folds into red, not into blue');
});

test('index 0 is never handed to a colour, because it is the transparent slot', () => {
    const { indexOf } = buildPalette(rgba(OPAQUE_RED, OPAQUE_BLUE));
    for (const v of indexOf.values()) assert.ok(v >= 1);
});

test('the alpha cutoff decides what counts as transparent', () => {
    const faint = [10, 20, 30, 100];
    assert.equal(buildPalette(rgba(faint), 128).palette.length, 0, 'below the cutoff: dropped');
    assert.equal(buildPalette(rgba(faint), 50).palette.length, 1, 'above it: a colour');
});

test('toIndices writes the transparent slot where the alpha was low', () => {
    const px = rgba(OPAQUE_RED, CLEAR, OPAQUE_RED);
    const { indexOf } = buildPalette(px);
    const idx = toIndices(px, indexOf);
    assert.equal(idx[1], 0);
    assert.equal(idx[0], idx[2]);
    assert.notEqual(idx[0], 0);
});

test('paletteBits never goes below two, which is the smallest GIF allows', () => {
    assert.equal(paletteBits(1), 2);
    assert.equal(paletteBits(4), 2);
    assert.equal(paletteBits(5), 3);
    assert.equal(paletteBits(256), 8);
});

// --- LZW ------------------------------------------------------------------------------------------

test('LZW round-trips a run of one value', () => {
    const indices = new Uint8Array(50).fill(3);
    assert.deepEqual(lzwDecode(lzwEncode(indices, 4), 4), [...indices]);
});

test('LZW round-trips a repeating pattern, which is where the table fills', () => {
    const indices = new Uint8Array(600);
    for (let i = 0; i < indices.length; i++) indices[i] = i % 7;
    assert.deepEqual(lzwDecode(lzwEncode(indices, 4), 4), [...indices]);
});

test('LZW round-trips noise, which shares nothing and grows the table fastest', () => {
    let seed = 12345;
    const indices = new Uint8Array(3000);
    for (let i = 0; i < indices.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        indices[i] = seed % 16;
    }
    assert.deepEqual(lzwDecode(lzwEncode(indices, 4), 4), [...indices]);
});

test('LZW round-trips enough data to clear the table more than once', () => {
    // Past 4096 codes the encoder must emit a clear and start again. A decoder that did not
    // expect it would read garbage from there on, so this is the case worth forcing.
    let seed = 999;
    const indices = new Uint8Array(60000);
    for (let i = 0; i < indices.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        indices[i] = seed % 200;
    }
    assert.deepEqual(lzwDecode(lzwEncode(indices, 8), 8), [...indices]);
});

test('LZW round-trips a single pixel', () => {
    assert.deepEqual(lzwDecode(lzwEncode(new Uint8Array([5]), 4), 4), [5]);
});

// --- the file ---------------------------------------------------------------------------------

const read = (b, i, n) => [...b.slice(i, i + n)];
const ascii = (b, i, n) => String.fromCharCode(...b.slice(i, i + n));

test('the file says GIF89a and ends with the trailer', () => {
    const gif = encodeGif([{ rgba: rgba(OPAQUE_RED) }], { width: 1, height: 1 });
    assert.equal(ascii(gif, 0, 6), 'GIF89a');
    assert.equal(gif[gif.length - 1], 0x3b);
});

test('the screen size is the size asked for', () => {
    const px = new Uint8ClampedArray(6 * 4).fill(255);
    const gif = encodeGif([{ rgba: px }], { width: 3, height: 2 });
    assert.deepEqual(read(gif, 6, 4), [3, 0, 2, 0]);
});

test('a looping GIF carries the Netscape extension, and one that does not, does not', () => {
    const one = { rgba: rgba(OPAQUE_RED) };
    const looped = encodeGif([one], { width: 1, height: 1, loop: true });
    const once = encodeGif([one], { width: 1, height: 1, loop: false });
    assert.ok(ascii(looped, 0, looped.length).includes('NETSCAPE2.0'));
    assert.ok(!ascii(once, 0, once.length).includes('NETSCAPE2.0'));
});

test('every frame is marked transparent and disposed, or a transparent animation smears', () => {
    const frames = [{ rgba: rgba(OPAQUE_RED) }, { rgba: rgba(OPAQUE_BLUE) }];
    const gif = encodeGif(frames, { width: 1, height: 1 });
    let found = 0;
    for (let i = 0; i < gif.length - 3; i++) {
        if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) {
            const flags = gif[i + 3];
            assert.equal((flags >> 2) & 7, 2, 'disposal 2: restore to background');
            assert.equal(flags & 1, 1, 'transparency on');
            found++;
        }
    }
    assert.equal(found, 2, 'one graphic control per frame');
});

/** The graphic control extension, not the Netscape one - both begin with 0x21. */
const graphicControlAt = (gif) => {
    for (let i = 0; i < gif.length - 2; i++) {
        if (gif[i] === 0x21 && gif[i + 1] === 0xf9) return i;
    }
    throw new Error('no graphic control extension');
};

test('the delay is written in hundredths, and never rounds to zero', () => {
    const gif = encodeGif([{ rgba: rgba(OPAQUE_RED), delayMs: 250 }], { width: 1, height: 1 });
    assert.deepEqual(read(gif, graphicControlAt(gif) + 4, 2), [25, 0]);

    const fast = encodeGif([{ rgba: rgba(OPAQUE_RED), delayMs: 3 }], { width: 1, height: 1 });
    assert.ok(fast[graphicControlAt(fast) + 4] >= 1,
        'a delay that rounds to nothing would play as fast as the viewer can manage');
});

test('a frame delay overrides the animation default', () => {
    const gif = encodeGif([{ rgba: rgba(OPAQUE_RED), delayMs: 500 }], { width: 1, height: 1, delayMs: 100 });
    assert.deepEqual(read(gif, graphicControlAt(gif) + 4, 2), [50, 0]);
});

test('a frame with no colour at all still produces a valid file', () => {
    // Every pixel transparent: the palette is empty, and the code must not write a zero-size
    // colour table or a zero-bit code size.
    const gif = encodeGif([{ rgba: rgba(CLEAR, CLEAR) }], { width: 2, height: 1 });
    assert.equal(ascii(gif, 0, 6), 'GIF89a');
    assert.equal(gif[gif.length - 1], 0x3b);
});

test('an empty animation is refused rather than written as a broken file', () => {
    assert.throws(() => encodeGif([], { width: 1, height: 1 }), /at least one frame/);
});

test('the pixels come back out of the file', () => {
    // The whole point, end to end: build a small picture, encode it, find the image data, and
    // decode it with the independent decoder above.
    const W = 4, H = 2;
    const px = new Uint8ClampedArray(W * H * 4);
    const put = (i, c) => px.set(c, i * 4);
    put(0, OPAQUE_RED); put(1, OPAQUE_BLUE); put(2, CLEAR); put(3, OPAQUE_RED);
    put(4, CLEAR); put(5, CLEAR); put(6, OPAQUE_BLUE); put(7, OPAQUE_RED);

    const gif = encodeGif([{ rgba: px }], { width: W, height: H });

    // Walk to the image descriptor, then past the local colour table to the LZW data.
    const desc = gif.indexOf(0x2c);
    const flags = gif[desc + 9];
    const tableEntries = 1 << ((flags & 7) + 1);
    let p = desc + 10 + tableEntries * 3;
    const minCodeSize = gif[p++];
    const data = [];
    for (;;) {
        const n = gif[p++];
        if (!n) break;
        for (let i = 0; i < n; i++) data.push(gif[p++]);
    }
    const indices = lzwDecode(data, minCodeSize);
    assert.equal(indices.length, W * H);

    // Read the table back and check each pixel is the colour it went in as.
    const table = [];
    for (let i = 0; i < tableEntries; i++) {
        const at = desc + 10 + i * 3;
        table.push([gif[at], gif[at + 1], gif[at + 2]]);
    }
    for (let i = 0; i < W * H; i++) {
        const wasClear = px[i * 4 + 3] === 0;
        if (wasClear) { assert.equal(indices[i], 0, `pixel ${i} should be the transparent index`); continue; }
        assert.notEqual(indices[i], 0, `pixel ${i} should not be transparent`);
        assert.deepEqual(table[indices[i]], [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]], `pixel ${i}`);
    }
});
