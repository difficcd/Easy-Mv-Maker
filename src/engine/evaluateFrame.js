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

import { computeCutAnim, computeLayerAnim, computeTextAnim, flattenLayersInUiOrder, safeArray, cutProgress } from '../canvas/canvasUtils.js';
import { computeCamera } from '../core/camera.js';
import { clipGroups } from '../core/clipping.js';
import { visibleCutsAt } from './selectCuts.js';

/**
 * @typedef {object} EvaluatedGroup
 * @property {Layer} base the layer the group composites onto
 * @property {Layer[]} clipped layers showing only where the base has paint, UI order
 * @property {any} anim the base layer's transform for this instant, or null
 */

/**
 * @typedef {object} EvaluatedCut
 * @property {Cut} cut
 * @property {any} anim cut-level animation for this instant, or null when paused
 * @property {EvaluatedGroup[]} groups visible layers, grouped by clipping, UI order
 * @property {{text: CutText, anim: any}[]} texts visible texts with their animation
 */

/**
 * @typedef {object} Scene
 * @property {{cx: number, cy: number, zoom: number, rot: number} | null} camera
 * @property {EvaluatedCut[]} cuts bottom track first, which is drawing order
 */

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
export function evaluateFrame(cuts, t, { playing, currentCutId, cw, ch }) {
    const active = visibleCutsAt(cuts, t, currentCutId, playing);

    // A shot belongs to the cut on the lowest active track: that is the base scene, and the tracks
    // above it are parts of the same shot rather than shots of their own.
    const camCut = playing ? active.find(c => c.camera) : null;
    const camera = camCut ? computeCamera(camCut.camera, cutProgress(camCut, t), cw, ch) : null;

    return {
        camera,
        cuts: active.map(cut => ({
            cut,
            anim: playing ? computeCutAnim(cut, t, cw, ch) : null,
            groups: evaluateGroups(cut, t, playing, cw, ch),
            texts: evaluateTexts(cut, t, playing),
        })),
    };
}

/** @returns {EvaluatedGroup[]} */
function evaluateGroups(cut, t, playing, cw, ch) {
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

/** @returns {{text: CutText, anim: any}[]} */
function evaluateTexts(cut, t, playing) {
    return safeArray(cut.texts)
        .filter(x => x && x.visible !== false)
        .map(text => ({ text, anim: playing ? computeTextAnim(text, cut, t) : null }))
        // A text faded to nothing is dropped here rather than drawn transparent, so the renderer
        // does not measure and lay out something invisible.
        .filter(x => !(x.anim && x.anim.alpha <= 0.001));
}
