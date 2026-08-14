// The audio and video tracks. These were five pieces of state that only ever moved together —
// loading audio set four of them — and the interesting cases are the ones where forgetting one
// leaves a combination the app has no name for: a URL with no clip range, or a clip range
// describing audio that is gone.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    mediaReducer, EMPTY_MEDIA,
    loadAudio, setAudioDuration, setAudioClip, clearAudio,
    loadVideo, clearVideo, setVideoCuts, moveTrack, resizeAudio,
    restoreMedia, clearMedia,
} from '../src/core/mediaReducer.js';

const clip = (startTime, endTime, offset = 0) => ({ startTime, endTime, offset });
const withAudio = (c = clip(0, 10)) => mediaReducer(
    mediaReducer(EMPTY_MEDIA, loadAudio('song.mp3', 'blob:x')), setAudioClip(c));
const withVideo = (o = { name: 'clip.mp4', startTime: 0, endTime: 10, offset: 0, duration: 10 }) =>
    mediaReducer(EMPTY_MEDIA, loadVideo(o));

// ── audio ──────────────────────────────────────────────────────────────────
test('loadAudio: the track is named and playable before its length is known', () => {
    const s = mediaReducer(EMPTY_MEDIA, loadAudio('song.mp3', 'blob:x'));
    assert.deepEqual(s.audioFile, { name: 'song.mp3' });
    assert.equal(s.audioUrl, 'blob:x');
    assert.equal(s.audioData, null, 'the element has not reported a duration yet');
});

test('loadAudio: replacing audio drops the old clip range', () => {
    // Keeping it would place the new track using the previous one's bounds until the element
    // reports back — the wrong length, in the wrong place, for a moment.
    const s = mediaReducer(withAudio(clip(5, 15, 2)), loadAudio('other.mp3', 'blob:y'));
    assert.equal(s.audioData, null);
    assert.equal(s.audioUrl, 'blob:y');
});

test('setAudioDuration: a missing or zero duration falls back rather than collapsing the timeline', () => {
    assert.equal(mediaReducer(EMPTY_MEDIA, setAudioDuration(214)).audioDuration, 214);
    assert.equal(mediaReducer(EMPTY_MEDIA, setAudioDuration(0)).audioDuration, 30);
    assert.equal(mediaReducer(EMPTY_MEDIA, setAudioDuration(undefined)).audioDuration, 30);
});

test('clearAudio: the track goes, the duration stays', () => {
    // Resetting the duration would shrink the timeline under the user mid-edit.
    const s = mediaReducer(mediaReducer(withAudio(), setAudioDuration(214)), clearAudio());
    assert.equal(s.audioFile, null);
    assert.equal(s.audioUrl, null);
    assert.equal(s.audioData, null);
    assert.equal(s.audioDuration, 214);
});

test('clearAudio: the video track is untouched', () => {
    const both = mediaReducer(withAudio(), loadVideo({ name: 'v', startTime: 0, endTime: 5 }));
    assert.equal(mediaReducer(both, clearAudio()).videoOverlay.name, 'v');
});

// ── dragging a track ───────────────────────────────────────────────────────
test('moveTrack: an absolute move that keeps the length', () => {
    const s = mediaReducer(withAudio(clip(2, 12)), moveTrack('audio', 7));
    assert.deepEqual([s.audioData.startTime, s.audioData.endTime], [7, 17]);
});

test('moveTrack: dragged before zero, a track stops at zero and keeps its length', () => {
    const s = mediaReducer(withAudio(clip(2, 12)), moveTrack('audio', -50));
    assert.deepEqual([s.audioData.startTime, s.audioData.endTime], [0, 10], 'not squashed to nothing');
});

test('moveTrack: video moves the same way, and the two are independent', () => {
    const both = mediaReducer(withAudio(clip(0, 10)), loadVideo({ name: 'v', startTime: 0, endTime: 4 }));
    const s = mediaReducer(both, moveTrack('video', 3));
    assert.deepEqual([s.videoOverlay.startTime, s.videoOverlay.endTime], [3, 7]);
    assert.equal(s.audioData.startTime, 0, 'the audio did not move');
});

test('moveTrack: dragging a track that is not loaded does nothing', () => {
    assert.equal(mediaReducer(EMPTY_MEDIA, moveTrack('audio', 5)).audioData, null);
    assert.equal(mediaReducer(EMPTY_MEDIA, moveTrack('video', 5)).videoOverlay, null);
});

