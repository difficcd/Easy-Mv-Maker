// Where the panels are and how wide they are.
//
// Three panels - tools, colour, cut/layer - each of which can sit in the left dock, the right
// dock, or its own floating window, each draggable between those by its header and resizable by a
// splitter. Plus the timeline's height, which is the same kind of thing.
//
// This is pure geometry: it reads nothing about the document. Not cuts, not layers, not the
// canvas, not what is on the timeline. That is what makes it separable at all - the panels
// themselves are built in App with their own props, and this only says where to put them and how
// wide they are. A hook that returned the panels would need every prop each one takes, which is
// most of App, and would have moved the tangle rather than reduced it.
//
// What stays in App: `panelOpen`, because which panels are open is decided by the menus and the
// left dock's tabs, both of which live elsewhere; and the JSX that mounts a panel into a slot.

import { useState, useEffect } from 'react';
import { useStored } from './useStored.js';
import { dragOnWindow } from '../core/windowDrag.js';

/** The element each panel's markup is rooted in, for finding which one a header belongs to. */
const PANEL_ROOTS = { color: '.color-panel', tools: '.toolbar', cut: '.right-panel' };

/** How close to an edge counts as dropping into that dock. Wide enough to hit on a tablet. */
const DOCK_BAND = 140;

const TIMELINE_H_MIN = 100;
const TIMELINE_H_MAX = 600;

/**
 * @param {object} opts
 * @param {readonly string[]} opts.panelIds every panel that can be docked
 * @param {Record<string, number[]>} opts.widthRange each panel's [min, max] width
 */
export function usePanelLayout({ panelIds, widthRange }) {
    const [rightW, setRightW] = useState(270);
    const [leftW, setLeftW] = useState(96);
    const [colorW, setColorW] = useState(200);
    const [timelineH, setTimelineH] = useState(240);
    // The drag in progress: {type:'panel'|'bottom', …} while a splitter is held, else null.
    const [splitter, setSplitter] = useState(/** @type {any} */(null));

    const [docks, setDocks] = useStored('mv_docks', { tools: 'left', color: 'left', cut: 'right' }, {
        // A layout stored by a version that docked differently is treated as absent rather than
        // restored into a shape this one cannot lay out.
        decode: (raw) => { const v = JSON.parse(raw); return v && ['left', 'right', 'float'].includes(v.tools) ? v : undefined; },
        encode: JSON.stringify,
    });
    const [floatPos, setFloatPos] = useStored('mv_floats',
        { tools: { x: 120, y: 120 }, color: { x: 160, y: 160 }, cut: { x: 200, y: 200 } }, {
        decode: (raw) => { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : undefined; },
        encode: JSON.stringify,
    });
    const [panelDrag, setPanelDrag] = useState(/** @type {any} */(null));

    // The tool strip has a floor of its own, below which its icons do not fit. Applied to the
    // displayed width rather than the stored one, so widening it again returns to what was stored.
    const toolW = Math.max(widthRange.tools?.[0] ?? 56, leftW || 96);
    const panelWidth = { color: colorW, tools: toolW, cut: rightW };

    /** Which dock a pointer position means; anywhere in the middle means "pull it out". */
    const dropZoneAt = (x) => (x < DOCK_BAND ? 'left' : x > window.innerWidth - DOCK_BAND ? 'right' : 'float');

    // Header drag is delegated from main-content rather than wired into each panel, so ColorPanel
    // and CutLayerPanel keep their own markup and know nothing about docking.
    const onDockPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const head = e.target.closest?.('.panel-head');
        if (!head) return;
        if (e.target.closest('button, input, select, textarea')) return;   // ✕ and controls still work
        const id = panelIds.find(p => head.closest(PANEL_ROOTS[p]));
        if (!id) return;
        e.preventDefault();
        const host = head.closest(PANEL_ROOTS[id]).getBoundingClientRect();
        const grab = { dx: e.clientX - host.left, dy: e.clientY - host.top };
        setPanelDrag({ id, x: e.clientX, y: e.clientY, zone: dropZoneAt(e.clientX), ...grab });
        const mv = (ev) => setPanelDrag(d => d && ({ ...d, x: ev.clientX, y: ev.clientY, zone: dropZoneAt(ev.clientX) }));
        dragOnWindow(mv, (ev) => {
            const zone = dropZoneAt(ev.clientX);
            setPanelDrag(null);
            setDocks(d => ({ ...d, [id]: zone }));
            if (zone === 'float') setFloatPos(p => ({ ...p, [id]: { x: Math.max(0, ev.clientX - grab.dx), y: Math.max(0, ev.clientY - grab.dy) } }));
        });
    };

    /** Begin resizing a docked panel. `side` is the edge it is docked to, which decides the sign. */
    const startPanelResize = (id, side, clientX) =>
        setSplitter({ type: 'panel', id, side, startX: clientX, startW: panelWidth[id] });

    /** Begin resizing the timeline. It grows upward, so its sign is the opposite of a panel's. */
    const startBottomResize = (clientY) =>
        setSplitter({ type: 'bottom', startY: clientY, startH: timelineH });

    // The drag runs on the window rather than on the splitter, so a gesture that leaves the
    // element keeps working and still ends when the button comes up somewhere else. Movement is
    // measured from the grab point, so the panel does not jump on the first move.
    useEffect(() => {
        if (!splitter) return;
        const mv = (e) => {
            if (splitter.type === 'panel') {
                // A left-docked panel grows as the pointer moves right; a right-docked one is the
                // mirror image, so the sign follows the side it is docked to.
                const delta = splitter.side === 'left' ? (e.clientX - splitter.startX) : (splitter.startX - e.clientX);
                const [lo, hi] = widthRange[splitter.id] || widthRange.cut;
                const w = Math.max(lo, Math.min(hi, splitter.startW + delta));
                if (splitter.id === 'color') setColorW(w);
                else if (splitter.id === 'tools') setLeftW(w);
                else setRightW(w);
            }
            else if (splitter.type === 'bottom') {
                setTimelineH(Math.max(TIMELINE_H_MIN, Math.min(TIMELINE_H_MAX, splitter.startH + (splitter.startY - e.clientY))));
            }
        };
        return dragOnWindow(mv, () => setSplitter(null));
    }, [splitter, widthRange]);

    return {
        leftW, rightW, colorW, toolW, timelineH,
        setLeftW, setRightW, setColorW, setTimelineH,
        panelWidth, docks, floatPos, panelDrag,
        onDockPointerDown, startPanelResize, startBottomResize,
    };
}
