import { useRef, useState } from 'react';

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

    return {
        elRef, blobRef, stopRef, sceneStopRef,
        cfg, setCfg, recent, setRecent, busy, setBusy, busyBg, setBusyBg,
        scene, setScene, sceneCfg, setSceneCfg,
    };
}
