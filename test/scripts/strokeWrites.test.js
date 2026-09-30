import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeWrites, ALLOWED } from '../../scripts/stroke-writes.mjs';

// The four shipped bugs this gate exists for, as they were written. If the gate stops seeing
// any of these, it has stopped being a gate.
const MOSAIC = `        updLayers(currentCutId, c => ({ layers: patchLayer(c.layers, c.activeLayerId, l => ({ strokes: [...l.strokes, stroke] })) }));`;
const FILL = `        updLayers(currentCutId, c => ({
            layers: patchLayer(c.layers, activeLayer.id, l => ({ strokes: insertFill(l.strokes, stroke, region.overPaint) }))
        }));`;
const ERASER = `                updLayers(currentCutId, c => ({
                    layers: patchLayer(c.layers, drawTargetLayerRef.current, l => ({ strokes: [...l.strokes, st] }))
                }));`;

test('the mosaic write, as it shipped, is caught', () => {
    assert.equal(strokeWrites(MOSAIC).length, 1);
});

test('a write whose patchLayer call wraps onto the next line is caught', () => {
    // The fill and the eraser both wrapped. A check that only looked at the line with
    // patchLayer on it would have seen neither.
    assert.equal(strokeWrites(FILL).length, 1);
    assert.equal(strokeWrites(ERASER).length, 1);
});

test('patching something other than strokes is not a stroke write', () => {
    const visible = `updLayers(cutId, c => ({ layers: patchLayer(c.layers, layerId, l => ({ visible: !l.visible })) }));`;
    const collapse = `updLayers(cutId, c => ({ layers: patchLayer(c.layers, fid, l => ({ collapsed: !l.collapsed })) }));`;
    assert.deepEqual(strokeWrites(visible), []);
    assert.deepEqual(strokeWrites(collapse), []);
});

test('going through commitStroke is not flagged, however the stroke is placed', () => {
    const committed = `commitStrokeToLayer(currentCutId, layer.id, stroke, (strokes, st) => insertFill(strokes, st, region.overPaint));`;
    assert.deepEqual(strokeWrites(committed), []);
});

test('every allowance names a file and the text that identifies the site', () => {
    // An allowance that matched everything would quietly switch the gate off.
    assert.ok(ALLOWED.length > 0);
    for (const a of ALLOWED) {
        assert.match(a.file, /^src\/.+\.[jt]sx?$/);
        assert.ok(a.match.length >= 8, `"${a.match}" is too loose to identify one site`);
    }
});

// --- a hand-rolled map is the same write ------------------------------------------------------
//
// The gate looked only for patchLayer, so `layers.map(...)` writing strokes went straight past
// it. One site did exactly that - committing a floating selection - and it was a real instance
// of both failures this gate exists for: no reveal, so a layer hidden while the selection
// floated took the pixels back invisibly, and no check that the layer still existed, so a
// deleted one swallowed the pair silently.

const SELECTION_COMMIT = `            layers: c.layers.map(l => l.id !== sel.sourceLayerId ? l : { ...l, strokes: [...(l.strokes || []), erase, paste] }),`;

test('the selection commit, as it stood, is caught', () => {
    assert.equal(strokeWrites(SELECTION_COMMIT).length, 1);
});

test('a stroke added through a helper is caught too', () => {
    // insertFill and friends - the list is still being rebuilt from the old one.
    assert.equal(strokeWrites(`layers: patchLayer(c.layers, id, l => ({ strokes: insertFill(l.strokes, s, over) }))`).length, 1);
});

test('writes that add nothing are left alone', () => {
    // Clearing a layer and passing the list through are not strokes arriving, and flagging them
    // would push people to add ALLOWED entries, which is how a gate stops meaning anything.
    assert.equal(strokeWrites(`layers: c.layers.map(l => ({ ...l, strokes: [] }))`).length, 0);
    assert.equal(strokeWrites(`layers: c.layers.map(l => ({ ...l, strokes: l.strokes }))`).length, 0);
    assert.equal(strokeWrites(`layers: c.layers.map(l => ({ ...l, visible: true }))`).length, 0);
    assert.equal(strokeWrites(`const names = layers.map(l => l.name);`).length, 0);
});

test('commitStroke itself is exempt, and named in ALLOWED rather than skipped', () => {
    // The function every other site is told to use has to write strokes somewhere.
    assert.ok(ALLOWED.some(a => a.file.endsWith('layerOps.ts')), 'the exemption is written down');
});
