// A cut's entrance and exit: the transform at a moment, from its animation settings.

import { CANVAS_H, CANVAS_W } from './canvasSize.ts';
import { cutDuration } from './cutTime.ts';
import { SWING, applyEase, swing } from './easing.js';

export const ANIM_DEFAULT = { inType: 'none', inDur: 0.4, inDir: 'left', outType: 'none', outDur: 0.4, outDir: 'right', deformAxis: 'x', deformAmount: 0, deformReturn: false, deformSpeed: 1, deformCount: 0, moveX: 0, moveY: 0, moveReturn: false, moveSpeed: 1, moveCount: 0, ease: 'linear', easePower: 2 };

// Per-cut animation state at a given absolute time. Returns null when the cut is
// at rest (no transform), so callers can skip the save/transform fast-path.
export function computeCutAnim(ac, time, cw = CANVAS_W, ch = CANVAS_H) {
    const a = ac.anim;
    if (!a) return null;
    const dur = cutDuration(ac);
    const lt = time - ac.startTime;
    let alpha = 1, sx = 1, sy = 1, tx = 0, ty = 0;
    // Slide travels a full canvas dimension so the cut clearly enters from off-screen.
    const dirOff = (dir, frac) => dir === 'left' ? [-cw * frac, 0] : dir === 'right' ? [cw * frac, 0] : dir === 'up' ? [0, -ch * frac] : [0, ch * frac];
    if (a.inType && a.inType !== 'none' && a.inDur > 0 && lt < a.inDur) {
        const p = applyEase(lt / a.inDur, a.ease, a.easePower);
        if (a.inType === 'fade') alpha *= p;
        else if (a.inType === 'scale') { alpha *= p; const s = 0.5 + 0.5 * p; sx *= s; sy *= s; }
        else if (a.inType === 'slide') { const [dx, dy] = dirOff(a.inDir, (1 - p)); tx += dx; ty += dy; }
    }
    if (a.outType && a.outType !== 'none' && a.outDur > 0 && lt > dur - a.outDur) {
        const p = 1 - applyEase((lt - (dur - a.outDur)) / a.outDur, a.ease, a.easePower);
        if (a.outType === 'fade') alpha *= p;
        else if (a.outType === 'scale') { alpha *= p; const s = 0.5 + 0.5 * p; sx *= s; sy *= s; }
        else if (a.outType === 'slide') { const [dx, dy] = dirOff(a.outDir, (1 - p)); tx += dx; ty += dy; }
    }
    if (a.deformAmount) {
        const t = Math.max(0, Math.min(1, lt / dur));
        // Ping-pong (return): oscillates back to the original; speed is cycles across the cut,
        // count caps how many.
        let prog;
        if (a.deformReturn) prog = swing(SWING.through, t, a.deformSpeed, a.deformCount);
        else prog = applyEase(t, a.ease, a.easePower);
        const f = 1 + a.deformAmount * prog;
        if (a.deformAxis === 'x') sx *= f; else sy *= f;
    }
    if (a.moveX || a.moveY) {
        // Whole-cut movement across its lifetime. One-way ramps to the target; ping-pong goes
        // out and back (0→1→0) at `speed` cycles, capped by `count`.
        const t = Math.max(0, Math.min(1, lt / dur));
        let prog;
        if (a.moveReturn) prog = swing(SWING.there, t, a.moveSpeed, a.moveCount);
        else prog = applyEase(t, a.ease, a.easePower);
        tx += (a.moveX || 0) * prog; ty += (a.moveY || 0) * prog;
    }
    if (alpha === 1 && sx === 1 && sy === 1 && tx === 0 && ty === 0) return null;
    return { alpha: Math.max(0, alpha), sx, sy, tx, ty };
}
