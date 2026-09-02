// A minimal ZIP writer, store-only (no compression).
//
// PNGs are already deflated, so compressing them again buys almost nothing and would cost a
// dependency plus a second pass over every frame. Storing them keeps this a hundred lines of
// pure arithmetic that can be unit tested without a browser.
//
// The format written is the classic one every unzip tool reads: a local header before each
// file, a central directory listing them all, and an end-of-central-directory record pointing
// at that listing. Zip64 is not written, so this tops out at 4GB or 65535 files - far past any
// frame sequence this app produces, but the limits are checked rather than silently exceeded.

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

/** @typedef {{ name: string, data: Uint8Array }} ZipEntry */

/**
 * CRC-32, the checksum ZIP uses. The table is built once on first use rather than at module
 * load, so importing this module for its types costs nothing.
 * @returns {Uint32Array}
 */
let crcTable = null;
function table() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
    }
    return crcTable;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number} unsigned CRC-32
 */
export function crc32(bytes) {
    const t = table();
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date and time, which is what ZIP stores. Two seconds is the resolution the format
 * has; nothing here needs better.
 * @param {Date} d
 * @returns {{ time: number, date: number }}
 */
export function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

/**
 * Build a ZIP archive from entries already in memory.
 *
 * @param {ZipEntry[]} entries
 * @param {{ date?: Date }} [opts]
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function makeZip(entries, { date = new Date() } = {}) {
    if (entries.length > 0xffff) throw new Error('too many files for a non-zip64 archive');
    const enc = new TextEncoder();
    const { time, date: dosDate } = dosDateTime(date);

    const files = entries.map(e => {
        const name = enc.encode(e.name);
        if (name.length > 0xffff) throw new Error('file name too long: ' + e.name);
        return { name, data: e.data, crc: crc32(e.data) };
    });

    const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
    const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
    const total = localSize + centralSize + 22;
    if (total > 0xffffffff) throw new Error('archive too large for a non-zip64 archive');

    // Backed by a plain ArrayBuffer rather than an inferred ArrayBufferLike, so the result
    // can be handed straight to a Blob.
    const out = new Uint8Array(new ArrayBuffer(total));
    const view = new DataView(out.buffer);
    let p = 0;
    const u32 = (v) => { view.setUint32(p, v, true); p += 4; };
    const u16 = (v) => { view.setUint16(p, v, true); p += 2; };

    const offsets = [];
    for (const f of files) {
        offsets.push(p);
        u32(LOCAL_SIG);
        u16(20);            // version needed
        u16(0);             // flags
        u16(0);             // method: stored
        u16(time); u16(dosDate);
        u32(f.crc);
        u32(f.data.length); // compressed
        u32(f.data.length); // uncompressed
        u16(f.name.length);
        u16(0);             // extra field length
        out.set(f.name, p); p += f.name.length;
        out.set(f.data, p); p += f.data.length;
    }

    const centralStart = p;
    files.forEach((f, i) => {
        u32(CENTRAL_SIG);
        u16(20);            // version made by
        u16(20);            // version needed
        u16(0); u16(0);     // flags, method
        u16(time); u16(dosDate);
        u32(f.crc);
        u32(f.data.length); u32(f.data.length);
        u16(f.name.length);
        u16(0); u16(0);     // extra, comment
        u16(0);             // disk number
        u16(0);             // internal attrs
        u32(0);             // external attrs
        u32(offsets[i]);
        out.set(f.name, p); p += f.name.length;
    });

    // Taken before the end record is written: `p` is a cursor, and by the time the size field
    // is reached it has already moved past the directory it is meant to measure.
    const centralEnd = p;
    u32(END_SIG);
    u16(0); u16(0);         // this disk, disk with central directory
    u16(files.length); u16(files.length);
    u32(centralEnd - centralStart);
    u32(centralStart);
    u16(0);                 // comment length
    return out;
}

/**
 * `frame_0001.png` and friends. Padded so a plain alphabetical sort is also chronological,
 * which is how every editor imports a sequence.
 *
 * @param {number} index zero-based
 * @param {number} count total frames, which sets the width
 * @returns {string}
 */
export function frameName(index, count) {
    const width = Math.max(4, String(Math.max(1, count - 1)).length);
    return `frame_${String(index).padStart(width, '0')}.png`;
}
