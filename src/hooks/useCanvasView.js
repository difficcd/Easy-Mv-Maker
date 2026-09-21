import { useEffect, useRef, useState } from 'react';
import { zoomAbout, pinchedView } from '../core/viewZoom.ts';
import { dragOnWindow } from '../core/windowDrag.ts';

/**
 * How the canvas is looked at: its zoom and offset, and every way of changing them.
 *
 *   space + drag, or the middle button   pan (mouse or pen)
 *   plain wheel                          zoom about the cursor
 *   one finger                           pan
 *   two fingers                          pinch-zoom, plus pan by the midpoint
 *   buttons and shortcuts                zoom about the centre, or reset
 *
 * Fingers never draw (palm rejection), so a finger on the canvas area is always navigation.
 * The maths of zooming about a point and of a pinch is core/viewZoom; this owns the state and
 * the gestures.
 *
 * `lastInteractRef` is the time of the last zoom or pan. The paint loop reads it to hold the
 * boiling preview still for a moment right after one, so the picture is not re-rasterising
 * while it is also moving.
 *
 * @param {{canvasAreaRef: import('react').MutableRefObject<HTMLElement | null>}} deps
 */
export function useCanvasView({ canvasAreaRef }) {
    const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
    const [spaceDown, setSpaceDown] = useState(false);   // space = pan (hand) mode
    const spaceDownRef = useRef(false);
    const panningRef = useRef(false);
    const lastInteractRef = useRef(0);
    const touchPtsRef = useRef(new Map());
    const pinchRef = useRef(null);

    const touched = () => { lastInteractRef.current = Date.now(); };

    /** Zoom about the centre of the view, for the buttons and shortcuts. */
    const zoomCanvas = (factor) => { touched(); setView(v => zoomAbout(v, factor)); };
    const resetView = () => setView({ zoom: 1, x: 0, y: 0 });

    // Space is the hand (pan) mode. Ignored while typing in a field, and the default is
    // suppressed only so the page does not scroll.
    useEffect(() => {
        const isTyping = () => {
            const a = document.activeElement;
            return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || /** @type {HTMLElement} */ (a).isContentEditable);
        };
        const down = (e) => {
            if (e.code !== 'Space' || e.repeat || isTyping()) return;
            e.preventDefault();
            spaceDownRef.current = true; setSpaceDown(true);
        };
        const up = (e) => {
            if (e.code !== 'Space') return;
            // keyup must be suppressed too, or space "clicks" whichever button has focus.
            if (!isTyping()) e.preventDefault();
            spaceDownRef.current = false; setSpaceDown(false);
        };
        // Reset on refocus so the key does not stay stuck down after leaving the window.
        const blur = () => { spaceDownRef.current = false; setSpaceDown(false); };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
    }, []);

    // Wheel zoom on the canvas (PC): anchored at the cursor so the point under it stays put.
    // Shift/Ctrl not required - plain wheel zooms, since the stage never scrolls. A native
    // listener because React's wheel handler is passive and cannot prevent the page scroll.
    useEffect(() => {
        const el = canvasAreaRef.current; if (!el) return;
        const h = (e) => {
            e.preventDefault();
            touched();
            const r = el.getBoundingClientRect();
            const cx = e.clientX - r.left - r.width / 2;
            const cy = e.clientY - r.top - r.height / 2;
            setView(v => zoomAbout(v, e.deltaY > 0 ? 0.9 : 1.1, cx, cy));
        };
        el.addEventListener('wheel', h, { passive: false });
        return () => el.removeEventListener('wheel', h);
        // The canvas area is mounted for the life of the app; the ref does not change identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Panning on desktop: hold space and drag, or drag with the middle button. Drawing is
    // blocked while space is held, so nothing is drawn.
    const startMousePan = (e) => {
        const sx = e.clientX, sy = e.clientY, sv = { ...view };
        panningRef.current = true;
        const mv = (ev) => { touched(); setView({ zoom: sv.zoom, x: sv.x + (ev.clientX - sx), y: sv.y + (ev.clientY - sy) }); ev.preventDefault(); };
        dragOnWindow(mv, () => { panningRef.current = false; });
    };
    const startFingerPan = () => {
        const [a] = [...touchPtsRef.current.values()];
        pinchRef.current = { mode: 'pan', startPt: { x: a.x, y: a.y }, startView: { ...view } };
    };

    const onAreaPointerDown = (e) => {
        if (e.pointerType !== 'touch') {
            if (spaceDownRef.current || e.button === 1) { e.preventDefault(); startMousePan(e); }
            return;
        }
        touchPtsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touchPtsRef.current.size === 2) {
            const [a, b] = [...touchPtsRef.current.values()];
            pinchRef.current = {
                mode: 'pinch',
                startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                startView: { ...view },
            };
        } else if (touchPtsRef.current.size === 1) {
            startFingerPan();
        }
    };
    const onAreaPointerMove = (e) => {
        if (e.pointerType !== 'touch' || !touchPtsRef.current.has(e.pointerId)) return;
        touchPtsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = pinchRef.current;
        if (touchPtsRef.current.size >= 2 && p?.mode === 'pinch') {
            const [a, b] = [...touchPtsRef.current.values()];
            touched();
            setView(pinchedView(p, a, b));
            e.preventDefault();
        } else if (touchPtsRef.current.size === 1 && p?.mode === 'pan') {
            const [a] = [...touchPtsRef.current.values()];
            touched();
            setView({ zoom: p.startView.zoom, x: p.startView.x + (a.x - p.startPt.x), y: p.startView.y + (a.y - p.startPt.y) });
            e.preventDefault();
        }
    };
    const onAreaPointerUp = (e) => {
        if (e.pointerType !== 'touch') return;
        touchPtsRef.current.delete(e.pointerId);
        if (touchPtsRef.current.size === 1) startFingerPan();   // one finger remains: resume panning
        else if (touchPtsRef.current.size === 0) pinchRef.current = null;
    };

    return {
        view, setView, zoomCanvas, resetView,
        spaceDown, spaceDownRef, panningRef, lastInteractRef,
        onAreaPointerDown, onAreaPointerMove, onAreaPointerUp,
    };
}
