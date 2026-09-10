// How many decoded frames to hold, which to let go of, and which cached layers a decode invalidates.
//
// Both answers here are small and both fail quietly when they are wrong. Releasing a frame that
// is about to be shown makes playback flicker, and it flickers in a way that looks like a decode
// problem rather than an eviction problem. Invalidating too much makes the whole cache rebuild
// mid-playback; invalidating too little leaves a layer showing pixels that have been replaced.
//
// Neither needs a canvas or a bitmap to decide, which is why they are here and not in App.

/**
 * How many decoded frames may be held at once.
 *
 * **This must stay above the prefetch window (~50).** If it does not, the trim below evicts
 * frames the prefetcher has just decoded, the prefetcher decodes them again, and the two spend
 * playback fighting each other - which shows up as stutter, not as a memory problem. The hot set
 * is a second guard on the same hazard.
 */
export const DECODED_CAP = 120;

/**
 * Which decoded frames to release, oldest use first.
 *
 * Two sets are never released whatever their age: `hot` is the prefetch window - the frames about
 * to be shown - and `protect` is whatever the caller knows it is using this instant. An id in
 * either is skipped rather than counted against the quota, so a run of protected frames does not
 * silently stop the trim early.
 *
 * @param {object} args
 * @param {Iterable<string>} args.decoded every id currently holding a decoded bitmap
 * @param {Map<string, number>} args.order id -> use counter, higher is more recent
 * @param {number} [args.cap]
 * @param {Set<string>} [args.protect]
 * @param {Set<string>} [args.hot]
 * @returns {string[]} ids to release, in the order they should go
 */
export function framesToRelease({ decoded, order, cap = DECODED_CAP, protect, hot }) {
    const ids = [...decoded];
    if (ids.length <= cap) return [];
    // Oldest first. An id with no recorded use sorts as 0, which is right: it was never touched
    // through the accounting path, so nothing says it is wanted.
    ids.sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
    const out = [];
    let want = ids.length - cap;
    for (const id of ids) {
        if (want <= 0) break;
        if (protect?.has(id) || hot?.has(id)) continue;
        out.push(id);
        want--;
    }
    return out;
}

/**
 * The layer-canvas keys that hold pixels from any of the given frames.
 *
 * Only these are dropped, rather than the whole cache: clearing everything made on-screen frames
 * flicker while playing, because a decode finishing mid-playback rebuilt every visible layer.
 *
 * @param {Array<{id: any, layers?: any[]}>} cuts
 * @param {Iterable<string>} ids the frames that just changed
 * @param {(cutId: any, layerId: any) => string} key
 * @returns {Set<string>}
 */
export function layerKeysUsingBitmaps(cuts, ids, key) {
    const want = new Set(ids);
    const out = new Set();
    if (!want.size) return out;
    for (const c of cuts || []) {
        for (const l of c?.layers || []) {
            const strokes = l?.strokes || [];
            if (strokes.some(s => s?.tool === 'paste' && want.has(s.bitmapId))) out.add(key(c.id, l.id));
        }
    }
    return out;
}

/**
 * Every cache key that belongs to one of `bases`, including a boiling layer's phase variants.
 *
 * A boiling layer holds one canvas per phase, keyed `cut:layer#phase`. Dropping the plain key
 * alone leaves the phases behind, still holding the bitmap that was just replaced - a layer that
 * updates when still and shows stale pixels the moment it starts boiling.
 *
 * @param {Iterable<string>} keys every key currently in the cache
 * @param {Set<string>} bases the keys to drop, without phase suffixes
 * @returns {string[]}
 */
export function keysWithPhases(keys, bases) {
    const out = [];
    for (const k of keys) {
        const hash = k.indexOf('#');
        if (bases.has(hash === -1 ? k : k.slice(0, hash))) out.push(k);
    }
    return out;
}
