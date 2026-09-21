// Recording a path with the pen: a camera move, a part's motion path, its sway curve, or the
// mosaic rectangle. All four are the same gesture - press, drag, lift - and differ only in
// what the finished points are turned into, which is why they share a hook rather than each
// owning a branch of App's pointer handlers.
//
// The capture states live here (they used to be two useStates in App), but App still hands
// them to the panels that turn a capture on, so they come back out by their old names.

import { useState } from 'react';
import { preparePath } from '../core/pathMotion.ts';
import { curveToWave } from '../core/sway.ts';
import { clampRegion } from '../canvas/pixelEffects.js';
import { setCutCamera } from '../core/cutsReducer.js';
import { tr } from '../i18n.js';

/**
 * @param {object} deps
 * @param {any} deps.gesture the shared gesture refs (useGesture); the points go in `pathPts`
 * @param {(action: any) => void} deps.dispatchCuts
 * @param {(cutId: any, layerId: any, patch: any) => void} deps.updLayerAnim
 * @param {{setToast: (s: string) => void}} deps.notices
 * @param {number} deps.cw
 * @param {number} deps.ch
 */
export function usePathCapture({ gesture, dispatchCuts, updLayerAnim, notices, cw, ch }) {
    /** {cutId, layerId, mode?} while recording a part's path, sway curve or mosaic rectangle. */
    const [pathCapture, setPathCapture] = useState(/** @type {any} */ (null));
    /** {cutId} while drawing a camera path. */
    const [cameraCapture, setCameraCapture] = useState(/** @type {any} */ (null));

    /** True while a press should record points rather than draw. */
    const active = !!(cameraCapture || pathCapture);

    /** The press: the first point. */
    const begin = (e, pos) => {
        gesture.begin(e);
        gesture.pathPts.current = [pos];
        e.preventDefault();
    };

    /** A move while recording. False when nothing is being recorded. */
    const move = (pos) => {
        if (!gesture.pathPts.current) return false;
        gesture.pathPts.current.push(pos);
        return true;
    };

    /**
     * The lift: the points become whatever was being recorded. False when nothing was.
     */
    const end = () => {
        if (!gesture.pathPts.current) return false;
        const pts = gesture.pathPts.current;
        gesture.pathPts.current = null;
        gesture.end();
        if (cameraCapture) {
            // Evened out the same way a part path is, and for the same reason: the camera walks
            // it by index, so uneven points would replay the drawing speed. A camera doing that
            // is far more obvious than a part doing it, because the whole frame lurches rather
            // than one drawing.
            const path = preparePath(pts);
            if (path.length > 1) dispatchCuts(setCutCamera(cameraCapture.cutId, { path }));
            setCameraCapture(null);
            return true;
        }
        if (pathCapture && pts.length > 1) {
            if (pathCapture.mode === 'mosaicRect') {
                // The whole drag, not its two ends: a rectangle dragged out by hand is what the
                // pointer covered, and the bounding box of that is forgiving about a curved
                // drag or a slip at the end.
                const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                const x = Math.min(...xs), y = Math.min(...ys);
                const rect = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
                // Refused rather than stored when it is too small to pixelate - an accidental
                // tap would otherwise set a region that shows nothing and give no clue why the
                // effect stopped.
                if (clampRegion(rect, cw, ch)) {
                    updLayerAnim(pathCapture.cutId, pathCapture.layerId, { mosaicRect: rect });
                } else {
                    notices.setToast(tr('영역이 너무 작습니다'));
                }
            } else if (pathCapture.mode === 'sway') {
                // Sway from a drawn curve: the curve is stored as a waveform, and how far it
                // actually swung becomes the default strength.
                const w = curveToWave(pts);
                if (w) updLayerAnim(pathCapture.cutId, pathCapture.layerId, { swayCurve: w.wave, swayAmount: Math.max(1, Math.round(w.amp / 4)) });
                else alert(tr('거의 직선이라 흔들림을 만들 수 없습니다. 물결치듯 그려보세요.'));
            } else {
                // Evened out before it is stored, not while it is played. The renderer walks
                // the path by index, so equal spacing is what makes the motion a constant speed
                // instead of a replay of how fast the pen was moving at each point.
                const path = preparePath(pts);
                if (path.length > 1) updLayerAnim(pathCapture.cutId, pathCapture.layerId, { path });
            }
        }
        setPathCapture(null);
        return true;
    };

    return { pathCapture, setPathCapture, cameraCapture, setCameraCapture, active, begin, move, end };
}
