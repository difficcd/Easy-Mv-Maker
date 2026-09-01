// Undo and redo.
//
// The pure part - what a push does to the stack, what a step returns - is in core/historyOps.js
// and has been for a while. What lived in App was the wiring: four refs, an effect that watches
// the document, an imperative escape hatch for the one caller that records at a moment of its own
// choosing, and the flag that stops applying a snapshot from immediately recording it again.
//
// That wiring is what makes this a hook rather than a function. Pulled out as a function it would
// need every one of those refs threaded in and back out; as a hook it simply keeps them.
//
// What it deliberately does not know: when the app is busy. Drawing, dragging a cut and moving a
// selection all mean "not now", and those are the drawing code's refs. The caller passes a
// predicate instead, so this file has no opinion about how drawing works.
//
// On the snapshot approach: every entry is a deep copy of the whole document, which is cheap to
// reason about and gets expensive as projects grow. Replacing it with recorded commands, or with
// patches, is a real future change - and this is where it would happen, behind the same three
// functions the app already calls.

import { useEffect, useRef, useCallback } from 'react';
import { pushSnapshot, step } from '../core/historyOps.js';

/**
 * @template T
 * @param {object} opts
 * @param {T} opts.snapshot the document as it is now; a change to this is what gets recorded
 * @param {() => boolean} opts.shouldSkip true while the app is mid-gesture and a snapshot would
 *   capture a half-finished state
 * @param {(snapshot: T) => void} opts.apply put a snapshot back into the app
 * @returns {{undo: () => void, redo: () => void, record: (snapshot: T) => void, entries: () => T[]}}
 */
export function useHistory({ snapshot, shouldSkip, apply }) {
    const entriesRef = useRef(/** @type {T[]} */([]));
    const indexRef = useRef(-1);
    // Applying a snapshot changes the document, which would otherwise be recorded as a new entry
    // and make undo un-undoable.
    const applyingRef = useRef(false);

    // The effect reads these through refs so it can depend on the document alone. Naming the
    // callbacks in its dependency list would re-run it on every render, since they are rebuilt
    // each time.
    const shouldSkipRef = useRef(shouldSkip);
    shouldSkipRef.current = shouldSkip;
    const applyRef = useRef(apply);
    applyRef.current = apply;

    /** Record a snapshot now, whatever the effect is doing. Stable, so callers may store it. */
    const record = useCallback((snap) => {
        const r = pushSnapshot(entriesRef.current, indexRef.current, snap);
        if (!r.changed) return;
        entriesRef.current = r.history;
        indexRef.current = r.index;
    }, []);

    useEffect(() => {
        if (shouldSkipRef.current()) return;
        if (applyingRef.current) { applyingRef.current = false; return; }
        record(snapshot);
    }, [snapshot, record]);

    const go = useCallback((dir) => {
        const r = step(entriesRef.current, indexRef.current, dir);
        if (!r) return;                       // already at that end
        indexRef.current = r.index;
        applyingRef.current = true;
        // Deep copied on the way out as well as in: the app mutates what it is given, and an entry
        // that gets mutated is an undo that quietly stops going back where it said it would.
        applyRef.current(JSON.parse(JSON.stringify(r.snapshot)));
    }, []);

    const undo = useCallback(() => go(-1), [go]);
    const redo = useCallback(() => go(1), [go]);

    /**
     * The recorded snapshots, for the bitmap garbage collector.
     *
     * Exposed rather than hidden, because the coupling is real: strokes point at pixels held
     * outside the document, and a snapshot keeps those pixels reachable. Freeing something an
     * undo still needs is not a leak, it is an undo that comes back blank. A function rather than
     * the array itself, so callers always see the current stack.
     */
    const entries = useCallback(() => entriesRef.current, []);

    return { undo, redo, record, entries };
}
