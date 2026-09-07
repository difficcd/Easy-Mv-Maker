/**
 * A growable byte buffer.
 *
 * The obvious thing is to collect bytes in a plain array and convert at the end, and for a small
 * picture it is fine. A full-size frame is two million pixels, and a JS array holds each byte as
 * a number - eight bytes of heap for one byte of output - so a handful of frames turns into
 * hundreds of megabytes before anything is written. This doubles a Uint8Array instead.
 *
 * Both export formats want one, and they want it for the same reason, so it lives here rather
 * than inside whichever of them was written first. Everything is little-endian, which is what
 * both GIF and ZIP use.
 */
export class ByteWriter {
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
    u32(v) {
        this._room(4);
        // >>> rather than >>, so a value with the top bit set - a CRC, or an offset past 2GB -
        // does not come out as a negative number and write the wrong bytes.
        this.buf[this.len++] = v & 255;
        this.buf[this.len++] = (v >>> 8) & 255;
        this.buf[this.len++] = (v >>> 16) & 255;
        this.buf[this.len++] = (v >>> 24) & 255;
    }
    str(text) { this._room(text.length); for (let i = 0; i < text.length; i++) this.buf[this.len++] = text.charCodeAt(i); }
    bytes(arr) { this._room(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
    /** How many bytes have been written, which is also the offset the next one lands at. */
    get position() { return this.len; }
    /** @returns {Uint8Array<ArrayBuffer>} backed by a plain ArrayBuffer, ready for a Blob. */
    done() {
        const out = new Uint8Array(new ArrayBuffer(this.len));
        out.set(this.buf.subarray(0, this.len));
        return out;
    }
}
