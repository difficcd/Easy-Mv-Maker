// Undo/redo as a list of snapshots and a position in it.
//
// The arithmetic is small and entirely off-by-one shaped, which is why it is here rather than
// inline: every operation has to keep the index pointing at the snapshot that is currently on
// screen, and the three that can break that are trimming the redo branch, dropping the oldest
// entry when the list is full, and stepping at either end.
//
// A snapshot is whatever the caller wants restored - here, the cuts, the audio placement and the
// track count - compared as JSON, since that is also how they are stored.

/** How many snapshots are kept. Older ones are dropped from the front. */
export const HISTORY_LIMIT = 80;

/**
 * Record a snapshot, returning the new list and position.
 *
 * The input is never modified, so the caller can keep the old pair if it wants to.
 *
 * @param {Array} history snapshots, oldest first
 * @param {number} index which one is currently on screen, or -1 for none
 * @param {object} snapshot the state to record
 * @param {number} [limit]
 * @returns {{history: Array, index: number, changed: boolean}} changed is false when the
 *   snapshot matches what is already on screen and nothing was recorded
 */
export function pushSnapshot(history, index, snapshot, limit = HISTORY_LIMIT) {
    const list = Array.isArray(history) ? history : [];
    const json = JSON.stringify(snapshot);
    // Nothing actually changed - a drag that ended where it started, an effect firing again -
    // so there is nothing to undo back to.
    if (list.length > 0 && index >= 0 && JSON.stringify(list[index]) === json) {
        return { history: list, index, changed: false };
    }
    // Anything undone past is dropped: taking a new action makes that branch unreachable, and
    // leaving it would let redo jump into a future that never happened.
    const next = list.slice(0, index + 1);
    next.push(JSON.parse(json));
    let at = next.length - 1;
    // Dropping the oldest shifts every position down one, the current one included.
    while (next.length > limit) { next.shift(); at--; }
    return { history: next, index: at, changed: true };
}

/** Whether there is anything to step to. Index 0 is the original state, so undo needs 1 or more. */
export const canUndo = (history, index) => index > 0;
export const canRedo = (history, index) => index < (Array.isArray(history) ? history.length : 0) - 1;

/**
 * Step one snapshot back or forward.
 * @returns {{index: number, snapshot: any}|null} null at either end, so the caller does nothing
 */
export function step(history, index, dir) {
    const list = Array.isArray(history) ? history : [];
    if (dir < 0 && !canUndo(list, index)) return null;
    if (dir > 0 && !canRedo(list, index)) return null;
    const at = index + (dir < 0 ? -1 : 1);
    return { index: at, snapshot: list[at] };
}
