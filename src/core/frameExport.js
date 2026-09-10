// What a frame export is going to be, before any of it happens.
//
// Three exports need the same answers - a single project, a queue of pieces, and anything that
// wants to say "this will be N frames" before starting - and they were each working them out
// again from the same constants. Two of the three had already drifted apart in spelling
// (`gifScale` and `scale`), which is how the third gets it subtly wrong.
//
// None of this touches a canvas. It is the arithmetic and the reasoning behind it, which is the
// part worth having in one place and worth being able to test.

/** A GIF wider than this is a file nobody can post. See `frameExportPlan`. */
export const GIF_MAX_EDGE = 720;

/**
 * Everything decided before the first frame is painted.
 *
 * The two rates, and why they differ: a GIF at 30fps is enormous and plays no better, and twelve
 * is what hand-drawn animation usually runs at anyway. A PNG sequence is going into an editor, so
 * it keeps the full rate.
 *
 * The scale, and why only the GIF gets one: every pixel of a GIF is a palette index and none of
 * it is inter-frame compressed, so a second of 1920x1080 runs to tens of megabytes and takes as
 * long again to encode. Fitted to 720 on the long edge it is a file that can be posted. A PNG
 * sequence keeps the full size, because that is what an editor wants.
 *
 * @param {object} args
 * @param {string} args.format `'gif'` or anything else, which means a PNG sequence
 * @param {number} args.cw
 * @param {number} args.ch
 * @param {number} [args.from] start of the range, in seconds
 * @param {number} [args.to] end of the range
 * @returns {{gif: boolean, fps: number, scale: number, gw: number, gh: number, total: number,
 *   delayMs: number, empty: boolean}}
 */
export function frameExportPlan({ format, cw, ch, from = 0, to = 0 }) {
    const gif = format === 'gif';
    const fps = gif ? 12 : 30;
    const w = Math.max(1, Math.round(Number(cw) || 1));
    const h = Math.max(1, Math.round(Number(ch) || 1));
    const scale = gif ? Math.min(1, GIF_MAX_EDGE / Math.max(w, h)) : 1;
    const span = (Number(to) || 0) - (Number(from) || 0);
    return {
        gif,
        fps,
        scale,
        gw: Math.max(1, Math.round(w * scale)),
        gh: Math.max(1, Math.round(h * scale)),
        // At least one frame whenever there is a range at all: a project shorter than a frame
        // should still produce a file rather than an empty one.
        total: span > 0 ? Math.max(1, Math.round(span * fps)) : 0,
        delayMs: Math.round(1000 / fps),
        /** Nothing to export - the caller says so rather than writing a file with no frames. */
        empty: !(span > 0),
    };
}

/**
 * What the finished bytes are and what they are called.
 *
 * The base differs by where they came from - one project or a queue of pieces - because the two
 * land in the same downloads folder and the name is the only thing that tells them apart. The
 * extension does not: a PNG sequence is a zip either way.
 *
 * @param {boolean} gif
 * @param {{gif: string, zip: string}} base
 */
export function exportFileInfo(gif, base = { gif: 'mv_export', zip: 'mv_frames' }) {
    return gif
        ? { type: 'image/gif', name: `${base.gif}.gif` }
        : { type: 'application/zip', name: `${base.zip}.zip` };
}

/**
 * Above this many frames the export is worth warning about.
 *
 * Each frame is encoded as it is painted rather than every frame being held to the end, so the
 * question is how long it takes and how big the file gets - not whether the tab survives it.
 */
export const LONG_EXPORT_FRAMES = 1000;
