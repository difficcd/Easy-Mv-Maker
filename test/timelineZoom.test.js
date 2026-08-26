import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TRACK_GUTTER, PPS_MIN, PPS_MAX, clampPps, timeAtX, xAtTime, scrollToHold, zoomAnchored, pinchZoom,
} from '../src/core/timelineZoom.js';

test('clampPps holds the scale inside its usable range', () => {
    assert.equal(clampPps(50), 50);
    assert.equal(clampPps(1), PPS_MIN);
    assert.equal(clampPps(9999), PPS_MAX);
    assert.equal(clampPps(NaN), PPS_MIN);
});

test('timeAtX and xAtTime account for the sticky label column', () => {
    // Time zero is not the left edge of the element - it is one gutter in.
    assert.equal(timeAtX(0, TRACK_GUTTER, 50), 0);
    assert.equal(xAtTime(0, 50), TRACK_GUTTER);
    assert.equal(timeAtX(0, TRACK_GUTTER + 100, 50), 2);
    assert.equal(xAtTime(2, 50), TRACK_GUTTER + 100);
});

test('timeAtX and xAtTime are inverses through a scroll', () => {
    for (const [scroll, x, pps] of [[0, 300, 50], [740, 12, 120], [1200, 640, 17]]) {
        const t = timeAtX(scroll, x, pps);
        assert.equal(xAtTime(t, pps) - scroll, x);
    }
});

test('zooming keeps the time under the cursor under the cursor', () => {
    const scrollLeft = 400, localX = 250, prev = 50;
    const held = timeAtX(scrollLeft, localX, prev);
    for (const factor of [1.1, 0.9, 2, 0.5]) {
        const r = zoomAnchored(prev, factor, scrollLeft, localX);
        assert.ok(r, 'should have zoomed');
        // The whole point: the same instant is still under the same pixel afterwards.
        assert.ok(Math.abs(timeAtX(r.scrollLeft, localX, r.pps) - held) < 1e-9);
    }
});

test('zooming at the very start does not scroll to a negative position', () => {
    // Zooming out at the left edge wants a negative scrollLeft, which is not a place the
    // timeline can be; asking for it once left the first label overlapping the ruler.
    const r = zoomAnchored(50, 0.5, 0, 10);
    assert.ok(r);
    assert.ok(r.scrollLeft >= 0, `scrollLeft was ${r.scrollLeft}`);
});

test('zoomAnchored reports no change at the limits', () => {
    // Returning null rather than an unchanged pair is what lets the caller leave the scroll
    // alone, instead of recomputing it from a scale that did not move.
    assert.equal(zoomAnchored(PPS_MAX, 1.1, 0, 100), null);
    assert.equal(zoomAnchored(PPS_MIN, 0.9, 0, 100), null);
    assert.notEqual(zoomAnchored(PPS_MAX, 0.9, 0, 100), null);
    assert.notEqual(zoomAnchored(PPS_MIN, 1.1, 0, 100), null);
});

test('zoomAnchored clamps rather than overshooting', () => {
    assert.equal(zoomAnchored(PPS_MAX - 1, 4, 0, 100).pps, PPS_MAX);
    assert.equal(zoomAnchored(PPS_MIN + 1, 0.1, 0, 100).pps, PPS_MIN);
});

test('a pinch scales from where the fingers started, not from the current value', () => {
    const pinch = { startPps: 50, startDist: 100, anchorTime: 4 };
    assert.equal(pinchZoom(pinch, 200, 300).pps, 100);
    assert.equal(pinchZoom(pinch, 50, 300).pps, 25);
    // Going out and back returns to exactly the starting scale - accumulating a factor per move
    // event would have drifted away from it.
    assert.equal(pinchZoom(pinch, 100, 300).pps, 50);
});

test('a pinch holds the time between the fingers', () => {
    const pinch = { startPps: 50, startDist: 100, anchorTime: 4 };
    const r = pinchZoom(pinch, 180, 300);
    assert.ok(Math.abs(timeAtX(r.scrollLeft, 300, r.pps) - 4) < 1e-9);
});

test('a pinch that starts with the fingers together does not divide by zero', () => {
    const r = pinchZoom({ startPps: 50, startDist: 0, anchorTime: 1 }, 100, 200);
    assert.ok(Number.isFinite(r.pps) && Number.isFinite(r.scrollLeft));
});

test('scrollToHold never goes negative', () => {
    assert.equal(scrollToHold(0, 50, 500), 0);
    assert.equal(scrollToHold(10, 50, 100), 10 * 50 + TRACK_GUTTER - 100);
});
