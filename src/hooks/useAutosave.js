// Saving to IndexedDB in the background, so a refresh or a crash never costs work.
//
// Debounced rather than immediate: the document changes on every stroke, and encoding a project
// with an imported video takes long enough that doing it per stroke would be felt.
//
// Two guards, both learned the hard way. It does not run until crash recovery has decided whether
// to restore - otherwise an empty new document overwrites the autosave the user was about to be
// offered. And it does not run mid-gesture, because a half-drawn stroke is not a state worth
// keeping and encoding one costs frames.
//
// Failures are surfaced, never swallowed. An autosave that quietly stops working lets somebody
// believe their work is being saved right up until they lose all of it, which is the worst
// possible way for this to fail.

import { useState, useRef, useEffect } from 'react';

/**
 * @param {object} opts
 * @param {unknown} opts.doc the document as one memoised value; a change to it means a save is
 *   due. One value rather than a list of them, because a spread dependency array is something
 *   the linter cannot verify, and an unmemoised array would be new on every render.
 * @param {() => boolean} opts.ready false until crash recovery has finished deciding
 * @param {() => boolean} opts.busy true mid-gesture, when a snapshot is not worth taking
 * @param {() => Promise<any>} opts.build produce the object to store
 * @param {(data: any) => Promise<any>} opts.save write it
 * @param {number} [opts.delay] quiet period before saving, in ms
 * @returns {{savedAt: number|null, error: string|null}}
 */
export function useAutosave({ doc, ready, busy, build, save, delay = 1500 }) {
    const [savedAt, setSavedAt] = useState(/** @type {number|null} */(null));
    const [error, setError] = useState(/** @type {string|null} */(null));
    const timerRef = useRef(/** @type {any} */(null));

    // Read through refs so the effect can depend on the watched values alone; naming the callbacks
    // would re-run it every render, since they are rebuilt each time.
    const fns = useRef({ ready, busy, build, save });
    fns.current = { ready, busy, build, save };

    useEffect(() => {
        const { ready: isReady, busy: isBusy } = fns.current;
        if (!isReady() || isBusy()) return;

        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
            try {
                const data = await fns.current.build();
                await fns.current.save(data);
                setSavedAt(Date.now());
                setError(null);
            } catch (e) {
                setError(String(e?.message || e));
            }
        }, delay);

        return () => clearTimeout(timerRef.current);
    }, [doc, delay]);

    return { savedAt, error };
}
