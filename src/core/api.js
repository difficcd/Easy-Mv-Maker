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

/**
 * A JSON endpoint, or throw.
 *
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
export async function apiFetch(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * One stored binary asset - a video frame, the audio, the reference video - or throw.
 *
 * @param {string} url
 * @returns {Promise<Blob>}
 */
export async function fetchAsset(url) {
    const res = await fetch(url);
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
export async function putAsset(base, asset, failMessage) {
    const blob = asset.blob || await (await fetch(asset.url)).blob();
    const res = await fetch(`${base}/asset/${asset.id}?ext=${encodeURIComponent(asset.ext)}`, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
    });
    if (!res.ok) throw new Error(failMessage);
}
