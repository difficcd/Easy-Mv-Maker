// The audio and video tracks, as a reducer.
//
// These were five pieces of state that only ever moved together: loading a piece of audio set
// four of them, clearing it set three, and forgetting one left the app in a state it has no name
// for — a URL with no clip range, or a clip range pointing at audio that is gone. The same
// argument that moved `cuts` to a reducer applies, on a smaller scale.
//
// What is *not* here: the audio element, the video element, and the blobs behind them. Those are
// browser objects with a lifetime of their own, so they stay in refs beside the component and
// this only describes where the tracks sit on the timeline.
//
// Actions are built by the exported creators, so a mistyped one is a type error rather than a
// silent no-op.

/** Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */
export const EMPTY_MEDIA = {
    audioFile: null,      // { name } — the label shown on the track
    audioUrl: null,       // object URL or data URL being played
    audioDuration: 30,    // length of the source, from the audio element
    audioData: null,      // { startTime, endTime, offset } — where the clip sits on the timeline
    videoOverlay: null,   // { name, startTime, endTime, offset, duration, w, h, cuts?, ... }
};

// ── action creators ────────────────────────────────────────────────────────

/** A piece of audio arrived. Its length is not known yet — the element reports that later. */
export const loadAudio = (name, url) => ({ type: 'loadAudio', name, url });
/** The audio element has read the source and knows how long it is. */
export const setAudioDuration = (duration) => ({ type: 'setAudioDuration', duration });
/** Where the clip sits on the timeline, and which part of the source it plays. */
export const setAudioClip = (clip) => ({ type: 'setAudioClip', clip });
export const clearAudio = () => ({ type: 'clearAudio' });

export const loadVideo = (overlay) => ({ type: 'loadVideo', overlay });
export const clearVideo = () => ({ type: 'clearVideo' });
/** Scene-cut markers found by the detector, in video time. */
export const setVideoCuts = (cuts, cutStart, cutOffset) => ({ type: 'setVideoCuts', cuts, cutStart, cutOffset });

/** Drag a track along the timeline, keeping its length. */
export const moveTrack = (which, startTime) => ({ type: 'moveTrack', which, startTime });
/** Drag one edge of the audio clip. The left edge also moves into the source. */
export const resizeAudio = (edge, startTime, endTime, offset) => ({ type: 'resizeAudio', edge, startTime, endTime, offset });

/** Restore both tracks at once, opening a project. */
export const restoreMedia = (media) => ({ type: 'restoreMedia', media });
/** Everything gone: a new project. */
export const clearMedia = () => ({ type: 'clearMedia' });

// ── the reducer ────────────────────────────────────────────────────────────

/** Move a track to an absolute start, keeping its duration and never before zero. */
const shifted = (track, startTime) => {
    if (!track) return track;
    const start = Math.max(0, startTime);
    return { ...track, startTime: start, endTime: start + (track.endTime - track.startTime) };
};

export function mediaReducer(state, action) {
    const s = state || EMPTY_MEDIA;
    switch (action.type) {
        case 'loadAudio':
            // The clip range is cleared rather than kept: it described the previous audio, and
            // leaving it would place the new track using the old one's bounds until the element
            // reports back.
            return { ...s, audioFile: { name: action.name }, audioUrl: action.url, audioData: null };
        case 'setAudioDuration':
            return { ...s, audioDuration: action.duration || 30 };
        case 'setAudioClip':
            return { ...s, audioData: action.clip };
        case 'clearAudio':
            // Duration is left as it is: it belongs to the source that has gone, and resetting it
            // would shrink the timeline under the user mid-edit.
            return { ...s, audioFile: null, audioUrl: null, audioData: null };

        case 'loadVideo':
            return { ...s, videoOverlay: action.overlay };
        case 'clearVideo':
            return { ...s, videoOverlay: null };
        case 'setVideoCuts':
            // Only meaningful while that video is still loaded; detection finishes asynchronously
            // and can land after the video was removed.
            return s.videoOverlay
                ? { ...s, videoOverlay: { ...s.videoOverlay, cuts: action.cuts, cutStart: action.cutStart, cutOffset: action.cutOffset } }
                : s;

        case 'moveTrack':
            return action.which === 'audio'
                ? { ...s, audioData: shifted(s.audioData, action.startTime) }
                : { ...s, videoOverlay: shifted(s.videoOverlay, action.startTime) };

        case 'resizeAudio': {
            if (!s.audioData) return s;
            // Dragging the left edge scrubs into the source as well as moving the clip: the audio
            // under the new start has to be the audio that was there before, or the track slides
            // out of sync with everything cut against it. The right edge is a plain trim.
            const next = action.edge === 'left'
                ? { ...s.audioData, startTime: action.startTime, offset: Math.max(0, action.offset) }
                : { ...s.audioData, endTime: action.endTime };
            return { ...s, audioData: next };
        }

        case 'restoreMedia':
            return { ...EMPTY_MEDIA, ...(action.media || {}) };
        case 'clearMedia':
            return { ...EMPTY_MEDIA };

        default:
            return s;
    }
}
