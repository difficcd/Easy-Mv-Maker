// Reading a cut's layer tree: order, keys and change signatures for the canvas cache.

// Cache canvases are keyed per (cut, layer) because layer ids are NOT unique
// across cuts (each cut starts numbering at 1). Keying by layer id alone caused
// cross-cut collisions and an infinite cache-rebuild loop.
import type { Id, LayerLike, StrokeLike } from './types.ts';

export const layerKey = (cutId: Id, layerId: Id): string => `${cutId}:${layerId}`;

export function flattenForCanvas<L extends LayerLike>(layers: L[]): L[] {
    return layers.filter(l => l.type !== 'folder' && l.visible !== false);
}

// Cheap change signature for a layer's strokes (strokes are append/replace only here),
// used to invalidate the layer canvas cache without stringifying the whole array.
export function strokeSig(strokes: ReadonlyArray<StrokeLike> | null | undefined, count?: number): string {
    const n = Math.max(0, Math.min(count ?? strokes?.length ?? 0, strokes?.length ?? 0));
    if (!strokes || !n) return '0';
    const last = strokes[n - 1];
    return n + '|' + (last.id ?? '') + '|' + (last.points ? last.points.length : 0) + '|' + (last.bitmapId ?? '') + '|' + (last.tool ?? '');
}

/**
 * The cache key for one layer's baked canvas.
 *
 * Two caches use this and they are compared against each other: the still-frame cache writes the
 * key without a phase, and the boiling path checks its own key against what the still frame
 * stored. For a layer that is not boiling the two must come out byte-identical or every such
 * layer misses the cache and is redrawn every frame - a performance cliff with no visible
 * symptom, which is exactly the kind of agreement that should not depend on two expressions
 * being edited together.
 *
 * `rev` is in it because edits that move coordinates without changing the stroke count or the
 * last stroke - a whole-layer move, say - are invisible to strokeSig.
 *
 * `count` asks what the signature *would have been* when the layer held only its first `count`
 * strokes. That is what lets `appendedAfter` recognise a layer that has only grown.
 *
 * @param {{strokes?: any[], roughen?: number, rev?: number}} layer
 * @param {{roughPhase?: number, roughWave?: number, roughMinSize?: number} | null} [rough]
 *   the boiling options, when asking for a particular phase; omitted for the still frame
 * @returns {string}
 */
export function layerSig(layer: LayerLike | null | undefined, rough: { roughPhase: number, roughWave: number, roughMinSize: number } | null = null, count?: number): string {
    const base = strokeSig(layer?.strokes, count) + '|r' + (layer?.roughen || 0) + '|v' + (layer?.rev || 0);
    if (!rough || !layer?.roughen) return base;
    return base + `|b${rough.roughPhase}|w${rough.roughWave}|m${rough.roughMinSize}`;
}

export function flattenLayersInUiOrder<L extends LayerLike>(layers: L[], parentId: Id | null = null, out: L[] = []): L[] {
    const pid = parentId ?? null;
    const list = layers.filter(l => (l.parentId ?? null) === pid);
    for (const layer of list) {
        if (layer.type === 'folder') {
            if (layer.visible === false) continue; // a hidden folder hides everything under it, nesting included
            flattenLayersInUiOrder(layers, layer.id, out);
        } else {
            out.push(layer);
        }
    }
    return out;
}

/**
 * How many of a layer's strokes a canvas baked under `stored` already holds - when the layer's
 * strokes are that same list with more added on the end. `null` when they are not, and the
 * canvas has to be redrawn from scratch.
 *
 * Committing a stroke redrew every stroke the layer held, so the Nth stroke of a drawing cost N
 * times the first and a session's baking grew with the square of the strokes drawn. Measured on
 * a 1920x1080 layer, drawing 40 brush strokes one at a time cost ~38s of baking where drawing
 * only each new stroke costs ~1.9s.
 *
 * This leans on exactly the invariant the cache already needs, and no more: an edit that changes
 * strokes without changing the count or the last stroke's identity must bump `rev` - see
 * `offsetLayers`, which exists to do that. A prefix that changed under a cache that did not
 * notice is already a stale cache today; this does not widen the assumption, it reuses it.
 *
 * @param {string|null|undefined} stored the signature the canvas was baked under
 * @param {LayerLike|null|undefined} layer
 * @param {{roughPhase: number, roughWave: number, roughMinSize: number}|null} [rough]
 * @returns {number|null} the index to start drawing from
 */
export function appendedAfter(
    stored: string | null | undefined,
    layer: LayerLike | null | undefined,
    rough: { roughPhase: number, roughWave: number, roughMinSize: number } | null = null,
): number | null {
    if (!stored) return null;
    const have = layer?.strokes?.length ?? 0;
    const was = Number(String(stored).split('|')[0]);
    // Equal counts are the caller's cache hit, not an append; a shorter list is a removal.
    if (!Number.isInteger(was) || was <= 0 || was >= have) return null;
    return layerSig(layer, rough, was) === stored ? was : null;
}
