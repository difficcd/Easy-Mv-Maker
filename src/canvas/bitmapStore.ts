// The pixels strokes point at.
//
// A fill, a lasso paste or a video frame is stored here under an id, and the stroke carries only
// the id - the document stays small and a bitmap used by several strokes is one bitmap. Three
// kinds of entry live side by side:
//
//   drawn pixels     {imageData, imageBitmap}   the user can still edit these, so the ImageData
//                                               is kept; the bitmap is a faster copy for display
//   video frames     {blob, ext, w, h, ...}     kept compressed and off the JS heap; decoded to a
//                                               bitmap on first display and released under a cap
//   legacy           {imageData} only           from files before bitmaps existed
//
// Decoding every frame at import is what took a big video out of memory, and keeping every
// decoded frame is what took it out again during playback - so decoding is lazy and the count
// of decoded frames is capped by an LRU (core/decodeBudget decides which to let go).

import { framesToRelease, DECODED_CAP } from '../core/decodeBudget.ts';
import { randomId } from '../core/ids.ts';
import type { StoreEntry } from '../core/projectAssets.ts';

/** The live bitmap store: what createBitmapStore hands back. */
export type BitmapStore = ReturnType<typeof createBitmapStore>;


/**
 * @param {object} deps
 * @param {() => [number, number]} deps.canvasSize the current canvas size - frames are decoded
 *   no larger than it, so a 4K frame costs what a 1080p one does
 * @param {(src: any, opts?: any) => Promise<ImageBitmap>} [deps.makeBitmap] createImageBitmap
 * @param {(data: Uint8ClampedArray, w: number, h: number) => any} [deps.makeImageData]
 * @param {() => string} [deps.newId]
 */
export function createBitmapStore({
    canvasSize,
    makeBitmap = (src, opts) => createImageBitmap(src, opts),
    makeImageData = (data, w, h) => new ImageData(data as any, w, h),
    newId = () => randomId(),
}: {
    canvasSize: () => [number, number],
    makeBitmap?: (src: any, opts?: any) => Promise<ImageBitmap>,
    makeImageData?: (data: Uint8ClampedArray, w: number, h: number) => any,
    newId?: () => string,
}) {
    /** id -> entry */
    const map = new Map<string, StoreEntry>();
    const decoding = new Set<string>();   // frame ids being decoded right now
    const hot = new Set<string>();        // frame ids in the current prefetch window
    const order = new Map<string, number>(); // id -> use counter, for the LRU
    let seq = 0;

    /** Store drawn pixels. The display bitmap follows when it is ready; drawing does not wait. */
    const store = (imageData: ImageData): string => {
        const id = newId();
        map.set(id, { imageData, imageBitmap: null });
        makeBitmap(imageData).then(bmp => { const e = map.get(id); if (e) e.imageBitmap = bmp; }).catch(() => { });
        return id;
    };

    /** Store a compressed frame as it is. Not decoded here - see the file comment. */
    const storeBlob = (blob: Blob, w = 0, h = 0): string => {
        const id = newId();
        const ext = (blob.type.match(/image\/(\w+)/)?.[1] || 'webp');
        map.set(id, { imageData: null, imageBitmap: null, blob, ext, w, h });
        return id;
    };

    /**
     * Decode a frame's Blob to a display bitmap, downscaled to at most the canvas. The Blob
     * keeps its full resolution for saving and export.
     */
    const decodeFrame = (e: StoreEntry): Promise<ImageBitmap> => {
        const [cw, ch] = canvasSize();
        if (e.w && e.h && (e.w > cw || e.h > ch)) {
            const s = Math.min(cw / e.w, ch / e.h);
            return makeBitmap(e.blob, { resizeWidth: Math.max(1, Math.round(e.w * s)), resizeHeight: Math.max(1, Math.round(e.h * s)), resizeQuality: 'high' });
        }
        return makeBitmap(e.blob);
    };

    /** The prefetch window moved: these frames are the ones the LRU must not release. */
    const setHot = (ids: Iterable<string>): void => { hot.clear(); for (const id of ids) hot.add(id); };

    /** A frame was just used: it is the most recently used for the LRU. */
    const touch = (id: string): void => { order.set(id, ++seq); };

    /** Let go of decoded frames beyond the cap, oldest first, never the protected or hot ones. */
    const trim = (protect?: Set<string> | null): void => {
        const decoded: string[] = [];
        for (const [id, e] of map) if (e.blob && e.imageBitmap) decoded.push(id);
        for (const id of framesToRelease({ decoded, order, cap: DECODED_CAP, protect, hot })) {
            const e = map.get(id)!;
            try { e.imageBitmap.close?.(); } catch { }
            e.imageBitmap = null;
            order.delete(id);
        }
    };

    /**
     * A copy of a stored bitmap under a fresh id, so a pasted or duplicated cut owns its own
     * pixels rather than aliasing the source's. `cache` dedups within one operation, so a bitmap
     * several strokes share stays one bitmap in the copy too. Ids that are not drawn pixels -
     * frames, legacy inline data - are returned as they are.
     */
    const clone = (oldId: string | null | undefined, cache: Map<string, string>): string | null | undefined => {
        if (!oldId) return oldId;
        if (cache.has(oldId)) return cache.get(oldId)!;
        const entry = map.get(oldId);
        let id = oldId;
        if (entry?.imageData) {
            const src = entry.imageData;
            id = store(makeImageData(new Uint8ClampedArray(src.data), src.width, src.height));
        }
        cache.set(oldId, id);
        return id;
    };

    return { map, decoding, hot, setHot, store, storeBlob, decodeFrame, touch, trim, clone };
}
