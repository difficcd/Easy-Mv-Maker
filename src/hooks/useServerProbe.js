// Is the project-storage API there?
//
// The app runs in three places that answer this differently: a dev machine with the server up, a
// static deployment where there is no server and never will be, and an APK where there is not one
// either. The server menu and the YouTube import hide themselves when the answer is no.
//
// Checking once was the original bug. If the server happened to be down at load, the app stayed
// convinced of it for the whole session - the menu entries never rendered, so clicking did
// nothing and the console stayed empty, which is how one bug here hid for a long time.
//
// So it re-checks, and backs off. A deployment that will never have a server would otherwise be a
// failing request every ten seconds for as long as the tab is open. Focus resets the backoff
// rather than merely interrupting it, because coming back to the tab is the moment the server has
// most likely just been started.

import { useState, useEffect } from 'react';
import { nextProbeDelay } from '../core/probeBackoff.js';

/**
 * @param {string} [url] the endpoint to probe
 * @returns {boolean} whether the API answered the last time it was asked
 */
export function useServerProbe(url = '/api/projects') {
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        let alive = true;
        let failures = 0;
        let timer = /** @type {any} */ (0);

        const schedule = () => {
            if (!alive) return;
            clearTimeout(timer);
            timer = setTimeout(probe, nextProbeDelay(failures));
        };
        const probe = () => fetch(url, { method: 'GET' })
            .then(r => {
                if (!alive) return;
                failures = r.ok ? 0 : failures + 1;
                setAvailable(r.ok);
            })
            .catch(() => {
                if (!alive) return;
                failures++;
                setAvailable(false);
            })
            .finally(schedule);

        probe();
        const onFocus = () => { failures = 0; probe(); };
        window.addEventListener('focus', onFocus);
        return () => { alive = false; clearTimeout(timer); window.removeEventListener('focus', onFocus); };
    }, [url]);

    return available;
}
