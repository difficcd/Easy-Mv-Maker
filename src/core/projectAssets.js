// Deciding how each piece of a project is stored, and how a stored one comes back.
//
// A project is written three different ways and the difference is not cosmetic:
//
//   - a local .emv file must open on a machine that has nothing else, so every frame, the audio
//     and the video are embedded as base64 dataURLs and the file stands alone
//   - an IndexedDB autosave runs every few seconds, so it stores Blobs directly - IDB persists
//     them natively, and base64 costs a third more bytes plus a full copy on the JS heap, which
//     is what used to make autosaving a big import run the tab out of memory
//   - a server save uploads frames and media as separate binary assets, so the JSON stays small
//     instead of becoming one enormous base64 string
//
// Which of the three applies was decided inline at each of the three call sites, with the
// fallbacks written out again each time. They did not agree: a frame with only a legacy dataURL
// fell back to embedding under a Blob-preferring autosave, which is correct, but nothing said so.
// The rules live here now, and the extension maps below are the reason - they are pure lookup
// with no way to notice a wrong answer until a file will not open.

/** A frame or media item goes out as a separate binary asset alongside a small JSON. */
export const STORE_ASSET = 'asset';
/** Stored as a Blob in the object itself - only IndexedDB can persist that. */
export const STORE_BLOB = 'blob';
/** Embedded as a base64 dataURL, so the JSON is self-contained. */
export const STORE_DATAURL = 'dataurl';

/**
 * Where one whole-image frame bitmap goes.
 *
 * Blob storage is preferred when it is available and allowed, but an entry that only ever had a
 * dataURL (written by an older version) has no Blob to store, so it embeds instead of vanishing.
 *
 * @param {{blob?: Blob|null, url?: string|null}} entry a bitmap store entry
 * @param {{assetSink?: unknown, blobsOk?: boolean}} mode how this project is being written
 * @returns {'asset'|'blob'|'dataurl'}
 */
export function frameStorage(entry, { assetSink = null, blobsOk = false } = {}) {
    if (assetSink) return STORE_ASSET;
    if (blobsOk && entry?.blob) return STORE_BLOB;
    return STORE_DATAURL;
}

/**
 * How a bitmap read back from a saved project has to be loaded.
 *
 * Only drawing layers are decoded to ImageData up front, because those are the ones the user can
 * still edit pixel by pixel. Video frames stay compressed and decode lazily when displayed -
 * decoding a whole import at once is several gigabytes of ImageData and takes the tab down.
 *
 * @param {unknown} val the saved value: a Blob, or a dataURL string
 * @param {Set<string>} compressedSet ids the file marked as whole encoded images
 * @param {string} id
 * @returns {'blob'|'compressed'|'decode'}
 */
export function frameLoad(val, compressedSet, id) {
    if (typeof Blob !== 'undefined' && val instanceof Blob) return 'blob';
    // The regex is not redundant with the manifest: files written before compressedBitmaps
    // existed have no manifest at all, and decoding their video frames would be the memory
    // blowup above. Format sniffing is what keeps those openable.
    if (compressedSet?.has(id) || (typeof val === 'string' && /^data:image\/(webp|jpeg)/.test(val))) return 'compressed';
    return 'decode';
}

/**
 * The file extension for a frame bitmap.
 * @param {{ext?: string, url?: string|null}} entry
 * @returns {string}
 */
export function imageExt(entry) {
    return entry?.ext || entry?.url?.match(/^data:image\/(\w+)/)?.[1] || 'webp';
}

/**
 * The file extension for an image, from a Blob MIME type.
 * @param {string|null|undefined} mime
 * @returns {string}
 */
export function imageExtFromType(mime) {
    return (typeof mime === 'string' && mime.match(/^image\/(\w+)/)?.[1]) || 'webp';
}

// Browsers report container formats under names nobody wants on the end of a filename, and the
// two lists differ, so they are written out rather than guessed at.
const AUDIO_EXT = { mpeg: 'mp3', 'x-m4a': 'm4a' };
const VIDEO_EXT = { 'x-matroska': 'mkv', quicktime: 'mov' };

/**
 * The file extension for the audio track, from its dataURL.
 * @param {string|null|undefined} dataUrl
 * @returns {string}
 */
export function audioExt(dataUrl) {
    const raw = (typeof dataUrl === 'string' && dataUrl.match(/^data:audio\/([\w.-]+)/)?.[1]) || 'mp3';
    return AUDIO_EXT[raw] || raw;
}

/**
 * The file extension for the video overlay, from its Blob MIME type.
 * @param {string|null|undefined} mime
 * @returns {string}
 */
export function videoExt(mime) {
    const raw = (typeof mime === 'string' && mime.match(/^video\/([\w.-]+)/)?.[1]) || 'mp4';
    return VIDEO_EXT[raw] || raw;
}
