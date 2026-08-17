// Where playback should begin when play is pressed.
//
// Two situations look alike from inside the app and want opposite things. Playback that ran to
// the end leaves the playhead sitting at the end, and pressing play there should replay rather
// than do nothing. But a playhead that was *put* somewhere — dragged into a gap between cuts, or
// past the last one — was put there on purpose, and moving it is overriding a decision the user
// just made.
//
// The old rule treated "past the end of the current cut" as finished, which caught the second
// case: parking anywhere after the current cut rewound to that cut's start. The only reliable
// signal is the end of the playable range, so that is all this looks at.

const EPS = 0.001;

/**
 * @param {number} currentTime where the playhead is
 * @param {number} playStart start of the playable range (the active part, or all content)
 * @param {number} playEnd end of it
 * @param {number} anchor where to rewind to — the current cut's start
 * @returns {number} the time to play from
 */
export function playbackStartFrom(currentTime, playStart, playEnd, anchor) {
    const t = Number.isFinite(currentTime) ? currentTime : playStart;
    // At or past the end there is nothing left to play, so pressing play means "again".
    if (t >= playEnd - EPS) return anchor;
    // Before the range entirely - the playhead is outside what is being played, so it has to
    // come in somewhere, and the anchor is the meaningful place.
    if (t < playStart - EPS) return anchor;
    // Anywhere inside the range, including empty gaps, is a deliberate position. Play from it.
    return t;
}
