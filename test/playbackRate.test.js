import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBACK_RATES, RATE_DEFAULT, safePlaybackRate, playbackRateCodec } from '../src/core/playbackRate.js';

test('every offered rate survives a round trip', () => {
    for (const r of PLAYBACK_RATES) {
        assert.equal(playbackRateCodec.decode(playbackRateCodec.encode(r)), r);
    }
});

test('the rates are ordered and include normal speed', () => {
    assert.deepEqual([...PLAYBACK_RATES].sort((a, b) => a - b), PLAYBACK_RATES);
    assert.ok(PLAYBACK_RATES.includes(RATE_DEFAULT));
});

test('a stored zero comes back as normal speed, not as a frozen clock', () => {
    // The reason this module exists. parseFloat('0') is 0, the loop advances by dt * 0, and the
    // playhead never moves with nothing on screen to say why.
    assert.equal(playbackRateCodec.decode('0'), RATE_DEFAULT);
});

test('a negative rate does not run the film backwards', () => {
    assert.equal(playbackRateCodec.decode('-2'), RATE_DEFAULT);
});

test('junk in localStorage is normal speed', () => {
    for (const raw of ['', 'fast', 'NaN', 'Infinity', '{}', 'null']) {
        assert.equal(playbackRateCodec.decode(raw), RATE_DEFAULT, `for ${JSON.stringify(raw)}`);
    }
});

test('a rate outside the offered list is kept if it is usable', () => {
    // The list is what the UI offers, not what the app can run. A value hand-edited to 1.2 is a
    // reasonable thing to want and there is no reason to overrule it.
    assert.equal(safePlaybackRate(1.2), 1.2);
    assert.equal(safePlaybackRate(8), 8);
});

test('an unusable rate falls back rather than clamping to the nearest edge', () => {
    // Clamping 0 to 0.05 would leave playback almost frozen and looking broken; the user never
    // asked for either number, so the honest answer is the default.
    assert.equal(safePlaybackRate(0), RATE_DEFAULT);
    assert.equal(safePlaybackRate(1e6), RATE_DEFAULT);
});
