import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelateCanvas, pixelateRegion } from '../../src/canvas/pixelEffects.js';

// The mosaic effect shipped broken and every unit test passed.
//
// `pixelateSize`, `mosaic` and `clampRegion` are pure and were all covered. What was not covered
// was the shape of the thing handed to them: App held one ref containing two slots, so the pair
// lived at `ref.current` while every reader asked for `ref.small`. That is `undefined`, and
// `scratch(undefined, w, h)` threw on the first frame the mosaic was on.
//
// So these do not test the arithmetic. They test the contract at the boundary - what these two
// functions ask of the scratch slots they are given - with fakes standing in for the canvas,
// which is the part a unit test can reach.

/** A canvas, as far as these functions need one. */
const fakeCanvas = (w, h) => ({
    width: w, height: h,
    getContext: () => ({
        clearRect() { }, drawImage() { }, putImageData() { },
        createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b }),
        imageSmoothingEnabled: true,
    }),
});

/** Stands in for `scratchCanvas(ref, w, h)`: keeps the canvas on the ref it was handed. */
function makeScratch(seen) {
    return (ref, w, h) => {
        // The real one does `ref.current`, so a slot that is not a ref is the bug this file is for.
        assert.ok(ref && typeof ref === 'object', 'a scratch slot must be an object');
        assert.ok('current' in ref, 'a scratch slot must be a ref - got ' + JSON.stringify(Object.keys(ref)));
        seen.push({ w, h });
        if (!ref.current || ref.current.width !== w || ref.current.height !== h) ref.current = fakeCanvas(w, h);
        return { canvas: ref.current, ctx: ref.current.getContext('2d') };
    };
}

test('the whole-layer path is given a ref, not an object of refs', () => {
    const seen = [];
    const small = { current: null };
    const out = pixelateCanvas(fakeCanvas(1920, 1080), 40, small, makeScratch(seen));
    assert.ok(out, 'returned nothing');
    assert.deepEqual(seen, [{ w: 48, h: 27 }]);
});

test('the region path is given the pair, and uses both slots', () => {
    const seen = [];
    const refs = { full: { current: null }, small: { current: null } };
    const rect = { x: 100, y: 100, w: 400, h: 200 };
    const out = pixelateRegion(fakeCanvas(1920, 1080), 40, rect, refs, makeScratch(seen), 1920, 1080);
    assert.ok(out, 'returned nothing');
    // The small one is sized to the region over the block; the full one to the whole frame.
    assert.deepEqual(seen, [{ w: 10, h: 5 }, { w: 1920, h: 1080 }]);
    assert.ok(refs.small.current && refs.full.current, 'both slots should have been filled');
});

test('the two slots are never the same canvas', () => {
    // Composing reads the small one while writing the full one. One shared slot would be a
    // canvas drawing itself.
    const refs = { full: { current: null }, small: { current: null } };
    pixelateRegion(fakeCanvas(800, 600), 20, { x: 0, y: 0, w: 400, h: 300 }, refs, makeScratch([]), 800, 600);
    assert.notEqual(refs.small.current, refs.full.current);
});

test('a block too small to matter does not touch the scratch at all', () => {
    const seen = [];
    assert.equal(pixelateCanvas(fakeCanvas(1920, 1080), 1, { current: null }, makeScratch(seen)), null);
    assert.equal(pixelateRegion(fakeCanvas(1920, 1080), 1, { x: 0, y: 0, w: 100, h: 100 },
        { full: { current: null }, small: { current: null } }, makeScratch(seen), 1920, 1080), null);
    assert.deepEqual(seen, [], 'nothing should have been allocated');
});

test('scratchCanvas says which slot was wrong instead of dereferencing undefined', async () => {
    // The real failure was `Cannot read properties of undefined (reading 'current')`, thrown four
    // frames deep in the composite loop with nothing naming the slot. This is the same mistake
    // made deliberately: an object holding refs, where a ref belongs.
    const { scratchCanvas } = await import('../../src/canvas/scratch.ts');
    const pair = { full: { current: null }, small: { current: null } };
    assert.throws(() => scratchCanvas(pair.small_typo, 10, 10), /scratchCanvas needs a ref/);
    assert.throws(() => scratchCanvas(pair, 10, 10), /got \{full,small\}/);
});
