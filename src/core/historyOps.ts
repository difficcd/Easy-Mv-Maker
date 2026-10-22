// Undo/redo as a list of snapshots and a position in it.
//
// The arithmetic is small and entirely off-by-one shaped, which is why it is here rather than
// inline: every operation has to keep the index pointing at the snapshot that is currently on
// screen, and the three that can break that are trimming the redo branch, dropping the oldest
// entry when the list is full, and stepping at either end.
//
// A snapshot is whatever the caller wants restored - here, the cuts, the audio placement and the
// track count - compared as JSON, since that is also how they are stored.

// How far back undo reaches.
//
// A snapshot is a copy of the whole document, so the honest limit is memory rather than a step
// count: eighty steps is generous for a few strokes and reckless for a long project with
// thousands of them. The budget is spent on whatever the snapshots actually cost, so a light
// project gets hundreds of steps and a heavy one still cannot fill the tab.
//
// Bitmaps are not in a snapshot - strokes only carry ids - so what is measured here is mostly
// stroke coordinates.
const HISTORY_BUDGET = 24 * 1024 * 1024; // of serialised snapshot, roughly
const MIN_HISTORY = 20;   // even a very heavy project keeps a usable amount of undo
const MAX_HISTORY = 400;  // and a trivial one does not keep an unbounded amount

/** Steps affordable at this snapshot size. Exported for the tests and for anyone tuning it. */
export function limitFor(snapshotBytes: number, budget = HISTORY_BUDGET): number {
    return Math.max(MIN_HISTORY, Math.min(MAX_HISTORY, Math.floor(budget / Math.max(1, snapshotBytes))));
}

/** The old fixed cap, kept as the default when no size is known. */
export const HISTORY_LIMIT = MAX_HISTORY;

/**
 * Record a snapshot, returning the new list and position.
 *
 * The input is never modified, so the caller can keep the old pair if it wants to.
 *
 * @param {Array} history snapshots, oldest first
 * @param {number} index which one is currently on screen, or -1 for none
 * @param {object} snapshot the state to record
 * @param {number} [limit] fixed step cap; omit to size it by what a snapshot costs
 * @returns {{history: Array, index: number, changed: boolean}} changed is false when the
 *   snapshot matches what is already on screen and nothing was recorded
 */
/**
 * One undo step: the snapshot kept as its JSON, and whatever the caller asked to keep beside it.
 *
 * As JSON rather than as a parsed copy. Each change used to stringify the new snapshot, stringify
 * the previous one *again* to compare them, and parse the new one back into a copy - three passes
 * over the whole document for every stroke. On a 3.5MB document that was 89ms per change, spent
 * before anything was drawn. A string is already a copy nothing can edit, the last entry's string
 * is what the next change compares against, and parsing happens only when undo actually steps back:
 * one pass instead of three, 31ms on the same document.
 *
 * `keep` is for what a caller needs from every entry without parsing them all - the bitmap
 * collector's ids, so that freeing pixels does not mean decoding the whole history.
 */
export interface HistoryEntry<K = unknown> { json: string; keep?: K }

export function pushSnapshot<S, K = unknown>(history: HistoryEntry<K>[] | null | undefined, index: number, snapshot: S, limit: number | null = null, summarize?: (snapshot: S) => K): { history: HistoryEntry<K>[], index: number, changed: boolean } {
    const list = Array.isArray(history) ? history : [];
    const json = JSON.stringify(snapshot);
    // Nothing actually changed - a drag that ended where it started, an effect firing again -
    // so there is nothing to undo back to.
    if (list.length > 0 && index >= 0 && list[index]?.json === json) {
        return { history: list, index, changed: false };
    }
    // Anything undone past is dropped: taking a new action makes that branch unreachable, and
    // leaving it would let redo jump into a future that never happened.
    const next = list.slice(0, index + 1);
    next.push(summarize ? { json, keep: summarize(snapshot) } : { json });
    let at = next.length - 1;
    // How many of these we can afford, judged by the one just taken.
    const cap = limit == null ? limitFor(json.length) : limit;
    // Dropping the oldest shifts every position down one, the current one included.
    while (next.length > cap) { next.shift(); at--; }
    return { history: next, index: at, changed: true };
}

/** Whether there is anything to step to. Index 0 is the original state, so undo needs 1 or more. */
export const canUndo = (history: unknown[] | null | undefined, index: number): boolean => index > 0;
export const canRedo = (history: unknown[] | null | undefined, index: number): boolean => index < (Array.isArray(history) ? history.length : 0) - 1;

/**
 * Step one snapshot back or forward.
 * @returns {{index: number, snapshot: any}|null} null at either end, so the caller does nothing
 */
export function step<S>(history: S[] | null | undefined, index: number, dir: number): { index: number, snapshot: S } | null {
    const list = Array.isArray(history) ? history : [];
    if (dir < 0 && !canUndo(list, index)) return null;
    if (dir > 0 && !canRedo(list, index)) return null;
    const at = index + (dir < 0 ? -1 : 1);
    return { index: at, snapshot: list[at] };
}
