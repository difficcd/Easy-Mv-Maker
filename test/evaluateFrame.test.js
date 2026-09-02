import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFrame } from '../src/engine/evaluateFrame.js';

const W = 1920, H = 1080;
const layer = (id, extra = {}) => ({ id, type: 'layer', parentId: null, visible: true, strokes: [], ...extra });
const cut = (id, start, end, extra = {}) => ({
    id, name: `Cut ${id}`, startTime: start, endTime: end, track: 0,
    layers: [layer('L1')], activeLayerId: 'L1', texts: [], ...extra,
});
const at = (cuts, t, playing = true, currentCutId = null) =>
    evaluateFrame(cuts, t, { playing, currentCutId, cw: W, ch: H });

test('an empty document evaluates to an empty frame', () => {
    const s = at([], 0);
    assert.deepEqual(s.cuts, []);
    assert.equal(s.camera, null);
});

test('only the cuts at t are in the frame, bottom track first', () => {
    const cuts = [cut('a', 0, 2), cut('b', 2, 4), { ...cut('over', 1, 3), track: 1 }];
    assert.deepEqual(at(cuts, 1.5).cuts.map(c => c.cut.id), ['a', 'over']);
});

test('paused, nothing is animated', () => {
    // The rule the whole app rests on: a cut sitting still is what makes it drawable. A canvas
    // showing a mid-animation transform would put the pen somewhere other than where ink appears.
    const c = cut('a', 0, 2, { anim: { inType: 'fade', inDur: 0.5 } });
    const s = at([c], 0.2, false, 'a');
    assert.equal(s.cuts[0].anim, null);
    assert.equal(s.camera, null);
});

test('playing, cut animation is evaluated once per cut', () => {
    const c = cut('a', 0, 2, { anim: { inType: 'fade', inDur: 0.5 } });
    const s = at([c], 0.25);
    assert.ok(s.cuts[0].anim, 'no cut animation while playing');
    assert.ok(s.cuts[0].anim.alpha > 0 && s.cuts[0].anim.alpha < 1, 'mid-fade alpha expected');
});

test('hidden layers are left out, folders are flattened away', () => {
    const c = cut('a', 0, 2, {
        layers: [
            { id: 'F', type: 'folder', parentId: null, visible: true },
            layer('inFolder', { parentId: 'F' }),
            layer('hidden', { visible: false }),
            layer('shown'),
        ],
    });
    const ids = at([c], 1).cuts[0].groups.map(g => g.base.id);
    assert.ok(ids.includes('shown'));
    assert.ok(ids.includes('inFolder'), 'a layer inside a folder should still be drawn');
    assert.ok(!ids.includes('hidden'));
    assert.ok(!ids.includes('F'), 'the folder itself is not a drawable layer');
});

test('a hidden folder hides what is inside it', () => {
    const c = cut('a', 0, 2, {
        layers: [
            { id: 'F', type: 'folder', parentId: null, visible: false },
            layer('inside', { parentId: 'F' }),
        ],
    });
    assert.deepEqual(at([c], 1).cuts[0].groups.map(g => g.base.id), []);
});

test('clipped layers arrive attached to their base, not as groups of their own', () => {
    const c = cut('a', 0, 2, {
        layers: [layer('shade', { clipped: true }), layer('flats')],
    });
    const groups = at([c], 1).cuts[0].groups;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].base.id, 'flats');
    assert.deepEqual(groups[0].clipped.map(l => l.id), ['shade']);
});

test('invisible texts are dropped', () => {
    const c = cut('a', 0, 2, {
        texts: [{ id: 't1', text: 'x', visible: true }, { id: 't2', text: 'y', visible: false }],
    });
    assert.deepEqual(at([c], 1).cuts[0].texts.map(x => x.text.id), ['t1']);
});

test('a text faded to nothing is dropped rather than drawn transparent', () => {
    // So the renderer does not measure and lay out something invisible.
    const c = cut('a', 0, 10, {
        texts: [{ id: 't', text: 'x', visible: true, anim: { inType: 'fade', inDur: 2 } }],
    });
    assert.equal(at([c], 0).cuts[0].texts.length, 0, 'a fully faded-out text should not be in the frame');
    assert.equal(at([c], 5).cuts[0].texts.length, 1);
});

test('the camera comes from the lowest active track that has one', () => {
    // A shot belongs to the base scene; the tracks above are parts of the same shot.
    const base = cut('base', 0, 4, { camera: { preset: 'zoomIn' } });
    const over = { ...cut('over', 0, 4, { camera: { preset: 'panLeft' } }), track: 1 };
    const s = at([over, base], 2);
    assert.ok(s.camera, 'no camera resolved');
    assert.equal(s.camera.cx, W / 2, 'took the upper track camera instead of the base');
});

test('no camera anywhere means no transform for the renderer to apply', () => {
    assert.equal(at([cut('a', 0, 2)], 1).camera, null);
});

test('while paused there is no camera, whatever the cut says', () => {
    const c = cut('a', 0, 2, { camera: { preset: 'zoomIn' } });
    assert.equal(at([c], 1, false, 'a').camera, null);
});

test('while paused the cut being edited is in the frame even off the playhead', () => {
    const cuts = [cut('a', 0, 2), cut('b', 4, 6)];
    assert.deepEqual(at(cuts, 5, false, 'a').cuts.map(c => c.cut.id), ['b', 'a']);
});

test('a cut with no layers and no texts still evaluates', () => {
    const c = cut('a', 0, 2, { layers: [], texts: undefined });
    const e = at([c], 1).cuts[0];
    assert.deepEqual(e.groups, []);
    assert.deepEqual(e.texts, []);
});
