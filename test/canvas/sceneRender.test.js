import test from 'node:test';
import assert from 'node:assert/strict';
import { drawScene } from '../../src/canvas/sceneRender.js';

/** Records the draws in order, and the alpha in force at each. */
function fakeCtx(log) {
    const c = {
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        save() { log.push('save'); }, restore() { log.push('restore'); },
        transform() { }, translate() { }, rotate() { }, scale() { }, setTransform() { },
        drawImage(src) { log.push(`draw:${src}@${c.globalAlpha}`); },
    };
    return c;
}
const group = (base, canvas, anim = null) => ({ base, clipped: [], anim, canvas });
const deps = (over = {}) => ({
    cw: 100, ch: 50,
    flattenClipGroup: (_cutId, g) => g.canvas,
    hiddenByGesture: () => false,
    selection: null,
    bitmapEntry: () => undefined,
    maskScratchRef: { current: null },
    ...over,
});

test('layers are drawn bottom to top, so the top of the panel is on top of the frame', () => {
    const log = [];
    const scene = { cuts: [{ cut: { id: 1 }, anim: null, groups: [group({ id: 'top' }, 'TOP'), group({ id: 'bottom' }, 'BOTTOM')] }] };
    drawScene(fakeCtx(log), scene, deps());
    assert.deepEqual(log.filter(l => l.startsWith('draw')), ['draw:BOTTOM@1', 'draw:TOP@1']);
});

test('a cut animation sets the alpha for its layers; the next cut starts clean', () => {
    const log = [];
    const scene = { cuts: [
        { cut: { id: 1 }, anim: { alpha: 0.5 }, groups: [group({ id: 'a' }, 'A')] },
        { cut: { id: 2 }, anim: null, groups: [group({ id: 'b' }, 'B')] },
    ] };
    const ctx = fakeCtx(log);
    // restore() in the fake does not undo alpha; the second cut must not inherit it through
    // the real save/restore either, so emulate that much.
    const saved = []; ctx.save = () => { saved.push(ctx.globalAlpha); log.push('save'); }; ctx.restore = () => { ctx.globalAlpha = saved.pop(); log.push('restore'); };
    drawScene(ctx, scene, deps());
    assert.deepEqual(log.filter(l => l.startsWith('draw')), ['draw:A@0.5', 'draw:B@1']);
});

test('a layer a gesture is drawing itself, or one still decoding, is skipped without disturbing the rest', () => {
    const log = [];
    const scene = { cuts: [{ cut: { id: 1 }, anim: null, groups: [group({ id: 'x' }, 'X'), group({ id: 'hidden' }, 'H'), group({ id: 'pending' }, null)] }] };
    drawScene(fakeCtx(log), scene, deps({ hiddenByGesture: (_c, id) => id === 'hidden' }));
    assert.deepEqual(log.filter(l => l.startsWith('draw')), ['draw:X@1']);
    assert.equal(log.filter(l => l === 'save').length, log.filter(l => l === 'restore').length, 'every save is restored');
});

import { drawVideoOverlay, drawOnionCut, ONION_ALPHA } from '../../src/canvas/sceneRender.js';

test('the video overlay is fitted, faded by its opacity, and leaves the alpha as it found it', () => {
    const log = [];
    const ctx = fakeCtx(log); ctx.globalAlpha = 0.9;
    const fit = (sw, sh, dw, dh) => ({ x: 1, y: 2, w: dw, h: dh });
    drawVideoOverlay(ctx, { readyState: 4, videoWidth: 640, videoHeight: 360 }, { opacity: 0.5 }, 100, 50, fit);
    assert.deepEqual(log, ['draw:[object Object]@0.5']);
    assert.equal(ctx.globalAlpha, 0.9);
    drawVideoOverlay(ctx, { readyState: 1 }, {}, 100, 50, fit);
    assert.equal(log.length, 1, 'no frame to give: nothing drawn');
    drawVideoOverlay(ctx, null, {}, 100, 50, fit);
    assert.equal(log.length, 1);
});

test('the onion skin draws a cut\'s visible layers faint, bottom to top, and puts the alpha back', () => {
    const log = [];
    const ctx = fakeCtx(log);
    const cut = { id: 7, layers: [{ id: 'top', type: 'layer' }, { id: 'hid', type: 'layer', visible: false }, { id: 'f', type: 'folder' }, { id: 'bot', type: 'layer' }] };
    drawOnionCut(ctx, cut, (_c, l) => l.id.toUpperCase(), (ls) => ls);
    assert.deepEqual(log, [`draw:BOT@${ONION_ALPHA}`, `draw:TOP@${ONION_ALPHA}`]);
    assert.equal(ctx.globalAlpha, 1);
});
