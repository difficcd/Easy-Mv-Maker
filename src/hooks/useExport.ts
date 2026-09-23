// Getting the movie out of the app.
//
// Three exports, one file, because they share the thing that is hard: painting a range of the
// timeline through the app's own paint path. A parallel renderer built for exporting is a thing
// that agrees with the real one until it quietly does not, and the first anyone hears of it is
// an export that looks wrong.
//
//   handleExport        a video, recorded off the canvas by MediaRecorder
//   handleExportFrames  a GIF or a PNG sequence, painted a frame at a time
//   handleExportPieces  several .emv files painted into one of those (#123)
//
// The five refs that say an export is running stay in App, and arrive here as `recording`. They
// are refs and not state because the playback loop reads them every frame, and usePlayback is
// called long before this is - recording and playback are one clock, and App is where the two
// meet.

import { tr } from '../i18n.ts';
import { pieceRange } from '../core/exportQueue.ts';
import { frameExportPlan, exportFileInfo, LONG_EXPORT_FRAMES } from '../core/frameExport.ts';
import { EXPORT_FPS } from '../core/recordClock.ts';
import { evaluateFrame } from '../engine/evaluateFrame.ts';
import { pendingBitmapIds } from '../engine/pendingBitmaps.ts';
import { scratchCanvas } from '../canvas/scratch.ts';
import { frameName, ZipWriter } from '../export/zip.ts';
import { GifWriter } from '../export/gif.ts';
import { downloadBlob } from '../export/download.ts';
import { pickRecordingType, frameSource, startRecorder } from '../export/recorder.ts';
import { videoBitrate, AUDIO_BITRATE } from '../core/recordBitrate.ts';
import type { Id } from '../core/types.ts';
import type { AudioClip } from '../core/mediaReducer.ts';
import type { StoreEntry } from '../core/projectAssets.ts';
import type { CanvasSlot } from '../canvas/pixelEffects.ts';
import type { PlaybackDeps } from './usePlayback.ts';

/** What the frame renderer reads while exporting: the document as it is now, not as it was when the export began. */
export interface RenderState { cuts: Cut[]; currentCutId: Id | null | undefined; cw: number; ch: number }
/** What an export needs from the app, grouped by where it comes from. */
export interface ExportDeps {
    /** the canvas, how to paint one frame, and what to paint it from */
    paint: { canvasRef: { current: HTMLCanvasElement | null }, paintFrameRef: { current: ((t: number, playing: boolean) => void) | null }, currentTimeRef: { current: number }, renderStateRef: { current: RenderState }, bitmapStoreRef: { current: Map<string, StoreEntry> }, videoStopRef: { current: boolean } };
    /** the audio element and the graph the recorder taps */
    audio: { audioRef: { current: HTMLAudioElement | null }, audioCtxRef: { current: AudioContext | null }, audioSourceRef: { current: MediaElementAudioSourceNode | null }, audioDestRef: { current: MediaStreamAudioDestinationNode | null }, audioUrl: string | null, audioData: AudioClip | null };
    /** what to export and how big it comes out */
    range: { playStart: number, playEnd: number, cw: number, ch: number, transparentBg: boolean, transparentFormat: string };
    /** opening and closing a document, for the multi-piece queue */
    doc: { buildData: (includeAudio?: boolean, assetSink?: any[] | null, blobsOk?: boolean) => Promise<any>, restore: (data: any, assetBase?: string | null, label?: string) => Promise<boolean>, invalidateCutsUsing: (ids: Iterable<string>) => void, decodeFrameBitmap: (e: StoreEntry) => Promise<ImageBitmap>, paintFrame: (t: number, playing: boolean) => void };
    /** where progress, failure and the playhead go */
    report: { setLoadProgress: (p: { label: string, done: number, total: number } | null) => void, setAppError: (m: string) => void, setToast: (m: string) => void, setCurrentTime: (t: number) => void, setIsPlaying: (on: boolean) => void };
    /** the same objects usePlayback is given, so the loop and the recorder agree */
    recording: PlaybackDeps['recording'];
}


