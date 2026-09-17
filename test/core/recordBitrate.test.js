import test from 'node:test';
import assert from 'node:assert/strict';
import { videoBitrate, codecFamily, AUDIO_BITRATE } from '../../src/core/recordBitrate.js';

const mbps = (n) => n / 1_000_000;

test('a codec is recognised from every type pickRecordingType can return', () => {
    // These are the exact strings in CANDIDATES. If one stops matching, that codec silently
    // falls back to the VP8 figure - not a crash, just a worse or wasteful file.
    assert.equal(codecFamily('video/mp4;codecs=h264'), 'h264');
    assert.equal(codecFamily('video/mp4'), 'h264');
    assert.equal(codecFamily('video/webm;codecs=vp9'), 'vp9');
    assert.equal(codecFamily('video/webm;codecs=vp8'), 'vp8');
    assert.equal(codecFamily('video/webm'), 'vp8');
});

test('an unset type is assumed to be the weaker codec, not the stronger one', () => {
    // Empty means the browser chose. Guessing VP9 there would under-provision a VP8 file.
    assert.equal(codecFamily(''), 'vp8');
    assert.equal(codecFamily(undefined), 'vp8');
});

test('1080p30 lands in a range that is actually good for line art', () => {
    const h264 = videoBitrate({ width: 1920, height: 1080, fps: 30, mimeType: 'video/mp4;codecs=h264' });
    // The bug was ~2.5 Mbps here. Anything in that neighbourhood means this did nothing.
    assert.ok(mbps(h264) > 6 && mbps(h264) < 9, `${mbps(h264)} Mbps`);
});

test('VP9 is given less than H.264 for the same frame', () => {
    const at = (mimeType) => videoBitrate({ width: 1920, height: 1080, fps: 30, mimeType });
    assert.ok(at('video/webm;codecs=vp9') < at('video/mp4;codecs=h264'));
});

test('it scales with the canvas, which is the whole reason it is not a constant', () => {
    const at = (w, h) => videoBitrate({ width: w, height: h, fps: 30, mimeType: 'video/mp4' });
    const hd = at(1280, 720), fhd = at(1920, 1080), uhd = at(3840, 2160);
    assert.ok(hd < fhd && fhd < uhd);
    // 4K is four times the pixels of 1080p, and short of the ceiling, so it should be ~4x.
    assert.ok(uhd / fhd > 3.5 && uhd / fhd < 4.5, `ratio ${uhd / fhd}`);
});

test('it scales with frame rate', () => {
    const at = (fps) => videoBitrate({ width: 1920, height: 1080, fps, mimeType: 'video/mp4' });
    assert.ok(at(60) > at(30));
});

test('a tiny canvas still gets enough to not look chewed', () => {
    const tiny = videoBitrate({ width: 160, height: 120, fps: 12, mimeType: 'video/mp4' });
    assert.equal(tiny, 2_000_000);
});

test('an absurd canvas is capped rather than asking for something no encoder will do', () => {
    const huge = videoBitrate({ width: 7680, height: 4320, fps: 60, mimeType: 'video/mp4' });
    assert.equal(huge, 48_000_000);
});

test('degenerate inputs produce a usable number rather than zero or NaN', () => {
    // A canvas is never 0 wide, but a bitrate of 0 is accepted by MediaRecorder and produces an
    // unplayable file, so it must not be reachable from here.
    for (const args of [
        { width: 0, height: 0, fps: 0 },
        { width: -100, height: -100, fps: -5 },
    ]) {
        const b = videoBitrate({ ...args, mimeType: 'video/mp4' });
        assert.ok(Number.isFinite(b) && b >= 2_000_000, JSON.stringify(args) + ' -> ' + b);
    }
});

test('the audio rate is a real number of bits', () => {
    assert.ok(Number.isInteger(AUDIO_BITRATE) && AUDIO_BITRATE > 0);
});
