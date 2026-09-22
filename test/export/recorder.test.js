import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRecordingType } from '../../src/export/recorder.ts';

test('mp4 with h264 is preferred when the browser has it', () => {
    assert.deepEqual(pickRecordingType(t => t === 'video/mp4;codecs=h264' || t.startsWith('video/webm')), { mimeType: 'video/mp4;codecs=h264', ext: 'mp4' });
});

test('with no mp4, the best webm the browser has, and the file is called .webm', () => {
    assert.deepEqual(pickRecordingType(t => t === 'video/webm;codecs=vp8' || t === 'video/webm'), { mimeType: 'video/webm;codecs=vp8', ext: 'webm' });
});

test('nothing supported, or a check that throws, leaves the choice to the recorder', () => {
    // An empty type means "whatever MediaRecorder picks", which every browser can do; the file
    // is named .webm because that is what they all fall back to.
    assert.deepEqual(pickRecordingType(() => false), { mimeType: '', ext: 'webm' });
    assert.deepEqual(pickRecordingType(() => { throw new Error('no'); }), { mimeType: '', ext: 'webm' });
});
