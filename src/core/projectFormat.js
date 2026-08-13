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

/** What the app should look like after opening this project, with defaults for anything absent. */
export function projectSettings(data) {
    const cuts = Array.isArray(data?.cuts) ? data.cuts : [];
    const w = data?.canvas?.w, h = data?.canvas?.h;
    return {
        // Only a complete size counts: half of one would give a canvas of NaN.
        canvas: (w && h) ? { w, h } : null,
        numTracks: data?.numTracks || 2,
        currentCutId: cuts[0]?.id ?? 1,
        onionPrev: data?.onionPrev ?? false,
        onionNext: data?.onionNext ?? false,
        pps: data?.pps ?? 50,
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
