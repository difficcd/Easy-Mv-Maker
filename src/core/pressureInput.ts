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
