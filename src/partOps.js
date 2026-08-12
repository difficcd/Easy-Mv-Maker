// Parts (scenes): cuts grouped by partId.
//
// Each video import arrives as one part, and cuts can also be grouped by hand. Selecting a part
// scopes playback to it, so a part's start and end are not stored anywhere - they are whatever
// its cuts currently span, recomputed on every render. That is deliberate: a stored range would
// drift the moment a cut inside it was dragged, and the drift would only show up as playback
// stopping in the wrong place.
//
// Membership is likewise a field on the cut rather than a list on the part, so deleting a cut
// cannot leave a part holding a reference to something that no longer exists.

/**
 * Group cuts into parts, in timeline order.
 *
 * @param {Array} cuts
 * @param {string} [fallbackName] shown for a part whose cuts carry no name
 * @returns {Array<{id: any, name: string, count: number, start: number, end: number}>}
 */
export function derivePartsFrom(cuts, fallbackName = 'Part') {
    const m = new Map();
    for (const c of (Array.isArray(cuts) ? cuts : [])) {
        if (!c?.partId) continue;
        const p = m.get(c.partId) || { id: c.partId, name: '', count: 0, start: Infinity, end: 0 };
        // The first cut that carries a name gives the part its name. Taking it from whichever cut
        // came first in the array instead meant a part read as unnamed while some of its cuts
        // knew perfectly well what it was called - possible after a partial edit, since assigning
        // a part normally writes the name onto every cut at once.
        if (!p.name && c.partName) p.name = c.partName;
        p.count++;
        p.start = Math.min(p.start, c.startTime);
        p.end = Math.max(p.end, c.endTime);
        m.set(c.partId, p);
    }
    return [...m.values()]
        .map(p => ({ ...p, name: p.name || fallbackName }))
        .sort((a, b) => a.start - b.start);
}

/**
 * The same grouping for imported frame sets, which predate parts and are keyed separately.
 * Kept apart from derivePartsFrom because an old project can have batches and no parts.
 */
export function deriveVideoBatches(cuts, fallbackName = 'Video') {
    const m = new Map();
    for (const c of (Array.isArray(cuts) ? cuts : [])) {
        if (!c?.videoBatch) continue;
        const b = m.get(c.videoBatch) || { id: c.videoBatch, label: c.videoLabel || fallbackName, count: 0, start: c.startTime, end: c.endTime };
        b.count++;
        b.start = Math.min(b.start, c.startTime);
        b.end = Math.max(b.end, c.endTime);
        m.set(c.videoBatch, b);
    }
    return [...m.values()];
}

/** Put the given cuts in a part, taking them out of whichever one they were in. */
export function assignPart(cuts, cutIds, partId, name) {
    const ids = cutIds instanceof Set ? cutIds : new Set(cutIds || []);
    return (Array.isArray(cuts) ? cuts : []).map(c => ids.has(c.id) ? { ...c, partId, partName: name } : c);
}

/** Rename a part, which means renaming it on every cut that belongs to it. */
export function renamePartIn(cuts, partId, name) {
    return (Array.isArray(cuts) ? cuts : []).map(c => c.partId === partId ? { ...c, partName: name } : c);
}

/**
 * Ungroup a part. The cuts stay exactly where they are and only lose their membership - this is
 * not a delete, and confusing the two would be expensive.
 */
export function ungroupPartIn(cuts, partId) {
    return (Array.isArray(cuts) ? cuts : []).map(c => c.partId === partId ? { ...c, partId: undefined, partName: undefined } : c);
}

/** Remove every cut of an imported frame set. This one really does delete. */
export function removeVideoBatch(cuts, batchId) {
    return (Array.isArray(cuts) ? cuts : []).filter(c => c.videoBatch !== batchId);
}
