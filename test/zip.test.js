import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, dosDateTime, makeZip, frameName, ZipWriter } from '../src/export/zip.js';

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

// --- the streaming writer ------------------------------------------------------------------
// makeZip is this class with everything handed over at once, so the tests above already cover the
// bytes it produces. What is left is the thing only streaming can get wrong: state carried across
// calls, and the promise that a caller may release each entry's data once it has been added.

// This slot used to hold "adding one at a time gives the same archive as all at once", comparing
// ZipWriter against makeZip. That test could not fail: makeZip *is* a ZipWriter with every entry
// handed over, so it compared a function with its own inlining. It read as reassurance and was
// worth nothing, which is worse than having no test there.
//
// What it was reaching for - "a change to the writer must not silently change the bytes" - is a
// real thing to want, and this is it. The archive below was produced by the writer and checked by
// a system unzip, so it is a record of output that is known to work rather than of output that
// merely exists.
const GOLDEN_ZIP = [80,75,3,4,20,0,0,0,0,0,163,104,67,92,29,128,188,85,3,0,0,0,3,0,0,0,5,0,0,0,97,46,98,105,110,1,2,3,80,75,3,4,20,0,0,0,0,0,163,104,67,92,116,35,223,85,2,0,0,0,2,0,0,0,5,0,0,0,98,46,98,105,110,4,5,80,75,1,2,20,0,20,0,0,0,0,0,163,104,67,92,29,128,188,85,3,0,0,0,3,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,97,46,98,105,110,80,75,1,2,20,0,20,0,0,0,0,0,163,104,67,92,116,35,223,85,2,0,0,0,2,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,38,0,0,0,98,46,98,105,110,80,75,5,6,0,0,0,0,2,0,2,0,102,0,0,0,75,0,0,0,0,0];

test('ZipWriter: the bytes are exactly what they were, entry by entry', () => {
    const zip = new ZipWriter({ date: new Date('2026-02-03T04:05:06Z') });
    zip.add('a.bin', new Uint8Array([1, 2, 3]));
    zip.add('b.bin', new Uint8Array([4, 5]));
    assert.deepEqual([...zip.finish()], GOLDEN_ZIP,
        'a change here is a change to every archive the app writes - deliberate or not');
});

// The whole point: a caller writes a piece's frames, drops them, and moves on. If the writer kept
// a reference instead of copying, the archive would come out full of whatever the buffer held next.
test('ZipWriter: the caller may reuse or clear the buffer it handed over', () => {
    const zip = new ZipWriter({ date: new Date('2026-02-03T04:05:06Z') });
    const scratch = new Uint8Array([1, 2, 3, 4]);
    zip.add('a.bin', scratch);
    scratch.fill(0xff);                    // as a caller reusing one buffer per frame would
    zip.add('b.bin', scratch);
    const out = zip.finish();
    const first = out.subarray(30 + 'a.bin'.length, 30 + 'a.bin'.length + 4);
    assert.deepEqual([...first], [1, 2, 3, 4], 'the bytes were copied in, not pointed at');
});

test('ZipWriter: an empty archive is still a valid one', () => {
    const out = new ZipWriter().finish();
    assert.equal(out.length, 22);
    assert.equal(new DataView(out.buffer).getUint32(0, true), 0x06054b50);
});

test('ZipWriter: finishing twice, or adding after finishing, is refused', () => {
    const zip = new ZipWriter();
    zip.add('a.bin', new Uint8Array([1]));
    zip.finish();
    assert.throws(() => zip.add('b.bin', new Uint8Array([2])), /already finished/);
    assert.throws(() => zip.finish(), /already finished/);
});

test('ZipWriter: offsets keep counting across many entries', async () => {
    const zip = new ZipWriter({ date: new Date('2026-02-03T04:05:06Z') });
    const n = 200;
    for (let i = 0; i < n; i++) zip.add(frameName(i, n), new Uint8Array(64).fill(i & 255));
    const out = zip.finish();
    const view = new DataView(out.buffer);
    // Read the end record, walk the central directory, and check every offset points at a local
    // header - which is what a reader does, and what a wrong cursor would break.
    const centralStart = view.getUint32(out.length - 6, true);
    let p = centralStart;
    for (let i = 0; i < n; i++) {
        assert.equal(view.getUint32(p, true), 0x02014b50, `central entry ${i}`);
        const nameLen = view.getUint16(p + 28, true);
        const offset = view.getUint32(p + 42, true);
        assert.equal(view.getUint32(offset, true), 0x04034b50, `entry ${i} points at a local header`);
        p += 46 + nameLen;
    }
    assert.equal(view.getUint16(out.length - 12, true), n, 'and the count agrees');
});
