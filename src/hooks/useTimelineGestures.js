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

const DRAG_SLOP = 5;   // mouse travel before a click becomes a marquee drag
const TAP_SLOP = 4;    // finger travel before a tap becomes a pan
const RULER_OFFSET = 60; // the track labels occupy the left edge; time starts after them
const MIN_PPS = 10, MAX_PPS = 300;

export function useTimelineGestures({
    timelineRef, tlTouchRef, tlPinchRef,
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
        return (clientX - rect.left + el.scrollLeft - RULER_OFFSET) / pps;
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

    /** Run a drag on window listeners, so it survives the pointer leaving the timeline. */
    const dragOnWindow = (onMove, onUp) => {
        const mv = (ev) => onMove(ev);
        const up = (ev) => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            onUp?.(ev);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
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

    const onTimelinePointerDown = (e) => {
        if (e.pointerType !== 'touch') {
            if (e.target.closest?.('.ruler')) startTimelineScrub(e);
            else startMarqueeOrSeek(e);
            return;
        }
        const el = timelineRef.current;
        tlTouchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (tlTouchRef.current.size === 2) {
            const [a, b] = [...tlTouchRef.current.values()];
            const midX = (a.x + b.x) / 2;
            const contentX = midX - el.getBoundingClientRect().left + el.scrollLeft - RULER_OFFSET;
            // The time under the midpoint is remembered so the zoom can hold it in place.
            tlPinchRef.current = {
                mode: 'pinch',
                startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                startPps: pps,
                anchorTime: Math.max(0, contentX / pps),
            };
        } else if (tlTouchRef.current.size === 1) {
            tlPinchRef.current = { mode: 'pan', startClientX: e.clientX, startClientY: e.clientY, startScroll: el ? el.scrollLeft : 0, moved: false };
        }
    };

    const onTimelinePointerMove = (e) => {
        if (e.pointerType !== 'touch' || !tlTouchRef.current.has(e.pointerId)) return;
        tlTouchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const el = timelineRef.current;
        if (!el) return;
        const p = tlPinchRef.current;
        if (tlTouchRef.current.size >= 2 && p?.mode === 'pinch') {
            const [a, b] = [...tlTouchRef.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const np = Math.max(MIN_PPS, Math.min(MAX_PPS, p.startPps * (dist / p.startDist)));
            setPps(np);
            // Scroll so the anchor time stays under the midpoint; without this the timeline slides
            // away from the fingers as it zooms.
            const midX = (a.x + b.x) / 2;
            el.scrollLeft = Math.max(0, p.anchorTime * np + RULER_OFFSET - (midX - el.getBoundingClientRect().left));
            e.preventDefault();
        } else if (tlTouchRef.current.size === 1 && p?.mode === 'pan') {
            const dx = e.clientX - p.startClientX;
            if (Math.abs(dx) > TAP_SLOP || Math.abs(e.clientY - p.startClientY) > TAP_SLOP) p.moved = true;
            el.scrollLeft = Math.max(0, p.startScroll - dx);
            e.preventDefault();
        }
    };

    const onTimelinePointerUp = (e) => {
        if (e.pointerType !== 'touch') return;
        const p = tlPinchRef.current;
        const wasTap = tlTouchRef.current.size === 1 && p?.mode === 'pan' && !p.moved;
        const upX = e.clientX;
        tlTouchRef.current.delete(e.pointerId);
        if (wasTap) seekToClientX(upX);
        if (tlTouchRef.current.size === 1) {
            // Lifting one finger of a pinch leaves the other one panning - starting from where it
            // is now, and already counted as moved so the release is not mistaken for a tap.
            const el = timelineRef.current;
            const [a] = [...tlTouchRef.current.values()];
            tlPinchRef.current = { mode: 'pan', startClientX: a.x, startClientY: a.y, startScroll: el ? el.scrollLeft : 0, moved: true };
        } else if (tlTouchRef.current.size === 0) {
            tlPinchRef.current = null;
        }
    };

    return {
        seekToTime, seekToClientX, goToScene, sceneTimelineTimes,
        startTimelinePan, startTimelineScrub, startMarqueeOrSeek,
        onTimelinePointerDown, onTimelinePointerMove, onTimelinePointerUp,
    };
}
