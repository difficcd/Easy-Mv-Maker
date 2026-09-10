import { useState } from 'react';
import { useStored } from './useStored.js';
import { arrayCodec, onOffCodec } from '../core/persist.js';
import { clampBrush } from '../core/brushSize.js';
import { RECENT_SLOTS } from '../ui/ColorPanel';

/**
 * What the pen is set to: which tool, what colour, how wide, how hard.
 *
 * Twenty-eight names, and the whole group reads only four things it does not own - and three of
 * those exist for one guard, `handleSetTool`. That is what a settings cluster looks like: it is
 * read from everywhere and written from almost nowhere, which is the opposite shape from the
 * drawing code that consumes it. Drawing touches fifty-three App names and cannot leave; this
 * touches four.
 *
 * Two derived values are here rather than at their call sites, because both were being
 * recomputed by hand and getting it wrong:
 *
 * - `etool` — the tool actually in effect. Ruler and Air are each two tools behind one button,
 *   and everything downstream wants the answer, not the pair.
 * - `toolSize` / `setToolSize` — the eraser keeps its own width, so switching to it and back does
 *   not lose the size you were drawing with. Every caller would otherwise have to ask which tool
 *   it is before reading or writing a width.
 *
 * @param {object} deps
 * @param {() => boolean} deps.busy true while something must not be interrupted by a tool change
 *   - a selection floating, a text being edited
 * @param {() => void} deps.leaveCurve finish an open curve, since leaving the Ruler abandons it.
 *   Carries its own "is there one" test: committing nothing still clears the live overlay, and
 *   doing that on every tool switch would wipe a stroke in progress.
 */
export function useToolSettings({ busy, leaveCurve }) {
    const [tool, setTool] = useState('pen');
    const [rulerMode, setRulerMode] = useState('line'); // the Ruler tool's two options: line and curve
    const [softMode, setSoftMode] = useState('soft');   // the Air tool's two options: airbrush and blur
    // The logic downstream still works in terms of "line" and "curve"; the Ruler tool just picks
    // between them by mode.
    const etool = tool === 'ruler' ? rulerMode : tool === 'soft' ? softMode : tool;

    const [color, setColor] = useState('#000000');
    // Recent colours only collect colours actually used, not ones merely selected.
    // See noteColorUsed below.
    const [recentColors, setRecentColors] = useStored('mv_recent_colors', [], arrayCodec);
    const [pickingColor, setPickingColor] = useState(false); // eyedropper: next canvas click samples a pixel
    const applyColor = (c) => { if (!c) return; setColor(c); };
    // "Used" means something was actually drawn in that colour; only then does it join Recent.
    const noteColorUsed = (c) => {
        if (!c) return;
        setRecentColors(p => (p[0] && p[0].toLowerCase() === c.toLowerCase())
            ? p
            : [c, ...p.filter(x => x.toLowerCase() !== c.toLowerCase())].slice(0, RECENT_SLOTS));
    };
    // Eyedropper: native picker where available, else sample the canvas on the next click.
    const pickColor = async () => {
        if (window.EyeDropper) { try { const r = await new window.EyeDropper().open(); applyColor(r.sRGBHex); } catch { } }
        else setPickingColor(true);
    };

    const [brushSize, setBrushSize] = useState(5);
    // Pen pressure. Off means an even line however hard the pen is pressed - wanted for lineart,
    // and for pens that report pressure unevenly.
    const [pressureOn, setPressureOn] = useStored('mv_pressure', true, onOffCodec);
    const [eraserSize, setEraserSize] = useState(20);
    const [opacity, setOpacity] = useState(1.0);
    const [mosaicBlock, setMosaicBlock] = useState(14); // mosaic block size (px)
    const toolSize = tool === 'eraser' ? eraserSize : brushSize;
    const setToolSize = (n) => { const v = clampBrush(n); if (tool === 'eraser') setEraserSize(v); else setBrushSize(v); };

    const handleSetTool = (newTool) => {
        if (busy()) return;
        // Switching tools mid-curve commits it automatically.
        if (newTool !== 'ruler') leaveCurve();
        setTool(newTool);
    };

    return {
        tool, setTool, etool, rulerMode, setRulerMode, softMode, setSoftMode, handleSetTool,
        color, setColor, applyColor, recentColors, noteColorUsed, pickColor, pickingColor, setPickingColor,
        brushSize, setBrushSize, eraserSize, setEraserSize, toolSize, setToolSize,
        opacity, setOpacity, pressureOn, setPressureOn, mosaicBlock, setMosaicBlock,
    };
}
