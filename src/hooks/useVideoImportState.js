import { useRef, useState } from 'react';
import { unpackMedia } from '../core/projectAssets.js';
import { safeMediaSrc, detachMedia } from '../core/mediaEl.js';
import { loadVideo, clearVideo } from '../core/mediaReducer.js';
import { fetchAsset } from '../core/api.js';
import { tr } from '../i18n.js';

// The state of bringing a video into the project.
//
// Sixteen names in App's declaration block, all of them touched only by the import: the hidden
// video element and the bytes behind it, the dialog's settings, the progress of an extraction and
// whether it has been sent to a background chip, the list of videos already fetched, the scene
// detector's progress and settings, and the two flags that ask a long run to stop.
//
// The logic stays in App for now - it reads the document, the bitmap store and the paint path,
// and moving it would mean handing all three back. What moves is the answer to "what does the
// video import remember", which was previously "find out by grepping".
//
// The two stop flags are refs rather than state deliberately. They are read inside loops that
// are already running, and a state update would not reach a closure that started before it.

export function useVideoImportState() {
    /** The hidden <video> that decodes and plays the overlay. */
    const elRef = useRef(/** @type {HTMLVideoElement|null} */(null));
    /** The video's bytes, kept so the project can be saved with it. */
    const blobRef = useRef(/** @type {Blob|null} */(null));

    /** The import dialog: {file, fps, maxFrames}, or null when it is closed. */
    const [cfg, setCfg] = useState(/** @type {any} */(null));
    /** Videos already fetched or opened, reusable without downloading again. */
    const [recent, setRecent] = useState(/** @type {any[]} */([]));
    /** {done, total} while frames are being extracted. */
    const [busy, setBusy] = useState(/** @type {any} */(null));
    /** The extraction has been sent to a background chip; the dialog is out of the way. */
    const [busyBg, setBusyBg] = useState(false);

    /** {done, total} while scene cuts are being detected. */
    const [scene, setScene] = useState(/** @type {any} */(null));
    /** The scene-detect settings modal: {threshold, rangeOn, startText, endText}. */
    const [sceneCfg, setSceneCfg] = useState(/** @type {any} */(null));

    /** Set to ask a running extraction, or a running detection, to stop. */
    const stopRef = useRef(false);
    const sceneStopRef = useRef(false);

    /**
     * Put a stored video track back: the element, the bytes a save needs, and the media state.
     * The same three shapes a stored track can arrive in as the audio, read by the same
     * function; the track wants a Blob. Returns how many pieces could not be loaded.
     *
     * @param {any} field the document's `video`
     * @param {object} deps
     * @param {string | null} deps.assetBase
     * @param {(action: any) => void} deps.dispatchMedia
     * @param {() => void} deps.requestRepaint
     */
    const restore = async (field, { assetBase, dispatchMedia, requestRepaint }) => {
        const got = await unpackMedia(field, '__video__', { assetBase, fetchAsset });
        let blob = got.blob;
        if (!blob && got.dataUrl) { try { blob = await (await fetch(got.dataUrl)).blob(); } catch { } }
        if (!blob) {
            blobRef.current = null; dispatchMedia(clearVideo());
            detachMedia(elRef.current);
            return got.missing;
        }
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        const v = elRef.current;
        // The url here is ours (createObjectURL), but it goes through the same gate as the audio
        // so there is one rule about what may reach a media element, not two.
        const src = safeMediaSrc(url, 'video');
        if (v && src) { v.muted = true; v.playsInline = true; v.src = src; v.onseeked = () => requestRepaint(); v.onloadedmetadata = () => { try { v.currentTime = field.offset || 0; } catch { } }; }
        dispatchMedia(loadVideo({ name: field.name || tr('영상'), startTime: field.startTime ?? 0, endTime: field.endTime ?? (field.duration || 0), offset: field.offset ?? 0, duration: field.duration || 0, w: field.w || 0, h: field.h || 0, cuts: field.cuts, cutStart: field.cutStart, cutOffset: field.cutOffset }));
        return got.missing;
    };

    return {
        elRef, blobRef, restore, stopRef, sceneStopRef,
        cfg, setCfg, recent, setRecent, busy, setBusy, busyBg, setBusyBg,
        scene, setScene, sceneCfg, setSceneCfg,
    };
}
