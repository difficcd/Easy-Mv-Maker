// Where the camera is looking, at a given moment in a cut.
//
// The camera is a window onto the artwork rather than something drawn into it: it has a centre
// (the point in canvas coordinates that lands in the middle of the frame) and a zoom. Everything
// composited for the cut goes through one transform derived from those two numbers, so the video
// reference, the drawing and the text all move together the way a real camera move does.
//
// Two ways to drive it, because they answer different needs. A drawn path is for a move nobody
// can name - follow this arc, past that, settle here - and reuses the pen the rest of the app is
// built around. Presets are for the moves that come up constantly in a music video, where drawing
// a straight line by hand would only make it crooked.
//
// The one thing worth knowing before reading the presets: a pan at zoom 1 shows the edge of the
// artwork. There is nothing outside the canvas, so moving the window sideways slides blank paper
// into frame. Every preset that moves the centre therefore zooms in first, and the amount is
// chosen so the travel stays inside what the zoom buys.

import { applyEase, samplePath } from '../canvas/canvasUtils.js';

/** No camera at all: the default, and what every existing project has. */
export const CAMERA_DEFAULT = {
    preset: 'none',
    /** Points in canvas coordinates. Overrides the preset's own path when present. */
    path: null,
    // null, not 1. A preset carries its own zoom, and a default of 1 here would be a real value
    // that silently overrode it - picking "zoom in" would produce no zoom at all. null means
    // "whatever the preset says"; a number means the user set it and it wins.
    zoomFrom: null,
    zoomTo: null,
    /** Degrees, applied about the frame centre. Small values only - this is a tilt, not a spin. */
    rotFrom: 0,
    rotTo: 0,
    ease: 'inout',
    easePower: 2,
};

/**
 * The smallest zoom at which a camera may sit `drift` off centre without the frame running off
 * the artwork - where drift is a fraction of the frame, so 0.04 means four percent of the width.
 *
 * Worth deriving rather than picking by eye. The first draft of the ken burns preset had a drift
 * its own zoom could not cover, and the frame showed blank paper for the first fifth of the move;
 * the tests caught it, but only because the constraint happened to be written down as one. Now
 * the presets cannot disagree with it, because they ask.
 *
 * @param {number} drift largest offset from centre, as a fraction of the frame
 * @returns {number}
 */
export function zoomForDrift(drift) {
    const d = Math.max(0, Math.min(0.49, drift));
    return 1 / (1 - 2 * d);
}

// How far a pan preset travels, as a fraction of the frame. A third of the width reads as a
// deliberate move at typical cut lengths; more than that and it becomes the subject.
const PAN_TRAVEL = 1 / 3;
const PAN_ZOOM = zoomForDrift(PAN_TRAVEL / 2);

// Ken Burns drifts a few percent each way while it pushes in.
const KB_DRIFT_X = 0.04, KB_DRIFT_Y = 0.03;

/**
 * The fixed moves. Each returns the same shape a hand-drawn camera produces, so nothing
 * downstream has to know which one it came from.
 *
 * Keyed by id; the label is a translation key resolved by the UI.
 */
export const CAMERA_PRESETS = {
    none: { label: '없음', build: () => null },

    zoomIn: {
        label: '줌 인',
        build: (cw, ch) => ({ path: [{ x: cw / 2, y: ch / 2 }], zoomFrom: 1, zoomTo: 1.25 }),
    },
    zoomOut: {
        label: '줌 아웃',
        build: (cw, ch) => ({ path: [{ x: cw / 2, y: ch / 2 }], zoomFrom: 1.25, zoomTo: 1 }),
    },

    panLeft: {
        label: '왼쪽으로',
        build: (cw, ch) => panPreset(cw, ch, +1, 0),
    },
    panRight: {
        label: '오른쪽으로',
        build: (cw, ch) => panPreset(cw, ch, -1, 0),
    },
    panUp: {
        label: '위로',
        build: (cw, ch) => panPreset(cw, ch, 0, +1),
    },
    panDown: {
        label: '아래로',
        build: (cw, ch) => panPreset(cw, ch, 0, -1),
    },

    // The staple: a slow push in with a little drift, so a still drawing stops looking still.
    kenBurns: {
        label: '켄 번스',
        build: (cw, ch) => ({
            path: [
                { x: cw / 2 - cw * KB_DRIFT_X, y: ch / 2 + ch * KB_DRIFT_Y },
                { x: cw / 2 + cw * KB_DRIFT_X, y: ch / 2 - ch * KB_DRIFT_Y },
            ],
            // The start is the tight case: it is the widest the frame ever gets, and it is
            // already off centre. Asking keeps the two numbers from drifting apart later.
            zoomFrom: zoomForDrift(Math.max(KB_DRIFT_X, KB_DRIFT_Y)),
            zoomTo: 1.25,
        }),
    },
};

