// Where the content starts and where it ends.
//
// This was answered in three places with three different answers. Playback used cuts, audio and
// the reference video. The screen recording used cuts and audio, but not the reference video -
// which is drawn on the very canvas it captures. The frame and GIF export used the cuts alone,
// and always began at zero rather than where the content begins, so a project whose first cut
// sits at three seconds exported three seconds of nothing before anything happened.
//
// None of those three was written down as a decision; they are the same idea typed out three
// times, drifting. So: one function, and the exports run the range playback runs. What you watch
// is what comes out, including the selected part - which playback already scopes to, and which
// the timeline already dims the rest of.

/**
 * The time range to play, or export.
 *
 * A selected part wins outright: it is the range, and the media outside it is not part of what
 * the user is looking at. With no part selected the range spans everything that occupies time -
 * the cuts, the audio clip, and the reference video.
 *
 * An empty project gives {start: 0, end: 0}, which callers read as nothing to do rather than
 * having to test for emptiness themselves.
 *
 * @param {object} opts
 * @param {Array<{startTime: number, endTime: number}>} [opts.cuts]
 * @param {{startTime?: number, endTime?: number} | null} [opts.audio]
 * @param {{startTime?: number, endTime?: number} | null} [opts.video] the reference video overlay
 * @param {{start: number, end: number} | null} [opts.part] the selected part, if there is one
 * @returns {{start: number, end: number}}
 */
export function playRange({ cuts, audio, video, part } = {}) {
    if (part && Number.isFinite(part.start) && Number.isFinite(part.end) && part.end > part.start) {
        return { start: Math.max(0, part.start), end: part.end };
    }
    const list = (Array.isArray(cuts) ? cuts : []).filter(c => c && Number.isFinite(c.startTime) && Number.isFinite(c.endTime));
    const starts = list.map(c => c.startTime);
    const ends = list.map(c => c.endTime);
    if (audio && Number.isFinite(audio.startTime)) starts.push(audio.startTime);
    if (audio && Number.isFinite(audio.endTime)) ends.push(audio.endTime);
    if (video && Number.isFinite(video.startTime)) starts.push(video.startTime);
    if (video && Number.isFinite(video.endTime)) ends.push(video.endTime);
    if (!ends.length) return { start: 0, end: 0 };
    const end = Math.max(0, ...ends);
    // Only meaningful if something is actually there: a project with no content starts at zero
    // rather than at Infinity.
    const start = starts.length ? Math.max(0, Math.min(...starts)) : 0;
    return { start: Math.min(start, end), end };
}
