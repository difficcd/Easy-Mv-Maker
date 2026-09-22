import { useRef, useState } from 'react';
import { unpackMedia } from '../core/projectAssets.ts';
import { safeMediaSrc, detachMedia } from '../core/mediaEl.ts';
import { loadVideo, clearVideo } from '../core/mediaReducer.ts';
import { fetchAsset } from '../core/api.ts';
import { tr } from '../i18n.js';
import { nextId } from '../core/ids.ts';
import { parseClock } from '../core/timeCode.ts';
import { importPlacement, buildImportedCuts, extractOptionsFor } from '../core/videoCuts.ts';
import { replaceBatchCuts } from '../core/cutsReducer.ts';
import { targetCanvasFor } from '../core/canvasSize.ts';
import { extractVideoFrames, fitRect } from '../canvas/videoFrames.js';

// The state of bringing a video into the project.
//
// Sixteen names in App's declaration block, all of them touched only by the import: the hidden
// video element and the bytes behind it, the dialog's settings, the progress of an extraction and
// whether it has been sent to a background chip, the list of videos already fetched, the scene
// detector's progress and settings, and the two flags that ask a long run to stop.
//
// The import itself is `run`, and putting a stored track back is `restore`. Both take what
// they need of the document at call time rather than at construction, so this hook stays free
// of App's state and App stays the only place that knows the whole document.
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

    /**
     * The import: extract the frames as the dialog asked, store them, and lay them out as cuts.
     * Everything after storing the blobs is arithmetic in core/videoCuts. Takes the document
     * and the store at call time; see the header.
     */
    const run = async ({ cw, ch, cuts, currentCutId, docEpochRef, setCanvasSize, storeBitmapBlob, dispatchCuts, setCurrentCutId, setCurrentTime, loadAudioUrl, gcBitmaps, notices }) => {
        if (!cfg?.file) return;
        const startedFor = docEpochRef.current;
        setBusy({ done: 0, total: 0 });
        try {
            const tgt = targetCanvasFor(cfg, cw, ch);
            const TW = tgt.w, TH = tgt.h;
            if (TW !== cw || TH !== ch) setCanvasSize({ w: TW, h: TH });
            // The dialog's settings become the extractor's numbers in core/videoCuts, where the
            // quality tiers are a table.
            const { opts, nativeRes: isNative } = extractOptionsFor(cfg, tgt, parseClock);
            const { frames, holds = [], skipped = 0, fps, width: fW, height: fH } = await extractVideoFrames(cfg.file, {
                ...opts,
                onProgress: (done, total, skipped) => setBusy({ done, total, skipped }),
                shouldStop: () => stopRef.current,
            });
            if (!frames.length) { alert(tr('추출된 프레임이 없습니다.')); return; }
            // Extraction can take minutes and can be left running in the background, so the
            // project may have been swapped underneath it. Dropping the frames is the only safe
            // answer: putting them in the project that happens to be open now would be writing
            // into a document the user never asked to change.
            if (docEpochRef.current !== startedFor) {
                notices.setError(tr('다른 프로젝트를 여는 동안 영상 프레임 추출이 끝나 결과를 버렸습니다. 프로젝트를 연 뒤 다시 가져오세요.'));
                return;
            }
            // Re-importing the same source replaces its old frames instead of piling up duplicates.
            const srcKey = cfg.srcKey;
            const { track, startAt } = importPlacement(cuts, srcKey, currentCutId);
            // The batch key comes from an id rather than the clock so that importing twice in
            // quick succession cannot produce two batches with the same name.
            const batch = 'vb_' + nextId().toString(36);
            const label = cfg.label || cfg.file.name.replace(/\.[^.]+$/, '').slice(0, 24);
            // Native-res frames keep the source aspect, so letterbox-fit them into the canvas;
            // compressed frames are already pre-letterboxed to the canvas (full-canvas paste).
            const fit = (isNative && fW && fH) ? fitRect(fW, fH, TW, TH) : { x: 0, y: 0, w: TW, h: TH };
            const rect = { x: Math.round(fit.x), y: Math.round(fit.y), w: Math.round(fit.w), h: Math.round(fit.h) };
            // Storing the blobs is the only part of this that has to happen here: everything after
            // it - where the cuts go, how long each lasts, which part it belongs to - is arithmetic,
            // and lives in core/videoCuts.js where it can be tested.
            const bitmapIds = [];
            for (let i = 0; i < frames.length; i++) bitmapIds.push(await storeBitmapBlob(frames[i], fW, fH));
            const made = buildImportedCuts({
                bitmapIds, holds, fps, track, startAt, batch, label, srcKey, parts: cfg.parts, rect, nextId,
            });
            dispatchCuts(replaceBatchCuts(srcKey, made));
            setCurrentCutId(made[0].id);
            setCurrentTime(made[0].startTime);
            // Audio (if asked) is the only thing that keeps the video bytes alive past this point.
            // Aligned to the first imported frame; when only a range was imported, the audio is
            // clipped to that same range (offset rStart, duration rEnd-rStart).
            if (cfg.withAudio) loadAudioUrl(URL.createObjectURL(cfg.file), label + tr(' (영상 음원)'), made[0].startTime, opts.start, opts.end == null ? null : opts.end - opts.start);
            setCfg(null);
            setTimeout(gcBitmaps, 0); // replaced frames' bitmaps go too
        } catch (e) {
            console.error('[import]', e);
            notices.setError(tr('영상 가져오기 실패: ') + e.message);
        } finally {
            stopRef.current = false;
            setBusy(null);
            setBusyBg(false);
        }
    };

    return {
        elRef, blobRef, restore, run, stopRef, sceneStopRef,
        cfg, setCfg, recent, setRecent, busy, setBusy, busyBg, setBusyBg,
        scene, setScene, sceneCfg, setSceneCfg,
    };
}
