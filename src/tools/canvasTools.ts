import { shapePoints } from '../core/shapeStroke.ts';
import { patchLayer, appendPoints } from '../core/layerOps.ts';
import type { Id, PressurePoint } from '../core/types.ts';
import type { Gesture } from '../hooks/useGesture.ts';

/**
 * What every tool is handed on a press and on a move: the event and where it landed, the
 * document under it, the shared gesture refs, the overlay, the other tools, and App's writers.
 * Built by toolCtx in App.
 */
export interface ToolContext {
    e: any;
    pos: PressurePoint;
    layer: Layer | null;
    tool: string;
    /** the effective tool: the ruler's or the air tool's mode, else the tool itself */
    etool: string;
    cut: Cut | null | undefined;
    cutId: Id;
    gesture: Gesture;
    overlay: { renderStroke: (full?: boolean) => void; scheduleStroke: () => void; restartStroke: () => void; renderLasso: () => void };
    tools: { curve: any; liquify: any; mosaic: any };
    newStroke: (tool: string, points: PressurePoint[], e: any) => any;
    samplesOf: (e: any, pos: PressurePoint) => PressurePoint[];
    commitStrokeToLayer: (cutId: Id, layerId: Id, stroke: any) => void;
    updLayers: (cutId: Id, fn: (cut: Cut) => Partial<Cut>) => void;
    floodFillAt: (pos: PressurePoint, cut: Cut | null | undefined, layer: Layer | null) => void;
}
/** A tool's two halves. A tool with no `move` does everything on the press. */
export interface Tool { down?: (c: ToolContext) => void; move?: (c: ToolContext) => void }


// What each tool does when the pen goes down, and when it moves.
//
// One entry per tool, and every entry takes the same context object - see toolCtx in App for
// what is in it. The point of the table is not that a lookup is faster than a switch; it is that
// a tool's two halves are next to each other. They used to be a hundred and fifty lines apart in
// two separate switches, so half the tools had a `down` that nothing obviously matched.
//
// What is deliberately NOT here is the end of a gesture. That is decided by which gesture is
// actually in flight - a stroke, a lasso, a drag - and not by which tool is selected now, and
// the two can differ: a tool can be changed while the pen is down. Dispatching the end on the
// current tool would finish the wrong thing.
//
// Nor is anything that comes before a tool runs: palm rejection, the eyedropper, a floating
// selection, a text under the pointer. Those are modes that outrank every tool, so they are
// checked once in App before this table is consulted.

/** Pens and brushes: drawn on the overlay only, so a move costs no layer write and no render. */
const BRUSH: Tool = {
    down: (c) => {
        c.gesture.stroke.current = c.newStroke(c.etool, [c.pos], c.e);
        c.overlay.restartStroke();
    },
    move: (c) => {
        const positions = c.samplesOf(c.e, c.pos);
        if (c.gesture.stroke.current) {
            for (const p of positions) c.gesture.stroke.current.points.push(p);
            c.overlay.scheduleStroke();
            return;
        }
        // The eraser arrives here too, and it has no overlay stroke: it must composite against
        // the layer, so it is written straight to the layer instead. appendPoints replaces the
        // last stroke rather than pushing into it, so nothing already in state is mutated.
        c.updLayers(c.cutId, (cut: Cut) => ({
            layers: patchLayer(cut.layers, c.gesture.target.current, l => ({ strokes: appendPoints(l.strokes, positions) })),
        }));
    },
};

/**
 * Line, rectangle and ellipse. The start is pinned and only the end follows; the shape is
 * rebuilt from those two corners on every move, so what gets stored is an ordinary stroke. It
 * takes the brush, it boils with the layer, it erases and saves like any other line, and nothing
 * downstream has to learn that a rectangle exists.
 */
const SHAPE: Tool = {
    down: (c) => {
        c.gesture.lineStart.current = c.pos;
        c.gesture.stroke.current = c.newStroke('brush', shapePoints(c.etool, c.pos, c.pos) || [c.pos, { ...c.pos }], c.e);
        c.overlay.restartStroke();
    },
    move: (c) => {
        const { stroke, lineStart } = c.gesture;
        if (!stroke.current || !lineStart.current) return;
        stroke.current.points = shapePoints(c.etool, lineStart.current, c.pos) || [lineStart.current, c.pos];
        c.overlay.renderStroke(true);   // the far corner moved, so redraw the whole thing
    },
};

const LASSO: Tool = {
    down: (c) => { c.gesture.lasso.current = [c.pos]; c.overlay.renderLasso(); },
    move: (c) => {
        if (!c.gesture.lasso.current) return;
        c.gesture.lasso.current.push(c.pos);
        c.overlay.renderLasso();
    },
};

const MOSAIC: Tool = {
    down: (c) => c.tools.mosaic.begin(c.pos),
    move: (c) => { c.tools.mosaic.to(c.pos); },
};

const LIQUIFY: Tool = {
    down: (c) => { if (!c.tools.liquify.begin(c.cut, c.layer, c.pos)) c.gesture.end(); },
    // Every sample, not just the last per frame: the push is path-dependent, and skipping
    // samples straightens a curve the pen drew.
    move: (c) => { for (const p of c.samplesOf(c.e, c.pos)) c.tools.liquify.to(p); },
};

const ERASER: Tool = {
    // The eraser must composite against the layer, so it stays on the layer-write path rather
    // than the overlay. Through commitStrokeToLayer all the same, for the reveal: a pen stroke
    // on a hidden layer shows the layer, and the eraser had been the one tool that did not -
    // which is the harder of the two to notice, since an eraser leaves nothing to look for.
    down: (c) => c.commitStrokeToLayer(c.cutId, c.gesture.target.current, c.newStroke(c.tool, [c.pos], c.e)),
    move: BRUSH.move,
};

const FILL: Tool = {
    // A fill is a single act, not a drag.
    down: (c) => { c.gesture.drawing.current = false; c.floodFillAt(c.pos, c.cut, c.layer); },
};

/** The move tool's press is handled before the table; there is nothing left for it to do. */
const MOVE: Tool = { down: (c) => { c.gesture.drawing.current = false; } };

export const TOOLS: Record<string, Tool> = {};
const define = (names: string[], handlers: Tool) => { for (const n of names) TOOLS[n] = handlers; };

define(['pen', 'brush', 'pencil', 'soft', 'blur', 'marker'], BRUSH);
define(['line', 'rect', 'ellipse'], SHAPE);
define(['lasso'], LASSO);
define(['mosaic'], MOSAIC);
define(['liquify'], LIQUIFY);
define(['eraser'], ERASER);
define(['fill'], FILL);
define(['move'], MOVE);
