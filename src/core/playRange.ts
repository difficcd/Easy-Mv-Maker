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

import type { TimeSpan } from './types.ts';

/** Where to start and stop, in seconds. */
export interface TimeRange { start: number; end: number }

/** What playRange looks at: the cuts, the audio clip, the reference video, the selected part. */
export interface RangeSources {
    cuts?: Array<{ startTime: number, endTime?: number } | null | undefined> | null;
    audio?: { startTime?: number, endTime?: number } | null;
    video?: { startTime?: number, endTime?: number } | null;
    part?: { start: number, end: number } | null;
}

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
export function playRange({ cuts, audio, video, part }: RangeSources = {}): TimeRange {
    if (part && Number.isFinite(part.start) && Number.isFinite(part.end) && part.end > part.start) {
        return { start: Math.max(0, part.start), end: part.end };
    }
    const list = (Array.isArray(cuts) ? cuts : []).filter((c): c is TimeSpan => !!c && Number.isFinite(c.startTime) && Number.isFinite(c.endTime));
    const starts = list.map(c => c.startTime);
    const ends = list.map(c => c.endTime);
    if (audio && Number.isFinite(audio.startTime)) starts.push(audio.startTime as number);
    if (audio && Number.isFinite(audio.endTime)) ends.push(audio.endTime as number);
    if (video && Number.isFinite(video.startTime)) starts.push(video.startTime as number);
    if (video && Number.isFinite(video.endTime)) ends.push(video.endTime as number);
    if (!ends.length) return { start: 0, end: 0 };
    const end = Math.max(0, ...ends);
    // Only meaningful if something is actually there: a project with no content starts at zero
    // rather than at Infinity.
    const start = starts.length ? Math.max(0, Math.min(...starts)) : 0;
    return { start: Math.min(start, end), end };
}

/**
 * The range an export covers: the play range, but starting at the first cut.
 *
 * Playback starts where the content starts, which can be the music - an intro before the first
 * drawing is something you want to hear while working. The export does not want it: "the
 * start point is fixed to the first cut's start; everything else as it was". A film that opens
 * with three seconds of blank frames is a film someone trims afterwards. Within a selected
 * part it is the first cut of that part, for the same reason.
 *
 * The end is untouched. Music running past the last cut is a choice the user made on the
 * timeline; an intro before the first cut is not one they can see.
 *
 * @param {Parameters<typeof playRange>[0]} [opts] the same options as playRange
 * @returns {{start: number, end: number}}
 */
export function exportRange(opts: RangeSources = {}): TimeRange {
    const { start, end } = playRange(opts);
    const { cuts, part } = opts;
    const inRange = (Array.isArray(cuts) ? cuts : []).filter((c): c is { startTime: number, endTime?: number } => !!c && Number.isFinite(c.startTime)
        && (!part || (c.startTime < part.end && (c.endTime ?? c.startTime) > part.start)));
    if (!inRange.length) return { start, end };
    const first = Math.max(start, Math.min(...inRange.map(c => c.startTime)));
    return { start: Math.min(first, end), end };
}
