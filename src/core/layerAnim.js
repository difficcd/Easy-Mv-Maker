// A layer's (part's) animation at a moment: move, rotate, scale, path, keys, sway, effects.

import { CANVAS_H, CANVAS_W } from './canvasSize.ts';
import { cutProgress } from './cutTime.ts';
import { SWING, applyEase, effectAt, samplePath, swing } from './easing.ts';
import { sampleKeys } from './keyframes.ts';
import { swayWaveAt } from './sway.js';

export const LAYER_ANIM_DEFAULT = { mode: 'progress', speed: 1, count: 0, tx: 0, ty: 0, rot: 0, scale: 0, pivotX: 0.5, pivotY: 0.5, path: null, ease: 'linear', easePower: 2, swayAmount: 0, swaySpeed: 1, swayCurve: null, swayProfile: null, swayAxis: 'y', swayLag: 0, keys: null, mosaic: 0, mosaicMin: 0, mosaicFrom: 0, mosaicTo: 1, mosaicSpeed: 1, mosaicRect: null, noise: 0, noiseFrom: 0, noiseTo: 1, noiseColor: 0 };

/**
 * The mosaic block size at a moment in a cut, in pixels. Under 2 means no mosaic.
 *
 * @param {any} a a layer animation
 * @param {number} t01 progress through the cut
 * @param {number} prog the layer's eased progress, for `mode: 'return'`
 * @returns {number}
 */
export function mosaicBlockAt(a, t01, prog) {
    const max = a?.mosaic || 0;
    if (!(max > 0)) return 0;
    // There-and-back keeps using the shared swing, so the control that already says "come back"
    // goes on meaning that, and the window only says when the swing may happen.
    if (a.mode === 'return') {
        const lo = Math.max(0, Math.min(max, a.mosaicMin || 0));
        return lo + (max - lo) * Math.max(0, Math.min(1, prog));
    }
    return effectAt(t01, {
        from: a.mosaicFrom, to: a.mosaicTo, speed: a.mosaicSpeed,
        min: a.mosaicMin, max, ease: a.ease, easePower: a.easePower,
    });
}

export function computeLayerAnim(layer, ac, time, cw = CANVAS_W, ch = CANVAS_H) {
    const a = layer.anim;
    if (!a) return null;
    const t = cutProgress(ac, time);
    const speed = a.speed || 1, count = a.count || 0;
    const keys = Array.isArray(a.keys) && a.keys.length >= 2 ? a.keys : null;
    let tx, ty, rot, sc, alpha = 1, prog;
    if (keys) {
        // When keyframes exist they take over move, rotate, scale and opacity; the speed
        // multiplier only changes how fast they play.
        const k = sampleKeys(keys, Math.max(0, Math.min(1, t * speed)));
        tx = k.tx || 0; ty = k.ty || 0;
        rot = (k.rot || 0) * Math.PI / 180;
        sc = 1 + (k.scale || 0);
        alpha = Math.max(0, Math.min(1, k.op ?? 1));
        prog = t;
    } else {
        if (a.mode === 'return') prog = swing(SWING.through, t, speed, count);
        else prog = applyEase(t, a.ease, a.easePower);
        tx = (a.tx || 0) * prog; ty = (a.ty || 0) * prog;
        rot = (a.rot || 0) * prog * Math.PI / 180;
        sc = 1 + (a.scale || 0) * prog;
    }
    if (!keys && a.path && a.path.length > 1) {
        let s;
        if (a.mode === 'return') s = swing(SWING.along, t, speed, count);
        else s = applyEase(t, a.ease, a.easePower);
        const p0 = a.path[0], pt = samplePath(a.path, s);
        tx += pt.x - p0.x; ty += pt.y - p0.y;
    }
    // Continuous sway (hair/cloth): a horizontal shear that oscillates by absolute time and grows
    // toward the far end from the pivot — anchor the pivot at the top of the hair for a natural swing.
    // Sway 1 is a plain sine wave; sway 2 follows the waveform of a curve the user drew.
    const sway = a.swayAmount || 0;
    const wave = !sway ? 0 : swayWaveAt(time, a.swaySpeed, a.swayCurve);
    const shear = (sway / 100) * wave;
    // With a per-point profile, the bend varies along the axis instead of being a single shear.
    // The renderer handles it as a slice warp, so only the values it needs are passed on.
    const prof = (sway && Array.isArray(a.swayProfile) && a.swayProfile.length > 1) ? a.swayProfile : null;
    const axis = a.swayAxis === 'x' ? 'x' : 'y';
    // A profile weight of 1 equals the displacement the old shear produced at the end of the
    // axis, so the feel is unchanged.
    const swayDisp = prof ? (sway / 100) * wave * (axis === 'y' ? ch : cw) : 0;
    // Mosaic as an effect rather than a stamp: the block grows with the same eased progress the
    // move and the scale use, so "over the cut" and "there and back" mean the same thing here as
    // they do for everything else on this panel.
    const mosaic = mosaicBlockAt(a, t, prog);
    // Static is a gate, not a ramp: it is at its strength the moment its window opens. The
    // mosaic ramps because "gradually pixelate" is a thing; "gradually more broken signal" reads
    // as the strength control not working, which is how it was reported.
    const nf = Math.max(0, Math.min(1, a.noiseFrom ?? 0)), nt = Math.max(nf, Math.min(1, a.noiseTo ?? 1));
    const noise = (a.noise > 0 && t >= nf && t <= nt) ? Math.min(1, a.noise) : 0;
    const noiseColor = noise ? Math.max(0, Math.min(1, a.noiseColor || 0)) : 0;
    if (tx === 0 && ty === 0 && rot === 0 && sc === 1 && shear === 0 && !prof && alpha === 1 && mosaic < 2 && !noise) return null;
    return {
        tx, ty, rot, sc, alpha, shear: prof ? 0 : shear, px: (a.pivotX ?? 0.5) * cw, py: (a.pivotY ?? 0.5) * ch,
        swayProfile: prof, swayAxis: axis, swayDisp, mosaic, mosaicRect: a.mosaicRect || null, noise, noiseColor,
        // The renderer needs these rather than one number, because with a lag the displacement
        // is different at every point along the axis.
        swayWave: prof ? { amp: (sway / 100) * (axis === 'y' ? ch : cw), speed: a.swaySpeed || 1, curve: a.swayCurve || null, time, lag: a.swayLag || 0 } : null,
    };
}
