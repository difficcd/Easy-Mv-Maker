// Turning extracted video frames into cuts.
//
// This is the arithmetic in the middle of the import, with the file reading and the bitmap storing
// taken off either end. It was inline in a function that also picks a canvas size, decodes a
// video, stores blobs, loads the audio and moves the playhead - so the part with the actual rules
// in it was the part nobody could test.
//
// The rules, all of which have a reason someone hit:
//
//   held frames     the extractor collapses runs of identical frames and reports how many each
//                   one stood for. A held frame spans its whole run, so a still shot stays still
//                   for as long as it was still, rather than being one frame followed by a gap.
//   where they go   after whatever is already on the chosen track, not at zero, so importing a
//                   second video does not land on top of the first.
//   which track     the one the current cut sits on, so an import goes where the user is looking.
//   re-import       cuts from the same source are replaced rather than added to, so importing the
//                   same file twice does not double it. That is why every cut carries videoSrc.
//   parts           a long video arrives already grouped. The split is by count, so the last part
//                   is the short one.

/**
 * Where a run of imported cuts should start, and on which track.
 *
 * @param {Array<{id: any, track: number, startTime: number, endTime: number, videoSrc?: string}>} cuts
 *   the cuts already in the project
 * @param {string} srcKey the source being imported; its existing cuts are ignored, since they are
 *   about to be replaced
 * @param {any} currentCutId which cut is selected, deciding the track
 * @returns {{track: number, startAt: number}}
 */
export function importPlacement(cuts, srcKey, currentCutId) {
    const kept = (Array.isArray(cuts) ? cuts : []).filter(c => c && c.videoSrc !== srcKey);
    const track = kept.find(c => c.id === currentCutId)?.track ?? 0;
    const startAt = kept.filter(c => c.track === track)
        .reduce((m, c) => Math.max(m, Number(c.endTime) || 0), 0);
    return { track, startAt };
}

/**
 * How long each imported frame lasts, in order.
 *
 * One frame's worth each, except where the extractor collapsed duplicates - those last for as
 * many frames as they stood in for. A missing or nonsense hold counts as one, because a frame
 * that lasts zero seconds is a cut that cannot be selected.
 *
 * @param {number[]} holds how many source frames each extracted frame represents
 * @param {number} count how many frames there are
 * @param {number} fps
 * @returns {number[]}
 */
export function frameDurations(holds, count, fps) {
    const dur = 1 / Math.max(0.1, Number(fps) || 0);
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
        const held = Math.max(1, Math.floor(Number(holds?.[i]) || 1));
        out[i] = dur * held;
    }
    return out;
}

/**
 * Which part each frame belongs to, and what that part is called.
 *
 * Split by count rather than by duration: the parts are meant to be even handfuls of cuts, and
 * held frames would otherwise make one part much longer than another. With one part there are no
 * part suffixes at all, so an import that was not split reads the way it always did.
 *
 * @param {number} count how many frames
 * @param {number} parts how many groups to make
 * @param {string} batch the batch id every cut carries
 * @param {string} label the name the user gave the import
 * @returns {(i: number) => {partId: string, partName: string}}
 */
export function partAssigner(count, parts, batch, label) {
    const n = Math.max(1, Math.min(count || 1, Math.floor(Number(parts)) || 1));
    if (n <= 1) return () => ({ partId: batch, partName: label });
    const perPart = Math.ceil(count / n);
    return (i) => {
        const p = Math.floor(i / perPart);
        return { partId: `${batch}_p${p}`, partName: `${label} ${p + 1}` };
    };
}

/**
 * The cuts an import produces, one per extracted frame.
 *
 * Every frame becomes a cut holding a single paste stroke of its bitmap - which is what makes an
 * imported frame drawable over rather than a background layer.
 *
 * @param {object} opts
 * @param {string[]} opts.bitmapIds one per frame, already stored
 * @param {number[]} opts.holds
 * @param {number} opts.fps
 * @param {number} opts.track
 * @param {number} opts.startAt
 * @param {string} opts.batch
 * @param {string} opts.label
 * @param {string} opts.srcKey
 * @param {number} opts.parts
 * @param {{x: number, y: number, w: number, h: number}} opts.rect where each frame is pasted
 * @param {() => any} opts.nextId
 * @returns {any[]}
 */
export function buildImportedCuts({ bitmapIds, holds, fps, track, startAt, batch, label, srcKey, parts, rect, nextId }) {
    const durations = frameDurations(holds, bitmapIds.length, fps);
    const partOf = partAssigner(bitmapIds.length, parts, batch, label);
    const made = [];
    let t = startAt;
    for (let i = 0; i < bitmapIds.length; i++) {
        const start = t;
        t = start + durations[i];
        const { partId, partName } = partOf(i);
        made.push({
            id: nextId(),
            name: `${label} ${i + 1}`,
            startTime: start, endTime: t, track,
            activeLayerId: 1, texts: [],
            videoBatch: batch, videoLabel: label, videoSrc: srcKey,
            partId, partName,
            layers: [{
                id: 1, name: 'L1', type: 'layer', parentId: null, visible: true, redoStrokes: [],
                strokes: [{ id: nextId(), tool: 'paste', bitmapId: bitmapIds[i], x: rect.x, y: rect.y, w: rect.w, h: rect.h }],
            }],
        });
    }
    return made;
}
