// Timeline cut geometry: where a cut lands when you drag or resize it, including snapping to
// neighbouring edges and refusing to overlap.
//
// This was inline inside the pointer-move handler, mixed in with setCuts and setSnapLinePos.
// The arithmetic is the part that goes wrong - off-by-a-pixel snap thresholds, a cut allowed to
// sit on top of another, a resize that inverts when dragged past its own far edge - and none of
// it could be tested where it was. These functions take cuts and return cuts.
//
// Each returns { cuts, snapAt } where snapAt is the timeline position to draw the snap guide at,
// or null for no guide. The caller turns that into pixels; nothing here knows about the DOM.

const SNAP_PX = 8;

/** Edges a cut can snap to on a given track: zero, plus every other cut's start and end. */
function snapEdges(cuts, exceptId, track) {
    const others = cuts.filter(o => o.id !== exceptId && o.track === track);
    return { others, edges: [0, ...others.flatMap(o => [o.startTime, o.endTime])] };
}

/**
 * Nearest edge within the snap radius.
 *
 * `hit` matters: the original code compared the snapped value against the raw one to decide
 * whether a snap had happened, but when nothing is in range those are equal, the distance is
 * zero, and zero passes the threshold - so the guide line was drawn on every drag regardless.
 * Reporting the hit explicitly is what fixes that.
 */
const snapTo = (v, edges, pps) => {
    for (const e of edges) {
        const d = Math.abs((v - e) * pps);
        if (d <= SNAP_PX) return { v: e, hit: true, dist: d };
    }
    return { v, hit: false, dist: Infinity };
};

/**
 * Drag a whole cut to a new start time and track.
 * `dt` is the time delta from where the drag began; `trackOff` the track delta.
 */
export function dragCut(cuts, { cutId, initialStart, initialTrack }, dt, trackOff, numTracks, pps) {
    const tc = cuts.find(c => c.id === cutId);
    if (!tc) return { cuts, snapAt: null };

    const dur = tc.endTime - tc.startTime;
    const track = Math.max(0, Math.min(numTracks - 1, initialTrack + trackOff));
    let start = Math.max(0, initialStart + dt);
    const { others, edges } = snapEdges(cuts, cutId, track);

    // Both ends can snap; whichever is closer wins, so a cut can be aligned by either edge.
    const head = snapTo(start, edges, pps);
    const tail = snapTo(start + dur, edges, pps);
    let snapAt = null;
    if (head.hit && head.dist <= tail.dist) { start = head.v; snapAt = start; }
    else if (tail.hit) { start = tail.v - dur; snapAt = start + dur; }

    // Overlap is not allowed: push to whichever side of the blocker is nearer. A push overrides
    // any snap guide, because the cut no longer sits where the guide claimed.
    for (const o of others) {
        if (start < o.endTime && start + dur > o.startTime) {
            const left = o.startTime - dur, right = o.endTime;
            start = Math.abs(start - left) < Math.abs(start - right) ? left : right;
            snapAt = null;
        }
    }
    start = Math.max(0, start);

    return {
        cuts: cuts.map(c => c.id === cutId ? { ...c, startTime: start, endTime: start + dur, track } : c),
        snapAt,
    };
}

/**
 * Drag one edge of a cut. `edge` is 'left' or 'right'.
 * `initialStart`/`initialEnd` are the cut's bounds when the resize began.
 */
export function resizeCut(cuts, { cutId, edge, initialStart, initialEnd }, dt, pps) {
    const tc = cuts.find(c => c.id === cutId);
    if (!tc) return { cuts, snapAt: null };

    const { others, edges } = snapEdges(cuts, cutId, tc.track);
    const MIN = 0.05;   // a cut may not be collapsed to nothing

    if (edge === 'left') {
        let start = snapTo(Math.max(0, initialStart + dt), edges, pps).v;
        // Do not swallow a neighbour that ends before this cut began.
        for (const o of others) if (start < o.endTime && initialStart >= o.endTime) start = o.endTime;
        start = Math.min(start, initialEnd - MIN);
        return { cuts: cuts.map(c => c.id === cutId ? { ...c, startTime: start } : c), snapAt: start };
    }

    let end = snapTo(Math.max(initialStart + MIN, initialEnd + dt), edges, pps).v;
    for (const o of others) if (end > o.startTime && initialEnd <= o.startTime) end = o.startTime;
    return { cuts: cuts.map(c => c.id === cutId ? { ...c, endTime: end } : c), snapAt: end };
}
