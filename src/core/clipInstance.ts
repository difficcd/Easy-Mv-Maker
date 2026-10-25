// Animation clips: a part's frames used again as one object, as many times as wanted.
//
// A copy of a clip is a cut of its own - it sits on a track, has a start and an end, can be
// dragged, copied, pasted, undone and saved like any cut, and carries the cut animation (fade,
// slide, move...) - but it holds no drawing. It names a part, and whatever that part shows at a
// moment, the copy shows too, placed and animated as the copy says. Redraw a frame of the part and
// every copy changes with it: the frames exist once, and a copy costs a few numbers. The layer
// cache is shared the same way, because what gets drawn is the part's own cut.
//
// A copy that needs a drawing of its own is unpacked: turned into ordinary cuts.
//
// Pure: no canvas, no React. engine/evaluateFrame and engine/selectCuts resolve copies with it.

import type { Id } from './types.ts';
import type { CutAnimAt } from './cutAnim.ts';

/** What makes a cut a copy of a clip: the part it shows, and how it is placed. */
export interface ClipRef {
    /** the part whose frames are shown */
    partId: PartId;
    /** offset from where the part's drawing sits, in canvas pixels */
    dx: number;
    dy: number;
    /** size relative to the original, about the canvas centre */
    scale: number;
    /** play the part over and over while the copy lasts, or once and then show nothing */
    loop: boolean;
}

/** Whether a cut is a copy of a clip rather than a drawing of its own. */
export const isClipCopy = (c: { clip?: ClipRef | null } | null | undefined): boolean => !!c?.clip;

/** The cuts that make up a clip - its part's own cuts, never other copies - and the span they cover. */
export function clipSource(cuts: readonly Cut[], partId: PartId): { cuts: Cut[], start: number, end: number } {
    const own = cuts.filter(c => c.partId === partId && !c.clip);
    if (!own.length) return { cuts: [], start: 0, end: 0 };
    return { cuts: own, start: Math.min(...own.map(c => c.startTime)), end: Math.max(...own.map(c => c.endTime)) };
}

/**
 * What a copy shows at time `t`: the part's cuts on screen at the matching moment of the part,
 * lowest track first, and that moment. Nothing when the part is gone or empty, or when a copy
 * that does not loop has run past the part's length.
 */
export function clipFrameAt(cuts: readonly Cut[], copy: Cut, t: number): { cuts: Cut[], t: number } {
    const ref = copy.clip;
    if (!ref) return { cuts: [], t };
    const src = clipSource(cuts, ref.partId);
    const len = src.end - src.start;
    if (!src.cuts.length || len <= 0) return { cuts: [], t };
    let local = t - copy.startTime;
    if (local < 0) return { cuts: [], t };
    if (ref.loop) local %= len;
    else if (local >= len) return { cuts: [], t };
    const at = src.start + local;
    return { cuts: src.cuts.filter(c => at >= c.startTime && at < c.endTime).sort((a, b) => a.track - b.track), t: at };
}

/** A copy's placement as a cut transform - offset and size, at all times - or null when it has none. */
export function clipPlacement(ref: ClipRef | null | undefined): CutAnimAt | null {
    if (!ref) return null;
    const s = ref.scale > 0 ? ref.scale : 1;
    if (!ref.dx && !ref.dy && s === 1) return null;
    return { alpha: 1, sx: s, sy: s, tx: ref.dx || 0, ty: ref.dy || 0 };
}

/**
 * Two cut transforms as one: the copy's placement, then its animation on top. Both act about the
 * canvas centre, so the scales multiply and the offsets add - the animation's offset scaled by the
 * placement, the way a nested transform moves.
 */
export function combineCutAnim(place: CutAnimAt | null, anim: CutAnimAt | null): CutAnimAt | null {
    if (!place) return anim;
    if (!anim) return place;
    return {
        alpha: place.alpha * anim.alpha,
        sx: place.sx * anim.sx, sy: place.sy * anim.sy,
        tx: place.tx + anim.tx * place.sx, ty: place.ty + anim.ty * place.sy,
    };
}

/** The lowest track at or above `from` with nothing on it between `start` and `end`. */
export function freeTrack(cuts: readonly Cut[], start: number, end: number, from = 0): number {
    for (let tr = Math.max(0, from); ; tr++) {
        if (!cuts.some(c => c.track === tr && c.startTime < end && c.endTime > start)) return tr;
    }
}

/**
 * A new copy of a part's clip: as long as the part, starting where it starts, on the first free
 * track above it, nudged so it does not sit exactly on the original. Null when the part has no
 * frames.
 */
export function makeClipCopy(cuts: readonly Cut[], partId: PartId, name: string, id: Id, nudge = 40): Cut | null {
    const src = clipSource(cuts, partId);
    if (!src.cuts.length || src.end <= src.start) return null;
    const above = Math.max(...src.cuts.map(c => c.track)) + 1;
    return {
        id: id as DocId, name, startTime: src.start, endTime: src.end,
        track: freeTrack(cuts, src.start, src.end, above),
        layers: [], texts: [], partId: null,
        clip: { partId, dx: nudge, dy: nudge, scale: 1, loop: true },
    } as Cut;
}

/** Another copy beside an existing one: the same clip and timing on the next free track, nudged again. */
export function duplicateClipCopy(cuts: readonly Cut[], copy: Cut, id: Id, nudge = 40): Cut | null {
    if (!copy.clip) return null;
    return {
        ...copy, id: id as DocId,
        track: freeTrack(cuts, copy.startTime, copy.endTime, copy.track + 1),
        clip: { ...copy.clip, dx: copy.clip.dx + nudge, dy: copy.clip.dy + nudge },
    };
}

/**
 * Unpack a copy into ordinary cuts on its track: the part's frames laid out over the copy's span,
 * repeated while it loops, the last one cut short at the copy's end. `cloneContents` gives each a
 * drawing of its own (cutClone), so editing them leaves the clip alone.
 *
 * What does not come along: the copy's offset, size and animation. Those belonged to the object;
 * the cuts it becomes are drawn where the part draws them, the way any cut is, so the pen still
 * lands where the ink appears.
 */
export function unpackClipCopy(cuts: readonly Cut[], copy: Cut, cloneContents: (c: Cut) => Partial<Cut>, nextId: () => Id): Cut[] {
    const ref = copy.clip;
    if (!ref) return [];
    const src = clipSource(cuts, ref.partId);
    const len = src.end - src.start;
    if (!src.cuts.length || len <= 0) return [];
    const out: Cut[] = [];
    const order = [...src.cuts].sort((a, b) => a.startTime - b.startTime || a.track - b.track);
    for (let k = 0; ; k++) {
        const base = copy.startTime + k * len;
        if (base >= copy.endTime || (k > 0 && !ref.loop)) break;
        for (const c of order) {
            const start = base + (c.startTime - src.start);
            if (start >= copy.endTime) continue;
            const end = Math.min(copy.endTime, base + (c.endTime - src.start));
            out.push({
                ...c, ...cloneContents(c),
                id: nextId() as DocId, startTime: start, endTime: end,
                track: copy.track + (c.track - Math.min(...src.cuts.map(s => s.track))),
                partId: null, clip: null,
            });
        }
    }
    return out;
}
