import { useRef } from 'react';
import { loadAudio, setAudioDuration, setAudioClip, clearAudio } from '../core/mediaReducer.js';
import { detachMedia } from '../core/mediaEl.js';
import { tr } from '../i18n';

/**
 * The music track: the element that plays it, the copies of it a save needs, and the four ways
 * one gets loaded or dropped.
 *
 * This could leave App whole because of what it does *not* touch. The audio knows nothing about
 * cuts, layers, the canvas or the timeline - it is a source, a position on the timeline, and a
 * clip range, all of which live in `mediaReducer` already. What was left in App was the browser
 * side: an <audio> element, the AudioContext the export recorder taps, and the base64 and Blob
 * copies that exist so a project can be saved with the music in it.
 *
 * The three shapes of the same sound, and why each exists:
 * - `audioRef` — the element. What plays, and what the recorder taps for the exported video.
 * - `audioB64Ref` — a base64 dataURL. Self-contained, so an `.emv` file carries the music.
 * - `audioBlobRef` — the same bytes as a Blob, cached by the dataURL they came from, so
 *   switching tracks invalidates it without anyone having to remember to. IndexedDB can hold a
 *   Blob; writing a whole song into it as base64 on every autosave debounce cannot be done.
 *
 * @param {object} deps
 * @param {string | null} deps.audioUrl the current source, from `media`
 * @param {(action: any) => void} deps.dispatchMedia
 * @param {(p: any) => void} deps.setLinkPrompt asks for a YouTube URL when none was given
 */
export function useAudioTrack({ audioUrl, dispatchMedia, setLinkPrompt }) {
    const audioRef = useRef(/** @type {HTMLAudioElement | null} */(null));
    const audioB64Ref = useRef(/** @type {string | null} */(null));
    const audioBlobRef = useRef(/** @type {{src: string|null, blob: Blob|null}} */({ src: null, blob: null }));
    // The export recorder mixes the audio into the captured stream through these. Created once,
    // on the first export, because createMediaElementSource can only be called once per element.
    const audioCtxRef = useRef(/** @type {AudioContext | null} */(null));
    const audioSourceRef = useRef(/** @type {MediaElementAudioSourceNode | null} */(null));
    const audioDestRef = useRef(/** @type {MediaStreamAudioDestinationNode | null} */(null));

    /** The current audio as a Blob, or null. Cached against the dataURL it was made from. */
    const audioAsBlob = async () => {
        const src = audioB64Ref.current;
        if (!src) return null;
        if (audioBlobRef.current.src === src) return audioBlobRef.current.blob;
        try {
            const blob = await (await fetch(src)).blob();
            audioBlobRef.current = { src, blob };
            return blob;
        } catch { return null; }
    };

    /**
     * @param {string} url
     * @param {string} name
     * @param {number} [startAt] where on the timeline the track begins
     * @param {number} [offset] where in the source the track begins
     * @param {number | null} [clipDur] how much of the source to use
     */
    const loadAudioUrl = (url, name, startAt = 0, offset = 0, clipDur = null) => {
        dispatchMedia(loadAudio(name, url));
        const audio = new Audio(url);
        // startAt aligns the track to a given timeline position (e.g. the first imported video frame);
        // offset/clipDur select a sub-range of the source audio (used when only a video segment is
        // imported), so audio + frames extracted together stay mechanically in sync.
        audio.onloadedmetadata = () => {
            dispatchMedia(setAudioDuration(audio.duration));
            const dur = clipDur != null ? Math.min(clipDur, Math.max(0, audio.duration - offset)) : Math.max(0, audio.duration - offset);
            dispatchMedia(setAudioClip({ startTime: startAt, endTime: startAt + dur, offset }));
            if (audioRef.current) audioRef.current.src = url;
        };
        // Capture base64 once so the project can be saved "with the music".
        if (url.startsWith('data:')) { audioB64Ref.current = url; }
        else { fetch(url).then(r => r.blob()).then(b => { const fr = new FileReader(); fr.onload = () => { audioB64Ref.current = /** @type {string} */(fr.result); }; fr.readAsDataURL(b); }).catch(() => { }); }
    };

    const handleAudioUpload = (e) => {
        const file = e.target.files[0]; if (!file) return;
        loadAudioUrl(URL.createObjectURL(file), file.name);
    };

    const handleDeleteAudio = () => {
        detachMedia(audioRef.current);
        if (audioUrl && audioUrl.startsWith('blob:')) { try { URL.revokeObjectURL(audioUrl); } catch { } }
        audioB64Ref.current = null;
        dispatchMedia(clearAudio());
    };

    // Its own fetch rather than `apiFetch`: this endpoint answers a failure with a JSON body
    // explaining what yt-dlp said, and that sentence is the whole value of the error here.
    const loadYoutubeAudio = async (presetUrl) => {
        const url = typeof presetUrl === 'string' ? presetUrl : null;
        if (!url) { setLinkPrompt({ kind: 'audio' }); return; }
        try {
            const res = await fetch('/api/youtube-audio?url=' + encodeURIComponent(url));
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
            const blob = await res.blob();
            loadAudioUrl(URL.createObjectURL(blob), tr('유튜브 음원'));
        } catch (e) { alert(tr('음원 추출 실패: ') + e.message); }
    };

    return {
        audioRef, audioB64Ref, audioBlobRef, audioCtxRef, audioSourceRef, audioDestRef,
        audioAsBlob, loadAudioUrl, handleAudioUpload, handleDeleteAudio, loadYoutubeAudio,
    };
}
