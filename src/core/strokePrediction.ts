// Where the pen is about to be, drawn ahead of the samples that have arrived.
//
// On a PC pen tablet the line trailed the pen (2026-10-25). Every sample reaches the page a frame
// or more after the hand made it, so the end of the line is always where the pen was. The browser
// predicts the next few positions (PointerEvent.getPredictedEvents); drawing to them on the live
// overlay closes most of the gap. They are a guess and never stored: the next frame redraws the
// stroke from the real samples, and the commit uses only those.

import type { PressurePoint } from './types.ts';

/** At most this many predicted points are drawn. Chrome predicts about 1-3; past that it overshoots on turns. */
export const PREDICTION_MAX = 3;

/** At most this far ahead, in canvas pixels, so a wild guess cannot fling the tail across the page. */
export const PREDICTION_REACH = 40;

/**
 * The points of a stroke with the predicted ones after them, for the preview only.
 *
 * Each predicted point takes the last real pressure: a predicted event's pressure is the
 * hardware's last reading or nothing, and a width that jumps at the tip reads as flicker.
 * Points beyond PREDICTION_REACH of the last real one are dropped, and so is everything after.
 */
export function withPrediction<P extends PressurePoint>(points: readonly P[], predicted: readonly PressurePoint[] | null | undefined): P[] {
    const last = points[points.length - 1];
    if (!last || !predicted || predicted.length === 0) return points.slice();
    const out = points.slice();
    for (const p of predicted.slice(0, PREDICTION_MAX)) {
        if (Math.hypot(p.x - last.x, p.y - last.y) > PREDICTION_REACH) break;
        out.push({ ...last, x: p.x, y: p.y });
    }
    return out;
}
