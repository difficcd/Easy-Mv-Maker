import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, dosDateTime, makeZip, frameName } from '../src/export/zip.js';

const bytes = (s) => new TextEncoder().encode(s);

test('crc32 matches the known value for the standard check string', () => {
    // The value every CRC-32 implementation is checked against.
    assert.equal(crc32(bytes('123456789')), 0xcbf43926);
});

test('crc32 of nothing is zero', () => {
    assert.equal(crc32(new Uint8Array(0)), 0);
});

test('dosDateTime packs a date the way the format wants', () => {
    const { time, date } = dosDateTime(new Date(2024, 4, 17, 13, 45, 30));
    assert.equal((date >> 9) + 1980, 2024);
    assert.equal((date >> 5) & 0xf, 5);
    assert.equal(date & 0x1f, 17);
    assert.equal(time >> 11, 13);
    assert.equal((time >> 5) & 0x3f, 45);
    assert.equal((time & 0x1f) * 2, 30);
});

test('dates before 1980 clamp instead of writing a negative year', () => {
    const { date } = dosDateTime(new Date(1970, 0, 1));
    assert.equal(date >> 9, 0);
});

test('an archive starts with a local header and ends with the end record', () => {
    const zip = makeZip([{ name: 'a.txt', data: bytes('hello') }]);
    const v = new DataView(zip.buffer);
    assert.equal(v.getUint32(0, true), 0x04034b50);
    assert.equal(v.getUint32(zip.length - 22, true), 0x06054b50);
});

test('the end record counts the entries and points at the central directory', () => {
    const zip = makeZip([
        { name: 'a.txt', data: bytes('hello') },
        { name: 'b.txt', data: bytes('world!') },
    ]);
    const v = new DataView(zip.buffer);
    const end = zip.length - 22;
    assert.equal(v.getUint16(end + 10, true), 2, 'entry count');
    const centralStart = v.getUint32(end + 16, true);
    assert.equal(v.getUint32(centralStart, true), 0x02014b50, 'central directory signature');
    assert.equal(v.getUint32(end + 12, true), end - centralStart, 'central directory size');
});

test('each central entry points back at its own local header', () => {
    const zip = makeZip([
        { name: 'a.txt', data: bytes('hello') },
        { name: 'bb.txt', data: bytes('world!') },
    ]);
    const v = new DataView(zip.buffer);
    let p = v.getUint32(zip.length - 22 + 16, true);
    for (let i = 0; i < 2; i++) {
        const nameLen = v.getUint16(p + 28, true);
        const offset = v.getUint32(p + 42, true);
        assert.equal(v.getUint32(offset, true), 0x04034b50, `entry ${i} local header`);
        p += 46 + nameLen;
    }
});

test('an empty archive is just the end record', () => {
    const zip = makeZip([]);
    assert.equal(zip.length, 22);
    assert.equal(new DataView(zip.buffer).getUint16(zip.length - 22 + 10, true), 0);
});

test('stored entries keep the bytes verbatim', () => {
    const data = new Uint8Array([0, 255, 13, 10, 26, 137]);   // the bytes a text mode would mangle
    const zip = makeZip([{ name: 'x.bin', data }]);
    const start = 30 + 'x.bin'.length;
    assert.deepEqual([...zip.slice(start, start + data.length)], [...data]);
});

test('a name with non-ASCII characters is measured in bytes, not characters', () => {
    const zip = makeZip([{ name: '컷.png', data: bytes('x') }]);
    const v = new DataView(zip.buffer);
    assert.equal(v.getUint16(26, true), new TextEncoder().encode('컷.png').length);
});

test('frameName pads so alphabetical order is also frame order', () => {
    assert.equal(frameName(0, 100), 'frame_0000.png');
    assert.equal(frameName(7, 100), 'frame_0007.png');
    const names = [frameName(9, 1000), frameName(10, 1000), frameName(100, 1000)];
    assert.deepEqual([...names].sort(), names);
});

test('frameName widens past four digits when there are enough frames', () => {
    assert.equal(frameName(12345, 20000), 'frame_12345.png');
});

test('too many files is refused rather than written wrong', () => {
    const many = Array.from({ length: 0x10000 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0) }));
    assert.throws(() => makeZip(many), /zip64/);
});

// The real test of a writer is whether something else can read what it wrote.
test('a system unzip can list and extract the archive', { skip: !hasUnzip() }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    try {
        const zip = makeZip([
            { name: 'frame_0000.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) },
            { name: 'notes.txt', data: bytes('two files, no compression') },
        ]);
        const path = join(dir, 'out.zip');
        writeFileSync(path, zip);
        const listing = execFileSync('unzip', ['-l', path], { encoding: 'utf8' });
        assert.match(listing, /frame_0000\.png/);
        assert.match(listing, /notes\.txt/);
        // -t verifies every CRC, which is the part most easy to get subtly wrong.
        const tested = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
        assert.match(tested, /No errors detected/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

function hasUnzip() {
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}
