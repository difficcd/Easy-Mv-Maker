import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbSize, THUMB_MAX } from '../../src/canvas/thumbnail.ts';

test('a preview keeps the frame shape, with the long side at the limit', () => {
    assert.deepEqual(thumbSize(1920, 1080), { w: THUMB_MAX, h: 180 });
    assert.deepEqual(thumbSize(1080, 1920), { w: 180, h: THUMB_MAX });
});

test('a frame smaller than a preview is not enlarged', () => {
    assert.deepEqual(thumbSize(200, 100), { w: 200, h: 100 });
});
