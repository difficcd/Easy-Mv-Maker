// Which cuts are selected after a click on one, and which are copied.
//
// Clicking a cut with nothing held selects it alone; with Ctrl it joins or leaves the selection;
// with Shift it selects the run from the current cut to it. The run is in *reading order* -
// track by track, then by start time - not in the order the cuts were made, which is what
// `cuts` is in. That rule lived inside the click handler, where the one case worth a test (a
// shift-click backwards, or across tracks) could not be checked.

import type { Id, CutLike } from './types.ts';

/** A copy of the set with `id` added if absent, removed if present. */
export function toggled<T>(set: Iterable<T>, id: T): Set<T> {
    const s = new Set(set);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
}

/** Cuts in reading order: by track, then by start time. */
export const inReadingOrder = <C extends CutLike = Cut>(cuts: Iterable<C>): C[] => [...cuts].sort((a, b) => a.track - b.track || a.startTime - b.startTime);

/**
 * The selection after a click on `id`.
 *
 * @param {Set<any>} selected the selection before the click
 * @param {Array<{id: any, track: number, startTime: number}>} cuts
 * @param {any} currentCutId the cut that was current - the anchor of a shift-click
 * @param {any} id the cut clicked
 * @param {{ctrl?: boolean, shift?: boolean}} mods
 * @returns {Set<any>}
 */
export function selectionAfterClick(selected: Iterable<Id>, cuts: CutLike[], currentCutId: Id | null | undefined, id: Id, { ctrl = false, shift = false }: { ctrl?: boolean, shift?: boolean } = {}): Set<Id> {
    if (ctrl) return toggled(selected, id);
    if (shift && currentCutId != null) {
        const ordered = inReadingOrder(cuts);
        const i1 = ordered.findIndex(c => c.id === currentCutId), i2 = ordered.findIndex(c => c.id === id);
        if (i1 >= 0 && i2 >= 0) {
            const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
            return new Set(ordered.slice(lo, hi + 1).map(c => c.id));
        }
    }
    return new Set([id]);
}

/**
 * The cuts a copy of `id` takes: the whole selection when `id` is part of a multi-selection,
 * otherwise just that one. In reading order, so a paste lays them out the way they read.
 *
 * @param {Array<{id: any, track: number, startTime: number}>} cuts
 * @param {Set<any>} selected
 * @param {any} id
 */
export function cutsToCopy<C extends CutLike>(cuts: C[], selected: Set<Id>, id: Id): C[] {
    const ids = (selected.size > 1 && selected.has(id)) ? selected : new Set([id]);
    return inReadingOrder(cuts.filter(c => ids.has(c.id)));
}
