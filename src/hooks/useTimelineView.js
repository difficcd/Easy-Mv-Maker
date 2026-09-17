import { useEffect, useRef, useState } from 'react';

// How the timeline is being looked at: how far it is zoomed in, which part of it is on screen,
// and the two things drawn over it while a drag is happening.
//
// The visible window is the load-bearing part. A film of a few hundred cuts is tens of thousands
// of DOM nodes if every cut block and ruler tick is rendered, which stalls the whole app - not
// just the timeline. So only what is within one screen either side of the scroll position is
// rendered, and `win` is that range in pixels.
//
// It is recomputed on a frame rather than on the scroll event, because scroll fires far more
// often than the screen updates and each recompute re-renders the timeline.
//
// Two effects rather than one, because they answer to different things. The first re-subscribes
// when the element itself comes or goes - the timeline is unmounted while the panels are folded,
// so the listener has to be attached to whatever element comes back. The second only recomputes,
// for the changes that make the content wider without the element moving: a zoom, a longer film,
// another track.

/**
 * @param {object} opts
 * @param {{current: HTMLElement|null}} opts.timelineRef the scrolling container
 * @param {boolean} opts.mounted whether that container is on screen at all
 * @param {number} opts.height re-measure when the panel is resized
 * @param {number} opts.maxTime
 * @param {number} opts.numTracks
 */
export function useTimelineView({ timelineRef, mounted, height, maxTime, numTracks }) {
    /** Pixels per second: the zoom. Saved with the document. */
    const [pps, setPps] = useState(50);
    /** The same value for handlers that must not close over a stale one. */
    const ppsRef = useRef(50);
    ppsRef.current = pps;

    /** The visible px window of the horizontally-scrolled timeline. */
    const [win, setWin] = useState({ left: 0, right: 4000 });
    const rafRef = useRef(0);

    /** The playhead is being dragged; playback and the canvas both behave differently. */
    const [scrubbing, setScrubbing] = useState(false);
    /** Where to draw the snap guide while a cut is dragged or resized, or null. */
    const [snapLinePos, setSnapLinePos] = useState(/** @type {number|null} */(null));

    useEffect(() => {
        const el = timelineRef.current; if (!el) return;
        const update = () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                const pad = el.clientWidth || 2000;   // one screen of margin each side
                setWin({ left: el.scrollLeft - pad, right: el.scrollLeft + (el.clientWidth || 2000) + pad });
            });
        };
        update();
        el.addEventListener('scroll', update, { passive: true });
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => { el.removeEventListener('scroll', update); ro.disconnect(); cancelAnimationFrame(rafRef.current); };
    }, [mounted, height, timelineRef]);

    // Keep the window sensible when zoom or content changes the scrollable width.
    useEffect(() => {
        const el = timelineRef.current; if (!el) return;
        const pad = el.clientWidth || 2000;
        setWin({ left: el.scrollLeft - pad, right: el.scrollLeft + (el.clientWidth || 2000) + pad });
    }, [pps, maxTime, numTracks, timelineRef]);

    return { pps, setPps, ppsRef, win, scrubbing, setScrubbing, snapLinePos, setSnapLinePos };
}
