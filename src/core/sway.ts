// Sway: a drawn curve as a waveform, the profile along the part, and the lagged displacement.

// Per-layer ("part") transform animated across the cut's local time. Enables cutout /
// puppet-style motion: move/rotate/scale a part, optionally along a drawn path, with
// one-way or ping-pong playback at a given speed and an optional repeat count.
// Sway from a drawn curve: converts what the user drew into a sway waveform.
// Progress is the drawing order (cumulative length) and the value is the deviation normal to
// the line from start to end, so anything from a scribble that doubles back to a gentle wave
// sways exactly as it was drawn.
// The returned amp (px) is how far that curve actually swung, and is used as the default strength.
import type { Point } from './types.ts';

/** One control point of a sway profile: where along the part (0..1) and how much it bends (-1..1). */
export interface SwayPoint { p: number; w: number }
/** A profile as stored: bare weights spread evenly, or points with their own positions. */
export type SwayProfile = ReadonlyArray<number | { p?: unknown, w?: unknown } | null | undefined>;

export function curveToWave(pts: readonly Point[] | null | undefined, samples = 64): { wave: number[], amp: number } | null {
    if (!pts || pts.length < 3) return null;
    const a = pts[0], b = pts[pts.length - 1];
    let ux = b.x - a.x, uy = b.y - a.y;
    const blen = Math.hypot(ux, uy);
    if (blen < 1) { ux = 1; uy = 0; } else { ux /= blen; uy /= blen; }
    const nx = -uy, ny = ux; // normal of the baseline
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = arc[arc.length - 1] || 1;
    const out: number[] = new Array(samples);
    let j = 0;
    for (let k = 0; k < samples; k++) {
        const target = (k / (samples - 1)) * total;
        while (j < pts.length - 2 && arc[j + 1] < target) j++;
        const seg = Math.max(1e-6, arc[j + 1] - arc[j]);
        const f = Math.min(1, Math.max(0, (target - arc[j]) / seg));
        const x = pts[j].x + (pts[j + 1].x - pts[j].x) * f - a.x;
        const y = pts[j].y + (pts[j + 1].y - pts[j].y) * f - a.y;
        out[k] = x * nx + y * ny;
    }
    const mean = out.reduce((s, v) => s + v, 0) / samples;
    let amp = 0;
    for (let k = 0; k < samples; k++) { out[k] -= mean; amp = Math.max(amp, Math.abs(out[k])); }
    if (amp < 0.5) return null; // effectively a straight line: nothing to sway
    for (let k = 0; k < samples; k++) out[k] /= amp;
    // Match the end to the start so looped playback does not jump.
    const drift = out[samples - 1] - out[0];
    for (let k = 0; k < samples; k++) out[k] -= drift * (k / (samples - 1));
    return { wave: out.map(v => Math.round(v * 1000) / 1000), amp: Math.round(amp) };
}

// Sway profile: smoothly interpolates the weights (-1..1) of control points along the axis.
// Zero holds that point still; a negative weight bends it the other way, so one stretch can
// bend one direction while the next bends back.
/**
 * The sway waveform at a moment: a plain sine, or the curve the user drew.
 *
 * @param {number} time seconds
 * @param {number} speed cycles a second
 * @param {number[] | null | undefined} curve
 * @returns {number} -1..1
 */
export function swayWaveAt(time: number, speed: number | null | undefined, curve: readonly number[] | null | undefined): number {
    const sp = speed || 1;
    return (curve && curve.length > 1) ? sampleWave(curve, sp * time) : Math.sin(2 * Math.PI * sp * time);
}

/**
 * How far the sway has pushed the drawing at one position along its axis.
 *
 * The lag is the whole point. Without it every point along the spine moves in phase - the root
 * and the tip reach the far side at the same instant - which is a flag, not hair. Real hair
 * trails: the tip is still going one way as the root starts back, and that delay is what reads
 * as weight.
 *
 * Expressed as seconds at the far end, so it is a number with a meaning rather than a dial:
 * `lag` of 0.2 means the tip is doing what the root did a fifth of a second ago.
 *
 * Analytic rather than simulated, and that is a deliberate limit. A spring chain would need
 * state carried between frames, and every frame here is a pure function of its time - scrubbing
 * backwards and exporting both re-ask for arbitrary moments, and a simulation would answer them
 * differently from playback. A travelling wave has the delay and the settle without the state.
 *
 * @param {number} p01 position along the axis, 0 at the root
 * @param {{amp: number, speed: number, curve?: number[] | null, time: number, lag?: number}} o
 * @returns {number} displacement in pixels
 */