/**
 * @param {object} opts
 * @param {{canvasRef: any, paintFrameRef: any, currentTimeRef: any, renderStateRef: any,
 *   bitmapStoreRef: any, videoStopRef: any}} opts.paint
 *   the canvas, how to paint one frame, and what to paint it from
 * @param {{audioRef: any, audioCtxRef: any, audioSourceRef: any, audioDestRef: any,
 *   audioUrl: string|null, audioData: any}} opts.audio
 *   the audio element and the graph the recorder taps
 * @param {{playStart: number, playEnd: number, cw: number, ch: number,
 *   transparentBg: boolean, transparentFormat: string}} opts.range
 *   what to export and how big it comes out
 * @param {{buildData: Function, restore: Function, invalidateCutsUsing: Function,
 *   decodeFrameBitmap: Function, paintFrame: Function}} opts.doc
 *   opening and closing a document, for the multi-piece queue
 * @param {{setLoadProgress: Function, setAppError: Function, setToast: Function, setCurrentTime: Function,
 *   setIsPlaying: Function}} opts.report
 *   where progress, failure and the playhead go
 * @param {{isExporting: {current: boolean}, exportEndRef: {current: number},
 *   exportStartRef: {current: number}, requestFrameRef: {current: (() => void) | null},
 *   mediaRecorderRef: {current: MediaRecorder|null}}} opts.recording
 *   the same objects usePlayback is given, so the loop and the recorder agree
 */
