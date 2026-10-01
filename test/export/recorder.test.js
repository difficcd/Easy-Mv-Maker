import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRecordingType } from '../../src/export/recorder.ts';

test('mp4 is preferred when the browser has it', () => {
    assert.deepEqual(pickRecordingType(t => t === 'video/mp4' || t.startsWith('video/webm')), { mimeType: 'video/mp4', ext: 'mp4' });
});

test('a browser that wants the codec named still gets mp4, not webm', () => {
    // The regression this is here for: the list used to lead with `video/mp4;codecs=h264`,
    // which no browser accepts - in an MP4, H.264 is `avc1`. A browser that supports MP4 only
    // when told the codec explicitly had nothing in the list it could say yes to, so it fell
    // through to WebM. Each of these says yes to exactly one mp4 form and no to the others.
    for (const only of ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1']) {
        assert.deepEqual(pickRecordingType(t => t === only || t.startsWith('video/webm')), { mimeType: only, ext: 'mp4' }, only);
    }
});

test('no mp4 candidate is the codec string that never matched', () => {
    // `video/mp4;codecs=h264` is not a string MediaRecorder recognises. A browser that answered
    // yes to it and to nothing else does not exist, so if the list asks for it again the ask is
    // dead weight that looks like a working first choice.
    assert.deepEqual(pickRecordingType(t => t === 'video/mp4;codecs=h264'), { mimeType: '', ext: 'webm' });
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
