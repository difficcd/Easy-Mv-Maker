// Whether a stroke came in with pressure at all.
//
// "Pressure doesn't work" (2026-10-23) was not the renderer: the strokes were stored with no
// pressure in them. A pen tablet on a PC whose driver has Windows Ink turned off talks to the
// browser as a mouse, and the browser reports a pressed mouse at a pressure of exactly 0.5 - the
// value the app stores for "no pressure information". Nothing in the page can turn that into
// pressure, so the app says what it received instead of drawing an even line without a word.

import type { PressurePoint } from './types.ts';

/** True when any point carries a pressure other than the neutral 0.5. */
export function strokeHasPressure(points: readonly PressurePoint[] | null | undefined): boolean {
    return !!points && points.some(p => p.pressure !== undefined && p.pressure !== 0.5);
}

/**
 * Whether to tell the artist that the stroke they just drew had no pressure: pressure is on, the
 * pointer was not a pen, and nothing in the points varied.
 */
export function missingPressure(pressureOn: boolean, stroke: { pen?: boolean, points?: readonly PressurePoint[] }): boolean {
    return pressureOn && !stroke.pen && !strokeHasPressure(stroke.points);
}

/**
 * How thin the lightest touch and how thick the hardest press draw, as a percentage of the brush
 * size (#394). The pen's width is size x pressure x 2, so the range the hardware gives is 0% at
 * no pressure to 200% at a full press - which is the default, and changes nothing.
 */
export interface PressureRange { light: number; heavy: number }
export const PRESSURE_RANGE_DEFAULT: PressureRange = { light: 0, heavy: 200 };
/** The widest a full press may be set to draw, as a percentage of the size. */
const HEAVY_MAX = 300;

/**
 * A pen's pressure reading mapped into the artist's range, as the pressure to store.
 *
 * Applied where the sample is recorded, not where the stroke is drawn - as pressure itself is
 * flattened there - so a drawing keeps the shape it had when the range is changed later, and
 * the renderer and the stored strokes are unchanged. The ends are taken in either order and kept
 * within 0-300%.
 */
export function mapPressure(raw: number, range: PressureRange): number {
    const p = Math.min(1, Math.max(0, raw));
    // Read defensively: the range comes back from local storage, which may hold anything.
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const a = Math.min(HEAVY_MAX, Math.max(0, num(range?.light, 0))), b = Math.min(HEAVY_MAX, Math.max(0, num(range?.heavy, 200)));
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo === 0 && hi === 200) return p;
    return (lo + (hi - lo) * p) / 200;
}
