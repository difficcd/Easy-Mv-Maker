// Every way the timeline can be pointed at, in one place.
//
// There are five, and which one a press becomes depends on the input device and where it landed:
//
//   mouse/pen on the ruler        scrub the playhead
//   mouse/pen on the track area   rubber-band select cuts, or seek if it turns out to be a click
//   middle button anywhere        pan
//   one finger                    pan, or seek if it turns out to be a tap
//   two fingers                   pinch-zoom, anchored under the fingers
//
// Spread through the component these read as unrelated handlers and the overlaps are invisible -
// the click/drag distinction appears twice with different thresholds, and the touch cases have to
// agree with each other about what the pinch state means.
//
// The drags listen on the window rather than the element, so a gesture that leaves the timeline
// keeps working and still ends when the button comes up somewhere else.
//
// Touch is handled by native listeners in the capture phase rather than by React handlers on the
// timeline root. A cut block stops propagation of its pointerdown so that it can be dragged, and
// a bubbling handler on the root therefore never saw a finger that landed on a cut - a pinch
// over the cuts, which is where the fingers usually are, did nothing. There used to be two
// implementations because of that: React handlers here, and a capture listener in App that
// stopped propagation first and so was the only one that ever ran. This is the one now.

import { useEffect, useRef } from 'react';
import { timeAtX, pinchZoom } from '../core/timelineZoom.js';
import { dragOnWindow } from '../core/windowDrag.js';

const DRAG_SLOP = 5;   // mouse travel before a click becomes a marquee drag
const TAP_SLOP = 4;    // finger travel before a tap becomes a pan

