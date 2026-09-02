// The playback clock.
//
// One requestAnimationFrame loop drives everything that moves: the canvas, the playhead, the
// audio element, the video overlay, the frame prefetcher, and - at a different rate - React.
// Export runs through the same loop, which is why it is here rather than beside the recorder.
//
// It owns six things App used to: the isPlaying and currentTime state, and the four refs the loop
// reads instead of state so it never runs on a stale closure. Everything else is an input, and
// the inputs are grouped by what they are rather than listed flat, because a playback loop really
// is a function of the timeline, the media and where to paint.
//
// Three rates, deliberately different:
//
//   every frame    the canvas and the playhead, written imperatively
//   ~8Hz           the frame prefetcher, which decodes ahead of the real playhead
//   ~5Hz           setCurrentTime, so React re-renders stay off the animation thread
//
// The last one is the reason currentTime is not simply state read by the loop: re-rendering at
// 60Hz starves the prefetcher and the video stutters.

import { useState, useRef, useEffect, useCallback } from 'react';
import { playbackStartFrom } from '../core/playbackStart.js';
import { xAtTime } from '../core/timelineZoom.js';

/**
 * @param {object} opts
 * @param {{audioRef: {current: HTMLAudioElement|null}, videoElRef: {current: HTMLVideoElement|null},
 *   audioUrl: string|null, audioData: any, videoOverlay: any}} opts.media
 *   the elements and what is loaded into them
 * @param {{playStart: number, playEnd: number, maxTime: number, loopPlay: boolean,
 *   playbackRate: number, anchorTime: number|undefined}} opts.range
 *   where playback runs, how fast, and where pressing play rewinds to
 * @param {{pps: number, playheadRef: {current: HTMLElement|null},
 *   paintFrameRef: {current: ((t: number, playing: boolean) => void) | null},
 *   prefetchRef: {current: ((t: number, playing: boolean) => void) | null}}} opts.paint
 *   where to draw each frame
 * @param {{isExporting: {current: boolean}, exportEndRef: {current: number},
 *   mediaRecorderRef: {current: MediaRecorder|null}}} opts.recording
 *   export state; playback runs at real time while recording, whatever speed is selected
 */
