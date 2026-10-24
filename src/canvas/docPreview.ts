// A preview for a saved project that has none: its first page, drawn straight from the document.
//
// Projects saved before previews existed have no image to show. Opening each one into the editor
// to paint it would replace whatever is on screen, so this draws the first cut on its own: the
// visible layers, bottom to top, each on its own canvas so an eraser clears only its layer, and
// the pictures that cut uses (fill, lasso, paste, video frames) loaded from the server. Texts,
// effects and animation are left out - it is a card on a list, and the next save replaces it with
// the editor's own picture of the page open at the time.

import { makeCanvas } from './canvasFactory.ts';
import { drawStrokesOnCtx } from './strokes.ts';
import { renderThumbnail } from './thumbnail.ts';
import { dataURLToImageData } from './imageCodec.ts';
import { migrateCuts, projectSettings } from '../core/projectFormat.ts';
import { collectUsedBitmapIds } from '../core/bitmapRefs.ts';
import { flattenLayersInUiOrder } from '../core/layerTree.ts';
import { fillBitmapStore, type AssetRef } from '../core/projectAssets.ts';

/** The first page: the cut that starts earliest, the lowest track winning a tie. */
export function firstCut<C extends { startTime?: number, track?: number }>(cuts: readonly C[]): C | null {
    let best: C | null = null;
    for (const c of cuts) {
        if (!best || (c.startTime ?? 0) < (best.startTime ?? 0)
            || ((c.startTime ?? 0) === (best.startTime ?? 0) && (c.track ?? 0) < (best.track ?? 0))) best = c;
    }
    return best;
}

/**
 * Only the pictures `ids` names, out of a document's assets and embedded bitmaps - a video project
 * keeps hundreds of frames, and the first page needs one or two of them.
 */
export function picturesFor(data: { assets?: AssetRef[] | null, bitmaps?: Record<string, unknown> | null, compressedBitmaps?: string[] | null }, ids: Set<unknown>) {
    const has = (id: unknown) => ids.has(id) || ids.has(String(id)) || ids.has(Number(id));
    return {
        assets: (data.assets || []).filter(a => has(a.id)),
        bitmaps: Object.fromEntries(Object.entries(data.bitmaps || {}).filter(([id]) => has(id))),
        compressedBitmaps: (data.compressedBitmaps || []).filter(id => has(id)),
    };
}

/**
 * The first page of a saved document as a small WebP, or null when it has no cuts.
 *
 * @param data the document as the server returns it
 * @param assetBase where its assets are, e.g. `/api/projects/p_abc`
 * @param fetchAsset one asset as a Blob, or throw
 */
export async function renderDocPreview(data: any, assetBase: string, fetchAsset: (url: string) => Promise<Blob>): Promise<Blob | null> {
    const cut = firstCut(migrateCuts(data?.cuts));
    if (!cut) return null;
    const s = projectSettings(data);
    const cw = s.canvas?.w ?? 1920, ch = s.canvas?.h ?? 1080;
    const fw = s.frame?.w ?? cw, fh = s.frame?.h ?? ch;

    const store = new Map();
    await fillBitmapStore(store, picturesFor(data, collectUsedBitmapIds({ cuts: [cut] })), {
        assetBase, fetchAsset, dataURLToImageData, createBitmap: (img) => createImageBitmap(img),
    });
    // Assets arrive as undecoded Blobs (the editor decodes them when a frame is shown); the
    // renderer wants pixels.
    for (const entry of store.values()) {
        if (entry.blob && !entry.imageBitmap) {
            try { entry.imageBitmap = await createImageBitmap(entry.blob); } catch { /* drawn without it */ }
        }
    }

    const layers = flattenLayersInUiOrder(cut.layers || []).filter(l => l.type !== 'folder' && l.visible !== false);
    return renderThumbnail(ctx => {
        if (!data.transparentBg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fw, fh); }
        // A canvas bigger than the frame is centred on it, as the editor places it at rest.
        const ox = (fw - cw) / 2, oy = (fh - ch) / 2;
        const lc = makeCanvas(cw, ch), lctx = lc.getContext('2d')!;
        for (let i = layers.length - 1; i >= 0; i--) {
            lctx.clearRect(0, 0, cw, ch);
            drawStrokesOnCtx(lctx, (layers[i].strokes || []) as any[], true, store);
            ctx.globalAlpha = (layers[i] as any).opacity ?? 1;
            ctx.drawImage(lc, ox, oy);
            ctx.globalAlpha = 1;
        }
    }, fw, fh);
}
