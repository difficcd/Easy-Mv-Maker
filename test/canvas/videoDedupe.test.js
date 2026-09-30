// What the duplicate-frame dedupe actually decides.
//
// #124 has sat open as "the exact-duplicate merging looks slightly off", with no way to say
// which direction it errs in - the two comparisons lived inside extractVideoFrames as closures,
// so nothing could ask them anything. They are exported now, and these say what they do, so the
// next person with a real video has something to check against rather than a feeling.

import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureDiff, framesIdentical } from '../../src/canvas/videoFrames.ts';

/** A 32x32 signature, as the extractor builds it: one grey byte per pixel. */
const sig = (fill) => new Uint8Array(32 * 32).fill(fill);

test('signatureDiff: the same picture is 0, which is what exact mode looks for', () => {
    assert.equal(signatureDiff(sig(128), sig(128)), 0);
});

test('signatureDiff: it is a mean, so one changed pixel barely registers', () => {
    // This is the loose direction: a small subject moving on a still background can average out.
    const a = sig(100), b = sig(100);
    b[0] = 255;
    assert.ok(signatureDiff(a, b) < 0.2, `one pixel of 1024 gave ${signatureDiff(a, b)}`);
    // Which matters because exact mode only treats 0 as a match - so this frame is still kept.
    assert.notEqual(signatureDiff(a, b), 0, 'but it is not zero, so exact mode keeps it');
});

test('signatureDiff: a uniform shift is the size of the shift', () => {
    assert.equal(signatureDiff(sig(100), sig(102)), 2);
    assert.equal(signatureDiff(sig(10), sig(200)), 190);
});

test('signatureDiff: the default 2 tolerance is about codec noise, not about motion', () => {
    // Two units of grey over the whole frame is the stated tolerance. Half the frame shifting
    // by four is the same mean - worth knowing before anyone loosens it.
    const a = sig(100), b = sig(100);
    for (let i = 0; i < b.length / 2; i++) b[i] = 104;
    assert.equal(signatureDiff(a, b), 2);
});

test('signatureDiff: signatures that cannot be compared are not a match', () => {
    // Infinity, never a small number: an unusable comparison must never read as "identical".
    assert.equal(signatureDiff(null, sig(1)), Infinity);
    assert.equal(signatureDiff(sig(1), undefined), Infinity);
    assert.equal(signatureDiff(new Uint8Array(4), new Uint8Array(8)), Infinity);
    assert.equal(signatureDiff(new Uint8Array(0), new Uint8Array(0)), Infinity);
});

test('framesIdentical: only byte-for-byte counts', () => {
    const a = new Uint8ClampedArray([1, 2, 3, 255]);
    assert.equal(framesIdentical(a, new Uint8ClampedArray([1, 2, 3, 255])), true);
    assert.equal(framesIdentical(a, new Uint8ClampedArray([1, 2, 4, 255])), false);
});

test('framesIdentical: nothing missing or mismatched is ever identical', () => {
    // There is no previous frame for the first one, and it must not merge into nothing.
    const a = new Uint8ClampedArray([1, 2, 3, 255]);
    assert.equal(framesIdentical(null, a), false);
    assert.equal(framesIdentical(a, null), false);
    assert.equal(framesIdentical(a, new Uint8ClampedArray([1, 2, 3])), false);
});

test('the two together: a signature match is a prefilter, not the answer', () => {
    // The pair this pipeline exists to separate - identical at 32x32, different in full res.
    // If exact mode ever merges one of these, this is the shape of the bug.
    assert.equal(signatureDiff(sig(128), sig(128)), 0, 'the prefilter says look closer');
    assert.equal(framesIdentical(new Uint8ClampedArray([128, 128, 128, 255]),
        new Uint8ClampedArray([128, 128, 129, 255])), false, 'and the full compare says no');
});
