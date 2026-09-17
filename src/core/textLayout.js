// Where each character of a line goes.
//
// Text is normally drawn a whole line at a time, and should stay that way: fillText applies the
// font's kerning and shaping, and drawing character by character throws both away. On Latin that
// shows up as visibly wrong spacing between pairs like "AV"; it is the reason this module is not
// the default path but the one taken only when something actually needs per-character positions.
//
// Two things need them. Curving a line means every character sits at its own angle. Animating
// characters separately - the ones that drop in one after another - means every character has its
// own transform. Both want the same answer, so it is worked out once, here, without a canvas.
//
// Measurement stays with the caller. Character widths come from ctx.measureText, and keeping that
// out means this file is pure and its arithmetic is testable.

/**
 * @typedef {object} PlacedChar
 * @property {string} ch
 * @property {number} x offset from the line's anchor, along the baseline
 * @property {number} y offset from the baseline, growing downward like canvas y
 * @property {number} angle radians, clockwise, about the character's own centre
 * @property {number} index position in the line, for staggering an animation
 */

/**
 * Lay a line out character by character.
 *
 * The curve is expressed as the total angle the line subtends, in degrees, which is the number a
 * person can reason about: 0 is straight, 180 is a half circle. Positive arcs upward - the
 * middle of the line rises - because that is what "curve" means on a banner.
 *
 * @param {string[]} chars
 * @param {number[]} widths advance width of each character, same order
 * @param {object} opts
 * @param {number} [opts.curve] total arc in degrees; 0 is a straight line
 * @param {number} [opts.letterSpacing] extra px between characters
 * @returns {PlacedChar[]}
 */
export function layoutLine(chars, widths, { curve = 0, letterSpacing = 0 } = {}) {
    const n = Math.min(chars.length, widths.length);
    if (n === 0) return [];

    // Advance of each character including the gap that follows it, and the total the line spans.
    const advances = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
        const adv = widths[i] + (i < n - 1 ? letterSpacing : 0);
        advances.push(adv);
        total += adv;
    }

    // Distance from the start of the line to the middle of each character.
    const centres = [];
    let run = 0;
    for (let i = 0; i < n; i++) {
        centres.push(run + widths[i] / 2);
        run += advances[i];
    }

    const theta = (curve * Math.PI) / 180;
    // Below this the radius is enormous and the arc is a straight line to any pixel that matters,
    // and computing it invites dividing by nearly zero.
    if (Math.abs(theta) < 1e-4 || total <= 0) {
        return chars.slice(0, n).map((ch, i) => ({ ch, x: centres[i], y: 0, angle: 0, index: i }));
    }

    // Wrap the line onto a circle whose arc length is the line's width, so curving does not change
    // how much room the text takes along its own length.
    const radius = total / theta;

    return chars.slice(0, n).map((ch, i) => {
        // Angle of this character measured from the middle of the line.
        const a = (centres[i] - total / 2) / radius;
        return {
            ch,
            // Rebased so a curve of zero and a curve of nearly zero agree: without the half-total
            // the whole line would jump sideways the moment it started bending.
            x: radius * Math.sin(a) + total / 2,
            // y grows downward, and (1 - cos) is never negative, so the sign has to come from the
            // radius - which is negative when the curve is. The middle stays at zero and the ends
            // drop away, which is a positive curve arcing upward.
            y: radius * (1 - Math.cos(a)),
            angle: a,
            index: i,
        };
    });
}

/**
 * Progress of one character when they are staggered.
 *
 * Every character runs the same animation; they start at different times. `spread` is how much of
 * the total duration is given over to starting them: 0 means all at once, and the more of it is
 * spent staggering, the less each character has to move in.
 *
 * It is capped below 1. Spending the whole duration on starts leaves the last character no time
 * at all, so it would snap into place instead of animating - and at exactly 1 it never starts,
 * which is how the cap came to be written down.
 *
 * @param {number} index
 * @param {number} count
 * @param {number} progress 0..1 through the whole animation
 * @param {number} [spread] 0..1
 * @returns {number} this character's own 0..1, clamped
 */
export function charProgress(index, count, progress, spread = 0.5) {
    if (count <= 1 || spread <= 0) return Math.max(0, Math.min(1, progress));
    // The last character always keeps a tenth of the duration to move in.
    const s = Math.min(0.9, spread);
    const span = 1 - s;
    const start = (index / (count - 1)) * s;
    return Math.max(0, Math.min(1, (progress - start) / span));
}