// ── trimming audio ─────────────────────────────────────────────────────────
test('resizeAudio: the left edge moves into the source as well as along the timeline', () => {
    // Without the offset the audio under the new start would not be the audio that was there,
    // and the track slides out of sync with everything cut against it.
    const s = mediaReducer(withAudio(clip(0, 10, 0)), resizeAudio('left', 3, null, 3));
    assert.equal(s.audioData.startTime, 3);
    assert.equal(s.audioData.offset, 3);
    assert.equal(s.audioData.endTime, 10, 'the far edge is untouched');
});

test('resizeAudio: the right edge is a plain trim', () => {
    const s = mediaReducer(withAudio(clip(0, 10, 2)), resizeAudio('right', null, 6, null));
    assert.equal(s.audioData.endTime, 6);
    assert.deepEqual([s.audioData.startTime, s.audioData.offset], [0, 2], 'start and offset unchanged');
});

test('resizeAudio: the offset never goes negative', () => {
    // Dragging the left edge back past the beginning of the source.
    const s = mediaReducer(withAudio(clip(5, 10, 0)), resizeAudio('left', 0, null, -5));
    assert.equal(s.audioData.offset, 0);
});

test('resizeAudio: with no audio loaded there is nothing to resize', () => {
    assert.equal(mediaReducer(EMPTY_MEDIA, resizeAudio('left', 1, null, 0)).audioData, null);
});

// ── video ──────────────────────────────────────────────────────────────────
test('setVideoCuts: scene markers are attached to the loaded video', () => {
    const s = mediaReducer(withVideo(), setVideoCuts([1, 2, 3], 0, 0.5));
    assert.deepEqual(s.videoOverlay.cuts, [1, 2, 3]);
    assert.deepEqual([s.videoOverlay.cutStart, s.videoOverlay.cutOffset], [0, 0.5]);
    assert.equal(s.videoOverlay.name, 'clip.mp4', 'the rest of the overlay survives');
});

test('setVideoCuts: markers arriving after the video was removed are dropped', () => {
    // Detection runs in the background and can finish late.
    const s = mediaReducer(EMPTY_MEDIA, setVideoCuts([1, 2], 0, 0));
    assert.equal(s.videoOverlay, null, 'no overlay is invented to hold them');
});

test('clearVideo: leaves the audio alone', () => {
    const both = mediaReducer(withAudio(), loadVideo({ name: 'v', startTime: 0, endTime: 5 }));
    const s = mediaReducer(both, clearVideo());
    assert.equal(s.videoOverlay, null);
    assert.ok(s.audioData, 'audio still loaded');
});

// ── whole-state actions ────────────────────────────────────────────────────
test('restoreMedia: opening a project fills in anything the file did not carry', () => {
    const s = mediaReducer(withAudio(), restoreMedia({ videoOverlay: { name: 'v', startTime: 0, endTime: 2 } }));
    assert.equal(s.videoOverlay.name, 'v');
    assert.equal(s.audioUrl, null, 'the previous project audio is gone, not left behind');
    assert.equal(s.audioDuration, 30, 'back to the default');
});

test('clearMedia: a new project starts empty', () => {
    assert.deepEqual(mediaReducer(withAudio(), clearMedia()), EMPTY_MEDIA);
});

test('an unknown action changes nothing, and no state is mutated', () => {
    const before = withAudio(clip(1, 9, 2));
    const snapshot = JSON.stringify(before);
    // @ts-ignore - deliberately not a real action
    assert.equal(mediaReducer(before, { type: 'nonsense' }), before);
    for (const a of [loadAudio('x', 'y'), setAudioClip(clip(0, 1)), clearAudio(), moveTrack('audio', 4),
        resizeAudio('left', 1, null, 1), loadVideo({ startTime: 0, endTime: 1 }), clearVideo(), clearMedia()]) {
        mediaReducer(before, a);
    }
    assert.equal(JSON.stringify(before), snapshot, 'the input was mutated');
});

test('a missing state falls back to empty rather than throwing', () => {
    assert.deepEqual(mediaReducer(undefined, clearAudio()).audioFile, null);
    assert.deepEqual(mediaReducer(null, setAudioDuration(60)).audioDuration, 60);
});
