// What the frame looks like at time t, before anything is drawn.
//
// Second piece of the scene engine. Selection said which cuts are in the frame; this says what
// state they are in - the cut's own animation, each layer group's, each text's, and where the
// camera is looking.
//
// The renderer currently answers those questions inline, in the middle of drawing, which has two
// costs. computeCutAnim is called twice per cut per frame, once in the layer pass and once in the
// text pass, because the two passes cannot see each other's work. And nothing that needs a frame
// without a canvas - export at a fixed frame rate, a thumbnail, a test - can ask for one.
//
// Everything here is pure and canvas-free. What stays in the renderer is the part that genuinely
// needs a context: compositing clip groups, slicing for sway, the selection mask, and leaving out
// a layer that the drag overlay is drawing instead.

import { computeCutAnim } from '../core/cutAnim.ts';
import { cutProgress } from '../core/cutTime.ts';
import { safeArray } from '../core/geometry.ts';
import { computeLayerAnim } from '../core/layerAnim.ts';
import { flattenLayersInUiOrder } from '../core/layerTree.ts';
import { computeTextAnim } from '../core/textAnim.ts';
import { computeCamera } from '../core/camera.ts';
import { clipGroups } from '../core/clipping.ts';
import { visibleCutsAt } from './selectCuts.ts';
import type { Id } from '../core/types.ts';
import type { CutAnimAt } from '../core/cutAnim.ts';
import type { LayerAnimAt } from '../core/layerAnim.ts';
import type { TextAnimAt } from '../core/textAnim.ts';
import type { CameraAt } from '../core/camera.ts';


/** One clipping group of a cut, resolved for an instant. */
export interface EvaluatedGroup {
    /** the layer the group composites onto */
    base: Layer;
    /** layers showing only where the base has paint, UI order */
    clipped: Layer[];
    /** the base layer's transform for this instant, or null */
    anim: LayerAnimAt | null;
}

/** A visible text with its animation for an instant. */
export interface EvaluatedText { text: CutText; anim: TextAnimAt | null }

/** One cut of the frame, resolved for an instant. */
export interface EvaluatedCut {
    cut: Cut;
    /** cut-level animation for this instant, or null when paused */
    anim: CutAnimAt | null;
    /** visible layers, grouped by clipping, UI order */
    groups: EvaluatedGroup[];
    /** visible texts with their animation */
    texts: EvaluatedText[];
}

/** What the frame looks like at one moment: the renderer's whole input. */
export interface Scene {
    /** the moment this scene is of, in seconds */
    time: number;
    camera: CameraAt | null;
    /** bottom track first, which is drawing order */
    cuts: EvaluatedCut[];
}

/**
 * Resolve the document to a frame.
 *
 * Animation is evaluated only while playing, which is not a shortcut - it is the rule the app is
 * built on. A cut sitting still at rest is what makes it drawable: if the canvas were showing a
 * mid-animation transform, the pen would land somewhere other than where the ink appears.
 *
 * @param {Cut[]} cuts
 * @param {number} t
 * @param {object} opts
 * @param {boolean} opts.playing
 * @param {any} opts.currentCutId the cut being edited, drawn even off the playhead while paused
 * @param {number} opts.cw @param {number} opts.ch canvas size
 * @returns {Scene}
 */
export function evaluateFrame(cuts: Cut[] | null | undefined, t: number, { playing, currentCutId, cw, ch }: { playing: boolean, currentCutId: Id, cw: number, ch: number }): Scene {
    const active = visibleCutsAt(cuts, t, currentCutId, playing);

    // A shot belongs to the cut on the lowest active track: that is the base scene, and the tracks
    // above it are parts of the same shot rather than shots of their own.
    const camCut = playing ? active.find(c => c.camera) : null;
    // Elapsed seconds as well as progress: the shake is per-second, so that one setting wobbles
    // at the same rate in a short cut and a long one.
    const camera = camCut ? computeCamera(camCut.camera, cutProgress(camCut, t), cw, ch, t - camCut.startTime) : null;

    return {
        // The moment this scene is of. The static needs seconds since its cut began, and the
        // renderer has no other way to know what t was.
        time: t,
        camera,
        cuts: active.map(cut => ({
            cut,
            anim: playing ? computeCutAnim(cut, t, cw, ch) : null,
            groups: evaluateGroups(cut, t, playing, cw, ch),
            texts: evaluateTexts(cut, t, playing),
        })),
    };
}

function evaluateGroups(cut: Cut, t: number, playing: boolean, cw: number, ch: number): EvaluatedGroup[] {
    const visible = flattenLayersInUiOrder(cut.layers || [])
        .filter(l => l.type === 'layer' && l.visible !== false);
    return clipGroups(visible).map(g => ({
        base: g.base,
        clipped: g.clipped,
        // The group's transform comes from its base. A clipped layer is paint on the base and
        // moves with it, which is the same reason the compositing happens before the transform.
        anim: playing ? computeLayerAnim(g.base, cut, t, cw, ch) : null,
    }));
}

function evaluateTexts(cut: Cut, t: number, playing: boolean): EvaluatedText[] {
    return safeArray<CutText>(cut.texts)
        .filter(x => x && x.visible !== false)
        .map(text => ({ text, anim: playing ? computeTextAnim(text, cut, t) : null }))
        // A text faded to nothing is dropped here rather than drawn transparent, so the renderer
        // does not measure and lay out something invisible.
        .filter(x => !(x.anim && x.anim.alpha <= 0.001));
}
