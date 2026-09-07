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


/**
 * Every bitmap the cuts reference, packed the way this kind of save wants them.
 *
 * The decisions here were already this module's - frameStorage says where each frame goes - but
 * the loop around them lived in App.jsx, where it could only be read, never run. It is the part
 * with the states: a frame can be a Blob, a legacy dataURL, or raw ImageData, and only the last
 * of those can be cached, because the first two are already encoded.
 *
 * The two encoders are injected rather than imported: one needs FileReader and the other a
 * canvas, and neither exists in a test runner. Everything else here is arithmetic over the
 * document.
 *
 * @param {any[]} cuts
 * @param {object} io
 * @param {{ get(id: string): any }} io.store the bitmap store
 * @param {Map<string, {imageData: unknown, url: string}>} io.cache dataURLs already encoded
 * @param {any[] | null} [io.assetSink] collects items to upload separately, when there is one
 * @param {boolean} [io.blobsOk] whether the destination can hold a Blob (IndexedDB can)
 * @param {(blob: Blob) => Promise<string>} io.blobToDataURL
 * @param {(imageData: unknown) => string} io.imageDataToDataURL
 * @returns {Promise<{ bitmaps: Record<string, any>, compressed: string[], assets: any[] }>}
 */
export async function collectBitmaps(cuts, {
    store, cache, assetSink = null, blobsOk = false, blobToDataURL, imageDataToDataURL,
}) {
    const usedIds = new Set();
    for (const cut of (cuts || [])) {
        for (const layer of (cut?.layers || [])) {
            for (const stroke of (Array.isArray(layer?.strokes) ? layer.strokes : [])) {
                if (stroke.bitmapId) usedIds.add(stroke.bitmapId);
            }
        }
    }

    const bitmaps = {};
    /** Ids stored as a whole encoded image (video frames): they stay compressed on restore. */
    const compressed = [];
    /** The manifest an asset save writes, naming what was uploaded beside the JSON. */
    const assets = [];

    for (const id of usedIds) {
        const entry = store.get(id);
        if (!entry) continue;

        // A whole encoded image - a video frame - held as a Blob, or as a dataURL by an older
        // version that had no Blob to hold.
        if (entry.blob || entry.url) {
            const ext = imageExt(entry);
            const where = frameStorage(entry, { assetSink, blobsOk });
            if (where === STORE_ASSET) {
                assets.push({ id, ext, w: entry.w || 0, h: entry.h || 0 });
                assetSink.push({ id, blob: entry.blob, url: entry.url, ext });
            } else if (where === STORE_BLOB) {
                bitmaps[id] = entry.blob;
                compressed.push(id);
            } else {
                bitmaps[id] = entry.blob ? await blobToDataURL(entry.blob) : entry.url;
                compressed.push(id);
            }
            continue;
        }

        if (!entry.imageData) continue;
        // Raw pixels, which have to be encoded. The cache is keyed on the ImageData itself rather
        // than the id: a lasso edit replaces the pixels under the same id, and a stale dataURL
        // would save the drawing as it was before the edit.
        const hit = cache.get(id);
        if (hit && hit.imageData === entry.imageData) { bitmaps[id] = hit.url; continue; }
        const url = imageDataToDataURL(entry.imageData);
        cache.set(id, { imageData: entry.imageData, url });
        bitmaps[id] = url;
    }

    return { bitmaps, compressed, assets };
}

/**
 * Rebuild a bitmap store from a saved project's `bitmaps` map.
 *
 * The reverse of collectBitmaps, and it was written inline inside App's restore - which meant the
 * only way to open a project's pixels was to open the project, replacing whatever was on screen.
 * Exporting several separately-made pieces as one file (#123) needs to read a piece's frames
 * without the app ever opening it, and so does anything else that wants to look at a file rather
 * than become it.
 *
 * Frames stay Blobs and are decoded lazily on display; drawing layers become editable ImageData up
 * front. Which of those a value is comes from frameLoad, so the routing is the same one the save
 * side uses rather than a second opinion about it.
 *
 * An entry that will not load is skipped rather than thrown: one unreadable frame in a thousand
 * should cost that frame, not the project. The count comes back so a caller can say so.
 *
 * @param {{bitmaps?: Record<string, any>, compressedBitmaps?: string[]}} data
 * @param {object} deps
 * @param {(url: string) => Promise<ImageData>} deps.dataURLToImageData
 * @param {(img: ImageData) => Promise<any>} [deps.createBitmap] best-effort fast path
 * @param {(url: string) => Promise<Blob>} deps.urlToBlob
 * @param {(type: string) => string} deps.extFromType
 * @param {() => void} [deps.onEach] called once per entry, loaded or not, for progress
 * @returns {Promise<{store: Map<string, any>, failed: number}>}
 */
export async function loadBitmapStore(data, { dataURLToImageData, createBitmap, urlToBlob, extFromType, onEach }) {
    const store = new Map();
    if (!data?.bitmaps) return { store, failed: 0 };
    const compressedSet = new Set(data.compressedBitmaps || []);
    const entries = await Promise.all(Object.entries(data.bitmaps).map(async ([id, val]) => {
        try {
            const how = frameLoad(val, compressedSet, id);
            if (how === 'blob') {
                return [id, { imageData: null, imageBitmap: null, blob: val, ext: extFromType(val.type) }];
            }
            if (how === 'compressed') {
                const blob = await urlToBlob(val);
                return [id, { imageData: null, imageBitmap: null, blob, ext: extFromType(blob.type) }];
            }
            const imageData = await dataURLToImageData(val);
            let imageBitmap = null;
            try { imageBitmap = createBitmap ? await createBitmap(imageData) : null; } catch { }
            return [id, { imageData, imageBitmap }];
        } catch { return null; } finally { onEach?.(); }
    }));
    let failed = 0;
    for (const e of entries) {
        if (e) store.set(e[0], e[1]); else failed++;
    }
    return { store, failed };
}
