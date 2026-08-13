// How often to ask whether the storage server is there. Locally it comes and goes, so the app
// has to keep checking; on a deployment there is no server at all, and a fixed poll is a request
// failing every ten seconds for as long as the tab stays open.

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextProbeDelay, PROBE_BASE_MS, PROBE_MAX_MS, PROBE_QUICK_TRIES } from '../src/core/probeBackoff.js';

test('a working server is checked at the base interval', () => {
    assert.equal(nextProbeDelay(0), PROBE_BASE_MS);
});

test('the first few failures retry quickly, since that is when it is about to appear', () => {
    // Starting the server in another terminal and switching back is the common local flow.
    for (let n = 0; n <= PROBE_QUICK_TRIES; n++) {
        assert.equal(nextProbeDelay(n), PROBE_BASE_MS, `failure ${n}`);
    }
});

test('after that it backs off, so a deployment is not polled forever', () => {
    const a = nextProbeDelay(PROBE_QUICK_TRIES + 1);
    const b = nextProbeDelay(PROBE_QUICK_TRIES + 2);
    assert.ok(a > PROBE_BASE_MS, 'grows past the base');
    assert.ok(b > a, 'and keeps growing');
});

test('the interval never grows without limit', () => {
    for (const n of [20, 100, 1e6]) {
        assert.equal(nextProbeDelay(n), PROBE_MAX_MS, `${n} failures`);
    }
    // Doubling from a large exponent must not overflow into Infinity or NaN.
    assert.ok(Number.isFinite(nextProbeDelay(5000)));
});

test('the delay never goes below the base, whatever it is handed', () => {
    for (const n of [-1, -100, NaN, undefined, null, 'x']) {
        const d = nextProbeDelay(/** @type {any} */(n));
        assert.ok(d >= PROBE_BASE_MS && Number.isFinite(d), `${String(n)} -> ${d}`);
    }
});

test('it is monotonic: more failures never means checking sooner', () => {
    let prev = 0;
    for (let n = 0; n <= 30; n++) {
        const d = nextProbeDelay(n);
        assert.ok(d >= prev, `failure ${n} waited less than the one before`);
        prev = d;
    }
});

test('an unreachable server settles within a couple of minutes of waiting, not seconds', () => {
    // Rough shape check: ten failures in, it should be checking on the order of minutes.
    assert.ok(nextProbeDelay(10) >= 60_000, `${nextProbeDelay(10)}ms`);
});
