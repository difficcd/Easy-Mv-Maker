// The rules behind a number field you can actually type into. Kept apart from the component in
// NumField.jsx so they can be tested without a DOM.
//
// The obvious controlled input - value={n} with onChange={e => set(clamp(+e.target.value))} -
// fights the user on every keystroke. Typing 100 into a field with a minimum of 6 goes: "1" is
// clamped up to 6, so the box now reads "6"; the next keystroke makes "60"; the next "600", which
// is clamped down to the maximum. 100 is unreachable by typing. Clearing the box is impossible
// too, because "" parses to NaN and is replaced with a number before the next digit lands.
//
// So the two questions are answered separately: what to report while the text is still being
// typed (liveNumber - never clamped, so a live preview can follow along) and what to settle on
// when the field is finished with (commitNumber - clamped, since that is the first moment the
// whole number is known).

/**
 * Constrain n to the range, ignoring bounds that were not given.
 * @param {number} n
 * @param {number} [min]
 * @param {number} [max]
 */
export function clampNum(n, min, max) {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
}

/**
 * The value to report while typing; null means "not a number yet, hold on".
 * Intermediate states like "", "-", "." and "1e" hold rather than snapping to zero.
 */
export function liveNumber(raw) {
    const s = String(raw).trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * The value to settle on when the field is left: unreadable text falls back to the old value.
 * @param {string|number} raw
 * @param {{min?: number, max?: number, fallback?: number}} [opts]
 */
export function commitNumber(raw, { min, max, fallback = 0 } = {}) {
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n)) return fallback;
    return clampNum(n, min, max);
}
