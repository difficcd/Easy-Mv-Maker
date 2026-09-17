// Easing, the return-trip shapes, and the shared effect envelope.

export function applyEase(t, type, power = 2) {
    t = Math.max(0, Math.min(1, t));
    if (!type || type === 'linear') return t;
    const p = Math.max(1, power || 1);
    if (type === 'in') return Math.pow(t, p);
    if (type === 'out') return 1 - Math.pow(1 - t, p);
    if (type === 'inout') return t < 0.5 ? Math.pow(2 * t, p) / 2 : 1 - Math.pow(2 * (1 - t), p) / 2;
    return t;
}

// Triangle wave 0->1->0 (period 2); used for ping-pong path following.
export function triwave(x) { const m = ((x % 2) + 2) % 2; return m < 1 ? m : 2 - m; }

// The three shapes a "왕복" (return) animation can take, and the cap they share.
//
// Four call sites wrote this out, each with its own arithmetic, and they do not all mean the same
// thing - which is the point of naming them rather than merging them:
//
//   SWING.through   -1..1   past the resting position and out the other side. What the layer
//                           presets are: 둥실둥실 bobs above and below, 숨쉬기 breathes in as
//                           well as out. A one-way version of these would not read as floating.
//   SWING.there     0..1    out to the target and back, never past the start. The cut's move.
//   SWING.along     0..1    the same trip, at constant speed - for following a drawn path, where
//                           there is nothing on the far side of the first point to travel to.
//
// One cycle is one whole trip in every case, so `speed` means the same thing to all three.
export const SWING = {
    through: (cycles) => Math.sin(2 * Math.PI * cycles),
    there: (cycles) => (1 - Math.cos(2 * Math.PI * cycles)) / 2,
    along: (cycles) => triwave(2 * cycles),
};

/**
 * A return animation's progress, or 0 once it has run out of repeats.
 *
 * @param {(cycles: number) => number} shape one of SWING
 * @param {number} t how far through the cut, 0..1
 * @param {number} [speed] trips across the cut
 * @param {number} [count] how many trips before it settles; 0 or less means forever
 * @returns {number}
 */
export function swing(shape, t, speed = 1, count = 0) {
    const cycles = (speed || 1) * t;
    // Settling at 0 rather than wherever the wave happened to be: every shape passes through 0 at
    // the end of a whole trip, so this is where it would have stopped anyway.
    if (count > 0 && cycles >= count) return 0;
    return shape(cycles);
}

/**
 * An effect that runs between two values over part of a cut.
 *
 * The mosaic and the film grain were both asked for the same three things - how long, how fast,
 * and between which values - so they are the same question and get one answer.
 *
 *   from..to    where in the cut it happens, as fractions. The duration is the gap between them.
 *   speed       how quickly it gets there once started. Above 1 it arrives early and holds;
 *               below 1 it is still on its way when the window closes.
 *   min..max    the values it runs between. A non-zero `min` starts the effect already applied
 *               and deepens it, which scaling from nothing cannot express.
 *
 * Outside the window it is `min` - off, usually - on both sides. That is what "start" and "end"
 * mean to anyone reading the panel, and the first version got it wrong: it held whatever it had
 * reached after `to`, so setting an end of 0.5 left the static running to the end of the cut,
 * which was reported as "the end control does nothing". "Come on and stay" is still expressible:
 * set the end to 1.
 *
 * @param {number} t01 progress through the cut
 * @param {{from?: number, to?: number, speed?: number, min?: number, max?: number,
 *   ease?: string, easePower?: number}} o
 * @returns {number}
 */
export function effectAt(t01, { from = 0, to = 1, speed = 1, min = 0, max = 0, ease, easePower } = {}) {
    if (!(max > 0)) return 0;
    const lo = Math.max(0, Math.min(max, min));
    const a = Math.max(0, Math.min(1, from));
    const b = Math.max(a, Math.min(1, to));
    const span = b - a;
    // Off outside the window. Before the start there is nothing yet; after the end it has ended.
    if (t01 < a || t01 > b) return lo;
    // A zero-length window is a single moment, not a division by zero.
    let p = span <= 0 ? 1 : (t01 - a) / span;
    p = Math.max(0, Math.min(1, p * Math.max(0.01, speed)));
    return lo + (max - lo) * applyEase(p, ease, easePower);
}

// Sample a polyline path at normalized position s in [0,1].
export function samplePath(path, s) {
    const n = path.length;
    if (n === 1) return path[0];
    const idx = Math.max(0, Math.min(1, s)) * (n - 1);
    const i = Math.floor(idx), f = idx - i;
    if (i >= n - 1) return path[n - 1];
    return { x: path[i].x + (path[i + 1].x - path[i].x) * f, y: path[i].y + (path[i + 1].y - path[i].y) * f };
}
