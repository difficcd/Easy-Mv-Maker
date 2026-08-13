// Timeline clock display and entry.

/** Seconds as mm:ss.cc, which is what the timeline shows and what parseClock reads back. */
export function fmt(s) {
    const t = Number.isFinite(s) ? Math.max(0, s) : 0;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}`;
}

/**
 * Read a typed time back into seconds.
 *
 * Accepts what a person is likely to type: "1:30", "1:02:03", or a plain number of seconds.
 * Anything unreadable is 0 rather than NaN, because a NaN reaches the playhead, the audio
 * element and the cut bounds before anyone notices where it came from.
 */
export function parseClock(str) {
    const parts = String(str).trim().split(':').map(p => +p || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}
