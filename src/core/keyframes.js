// Editing a part's keyframe list: the rules the panel applies before a list is stored.
//
// Two rules, both easy to lose inside a click handler. The list is always sorted by position,
// because the renderer walks it in order and the panel shows it in order - editing a key's
// percentage moves its row rather than leaving the list out of sequence. And a key added where
// one already sits replaces it rather than stacking a second key at the same instant, which
// would make the tween jump.

/** Two keys closer than this in progress are the same instant. */
export const KEY_SNAP = 0.005;

/** The stored form of a list: sorted, or null when there is nothing to store. */
export function keysOrNull(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return null;
    return [...keys].sort((x, y) => x.p - y.p);
}

/** Progress clamped to the cut and rounded to a whole percent, which is what the panel shows. */
export const snapProgress = (p) => Math.round(Math.max(0, Math.min(1, p)) * 100) / 100;

/**
 * The list with a key at `p` carrying `values` - replacing the key already there, if any, or
 * added with a fresh id otherwise. The id is what lets React follow a key whose row moves.
 *
 * @param {Array<{id?: string, p: number}>} keys
 * @param {number} p progress, already snapped
 * @param {object} values the key's fields other than id and p
 * @param {() => string} mkId
 * @returns {Array<object>} sorted
 */
export function upsertKey(keys, p, values, mkId) {
    const list = Array.isArray(keys) ? keys : [];
    const cur = list.find(k => Math.abs(k.p - p) < KEY_SNAP);
    const next = cur
        ? list.map(k => k === cur ? { ...k, ...values, p } : k)
        : [...list, { id: mkId(), ...values, p }];
    return keysOrNull(next);
}

/** The list with the key at index `i` patched, re-sorted in case its position changed. */
export function patchKey(keys, i, patch) {
    return keysOrNull(keys.map((k, j) => j === i ? { ...k, ...patch } : k));
}

/** The list without the key at index `i`; null once it is empty. */
export function removeKey(keys, i) {
    return keysOrNull(keys.filter((_, j) => j !== i));
}
