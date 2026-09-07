// Reading a saved project back.
//
// Files written by older versions are still expected to open, so loading is not just parsing: it
// fills in fields that did not exist yet and renames ones that did. That is the part worth
// keeping honest, because when it goes wrong it goes wrong quietly - an old project opens with
// its parts unnamed, or every layer suddenly nested at the root - and by then the file has
// usually been saved again in the new shape.
//
// Everything here is pure. The rest of loading is fetching and decoding, which stays in App.
//
// Format history:
//   - parts used to be called video batches, since importing a video was the only way to make
//     one (videoBatch / videoLabel -> partId / partName)
//   - layers gained a type and a parentId when folders arrived; before that every layer was a
//     plain layer at the root
//   - texts arrived later still, so older cuts have no texts array at all

import { clampPps } from './timelineZoom.js';
import { clampCanvasSize } from './canvasSize.js';

/**
 * The most timeline tracks a project may claim.
 *
 * Every track is a row the timeline renders, so this is a rendering budget rather than a rule
 * about music videos. Nothing in the app creates this many; a file can still say so.
 */
export const MAX_TRACKS = 64;

/** At least one track to put a cut on, at most MAX_TRACKS. Anything unreadable is the default 2. */
function clampTracks(n) {
    const t = Math.round(Number(n));
    if (!Number.isFinite(t)) return 2;
    return Math.max(1, Math.min(MAX_TRACKS, t));
}

/**
 * What the app should look like after opening this project, with defaults for anything absent.
 *
 * This is the boundary where a file becomes app state, and it was the one place that applied none
 * of the limits the app applies everywhere else. The custom-size prompt clamps what a person can
 * type; the timeline clamps what a pinch or a wheel can reach. A file went straight in. A file is
 * the easier of the two to get a wrong number into - hand-edited, written by an older version, or
 * half-corrupted - and the failures land far from here: a pps of 0 renders every cut at zero
 * width, a negative numTracks puts cuts on track -1 where nothing draws them, and a canvas of
 * 100000 square asks for forty gigabytes.
 */
export function projectSettings(data) {
    const cuts = Array.isArray(data?.cuts) ? data.cuts : [];
    return {
        // Half a size is treated as none at all: a width with no height gives a canvas of NaN.
        canvas: clampCanvasSize(data?.canvas?.w, data?.canvas?.h),
        // Absent and wrong are different, and `||` cannot tell them apart - which is what the
        // onion-skin flags below are tested for. So absence is `??`, and a value that is present
        // but unusable is clamped rather than replaced: a stored zoom of 0 becomes the smallest
        // zoom the timeline can be read at, not the default someone else would have picked.
        numTracks: clampTracks(data?.numTracks ?? 2),
        currentCutId: cuts[0]?.id ?? 1,
        onionPrev: data?.onionPrev ?? false,
        onionNext: data?.onionNext ?? false,
        pps: clampPps(data?.pps ?? 50),
    };
}

/**
 * Bring saved cuts up to the current shape.
 *
 * Written as spread-then-override so a field the file already has always wins, and adding a new
 * default here can never overwrite real data in an existing project.
 */
export function migrateCuts(cuts) {
    return (Array.isArray(cuts) ? cuts : []).map(c => ({
        ...c,
        partId: c.partId ?? c.videoBatch,
        partName: c.partName ?? c.videoLabel,
        texts: Array.isArray(c.texts) ? c.texts : [],
        layers: (Array.isArray(c.layers) ? c.layers : []).map(l => ({
            type: 'layer',
            parentId: null,
            ...l,
            // Redo is a within-session affair; keeping it would let an undo after opening a file
            // restore strokes the user never saw in this session.
            redoStrokes: [],
        })),
    }));
}

/**
 * Progress reporting for a load, throttled.
 *
 * Two rules, both about not making things worse: a small project must not flash a progress bar
 * up for one frame, and a large one must not spend its time re-rendering the bar - so updates
 * are capped at about a hundred for the whole load however many items there are.
 *
 * @param {number} total items to be loaded
 * @param {(p: {done: number, total: number}) => void} onProgress
 * @param {number} [minToShow] below this many items, report nothing at all
 * @returns {{heavy: boolean, tick: () => void}}
 */
export function makeLoadProgress(total, onProgress, minToShow = 12) {
    const heavy = total > minToShow;
    const step = Math.max(1, Math.floor(total / 100));
    let done = 0, lastPaint = 0;
    return {
        heavy,
        tick() {
            done++;
            if (!heavy) return;
            if (done - lastPaint >= step || done === total) {
                lastPaint = done;
                onProgress({ done, total });
            }
        },
    };
}
