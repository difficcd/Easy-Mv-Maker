import test from 'node:test';
import assert from 'node:assert/strict';
import { swaySlices, SWAY_SLICES } from '../src/canvas/swayRender.js';
import { swayWeightAt } from '../src/canvas/canvasUtils.js';

const SPAN = 1080;
const DISP = 120;
// A profile with a real bend in it, so the slices have something to disagree about.
const PROFILE = [0, 0.2, 1, 0.4];

/** The offset one slice puts at position `a`. */
const offsetAt = (s, a) => s.k * a + s.m;

test('slices tile the span exactly - no gap and no overlap', () => {
    const s = swaySlices({ profile: PROFILE, disp: DISP, span: SPAN });
    assert.equal(s[0].a0, 0);
    for (let i = 1; i < s.length; i++) {
        assert.equal(s[i].a0, s[i - 1].a0 + s[i - 1].len, `slice ${i} does not start where ${i - 1} ends`);
    }
    assert.equal(s.at(-1).a0 + s.at(-1).len, SPAN);
});

test('neighbouring slices agree exactly at their shared edge - this is what stops the tearing', () => {
    const s = swaySlices({ profile: PROFILE, disp: DISP, span: SPAN });
    for (let i = 1; i < s.length; i++) {
        const edge = s[i].a0;
        const left = offsetAt(s[i - 1], edge);
        const right = offsetAt(s[i], edge);
        // Not "close enough": both sides are computed from the same dispAt(edge), so the only
        // difference either can have is floating-point noise from the k*a + m round trip.
        assert.ok(Math.abs(left - right) < 1e-9, `seam of ${left - right}px at ${edge}`);
    }
});

test('each slice hits the true displacement at both of its own ends', () => {
    const s = swaySlices({ profile: PROFILE, disp: DISP, span: SPAN });
    for (const sl of s) {
        for (const a of [sl.a0, sl.a0 + sl.len]) {
            const want = DISP * swayWeightAt(PROFILE, a / SPAN);
            assert.ok(Math.abs(offsetAt(sl, a) - want) < 1e-9, `slice at ${sl.a0} is off by ${offsetAt(sl, a) - want} at ${a}`);
        }
    }
});

test('the seam property does not depend on the slice count', () => {
    for (const slices of [1, 2, 7, 64, 256]) {
        const s = swaySlices({ profile: PROFILE, disp: DISP, span: SPAN, slices });
        for (let i = 1; i < s.length; i++) {
            const edge = s[i].a0;
            assert.ok(Math.abs(offsetAt(s[i - 1], edge) - offsetAt(s[i], edge)) < 1e-9,
                `${slices} slices: seam at ${edge}`);
        }
    }
});

test('a span that does not divide by the slice count still tiles it', () => {
    // 1001 / 64 is not whole, which is where a rounding bug would leave a one-pixel strip.
    const s = swaySlices({ profile: PROFILE, disp: DISP, span: 1001 });
    assert.equal(s.at(-1).a0 + s.at(-1).len, 1001);
    for (let i = 1; i < s.length; i++) assert.equal(s[i].a0, s[i - 1].a0 + s[i - 1].len);
});

test('a span smaller than the slice count drops the empty slices rather than dividing by zero', () => {
    const s = swaySlices({ profile: PROFILE, disp: DISP, span: 10 });
    assert.ok(s.length <= 10 && s.length > 0);
    for (const sl of s) assert.ok(sl.len > 0 && Number.isFinite(sl.k) && Number.isFinite(sl.m));
    assert.equal(s.at(-1).a0 + s.at(-1).len, 10);
});

test('a flat profile is a rigid translation - every slice shares one offset and no gradient', () => {
    const s = swaySlices({ profile: [0.5, 0.5], disp: DISP, span: SPAN });
    for (const sl of s) {
        assert.equal(sl.k, 0);
        assert.ok(Math.abs(sl.m - DISP * 0.5) < 1e-9);
    }
});

test('SWAY_SLICES is the default', () => {
    assert.equal(swaySlices({ profile: PROFILE, disp: DISP, span: SPAN }).length,
        swaySlices({ profile: PROFILE, disp: DISP, span: SPAN, slices: SWAY_SLICES }).length);
});
