// Talking to the local project server.
//
// Two wrappers around fetch, and the only thing they add is the check fetch does not do: a 404 or
// a 500 is a perfectly good response as far as fetch is concerned, and it rejects only when the
// network itself fails. Every call here wants the opposite - a response that is not ok is a
// failure, and should be thrown rather than parsed.
//
// That is not a hypothetical tidy-up. Before the check existed on the asset path, a 404 from the
// store came back as a Blob of `{"error":"not found"}` and was written into a project as the
// frame's image data.
//
// These live outside App because both App and the server-storage hook need them, and neither owns
// them: there is no state here, only fetch and a status code.
//
// One thing more than the status check: a 429 is waited out rather than thrown. The server rate
// limits writes, a save is one write per frame, and the frame count is the user's business - so
// any ceiling can be reached by a big enough project. Failing there is the worst outcome, because
// the manifest is written last: every frame uploads, then the save fails, and nothing is
// committed. Waiting makes a large save slow instead.

/** How many times a 429 is waited out before giving up. */
const RETRY_LIMIT = 6;
/** The longest a single wait may be, so a bad Retry-After cannot hang a save for an hour. */
const RETRY_MAX_MS = 5000;

/**
 * How long to wait before retrying a rate-limited request.
 *
 * The server's Retry-After is in seconds and is what it actually wants; anything missing or
 * unparseable falls back to doubling, so a server that rate limits without the header still gets
 * backed off rather than hammered. Clamped at both ends: never busy-loop, never stall.
 *
 * Exported for the tests - the arithmetic is the part worth pinning, and it needs no network.
 *
 * @param header the response's Retry-After, in seconds
 * @param attempt how many retries have already happened, from 0
 */
export function retryDelayMs(header: string | null | undefined, attempt: number): number {
    const seconds = Number(header);
    const fromHeader = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
    const backoff = Math.min(RETRY_MAX_MS, 250 * Math.pow(2, Math.max(0, attempt)));
    return Math.min(RETRY_MAX_MS, Math.max(200, fromHeader || backoff));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * fetch, but a 429 is waited out rather than returned.
 *
 * Every body sent through here is a string or a Blob, both of which can be sent again; a stream
 * could not be, and nothing here uses one.
 */
async function fetchWaiting(url: string, opts?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, opts);
        if (res.status !== 429 || attempt >= RETRY_LIMIT) return res;
        await sleep(retryDelayMs(res.headers.get('Retry-After'), attempt));
    }
}

/**
 * A JSON endpoint, or throw.
 *
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
export async function apiFetch(url: string, opts?: RequestInit): Promise<any> {
    const res = await fetchWaiting(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * One stored binary asset - a video frame, the audio, the reference video - or throw.
 *
 * @param {string} url
 * @returns {Promise<Blob>}
 */
export async function fetchAsset(url: string): Promise<Blob> {
    const res = await fetchWaiting(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
}

/**
 * Upload one asset, or throw with a message naming which of how many failed.
 *
 * Sends the Blob directly rather than a dataURL: base64 is a third larger and has to be decoded
 * on both ends. A legacy dataURL is fetched back into a Blob first, which is why `url` is still
 * accepted alongside `blob`.
 *
 * @param {string} base the project or backup key's asset path, e.g. `/api/projects/p_abc`
 * @param {{id: string, ext: string, blob?: Blob, url?: string}} asset
 * @param {string} failMessage thrown as-is, so the caller can localise and number it
 * @returns {Promise<void>}
 */
export async function putAsset(base: string, asset: { id: string, ext: string, blob?: Blob | null, url?: string | null }, failMessage: string): Promise<void> {
    const blob = asset.blob || await (await fetch(asset.url as string)).blob();
    const res = await fetchWaiting(`${base}/asset/${asset.id}?ext=${encodeURIComponent(asset.ext)}`, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
    });
    // The status goes in the message. "upload failed (57/120)" says which frame and nothing about
    // why, and the difference between a full disk and a rate limit is the whole diagnosis.
    if (!res.ok) throw new Error(`${failMessage} (HTTP ${res.status})`);
}
