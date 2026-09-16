import { useRef, useState } from 'react';

/**
 * Which panels are on screen, and the Tab that folds them all away.
 *
 * Folding is not "close everything": the second press has to put back exactly what was open,
 * so what was open is remembered rather than recomputed. Two things make that harder than it
 * looks, and both are why this is a hook rather than four booleans:
 *
 *  - the timeline's scroll container is unmounted while the panels are folded, so it comes back
 *    a fresh element scrolled to zero - the view jumps to the start of the project rather than
 *    staying where the work was. Where it was looking is remembered too, and put back after the
 *    layout has happened;
 *  - the key handler subscribes once, so it calls through a ref rather than closing over a
 *    toggle that would freeze the panel state as it was on the first render.
 *
 * @param {{timelineRef: {current: HTMLElement | null}}} deps
 */
export function usePanelVisibility({ timelineRef }) {
    const [showLeft, setShowLeft] = useState(true);
    const [showRight, setShowRight] = useState(true);
    const [showBottom, setShowBottom] = useState(true);
    // Which panel is open in the left dock (null = closed); switched from the icon rail.
    const [leftDock, setLeftDock] = useState('color');

    const beforeHideRef = useRef(/** @type {{left: boolean, dock: string | null, right: boolean, bottom: boolean} | null} */(null));
    const scrollRef = useRef(/** @type {{left: number, top: number} | null} */(null));

    const toggleAllPanels = () => {
        const prev = beforeHideRef.current;
        if (prev) {
            beforeHideRef.current = null;
            setShowLeft(prev.left); setLeftDock(prev.dock); setShowRight(prev.right); setShowBottom(prev.bottom);
            // After the layout has been laid out again - the container does not exist until then.
            const want = scrollRef.current;
            if (want) requestAnimationFrame(() => requestAnimationFrame(() => {
                const el = timelineRef.current;
                if (el) { el.scrollLeft = want.left; el.scrollTop = want.top; }
            }));
        } else {
            const tl = timelineRef.current;
            scrollRef.current = tl ? { left: tl.scrollLeft, top: tl.scrollTop } : null;
            beforeHideRef.current = { left: showLeft, dock: leftDock, right: showRight, bottom: showBottom };
            setShowLeft(false); setLeftDock(null); setShowRight(false); setShowBottom(false);
        }
    };
    // Read at event time by the key handler, which subscribes once. The same ref trick paintFrame
    // uses, for the same reason.
    const toggleAllPanelsRef = useRef(/** @type {(() => void) | null} */(null));
    toggleAllPanelsRef.current = toggleAllPanels;

    return {
        showLeft, setShowLeft, showRight, setShowRight, showBottom, setShowBottom,
        leftDock, setLeftDock, toggleAllPanels, toggleAllPanelsRef,
        /** Which panels the dock should render, by id. */
        panelOpen: { color: leftDock === 'color', tools: showLeft, cut: showRight },
    };
}