export function usePlayback({ media, range, paint, recording }) {
    const { audioRef, videoElRef, audioUrl, audioData, videoOverlay } = media;
    const { playStart, playEnd, maxTime, loopPlay, playbackRate, anchorTime } = range;
    const { pps, playheadRef, paintFrameRef, prefetchRef } = paint;
    const { isExporting, exportEndRef, mediaRecorderRef } = recording;

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);

    const reqRef = useRef(/** @type {number|null} */(null));
    const isPlayingRef = useRef(false);
    const currentTimeRef = useRef(0);     // the loop's clock, read instead of state to avoid a stale closure
    const seekRef = useRef(/** @type {number|null} */(null));  // a scrub while playing lands here

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        if (!isPlaying) {
            if (audioRef.current) audioRef.current.pause();
            // The video has to be stopped here too. Only `finish` paused it, which is the path
            // for reaching the end - stopping any other way left the element rolling. Nothing
            // showed it, because a paused canvas is not being repainted; the moment drawing began
            // the repaints resumed and the overlay was discovered to have been playing all along.
            if (videoElRef.current) videoElRef.current.pause();
            cancelAnimationFrame(reqRef.current);
            return;
        }
        // Export must record at real time; preview honors the chosen playback speed.
        const rate = isExporting.current ? 1 : playbackRate;
        const audio = audioRef.current;
        if (audio) audio.playbackRate = rate;
        let last = performance.now();
        let t = currentTimeRef.current;
        let lastUiSync = 0, lastPrefetch = 0;
        const audible = () => audio && audioUrl && (!audioData || (t >= audioData.startTime && t < audioData.endTime));
        // Kick audio once, seeking only at the start — not every frame (per-frame seeks stutter).
        if (audio && audioUrl) {
            if (audible()) { const exp = audioData ? (t - audioData.startTime) + audioData.offset : t; if (Math.abs(audio.currentTime - exp) > 0.05) audio.currentTime = exp; audio.play().catch(() => { }); }
        }
        // Video overlay follows the clock (audio stays the master). Seek only on real drift so the
        // browser's native video decode plays smoothly instead of stuttering on per-frame seeks.
        const vid = videoElRef.current;
        if (vid && videoOverlay) vid.playbackRate = rate;
        const syncVideo = (tt, forceSeek) => {
            if (!vid || !videoOverlay) return;
            if (tt >= videoOverlay.startTime && tt < videoOverlay.endTime) {
                const exp = (tt - videoOverlay.startTime) + videoOverlay.offset;
                if (forceSeek || Math.abs(vid.currentTime - exp) > 0.2) { try { vid.currentTime = exp; } catch { } }
                if (vid.paused) vid.play().catch(() => { });
            } else if (!vid.paused) vid.pause();
        };
        syncVideo(t, true);
        const finish = (end) => { isPlayingRef.current = false; setIsPlaying(false); if (audio) audio.pause(); if (vid) vid.pause(); setCurrentTime(end); currentTimeRef.current = end; paintFrameRef.current?.(end, false); };
        const step = (now) => {
            if (!isPlayingRef.current) return;
            const dt = (now - last) / 1000; last = now;
            // A scrub while playing drops a target time here; jump to it and re-seek audio this frame.
            if (seekRef.current != null) {
                t = seekRef.current; seekRef.current = null;
                if (audio && audioUrl) { const exp = audioData ? Math.max(0, (t - audioData.startTime) + audioData.offset) : t; try { audio.currentTime = exp; } catch { } }
                syncVideo(t, true);
                currentTimeRef.current = t;
                paintFrameRef.current?.(t, true);
                if (playheadRef.current) playheadRef.current.style.left = `${xAtTime(t, pps)}px`;
                reqRef.current = requestAnimationFrame(step);
                return;
            }
            // Audio is the master clock while it's sounding: read its time so A/V never drift and
            // we never seek it mid-play. Fall back to wall-clock accumulation otherwise.
            if (audio && audioUrl && audible()) {
                if (audio.paused) { const exp = audioData ? (t - audioData.startTime) + audioData.offset : t; audio.currentTime = exp; audio.play().catch(() => { }); }
                t = audioData ? audioData.startTime + (audio.currentTime - audioData.offset) : audio.currentTime;
            } else {
                if (audio && !audio.paused) audio.pause();
                t += dt * rate;
            }
            syncVideo(t, false);
            if (isExporting.current && t >= exportEndRef.current) {
                if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
                isExporting.current = false; finish(t); return;
            }
            const endAt = isExporting.current ? maxTime : playEnd;
            if (t >= endAt) {
                if (loopPlay && !isExporting.current) {
                    t = playStart;
                    if (audio && audioUrl) { audio.currentTime = audioData ? Math.max(0, (playStart - audioData.startTime) + audioData.offset) : playStart; if (audible()) audio.play().catch(() => { }); }
                } else { finish(endAt); return; }
            }
            currentTimeRef.current = t;
            paintFrameRef.current?.(t, true);                                   // 60fps imperative canvas
            if (playheadRef.current) playheadRef.current.style.left = `${xAtTime(t, pps)}px`; // 60fps imperative playhead
            if (now - lastPrefetch > 120) { lastPrefetch = now; prefetchRef.current?.(t, true); } // decode ahead of the REAL playhead
            if (now - lastUiSync > 200) { lastUiSync = now; setCurrentTime(t); } // ~5Hz React sync — keep re-renders off the rAF thread so prefetch keeps up
            reqRef.current = requestAnimationFrame(step);
        };
        reqRef.current = requestAnimationFrame(step);
        return () => cancelAnimationFrame(reqRef.current);
    }, [isPlaying, maxTime, audioUrl, audioData, loopPlay, playStart, playEnd, playbackRate, pps, videoOverlay]);

    // While paused the clock follows whatever set the time - a scrub, a cut click, opening a file.
    useEffect(() => { if (!isPlaying) currentTimeRef.current = currentTime; }, [currentTime, isPlaying]);

    /** Stop the loop and the audio now, without waiting for the effect to notice. */
    const halt = useCallback(() => {
        isPlayingRef.current = false;
        cancelAnimationFrame(reqRef.current);
        if (audioRef.current) audioRef.current.pause();
    }, [audioRef]);

    const playPause = useCallback(() => {
        if (!isPlaying) {
            // Where to start is worked out in playbackStart, which is where the reasoning about
            // "finished" versus "put there on purpose" lives.
            let anchor = anchorTime ?? playStart;
            if (anchor < playStart - 0.001 || anchor >= playEnd) anchor = playStart; // keep the anchor inside the active part
            const from = playbackStartFrom(currentTime, playStart, playEnd, anchor);
            if (Math.abs(from - currentTime) > 0.001) {
                setCurrentTime(from);
                currentTimeRef.current = from;
                if (audioRef.current) audioRef.current.currentTime = audioData ? Math.max(0, (from - audioData.startTime) + audioData.offset) : from;
            }
        } else {
            halt();
        }
        setIsPlaying(!isPlaying);
    }, [isPlaying, anchorTime, playStart, playEnd, currentTime, audioData, audioRef, halt]);

    /** Stop where the playhead is. Not a rewind - that surprised people who used it as a pause. */
    const stop = useCallback(() => {
        halt();
        setIsPlaying(false);
        // Keep the audio element aligned to the timeline position it stopped at.
        if (audioRef.current) audioRef.current.currentTime = currentTime;
    }, [halt, audioRef, currentTime]);

    return {
        isPlaying, setIsPlaying,
        currentTime, setCurrentTime,
        currentTimeRef, seekRef, isPlayingRef,
        playPause, stop,
    };
}
