// Reading a cut's layer tree: order, keys and change signatures for the canvas cache.

// Cache canvases are keyed per (cut, layer) because layer ids are NOT unique
// across cuts (each cut starts numbering at 1). Keying by layer id alone caused
// cross-cut collisions and an infinite cache-rebuild loop.
export const layerKey = (cutId, layerId) => `${cutId}:${layerId}`;

export function flattenForCanvas(layers) {
    return layers.filter(l => l.type !== 'folder' && l.visible !== false);
}

// Cheap change signature for a layer's strokes (strokes are append/replace only here),
// used to invalidate the layer canvas cache without stringifying the whole array.
export function strokeSig(strokes) {
    if (!strokes || !strokes.length) return '0';
    const last = strokes[strokes.length - 1];
    return strokes.length + '|' + (last.id ?? '') + '|' + (last.points ? last.points.length : 0) + '|' + (last.bitmapId ?? '') + '|' + (last.tool ?? '');
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
 * @param {{strokes?: any[], roughen?: number, rev?: number}} layer
 * @param {{roughPhase?: number, roughWave?: number, roughMinSize?: number} | null} [rough]
 *   the boiling options, when asking for a particular phase; omitted for the still frame
 * @returns {string}
 */
export function layerSig(layer, rough = null) {
    const base = strokeSig(layer?.strokes) + '|r' + (layer?.roughen || 0) + '|v' + (layer?.rev || 0);
    if (!rough || !layer?.roughen) return base;
    return base + `|b${rough.roughPhase}|w${rough.roughWave}|m${rough.roughMinSize}`;
}

export function flattenLayersInUiOrder(layers, parentId = null, out = []) {
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
