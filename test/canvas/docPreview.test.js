import test from 'node:test';
import assert from 'node:assert/strict';
import { firstCut, picturesFor } from '../../src/canvas/docPreview.ts';

test('the first page is the cut that starts earliest, the lowest track winning a tie', () => {
    const cuts = [{ id: 3, startTime: 2, track: 0 }, { id: 2, startTime: 0, track: 1 }, { id: 1, startTime: 0, track: 0 }];
    assert.equal(firstCut(cuts).id, 1);
    assert.equal(firstCut([]), null);
});

test('only the pictures the first page uses are loaded', () => {
    const data = {
        assets: [{ id: 'a1', ext: 'webp' }, { id: 'a2', ext: 'webp' }],
        bitmaps: { 7: 'data:x', 8: 'data:y' },
        compressedBitmaps: ['7', '9'],
    };
    const got = picturesFor(data, new Set(['a2', 7]));
    assert.deepEqual(got.assets.map(a => a.id), ['a2']);
    assert.deepEqual(Object.keys(got.bitmaps), ['7'], 'a numeric id matches its string key');
    assert.deepEqual(got.compressedBitmaps, ['7']);
});
