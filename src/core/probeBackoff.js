// How often to ask whether the project-storage server is there.
//
// Locally the server comes and goes — it is started in a second terminal, and the common flow is
// "start it, switch back to the tab" — so the app has to keep checking rather than deciding once
// at load. A fixed ten-second poll does that, and for local work it is fine.
//
// On a deployment there is no server and there never will be until one is hosted, so that same
// poll is a request that fails every ten seconds for as long as the tab is open: console noise
// for anyone who opens it, and pointless radio on a tablet.
//
// Backing off gets both. The first few failures are retried quickly, because that is the case
// where the server is about to appear; after that the interval grows until it is checking every
// few minutes, which costs nothing. Focus still forces an immediate check, so the local flow
// does not have to wait for the timer.

const BASE_MS = 10_000;   // the original poll, kept for the first failures
const MAX_MS = 300_000;   // five minutes; a deployment settles here
const QUICK_TRIES = 3;    // how many failures stay at the base interval

/**
 * Delay before the next probe, given how many have failed in a row.
 *
 * @param {number} failures consecutive failures; 0 means the last probe succeeded
 * @returns {number} milliseconds
 */
export function nextProbeDelay(failures) {
    const n = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;
    if (n <= QUICK_TRIES) return BASE_MS;
    // Doubling from the base once the quick tries are used up.
    return Math.min(MAX_MS, BASE_MS * 2 ** (n - QUICK_TRIES));
}

export const PROBE_BASE_MS = BASE_MS;
export const PROBE_MAX_MS = MAX_MS;
export const PROBE_QUICK_TRIES = QUICK_TRIES;