export function useTimelineGestures({
    timelineRef, timelineMounted,
    cuts, currentCutId, setCurrentCutId, maxTime,
    pps, setPps,
    setCurrentTime, currentTimeRef, isPlayingRef, seekRef,
    audioRef, audioUrl, audioData,
    setScrubbing, setMarquee, selectedCutIds, setSelectedCutIds,
    videoOverlay,
}) {
    /** Move the playhead to an absolute time, bringing the audio and the current cut with it. */
    const seekToTime = (time) => {
        const t = Math.min(maxTime, Math.max(0, time));
        setCurrentTime(t);
        currentTimeRef.current = t;
        // While playing, hand the target to the rAF loop instead of fighting it: the loop re-seeks
        // the audio and carries on from there.
        if (isPlayingRef.current) seekRef.current = t;
        else if (audioRef.current && audioUrl) {
            try { audioRef.current.currentTime = audioData ? Math.max(0, (t - audioData.startTime) + audioData.offset) : t; } catch { }
        }
        // Tracks stack, so when several cuts cover this instant the topmost one wins.
        const active = cuts.filter(c => t >= c.startTime && t < c.endTime);
        if (active.length) setCurrentCutId(active.reduce((p, c) => p.track > c.track ? p : c).id);
    };

    /** Time under a page x coordinate, accounting for the scroll and the label gutter. */
    const timeAtClientX = (clientX) => {
        const el = timelineRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return timeAtX(el.scrollLeft, clientX - rect.left, pps);
    };
    const seekToClientX = (clientX) => {
        const t = timeAtClientX(clientX);
        if (t != null) seekToTime(t);
    };

    // Scene-cut markers, in timeline time rather than video time.
    const sceneTimelineTimes = () => (Array.isArray(videoOverlay?.cuts) ? videoOverlay.cuts : [])
        .map(vt => (videoOverlay.cutStart || 0) + (vt - (videoOverlay.cutOffset || 0)))
        .filter(t => t >= 0)
        .sort((a, b) => a - b);

    const goToScene = (dir) => {
        const times = sceneTimelineTimes();
        if (!times.length) return;
        // The small margin stops "next" finding the marker the playhead is already sitting on.
        const cur = currentTimeRef.current ?? 0;
        const target = dir > 0 ? times.find(t => t > cur + 0.02) : [...times].reverse().find(t => t < cur - 0.02);
        if (target != null) seekToTime(target);
    };

    // Middle-click pan. Handled in the capture phase by the caller so it works wherever the press
    // lands, cuts included, and the browser's own auto-scroll never starts.
    const startTimelinePan = (e) => {
        if (e.button !== 1) return;
        const el = timelineRef.current;
        if (!el) return;
        e.preventDefault(); e.stopPropagation();
        const sx = e.clientX, sy = e.clientY, sl = el.scrollLeft, st = el.scrollTop;
        el.style.cursor = 'grabbing';
        dragOnWindow(
            (ev) => {
                el.scrollLeft = Math.max(0, sl - (ev.clientX - sx));
                el.scrollTop = Math.max(0, st - (ev.clientY - sy));
                ev.preventDefault();
            },
            () => { el.style.cursor = ''; },
        );
    };

    // Drag-to-scrub. Cuts and their handles stop propagation, so this only reaches the ruler.
    const startTimelineScrub = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        // Scrubbing renders as though playing. paintFrame only evaluates cut, part and text
        // animation when told it is playing, so without this a scrub showed static artwork
        // sliding past instead of the animation at that instant.
        setScrubbing(true);
        seekToClientX(e.clientX);
        dragOnWindow(ev => seekToClientX(ev.clientX), () => setScrubbing(false));
    };

    // Track area: rubber-band select, or - if the pointer never really moved - seek.
    const startMarqueeOrSeek = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const el = timelineRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const sx = e.clientX - rect.left + el.scrollLeft;
        const sy = e.clientY - rect.top + el.scrollTop;
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        const base = additive ? new Set(selectedCutIds) : new Set();
        const downX = e.clientX, downY = e.clientY;
        let dragging = false;

        dragOnWindow(
            (ev) => {
                const cx = ev.clientX - rect.left + el.scrollLeft;
                const cy = ev.clientY - rect.top + el.scrollTop;
                if (!dragging && Math.abs(cx - sx) < DRAG_SLOP && Math.abs(cy - sy) < DRAG_SLOP) return;
                dragging = true;
                setMarquee({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) });
                // Hit-tested against the rendered blocks rather than recomputed from times, so it
                // agrees with what is on screen whatever the zoom and scroll are.
                const l = Math.min(downX, ev.clientX), r = Math.max(downX, ev.clientX);
                const t = Math.min(downY, ev.clientY), b = Math.max(downY, ev.clientY);
                const sel = new Set(base);
                el.querySelectorAll('.cut-block[data-cutid]').forEach(node => {
                    const nr = node.getBoundingClientRect();
                    if (nr.right >= l && nr.left <= r && nr.bottom >= t && nr.top <= b) {
                        const cut = cuts.find(c => String(c.id) === node.getAttribute('data-cutid'));
                        if (cut) sel.add(cut.id);
                    }
                });
                setSelectedCutIds(sel);
                if (sel.size) { const first = [...sel][0]; if (first !== currentCutId) setCurrentCutId(first); }
            },
            () => {
                setMarquee(null);
                if (!dragging) {
                    if (!additive) setSelectedCutIds(new Set());
                    seekToClientX(downX);
                }
            },
        );
    };

    /** A mouse or pen press on the timeline root. Fingers never reach here; see the effect. */
    const onTimelinePointerDown = (e) => {
        if (e.pointerType === 'touch') return;
        if (e.target.closest?.('.ruler')) startTimelineScrub(e);
        else startMarqueeOrSeek(e);
    };

    // Fingers: one pans, or seeks if it turns out to be a tap; two pinch-zoom about the point
    // between them. Capture phase, so a finger that lands on a cut block is still seen - a
    // block stops propagation for its own drag, which is right for a mouse and would otherwise
    // hide every pinch that starts over the cuts. A single finger on a block is left to the
    // block (it drags the cut), but still counts towards a pinch.
    //
    // Re-attached whenever the timeline is shown again: it is inside `showBottom &&`, so hiding
    // it unmounts the element, and listeners on the old node would be silently dead.
    // Read at event time through a ref, so the listeners see the current pps and seek without
    // being re-attached on every render; only the element's identity decides that.
    const latest = useRef(null);
    latest.current = { pps, seekToClientX };
    useEffect(() => {
        const el = timelineRef.current;
        if (!el) return;
        const pts = new Map();          // pointerId -> {x, y, onBlock}
        let gesture = null;             // {mode: 'pan', ...} | {mode: 'pinch', ...} | null
        const fingers = () => [...pts.values()];
        const down = (e) => {
            if (e.pointerType !== 'touch') return;
            const onBlock = !!e.target.closest?.('.cut-block, .rh, button');
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY, onBlock });
            if (pts.size === 2) {
                const [a, b] = fingers();
                const midX = (a.x + b.x) / 2 - el.getBoundingClientRect().left;
                // The time under the midpoint is remembered so the zoom can hold it in place.
                gesture = { mode: 'pinch', startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startPps: latest.current.pps, anchorTime: Math.max(0, timeAtX(el.scrollLeft, midX, latest.current.pps)) };
                e.preventDefault(); e.stopPropagation();
            } else if (pts.size === 1 && !onBlock) {
                gesture = { mode: 'pan', startClientX: e.clientX, startClientY: e.clientY, startScroll: el.scrollLeft, moved: false };
            }
        };
        const move = (e) => {
            if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
            const prev = pts.get(e.pointerId);
            pts.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });
            if (pts.size >= 2 && gesture?.mode === 'pinch') {
                const [a, b] = fingers();
                // Scroll so the anchor time stays under the midpoint; without this the timeline
                // slides away from the fingers as it zooms.
                const r = pinchZoom(gesture, Math.hypot(a.x - b.x, a.y - b.y), (a.x + b.x) / 2 - el.getBoundingClientRect().left);
                setPps(r.pps);
                el.scrollLeft = r.scrollLeft;
                e.preventDefault(); e.stopPropagation();
            } else if (pts.size === 1 && gesture?.mode === 'pan') {
                const dx = e.clientX - gesture.startClientX;
                if (Math.abs(dx) > TAP_SLOP || Math.abs(e.clientY - gesture.startClientY) > TAP_SLOP) gesture.moved = true;
                el.scrollLeft = Math.max(0, gesture.startScroll - dx);
                e.preventDefault();
            }
        };
        const up = (e) => {
            if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
            const wasTap = pts.size === 1 && gesture?.mode === 'pan' && !gesture.moved;
            const upX = e.clientX;
            pts.delete(e.pointerId);
            if (wasTap) latest.current.seekToClientX(upX);
            if (pts.size === 1) {
                // Lifting one finger of a pinch leaves the other one panning - from where it is
                // now, and already counted as moved so the release is not mistaken for a tap.
                const [a] = fingers();
                gesture = { mode: 'pan', startClientX: a.x, startClientY: a.y, startScroll: el.scrollLeft, moved: true };
            } else if (pts.size === 0) {
                gesture = null;
            }
        };
        const opt = { capture: true, passive: false };
        el.addEventListener('pointerdown', down, opt);
        el.addEventListener('pointermove', move, opt);
        el.addEventListener('pointerup', up, opt);
        el.addEventListener('pointercancel', up, opt);
        return () => {
            el.removeEventListener('pointerdown', down, opt);
            el.removeEventListener('pointermove', move, opt);
            el.removeEventListener('pointerup', up, opt);
            el.removeEventListener('pointercancel', up, opt);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timelineMounted]);

    return {
        seekToTime, seekToClientX, goToScene, sceneTimelineTimes,
        startTimelinePan, startTimelineScrub, startMarqueeOrSeek,
        onTimelinePointerDown,
    };
}