export function swayDispAt(p01: number, { amp, speed, curve, time, lag }: { amp: number, speed: number, curve?: readonly number[] | null, time: number, lag?: number }): number {
    return amp * swayWaveAt(time - (lag || 0) * p01, speed, curve);
}

export function swayWeightAt(profile: SwayProfile | null | undefined, p: number): number {
    const n = profile?.length || 0;
    if (!profile || !n) return 1;
    const at = swayPointAt(profile);
    if (n === 1) return at(0).w;
    const x = Math.min(1, Math.max(0, p));
    // Find the pair the position falls between. Before the first point or after the last, the
    // nearest one wins outright: a point placed at the elbow says nothing about the hand.
    let i = 0;
    while (i < n - 2 && at(i + 1).p < x) i++;
    const a = at(i), b = at(i + 1);
    const gap = b.p - a.p;
    if (gap <= 0) return b.w;
    const f = Math.min(1, Math.max(0, (x - a.p) / gap));
    const t = f * f * (3 - 2 * f); // smoothstep, so the gaps between control points do not turn into corners
    return a.w + (b.w - a.w) * t;
}

/**
 * How to read one entry of a profile, whichever of the two shapes it is in.
 *
 * A profile used to be weights alone, spaced evenly along the axis - three of them meant top,
 * middle and bottom. That is fine for hair and useless for an arm, where the point that matters
 * is wherever the elbow happens to be. A point may carry its own position now: `{p, w}`, p being
 * 0..1 along the axis.
 *
 * Both shapes are read here rather than one being migrated to the other, so a project saved
 * before this still opens and still moves exactly as it did.
 *
 * @param {Array<number | {p: number, w: number}>} profile
 * @returns {(i: number) => {p: number, w: number}}
 */
export function swayPointAt(profile: SwayProfile): (i: number) => SwayPoint {
    const n = profile.length;
    return (i) => {
        const v = profile[i];
        // Number.isFinite rather than a clamp: Math.max(0, NaN) is NaN, so a clamp lets junk
        // straight through and it comes out the far end as a canvas of NaN.
        if (typeof v === 'number') return { p: n > 1 ? i / (n - 1) : 0, w: Number.isFinite(v) ? v : 0 };
        const pv = Number(v?.p), wv = Number(v?.w);
        return {
            p: Number.isFinite(pv) ? Math.min(1, Math.max(0, pv)) : (n > 1 ? i / (n - 1) : 0),
            w: Number.isFinite(wv) ? wv : 0,
        };
    };
}

/**
 * A profile as positioned points, in order.
 *
 * Always the positioned shape, whichever way it came in, because this is what an edit produces:
 * the moment someone moves a point, the profile has positions in it whether it did before or not.
 * Reading still accepts both, so a project that is never edited is never rewritten.
 *
 * Sorted because dragging a point past its neighbour is a thing people do, and the alternative is
 * an interpolation that runs backwards through the middle of the drag.
 *
 * @param {Array<number | {p: number, w: number}>} profile
 * @returns {{p: number, w: number}[]}
 */
export function sortSwayProfile(profile: unknown): SwayPoint[] {
    if (!Array.isArray(profile)) return [];
    const at = swayPointAt(profile);
    return (profile as SwayProfile).map((_, i) => at(i)).sort((a, b) => a.p - b.p);
}

// Samples the waveform cyclically over 0..1 with linear interpolation.
export function sampleWave(wave: readonly number[], u: number): number {
    const n = wave.length;
    if (!n) return 0;
    const x = (((u % 1) + 1) % 1) * n;
    const i = Math.floor(x), f = x - i;
    const a = wave[i % n], b = wave[(i + 1) % n];
    return a + (b - a) * f;
}
