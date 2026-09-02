// Which cuts a frame is made of.
//
// The first piece of the scene engine, and the piece everything else waits on: before anything
// can be animated or drawn, something has to say which cuts exist at time t and which neighbours
// the onion skin should show.
//
// It was written out twice each. Not a lot of code, but the sort where the two copies disagree
// quietly - one uses `<=` where the other uses `<` and a frame at a cut boundary shows two cuts
// in one place and one in the other, which reads as a flicker rather than as a bug.
//
// Pure and DOM-free on purpose. The goal it serves is that playback, scrubbing, export, thumbnail
// generation and onion skin all describe a frame the same way:
//
//     const scene = evaluate(project, t)
//     render(ctx, scene)
//
// Today only the selection half of that exists. Animation and compositing follow.

/**
 * The cuts playing at a moment, bottom track first.
 *
 * Half-open on purpose: a cut covers its start and not its end, so two cuts that touch never both
 * claim the instant between them.
 *
 * Ordered by track because that is the order they are drawn in, and returning them any other way
 * would mean every caller sorting again.
 *
 * @param {Cut[]} cuts
 * @param {number} t
 * @returns {Cut[]}
 */
export function cutsAt(cuts, t) {
    return (Array.isArray(cuts) ? cuts : [])
        .filter(c => t >= c.startTime && t < c.endTime)
        .sort((a, b) => a.track - b.track);
}

/**
 * The cuts to draw, which is not quite the same question.
 *
 * While playing it is exactly what is at t. While paused it also includes the cut being edited,
 * even when the playhead is not over it - otherwise clicking a cut in the timeline and finding a
 * blank canvas is the normal experience of the app.
 *
 * @param {Cut[]} cuts
 * @param {number} t
 * @param {any} currentCutId
 * @param {boolean} playing
 * @returns {Cut[]}
 */
export function visibleCutsAt(cuts, t, currentCutId, playing) {
    const active = cutsAt(cuts, t);
    if (playing) return active;
    if (active.some(c => c.id === currentCutId)) return active;
    const current = (Array.isArray(cuts) ? cuts : []).find(c => c.id === currentCutId);
    return current ? [...active, current].sort((a, b) => a.track - b.track) : active;
}

/**
 * The cuts either side of this one on its own track, for onion skinning.
 *
 * Same track only: onion skin is for seeing the drawing before and after in a sequence, and a cut
 * on another track is a different element of the same shot, not the previous frame of this one.
 *
 * `next` starts at `endTime` rather than after it, because cuts usually abut - a strict
 * comparison would find nothing in the common case.
 *
 * @param {Cut[]} cuts
 * @param {Cut | null | undefined} cut
 * @returns {{prev: Cut | null, next: Cut | null}}
 */
export function onionNeighbours(cuts, cut) {
    if (!cut) return { prev: null, next: null };
    const sameTrack = (Array.isArray(cuts) ? cuts : []).filter(c => c.track === cut.track);
    const prev = sameTrack
        .filter(c => c.startTime < cut.startTime)
        .sort((a, b) => b.startTime - a.startTime)[0] || null;
    const next = sameTrack
        .filter(c => c.startTime >= cut.endTime)
        .sort((a, b) => a.startTime - b.startTime)[0] || null;
    return { prev, next };
}

/**
 * Which cut the playhead should select: the topmost of those it is over.
 *
 * Topmost rather than bottom, because the upper tracks are what a click would land on.
 *
 * @param {Cut[]} cuts
 * @param {number} t
 * @returns {Cut | null}
 */
export function topCutAt(cuts, t) {
    const active = cutsAt(cuts, t);
    if (!active.length) return null;
    return active.reduce((p, c) => (p.track > c.track ? p : c));
}