export function useExport({ paint, audio, range, doc, report, recording }: ExportDeps) {
    const { canvasRef, paintFrameRef, currentTimeRef, renderStateRef, bitmapStoreRef, videoStopRef } = paint;
    const { audioRef, audioCtxRef, audioSourceRef, audioDestRef, audioUrl, audioData } = audio;
    const { playStart, playEnd, cw: CANVAS_W, ch: CANVAS_H, transparentBg, transparentFormat } = range;
    /**
     * The span to export: the one asked for, else the whole range. The dialog asks for one -
     * "let me set the start and the end" - and the defaults it shows are these same two numbers.
     * @param {{from?: number, to?: number} | undefined} r
     */
    const span = (r?: { from?: number, to?: number } | null): { from: number, to: number } => ({
        from: r && Number.isFinite(r.from) ? Math.max(0, r.from as number) : playStart,
        to: r && Number.isFinite(r.to) ? (r.to as number) : playEnd,
    });
    const { buildData, restore, invalidateCutsUsing, decodeFrameBitmap, paintFrame } = doc;
    const { setLoadProgress, setAppError, setToast, setCurrentTime, setIsPlaying } = report;
    const { isExporting, exportEndRef, exportStartRef, requestFrameRef, mediaRecorderRef } = recording;

    // Transparency cannot survive the recorder. Chrome hands VP9 to the hardware encoder above
    // roughly 480p, and that encoder has no alpha channel - measured here, the background came back
    // solid black at 1920x1080 while the same code kept it transparent at 640x360. WebCodecs is no
    // way out either: VideoEncoder reports alpha 'keep' unsupported for vp8 and vp9 alike.
    //
    // So a transparent project exports as a PNG sequence, which is what an editor wants for an
    // overlay anyway. Drawing each frame deliberately rather than recording one in real time also
    // means no dropped or duplicated frames, and it waits for pasted bitmaps to decode instead of
    // holding the previous frame the way playback does.
    /**
     * Put one painted canvas into the file being written.
     *
     * The two formats want opposite things from the same canvas: a GIF wants raw pixels, scaled
     * down, because a full-size GIF is tens of megabytes a second and going through a PNG and
     * back would cost an encode and a decode a frame for nothing. A PNG sequence wants the file
     * itself, full size, because it is going into an editor.
     *
     * @param {GifWriter|ZipWriter} writer
     * @param {HTMLCanvasElement} src the canvas as just painted
     * @param {number} i frame number across the whole export, so a queue keeps counting
     */
    const captureFrame = async (writer: GifWriter | ZipWriter, src: HTMLCanvasElement, i: number, { gif, gw, gh, scratch, total }: { gif: boolean, gw: number, gh: number, scratch: CanvasSlot, total: number }) => {
        // Scaled whenever the canvas is not already the output size. That is the same condition
        // as "the GIF was scaled down" for a single project, and it is also what makes a queue of
        // pieces work: each piece has its own canvas size, and a file has one.
        const needsFit = src.width !== gw || src.height !== gh;
        let from: HTMLCanvasElement = src;
        if (needsFit) {
            const { canvas: fitted, ctx: fctx } = scratchCanvas(scratch, gw, gh);
            fctx.imageSmoothingQuality = 'high';
            fctx.drawImage(src, 0, 0, gw, gh);
            from = fitted;
        }
        if (gif) {
            // Straight off the canvas as pixels: going through a PNG and back would cost an
            // encode and a decode a frame for nothing.
            (writer as GifWriter).addFrame(from.getContext('2d')!.getImageData(0, 0, gw, gh).data);
            return;
        }
        const blob = await new Promise<Blob | null>(res => from.toBlob(res, 'image/png'));
        if (!blob) throw new Error('toBlob returned nothing');
        (writer as ZipWriter).add(frameName(i, total), new Uint8Array(await blob.arrayBuffer()));
    };

    /**
     * Paint a range and hand each finished frame to `capture`.
     *
     * Split out from the export below because the multi-piece export (#123) runs it once per
     * piece into one shared writer. Nothing here knows what is being written, which is what lets
     * a second piece carry on into the same file.
     *
     * Frames are painted with the app's own paint path rather than a second renderer built for
     * exporting. A parallel renderer is a thing that agrees with the real one until it quietly
     * does not, and the first anyone hears of it is an export that looks wrong.
     */
    const renderFrameRange = async ({ from, to, fps, capture, onProgress, indexBase = 0 }: { from: number, to: number, fps: number, capture: (src: HTMLCanvasElement, i: number) => Promise<void>, onProgress?: (done: number) => void, indexBase?: number }): Promise<number> => {
        const canvas = canvasRef.current; if (!canvas) return 0;
        const count = Math.max(1, Math.round((to - from) * fps));
        for (let i = 0; i < count; i++) {
            const t = from + i / fps;
            // Read per frame, not once: between pieces the whole document changes underneath this.
            const live = renderStateRef.current;
            // Wait for what this frame needs rather than painting without it.
            const scene = evaluateFrame(live.cuts, t, { playing: true, currentCutId: live.currentCutId, cw: live.cw, ch: live.ch });
            const missing = pendingBitmapIds(scene.cuts.map(e => e.cut), bitmapStoreRef.current);
            if (missing.length) {
                const store = bitmapStoreRef.current;
                for (const id of missing) {
                    const e = store.get(id); if (!e || !e.blob) continue;
                    try { e.imageBitmap = await decodeFrameBitmap(e); } catch { }
                }
                invalidateCutsUsing(missing);
            }
            paintFrameRef.current?.(t, true);
            await capture(canvas, indexBase + i);
            // Yield often enough that the progress bar moves and the tab stays answerable.
            if (i % 5 === 0 || i === count - 1) {
                onProgress?.(indexBase + i + 1);
                await new Promise(res => setTimeout(res, 0));
            }
        }
        return count;
    };

    /**
     * Ask for files, and resolve with what was chosen - or nothing, if the dialog was dismissed.
     *
     * A plain input rather than showOpenFilePicker: this needs several files at once, and it has
     * to work on the tablet, where the picker API is not there. `cancel` fires on browsers that
     * have it; where it does not, the promise settles when the dialog is used, and a dismissed
     * dialog simply leaves it pending until the page goes - which costs nothing, since nothing is
     * held open waiting for it.
     *
     * @param {string} accept
     * @param {boolean} [multiple]
     * @returns {Promise<File[]>}
     */
    const pickFiles = (accept: string, multiple = false) => new Promise<File[]>((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.multiple = multiple;
        inp.onchange = () => resolve([...(inp.files || [])]);
        inp.oncancel = () => resolve([]);
        inp.click();
    });

    /**
     * Export several separately-made projects as one file (#123).
     *
     * Past a certain number of cuts the app lags, so the advice is to work in pieces - which is
     * only worth saying if combining them is easy. This is the combining.
     *
     * The design in one line: **a piece is a temporary tab.** Opening a document, painting it and
     * putting it back is what tab switching already does, and it does it with buildData and
     * restore, both of which are here. So the queue snapshots what is open, opens each piece in
     * turn, paints its frames straight into one writer, and puts the original document back at
     * the end.
     *
     * That gets two things for free. Peak memory stays at one piece, which is the whole reason
     * for splitting. And the frames come out of the app's own paint path, so there is no second
     * renderer to drift from the first - which is what a headless exporter would have been.
     *
     * The output is the size of the document that is open now. It needs no lookahead, and it is a
     * number the user can see before they start; a piece of another size is fitted to it.
     */
    const handleExportPieces = async () => {
        const canvas = canvasRef.current; if (!canvas) return;
        const files = await pickFiles('.emv', true);
        if (!files.length) return;

        // Planned once, from the document that is open: a file has one frame size and each
        // piece has its own canvas. Planning per piece would give a 16:9 piece the same answer
        // and a square one a different one, which is a file no decoder opens.
        const { gif, fps, gw, gh, delayMs } = frameExportPlan({ format: transparentFormat, cw: CANVAS_W, ch: CANVAS_H });
        const scratch: CanvasSlot = { current: null };
        // Frame names are padded to a fixed width rather than to the real total, because the total
        // is not known until every piece has been opened - and opening them twice, once to measure
        // and once to draw, is the cost this whole feature exists to avoid. Five digits sorts
        // correctly up to a hundred thousand frames, which is an hour at thirty a second.
        const NAME_WIDTH = 99999;

        let snapshot: any = null;
        try {
            snapshot = await buildData(true, null, true);
        } catch (e: any) {
            setAppError(tr('현재 작업을 저장할 수 없어 내보내기를 시작하지 않았습니다: ') + (e?.message || String(e)));
            return;
        }

        const label = tr('조각 내보내는 중');
        isExporting.current = true;
        videoStopRef.current = false;
        const writer: GifWriter | ZipWriter = gif ? new GifWriter({ width: gw, height: gh, delayMs }) : new ZipWriter();
        let written = 0;
        let opened = 0;
        try {
            for (let p = 0; p < files.length; p++) {
                setLoadProgress({ label: `${label} (${p + 1}/${files.length})`, done: written, total: 0 });
                const text = await files[p].text();
                let doc: any;
                try { doc = JSON.parse(text); }
                catch { throw new Error(tr('{0}: 읽을 수 없는 파일입니다', files[p].name)); }
                if (!await restore(doc)) throw new Error(tr('{0}: 열 수 없습니다', files[p].name));
                opened++;
                // restore dispatches; the refs the renderer reads are written during the render
                // that follows. Yielding a macrotask lets that render happen, so the first frame
                // of this piece is this piece.
                await new Promise(res => setTimeout(res, 0));
                // The range comes from the document rather than from playStart, which is state and
                // is still the previous piece's until React re-renders.
                const { start, end } = pieceRange({ cuts: doc.cuts, audio: doc.audio, video: doc.video });
                if (end <= start) continue;   // an empty piece contributes nothing, and no gap
                written += await renderFrameRange({
                    from: start, to: end, fps, indexBase: written,
                    capture: (src: HTMLCanvasElement, i: number) => captureFrame(writer, src, i, { gif, gw, gh, scratch, total: NAME_WIDTH }),
                    onProgress: (done: number) => setLoadProgress({ label: `${label} (${p + 1}/${files.length})`, done, total: 0 }),
                });
            }
            if (!written) throw new Error(tr('내보낼 콘텐츠가 없습니다.'));
            const bytes = writer.finish();
            const { type, name } = exportFileInfo(gif, { gif: 'mv_pieces', zip: 'mv_pieces' });
            downloadBlob(new Blob([bytes], { type }), name);
            setToast(tr('완료!'));
        } catch (e: any) {
            setAppError(tr('내보내기 실패: ') + (e && e.message ? e.message : String(e)));
        } finally {
            isExporting.current = false;
            // Put back what was open. Only if a piece actually replaced it - restoring a snapshot
            // over the document it was taken from is work for nothing, and it would also throw
            // away an undo history the user still has.
            if (opened) {
                try { await restore(snapshot, null, tr('작업 내용 복구 중')); }
                catch (e: any) { setAppError(tr('내보내기는 끝났지만 원래 작업을 되돌리지 못했습니다: ') + (e?.message || String(e))); }
            }
            setLoadProgress(null);
            paintFrame(currentTimeRef.current, false);
        }
    };

    /** @param {{from?: number, to?: number}} [r] */
    const handleExportFrames = async (r?: { from?: number, to?: number } | null) => {
        const canvas = canvasRef.current; if (!canvas) return;
        // By default the range playback uses, so what you watch is what comes out: it starts at
        // the first cut rather than at zero, and it follows the selected part the way playback
        // and the dimming already do. Exporting from zero meant a project whose first cut sits at
        // three seconds began with three seconds of nothing.
        const { from, to } = span(r);
        // The rates, the scale and the frame count are all in core/frameExport, with the
        // reasoning behind each. The queue above plans through the same function.
        const { gif, fps, gw, gh, delayMs, total, empty } = frameExportPlan({ format: transparentFormat, cw: CANVAS_W, ch: CANVAS_H, from, to });
        if (empty) { setToast(tr('내보낼 콘텐츠가 없습니다.')); return; }
        // One scratch canvas for the whole export rather than one a frame.
        const gifScratch: CanvasSlot = { current: null };
        if (total > LONG_EXPORT_FRAMES && !confirm(tr('{0}프레임을 내보냅니다. 오래 걸립니다. 계속할까요?').replace('{0}', String(total)))) return;

        const label = tr('프레임 내보내는 중');
        setLoadProgress({ label, done: 0, total });
        isExporting.current = true;
        const writer: GifWriter | ZipWriter = gif ? new GifWriter({ width: gw, height: gh, delayMs }) : new ZipWriter();
        try {
            await renderFrameRange({
                from, to, fps,
                capture: (src: HTMLCanvasElement, i: number) => captureFrame(writer, src, i, { gif, gw, gh, scratch: gifScratch, total }),
                onProgress: (done: number) => setLoadProgress({ label, done, total }),
            });
            const bytes = writer.finish();
            const { type, name } = exportFileInfo(gif);
            downloadBlob(new Blob([bytes], { type }), name);
            setToast(tr('완료!'));
        } catch (e: any) {
            setAppError(tr('내보내기 실패: ') + (e && e.message ? e.message : String(e)));
        } finally {
            isExporting.current = false;
            setLoadProgress(null);
            paintFrame(currentTimeRef.current, false);
        }
    };

    /** @param {{from?: number, to?: number}} [r] the span, or the whole range when omitted */
    const handleExport = (r?: { from?: number, to?: number } | null) => {
        if (transparentBg) { handleExportFrames(r); return; }
        const { from: playStart, to: playEnd } = span(r);
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (typeof canvas.captureStream !== 'function' || typeof window.MediaRecorder === 'undefined') {
            setAppError(tr('이 환경에서는 내보내기를 지원하지 않습니다.\nPC 브라우저(Chrome 등)에서 실행해 주세요.')); return;
        }
        // Same range as the frame export and as playback. This used to be its own third answer
        // to "where does the content end" - cuts and audio, but not the reference video, which is
        // on the canvas being recorded.
        if (playEnd <= playStart) { setToast(tr('내보낼 콘텐츠가 없습니다.')); return; }
        const { mimeType, ext } = pickRecordingType((t: string) => MediaRecorder.isTypeSupported(t));
        // Deliberately still a blocking dialog: dismissing it is what starts the recording, so
        // the user gets a moment to be ready. A toast would begin recording with nobody looking.
        // It becomes a real confirm dialog with the other blocking ones.
        alert(tr('녹화가 시작됩니다.'));
        // The loop reads its clock from the ref, and the ref only follows state while paused -
        // and isPlaying goes true in the same render. Left to state alone the loop started at
        // wherever the playhead was, the recorder ran from that moment, and the frames only
        // began once the clock reached the export start: the music led the picture by the gap.
        setCurrentTime(playStart); currentTimeRef.current = playStart;
        if (audioRef.current) audioRef.current.currentTime = audioData ? Math.max(0, (playStart - audioData.startTime) + audioData.offset) : playStart;
        // Frames on request rather than sampled at 30Hz off a 60Hz paint loop - that sampling
        // put two paints in one frame and three in the next, which is the judder in #156. The
        // loop paints on the frame grid and asks for each frame itself (usePlayback).
        const { stream, requestFrame } = frameSource(canvas, EXPORT_FPS);
        requestFrameRef.current = requestFrame;
        exportStartRef.current = playStart;
        const tracks: MediaStreamTrack[] = [...stream.getVideoTracks()];
        if (audioRef.current && audioUrl && !audioSourceRef.current) { try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext!)(); audioDestRef.current = audioCtxRef.current.createMediaStreamDestination(); audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current); audioSourceRef.current.connect(audioDestRef.current); audioSourceRef.current.connect(audioCtxRef.current.destination); } catch { } }
        if (audioDestRef.current) tracks.push(...audioDestRef.current.stream.getAudioTracks());
        // Monitoring mute is about this sitting, not about the film. The recorder taps the same
        // element, so leaving it muted would hand it silence and the video would come out with
        // no music - and nothing would say so. Lifted for the recording and put back after.
        const wasMuted = !!audioRef.current?.muted;
        if (wasMuted) audioRef.current!.muted = false;
        const unmute = () => { if (wasMuted && audioRef.current) audioRef.current.muted = true; };

        let mr: MediaRecorder;
        try {
            mr = startRecorder(tracks, mimeType, (blob) => {
                downloadBlob(blob, `mv_export.${ext}`);
                setToast(tr('완료!'));
                isExporting.current = false; requestFrameRef.current = null;
                unmute();
            }, {
                // Asked for explicitly: the browser's own choice is about 2.5 Mbps whatever the
                // canvas size, which starves a 1080p drawing (#229).
                videoBitsPerSecond: videoBitrate({ width: canvas.width, height: canvas.height, fps: EXPORT_FPS, mimeType }),
                audioBitsPerSecond: AUDIO_BITRATE,
            });
        } catch (e: any) { unmute(); setAppError(tr('녹화를 시작할 수 없습니다: ') + e.message); return; }
        exportEndRef.current = playEnd; isExporting.current = true; mediaRecorderRef.current = mr; setIsPlaying(true);
    };

    return { handleExport, handleExportFrames, handleExportPieces };
}
