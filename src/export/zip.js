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

import { ByteWriter } from './byteWriter.js';

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
 * A ZIP being written, one entry at a time.
 *
 * The whole-archive version had to know every entry before it could start, because it measured
 * everything to allocate one exact buffer. That is fine for a single project's frames and wrong
 * for a queue of them: exporting several pieces as one file (#123) works precisely by never
 * holding more than one piece, and an archive builder that wants them all at once takes that back.
 *
 * Streaming costs one thing - the archive is written into a growing buffer rather than an exact
 * one - and saves a bigger one: the caller can drop each piece's frames as soon as they are in,
 * so peak memory is the archive plus one frame rather than the archive plus every frame.
 *
 * Store-only, like the whole-archive version, because PNGs are already deflated.
 */
export class ZipWriter {
    /** @param {{ date?: Date }} [opts] */
    constructor({ date = new Date() } = {}) {
        const { time, date: dosDate } = dosDateTime(date);
        this.time = time;
        this.dosDate = dosDate;
        this.w = new ByteWriter();
        this.enc = new TextEncoder();
        /** @type {{name: Uint8Array, crc: number, size: number, offset: number}[]} */
        this.files = [];
        this.finished = false;
    }

    /**
     * Add one file. Its bytes are written immediately, so the caller may release them after.
     *
     * @param {string} name
     * @param {Uint8Array} data
     */
    add(name, data) {
        if (this.finished) throw new Error('zip already finished');
        if (this.files.length >= 0xffff) throw new Error('too many files for a non-zip64 archive');
        const encoded = this.enc.encode(name);
        if (encoded.length > 0xffff) throw new Error('file name too long: ' + name);
        const offset = this.w.position;
        // An entry that starts past 4GB cannot be pointed at by a 32-bit central directory offset,
        // and refusing here says which file it was rather than writing a header that lies.
        if (offset > 0xffffffff) throw new Error('archive too large for a non-zip64 archive');
        const crc = crc32(data);
        const w = this.w;
        w.u32(LOCAL_SIG);
        w.u16(20);              // version needed
        w.u16(0);               // flags
        w.u16(0);               // method: stored
        w.u16(this.time); w.u16(this.dosDate);
        w.u32(crc);
        w.u32(data.length);     // compressed
        w.u32(data.length);     // uncompressed
        w.u16(encoded.length);
        w.u16(0);               // extra field length
        w.bytes(encoded);
        w.bytes(data);
        this.files.push({ name: encoded, crc, size: data.length, offset });
    }

    /**
     * Write the central directory and hand back the archive.
     *
     * @returns {Uint8Array<ArrayBuffer>}
     */
    finish() {
        if (this.finished) throw new Error('zip already finished');
        this.finished = true;
        const w = this.w;
        const centralStart = w.position;
        for (const f of this.files) {
            w.u32(CENTRAL_SIG);
            w.u16(20);          // version made by
            w.u16(20);          // version needed
            w.u16(0); w.u16(0); // flags, method
            w.u16(this.time); w.u16(this.dosDate);
            w.u32(f.crc);
            w.u32(f.size); w.u32(f.size);
            w.u16(f.name.length);
            w.u16(0); w.u16(0); // extra, comment
            w.u16(0);           // disk number
            w.u16(0);           // internal attrs
            w.u32(0);           // external attrs
            w.u32(f.offset);
            w.bytes(f.name);
        }
        // Taken before the end record is written: position is a cursor, and by the time the size
        // field is reached it has already moved past the directory it is meant to measure.
        const centralEnd = w.position;
        w.u32(END_SIG);
        w.u16(0); w.u16(0);     // this disk, disk with central directory
        w.u16(this.files.length); w.u16(this.files.length);
        w.u32(centralEnd - centralStart);
        w.u32(centralStart);
        w.u16(0);               // comment length
        return w.done();
    }
}

/**
 * Build a ZIP archive from entries already in memory.
 *
 * Kept as the name every existing caller uses; it is the streaming writer with all the entries
 * handed over at once.
 *
 * @param {ZipEntry[]} entries
 * @param {{ date?: Date }} [opts]
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function makeZip(entries, { date = new Date() } = {}) {
    if (entries.length > 0xffff) throw new Error('too many files for a non-zip64 archive');
    const zip = new ZipWriter({ date });
    for (const e of entries) zip.add(e.name, e.data);
    return zip.finish();
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