/**
 * A pan across the frame in one direction, with the zoom that keeps the edges out of shot.
 * `dx`/`dy` are -1, 0 or +1 and point at where the camera STARTS, so panLeft starts on the right.
 */
function panPreset(cw, ch, dx, dy) {
    const rx = (cw * PAN_TRAVEL) / 2, ry = (ch * PAN_TRAVEL) / 2;
    return {
        path: [
            { x: cw / 2 + dx * rx, y: ch / 2 + dy * ry },
            { x: cw / 2 - dx * rx, y: ch / 2 - dy * ry },
        ],
        zoomFrom: PAN_ZOOM,
        zoomTo: PAN_ZOOM,
    };
}

/**
 * Resolve a camera setting into the path and zoom range actually used.
 *
 * A drawn path wins over the preset's own, so somebody can pick "ken burns" for its zoom and then
 * replace the movement without losing the zoom.
 *
 * @param {typeof CAMERA_DEFAULT | null | undefined} cam
 * @param {number} cw @param {number} ch
 * @returns {{path: {x:number,y:number}[], zoomFrom: number, zoomTo: number, rotFrom: number, rotTo: number} | null}
 */
export function resolveCamera(cam, cw, ch) {
    if (!cam) return null;
    const preset = CAMERA_PRESETS[cam.preset]?.build(cw, ch) || null;
    const drawn = Array.isArray(cam.path) && cam.path.length > 0 ? cam.path : null;
    const path = drawn || preset?.path || null;

    // Explicit values on the camera win; otherwise the preset's, otherwise no change at all.
    const zoomFrom = num(cam.zoomFrom, preset?.zoomFrom, 1);
    const zoomTo = num(cam.zoomTo, preset?.zoomTo, 1);
    const rotFrom = num(cam.rotFrom, 0, 0);
    const rotTo = num(cam.rotTo, 0, 0);

    // Nothing to do is worth detecting: it lets the renderer skip the transform entirely rather
    // than multiplying by an identity matrix on every frame of every cut that has no camera.
    const still = (!path || path.length < 2) && zoomFrom === 1 && zoomTo === 1 && rotFrom === 0 && rotTo === 0;
    if (still) return null;

    return { path: path || [{ x: cw / 2, y: ch / 2 }], zoomFrom, zoomTo, rotFrom, rotTo };
}

/** First of the three that is an actual number: the user's value, the preset's, then the base. */
const num = (v, fallback, base) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
    return base;
};

/**
 * Where the camera is at a normalised time through the cut.
 *
 * @param {typeof CAMERA_DEFAULT | null | undefined} cam
 * @param {number} t01 0 at the start of the cut, 1 at the end
 * @param {number} cw @param {number} ch
 * @returns {{cx: number, cy: number, zoom: number, rot: number} | null} null when there is no
 *   camera move, so the caller skips the transform rather than applying an identity
 */
export function computeCamera(cam, t01, cw, ch) {
    const r = resolveCamera(cam, cw, ch);
    if (!r) return null;

    // Eased once and used for everything, so the position, the zoom and the tilt stay in step.
    // Easing them separately is what makes a move feel like two moves.
    const p = applyEase(Math.max(0, Math.min(1, t01)), cam.ease ?? 'inout', cam.easePower ?? 2);

    const c = r.path.length > 1 ? samplePath(r.path, p) : r.path[0];
    return {
        cx: c.x,
        cy: c.y,
        zoom: r.zoomFrom + (r.zoomTo - r.zoomFrom) * p,
        rot: (r.rotFrom + (r.rotTo - r.rotFrom) * p) * Math.PI / 180,
    };
}

/**
 * Put the camera onto a 2D context. The caller owns the save/restore.
 *
 * Reads as: move the origin to the middle of the frame, scale and tilt about it, then shift so
 * the camera's centre is the thing sitting there.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{cx:number, cy:number, zoom:number, rot:number}} cam
 * @param {number} cw @param {number} ch
 */
export function applyCamera(ctx, cam, cw, ch) {
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(cam.zoom, cam.zoom);
    if (cam.rot) ctx.rotate(cam.rot);
    ctx.translate(-cam.cx, -cam.cy);
}
