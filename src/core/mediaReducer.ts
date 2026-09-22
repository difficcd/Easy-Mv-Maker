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

import type { TimeSpan } from './types.ts';

/** Where the audio clip sits on the timeline, and how far into the file it starts. */
export interface AudioClip extends TimeSpan { offset: number }
/** The reference video track. */
export interface VideoOverlay extends TimeSpan { name?: string; offset: number; duration: number; w?: number; h?: number; opacity?: number; cuts?: number[]; cutStart?: number; cutOffset?: number; [k: string]: any }
/** The media state: the audio track and the reference video, or neither. */
export interface MediaState {
    audioFile: { name: string } | null;
    audioUrl: string | null;
    audioDuration: number;
    audioData: AudioClip | null;
    videoOverlay: VideoOverlay | null;
}
/** Every action the reducer takes; the creators below build them. */
export type MediaAction =
    | { type: 'loadAudio', name: string, url: string }
    | { type: 'setAudioDuration', duration: number }
    | { type: 'setAudioClip', clip: AudioClip | null }
    | { type: 'clearAudio' }
    | { type: 'loadVideo', overlay: VideoOverlay }
    | { type: 'clearVideo' }
    | { type: 'setVideoCuts', cuts: number[], cutStart?: number, cutOffset?: number }
    | { type: 'setVideoOpacity', opacity: number }
    | { type: 'clearVideoCuts' }
    | { type: 'moveTrack', which: 'audio' | 'video', startTime: number }
    | { type: 'resizeAudio', edge: 'left' | 'right', startTime: number | null, endTime: number | null, offset: number | null }
    | { type: 'restoreMedia', media: Partial<MediaState> | null | undefined }
    | { type: 'clearMedia' };

/** Nothing loaded. The duration is a placeholder so an empty timeline still has a length. */
export const EMPTY_MEDIA: MediaState = {
    audioFile: null,      // { name } — the label shown on the track
    audioUrl: null,       // object URL or data URL being played
    audioDuration: 30,    // length of the source, from the audio element
    audioData: null,      // { startTime, endTime, offset } — where the clip sits on the timeline
    videoOverlay: null,   // { name, startTime, endTime, offset, duration, w, h, cuts?, ... }
};

// ── action creators ────────────────────────────────────────────────────────

/** A piece of audio arrived. Its length is not known yet — the element reports that later. */
export const loadAudio = (name: string, url: string) => ({ type: 'loadAudio', name, url }) as const;
/** The audio element has read the source and knows how long it is. */
export const setAudioDuration = (duration: number) => ({ type: 'setAudioDuration', duration }) as const;
/** Where the clip sits on the timeline, and which part of the source it plays. */
export const setAudioClip = (clip: AudioClip | null) => ({ type: 'setAudioClip', clip }) as const;
export const clearAudio = () => ({ type: 'clearAudio' }) as const;

export const loadVideo = (overlay: VideoOverlay) => ({ type: 'loadVideo', overlay }) as const;
export const clearVideo = () => ({ type: 'clearVideo' }) as const;
/** Scene-cut markers found by the detector, in video time. */
export const setVideoCuts = (cuts: number[], cutStart?: number, cutOffset?: number) => ({ type: 'setVideoCuts', cuts, cutStart, cutOffset }) as const;
/** How strongly the overlay shows through, 0..1. A reference layer is usually wanted faint. */
export const setVideoOpacity = (opacity: number) => ({ type: 'setVideoOpacity', opacity }) as const;
/** Throw away the detected scene markers without touching the video itself. */
export const clearVideoCuts = () => ({ type: 'clearVideoCuts' }) as const;

/** Drag a track along the timeline, keeping its length. */
export const moveTrack = (which: 'audio' | 'video', startTime: number) => ({ type: 'moveTrack', which, startTime }) as const;
/** Drag one edge of the audio clip. The left edge also moves into the source. */
export const resizeAudio = (edge: 'left' | 'right', startTime: number | null, endTime: number | null, offset: number | null) => ({ type: 'resizeAudio', edge, startTime, endTime, offset }) as const;

/** Restore both tracks at once, opening a project. */
export const restoreMedia = (media: Partial<MediaState> | null | undefined) => ({ type: 'restoreMedia', media }) as const;
/** Everything gone: a new project. */
export const clearMedia = () => ({ type: 'clearMedia' }) as const;

// ── the reducer ────────────────────────────────────────────────────────────

/** Move a track to an absolute start, keeping its duration and never before zero. */
const shifted = <T extends TimeSpan>(track: T | null, startTime: number): T | null => {
    if (!track) return track;
    const start = Math.max(0, startTime);
    return { ...track, startTime: start, endTime: start + (track.endTime - track.startTime) };
};

export function mediaReducer(state: MediaState | null | undefined, action: MediaAction): MediaState {
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

        case 'setVideoOpacity': {
            if (!s.videoOverlay) return s;
            // Clamped here rather than trusted from the caller: this ends up as globalAlpha, and
            // a value outside 0..1 makes the whole frame silently vanish. The typeof check is not
            // redundant with isFinite - Number(null) and Number('') are both 0, so coercing first
            // would turn a missing value into an invisible video.
            const o = action.opacity;
            const opacity = (typeof o === 'number' && Number.isFinite(o)) ? Math.max(0, Math.min(1, o)) : 1;
            return { ...s, videoOverlay: { ...s.videoOverlay, opacity } };
        }
        case 'clearVideoCuts':
            return s.videoOverlay
                ? { ...s, videoOverlay: { ...s.videoOverlay, cuts: [] } }
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
                ? { ...s.audioData, startTime: action.startTime ?? s.audioData.startTime, offset: Math.max(0, action.offset ?? 0) }
                : { ...s.audioData, endTime: action.endTime ?? s.audioData.endTime };
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
