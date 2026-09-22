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

/** Where a frame's pixels go when a project is written. */
export type StoreKind = typeof STORE_ASSET | typeof STORE_BLOB | typeof STORE_DATAURL;
/** One bitmap in the live store: decoded pixels, or bytes still to decode, or a URL to fetch. */
export interface StoreEntry { imageData?: ImageData | null; imageBitmap?: any; blob?: Blob | null; url?: string | null; ext?: string; w?: number; h?: number }
/** A frame written as a server asset: what the document keeps of it. */
export interface AssetRef { id: string; ext: string; w?: number; h?: number }
/** A frame handed to the asset sink to be uploaded. */
export interface AssetOut { id: string; blob?: Blob | null; url?: string | null; ext: string }
/** collectBitmaps' answer: the bitmaps to embed, which of them are compressed, and the assets to upload. */
export interface CollectedBitmaps { bitmaps: Record<string, string | Blob>; compressed: string[]; assets: AssetRef[] }

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
export function frameStorage(entry: { blob?: Blob | null } | null | undefined, { assetSink = null, blobsOk = false }: { assetSink?: unknown[] | null, blobsOk?: boolean } = {}): StoreKind {
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
export function frameLoad(val: unknown, compressedSet: Set<string> | null | undefined, id: string): 'blob' | 'compressed' | 'decode' {
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
export function imageExt(entry: { ext?: string, url?: string | null } | null | undefined): string {
    return entry?.ext || entry?.url?.match(/^data:image\/(\w+)/)?.[1] || 'webp';
}

/**
 * The file extension for an image, from a Blob MIME type.
 * @param {string|null|undefined} mime
 * @returns {string}
 */
export function imageExtFromType(mime: unknown): string {
    return (typeof mime === 'string' && mime.match(/^image\/(\w+)/)?.[1]) || 'webp';
}

// Browsers report container formats under names nobody wants on the end of a filename, and the
// two lists differ, so they are written out rather than guessed at.
const AUDIO_EXT: Record<string, string> = { mpeg: 'mp3', 'x-m4a': 'm4a' };
const VIDEO_EXT: Record<string, string> = { 'x-matroska': 'mkv', quicktime: 'mov' };

/**
 * The file extension for the audio track, from its dataURL.
 * @param {string|null|undefined} dataUrl
 * @returns {string}
 */
export function audioExt(dataUrl: unknown): string {
    const raw = (typeof dataUrl === 'string' && dataUrl.match(/^data:audio\/([\w.-]+)/)?.[1]) || 'mp3';
    return AUDIO_EXT[raw] || raw;
}

/**
 * The file extension for the video overlay, from its Blob MIME type.
 * @param {string|null|undefined} mime
 * @returns {string}
 */
export function videoExt(mime: unknown): string {
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
export async function collectBitmaps(cuts: Cut[] | null | undefined, {
    store, cache, assetSink = null, blobsOk = false, blobToDataURL, imageDataToDataURL,
}: { store: Map<string, StoreEntry>, cache: Map<string, { imageData: ImageData, url: string }>, assetSink?: AssetOut[] | null, blobsOk?: boolean, blobToDataURL: (b: Blob) => Promise<string>, imageDataToDataURL: (img: ImageData) => string }): Promise<CollectedBitmaps> {
    const usedIds = new Set<string>();
    for (const cut of (cuts || [])) {
        for (const layer of (cut?.layers || [])) {
            for (const stroke of (Array.isArray(layer?.strokes) ? layer.strokes : [])) {
                if (stroke.bitmapId) usedIds.add(stroke.bitmapId);
            }
        }
    }

    const bitmaps: Record<string, string | Blob> = {};
    /** Ids stored as a whole encoded image (video frames): they stay compressed on restore. */
    const compressed: string[] = [];
    /** The manifest an asset save writes, naming what was uploaded beside the JSON. */
    const assets: AssetRef[] = [];

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
                assetSink!.push({ id, blob: entry.blob ?? null, url: entry.url ?? null, ext });
            } else if (where === STORE_BLOB) {
                bitmaps[id] = entry.blob as Blob;
                compressed.push(id);
            } else {
                bitmaps[id] = entry.blob ? await blobToDataURL(entry.blob) : (entry.url as string);
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
export async function loadBitmapStore(data: { bitmaps?: Record<string, unknown> | null, compressedBitmaps?: string[] | null } | null | undefined, { dataURLToImageData, createBitmap, urlToBlob, extFromType, onEach }: { dataURLToImageData: (url: string) => Promise<ImageData>, createBitmap?: ((img: ImageData) => Promise<any>) | null, urlToBlob: (url: string) => Promise<Blob>, extFromType: (type: string) => string, onEach?: () => void }): Promise<{ store: Map<string, StoreEntry>, failed: number }> {
    const store = new Map<string, StoreEntry>();
    if (!data?.bitmaps) return { store, failed: 0 };
    const compressedSet = new Set(data.compressedBitmaps || []);
    const entries: Array<[string, StoreEntry] | null> = await Promise.all(Object.entries(data.bitmaps).map(async ([id, val]): Promise<[string, StoreEntry] | null> => {
        try {
            const how = frameLoad(val, compressedSet, id);
            if (how === 'blob') {
                return [id, { imageData: null, imageBitmap: null, blob: val as Blob, ext: extFromType((val as Blob).type) }];
            }
            if (how === 'compressed') {
                const blob = await urlToBlob(val as string);
                return [id, { imageData: null, imageBitmap: null, blob, ext: extFromType(blob.type) }];
            }
            const imageData = await dataURLToImageData(val as string);
            let imageBitmap: any = null;
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

/**
 * Put a document's pixels into a bitmap store: the externalised frame assets first, then the
 * embedded bitmaps. What `restore` in App used to do inline in two blocks.
 *
 * Assets are fetched one at a time and kept as Blobs, undecoded - one frame in flight, bounded
 * memory, and no decode until a frame is shown, which is what keeps a big project from OOMing
 * on open. The embedded bitmaps go through loadBitmapStore.
 *
 * @param {Map<string, any>} store the live store; cleared first
 * @param {any} data the document
 * @param {object} deps
 * @param {string | null} deps.assetBase where the server keeps this project's assets, or null
 * @param {(url: string) => Promise<Blob>} deps.fetchAsset
 * @param {() => void} [deps.tick] progress, once per asset or bitmap
 * @param {(url: string) => Promise<ImageData>} deps.dataURLToImageData
 * @param {(img: ImageData) => Promise<any>} [deps.createBitmap]
 * @returns {Promise<number>} how many could not be loaded
 */
export async function fillBitmapStore(store: Map<string, StoreEntry>, data: { assets?: AssetRef[] | null, bitmaps?: Record<string, unknown> | null, compressedBitmaps?: string[] | null }, { assetBase, fetchAsset, tick, dataURLToImageData, createBitmap }: { assetBase: string | null, fetchAsset: (url: string) => Promise<Blob>, tick?: () => void, dataURLToImageData: (url: string) => Promise<ImageData>, createBitmap?: ((img: ImageData) => Promise<any>) | null }): Promise<number> {
    store.clear();
    let missing = 0;
    if (assetBase && Array.isArray(data.assets)) {
        for (const a of data.assets) {
            try {
                const blob = await fetchAsset(`${assetBase}/asset/${a.id}`);
                store.set(a.id, { imageData: null, imageBitmap: null, blob, ext: a.ext, w: a.w || 0, h: a.h || 0 });
            } catch { missing++; }
            tick?.();
        }
    }
    const { store: loaded, failed } = await loadBitmapStore(data, {
        dataURLToImageData,
        createBitmap,
        urlToBlob: async (url) => (await fetch(url)).blob(),
        extFromType: imageExtFromType,
        onEach: tick,
    });
    for (const [id, entry] of loaded) store.set(id, entry);
    return missing + failed;
}

/** How many assets and bitmaps a document will load - for a progress bar before it starts. */
export function bitmapLoadCount(data: { assets?: unknown[] | null, bitmaps?: Record<string, unknown> | null }, assetBase: string | null): number {
    const assets = (assetBase && Array.isArray(data.assets)) ? data.assets.length : 0;
    const bitmaps = data.bitmaps ? Object.keys(data.bitmaps).length : 0;
    return assets + bitmaps;
}

/**
 * A Blob as a base64 dataURL.
 *
 * The conversion the "local .emv must stand alone" rule above rests on: bytes held as a Blob
 * have to become text before they can go into a JSON file. Also the way back for a Blob that has
 * to reach an <audio> or <video> element and then be saved again.
 *
 * `readAsDataURL` rather than a manual base64: it sets the media type from the Blob itself, and
 * the type is what tells the element what it is being given.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
    });
}

/**
 * How the audio or the video track is written into a project, in one of three shapes.
 *
 * Both tracks made the same three-way choice inline, one with a dataURL at hand and a Blob to
 * make, the other the reverse, and the two had drifted in wording. The choice:
 *
 *  - server save (`assetSink`): the bytes go out as a separate binary asset and the document
 *    keeps `{asset: true, ext}` - embedding tens of MB of base64 was the main OOM source;
 *  - browser store (`blobsOk`): the Blob is stored as it is, made on the spot if only a dataURL
 *    is at hand, and falls back to the dataURL if that fails - a large autosave beats one with
 *    no music in it;
 *  - a self-contained file: the dataURL, made from the Blob if that is what is at hand.
 *
 * @param {object} meta the track's timing and name, spread into the field
 * @param {object} args
 * @param {string} args.id the asset id, e.g. '__audio__'
 * @param {string} args.ext
 * @param {{push: (a: object) => void} | null} [args.assetSink]
 * @param {boolean} [args.blobsOk]
 * @param {Blob | null} [args.blob] the bytes as a Blob, if that is what is at hand
 * @param {string | null} [args.dataUrl] the bytes as a dataURL, if that is what is at hand
 * @param {() => Promise<Blob | null>} [args.toBlob] makes the Blob when only the dataURL is at hand
 * @param {(b: Blob) => Promise<string>} [args.toDataUrl] makes the dataURL when only the Blob is
 * @returns {Promise<object>} the field for the document
 */
export async function packMedia<M extends object>(meta: M, { id, ext, assetSink = null, blobsOk = false, blob = null, dataUrl = null, toBlob, toDataUrl }: { id: string, ext: string, assetSink?: AssetOut[] | null, blobsOk?: boolean, blob?: Blob | null, dataUrl?: string | null, toBlob?: () => Promise<Blob | null>, toDataUrl?: (b: Blob) => Promise<string> }): Promise<M & { asset?: boolean, ext?: string, blob?: Blob, dataUrl?: string | null }> {
    if (assetSink) {
        assetSink.push(blob ? { id, blob, ext } : { id, url: dataUrl, ext });
        return { ...meta, asset: true, ext };
    }
    if (blobsOk) {
        const b = blob || (toBlob ? await toBlob() : null);
        return b ? { ...meta, blob: b } : { ...meta, dataUrl };
    }
    return { ...meta, dataUrl: dataUrl || (toDataUrl && blob ? await toDataUrl(blob) : null) };
}

/**
 * How a media track comes back out of a project: the reverse of packMedia, in the same three
 * shapes. Returns whichever the file holds - a Blob, or a dataURL - and leaves converting to
 * the other to the caller, since the audio element wants a URL and the video track a Blob.
 * `missing` is 1 when the file said "asset" and the asset could not be fetched, so the caller
 * can count it among the things that failed to load.
 *
 * Audio and video each read the three shapes their own way, in a different order, before this.
 *
 * @param {{blob?: Blob, asset?: boolean, dataUrl?: string} | null | undefined} field
 * @param {string} id the asset id, e.g. '__audio__'
 * @param {{assetBase?: string | null, fetchAsset: (url: string) => Promise<Blob>}} args
 * @returns {Promise<{blob: Blob | null, dataUrl: string | null, missing: number}>}
 */
export async function unpackMedia(field: { blob?: unknown, asset?: boolean, dataUrl?: string | null } | null | undefined, id: string, { assetBase = null, fetchAsset }: { assetBase?: string | null, fetchAsset: (url: string) => Promise<Blob> }): Promise<{ blob: Blob | null, dataUrl: string | null, missing: number }> {
    if (!field) return { blob: null, dataUrl: null, missing: 0 };
    if (typeof Blob !== 'undefined' && field.blob instanceof Blob) return { blob: field.blob, dataUrl: null, missing: 0 };
    if (field.asset && assetBase) {
        try { return { blob: await fetchAsset(`${assetBase}/asset/${id}`), dataUrl: null, missing: 0 }; }
        catch { return { blob: null, dataUrl: null, missing: 1 }; }
    }
    if (field.dataUrl) return { blob: null, dataUrl: field.dataUrl, missing: 0 };
    return { blob: null, dataUrl: null, missing: 0 };
}
