// Unit tests for the pure helpers in canvasUtils.
//
// These run on Node's built-in test runner with no extra dependency: everything under test is
// plain maths on plain objects, so there is nothing to mock and no DOM to stand up. The functions
// that do touch a canvas (extractVideoFrames, drawStrokesOnCtx, imageDataToDataURL) are left out
// deliberately - they need a real 2D context and belong in a browser test, not here.
//
// The expected values were taken from running the current implementation, so these lock in
// today's behaviour rather than asserting a specification the code never claimed to meet.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    pointInPolygon, dist, safeArray, hexToRgb, fitRect, layerKey, strokeSig,
    applyEase, triwave, swayWeightAt, sampleWave, sampleKeys, targetCanvasFor,
    computeCutAnim, flattenLayersInUiOrder, sizeCanvas, dilateMask, FONT_PRESETS, fontGroups,
cutDuration, cutProgress, scratchCanvas , layerSig, seekTarget, applyCutAnim} from '../src/canvas/canvasUtils.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ── geometry ───────────────────────────────────────────────────────────────
test('pointInPolygon: inside, outside and the lasso case', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    assert.equal(pointInPolygon([5, 5], square), true);
    assert.equal(pointInPolygon([15, 5], square), false);
    assert.equal(pointInPolygon([5, -1], square), false);

    // A concave polygon is the interesting one: the notch must not count as inside.
    const c = [[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10]];
    assert.equal(pointInPolygon([5, 8], c), false, 'the notch is outside');
    assert.equal(pointInPolygon([2, 8], c), true, 'the left arm is inside');
});

test('dist: plain euclidean distance', () => {
    assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
    assert.equal(dist({ x: 1, y: 1 }, { x: 1, y: 1 }), 0);
});

test('fitRect: letterboxes and centres on the constrained axis', () => {
    // A portrait source in a landscape box is limited by height and centred horizontally.
    const r = fitRect(1080, 1920, 1920, 1080);
    assert.equal(r.h, 1080);
    near(r.w, 607.5);
    near(r.x, (1920 - 607.5) / 2);
    assert.equal(r.y, 0);

    // Matching aspect ratios fill the box exactly, with no offset.
    assert.deepEqual(fitRect(100, 100, 50, 50), { x: 0, y: 0, w: 50, h: 50 });
});

// ── small helpers ──────────────────────────────────────────────────────────
test('safeArray: anything that is not an array becomes an empty one', () => {
    assert.deepEqual(safeArray(null), []);
    assert.deepEqual(safeArray(undefined), []);
    assert.deepEqual(safeArray('nope'), []);
    const a = [1, 2];
    assert.equal(safeArray(a), a, 'an array is passed through untouched');
});

test('hexToRgb: parses, and falls back to black rather than NaN', () => {
    assert.deepEqual(hexToRgb('#36354b'), { r: 54, g: 53, b: 75 });
    assert.deepEqual(hexToRgb('nope'), { r: 0, g: 0, b: 0 });
    assert.deepEqual(hexToRgb(''), { r: 0, g: 0, b: 0 });
    assert.deepEqual(hexToRgb(null), { r: 0, g: 0, b: 0 });
});

test('layerKey: cut and layer ids make one cache key', () => {
    assert.equal(layerKey('c1', 'L1'), 'c1:L1');
    // Layer ids are not unique across cuts, which is exactly why the cut id is part of the key.
    assert.notEqual(layerKey('c1', 'L1'), layerKey('c2', 'L1'));
});

test('strokeSig: empty is a fixed token, and edits change the signature', () => {
    assert.equal(strokeSig([]), '0');
    assert.equal(strokeSig(null), '0');
    const one = [{ id: 1, points: [{ x: 0, y: 0 }], size: 3, color: '#000', pen: 'brush' }];
    const two = [...one, { id: 2, points: [{ x: 1, y: 1 }], size: 3, color: '#000', pen: 'brush' }];
    assert.notEqual(strokeSig(one), strokeSig(two), 'adding a stroke changes it');
});

// ── easing and waveforms ───────────────────────────────────────────────────
test('applyEase: shape per type, and the input is clamped', () => {
    assert.equal(applyEase(0.5, 'linear'), 0.5);
    assert.equal(applyEase(0.5, 'in'), 0.25, 'ease-in starts slow');
    assert.equal(applyEase(0.5, 'out'), 0.75, 'ease-out starts fast');
    assert.equal(applyEase(0.5, 'inout'), 0.5, 'symmetric at the midpoint');

    // Every curve has to agree at the ends or an animation would jump at its boundaries.
    for (const type of ['linear', 'in', 'out', 'inout']) {
        assert.equal(applyEase(0, type), 0, `${type} starts at 0`);
        assert.equal(applyEase(1, type), 1, `${type} ends at 1`);
    }
    assert.equal(applyEase(-1, 'linear'), 0, 'clamped below');
    assert.equal(applyEase(2, 'linear'), 1, 'clamped above');
});

test('triwave: triangle wave with period 2, peaking at 1', () => {
    assert.deepEqual([0, 0.5, 1, 1.5, 2].map(triwave), [0, 0.5, 1, 0.5, 0]);
    // Negative input must fold the same way; a sway running backwards relies on it.
    assert.equal(triwave(-0.5), triwave(1.5));
    assert.equal(triwave(2.5), triwave(0.5), 'periodic');
});

test('sampleWave: interpolates, and an empty wave is silent', () => {
    assert.equal(sampleWave([], 0.5), 0);
    const w = [0, 1, 0];
    assert.equal(sampleWave(w, 0), 0);
    assert.equal(sampleWave(w, 0.25), 0.75);
});

test('swayWeightAt: no profile means full sway, and it interpolates between points', () => {
    assert.equal(swayWeightAt([], 0.5), 1, 'no profile = unweighted');
    assert.equal(swayWeightAt(undefined, 0.5), 1);
    assert.equal(swayWeightAt([1, 0], 0), 1);
    assert.equal(swayWeightAt([1, 0], 1), 0);
    assert.equal(swayWeightAt([1, 0], 0.5), 0.5, 'halfway between the two weights');
});

test('sampleKeys: interpolates between keyframes and holds outside the range', () => {
    const keys = [{ p: 0, tx: 0 }, { p: 1, tx: 100 }];
    assert.equal(sampleKeys(keys, 0.5).tx, 50);
    assert.equal(sampleKeys(keys, 0).tx, 0);
    assert.equal(sampleKeys(keys, 1).tx, 100);
    assert.equal(sampleKeys(keys, -1).tx, 0, 'before the first key holds it');
    assert.equal(sampleKeys(keys, 2).tx, 100, 'after the last key holds it');
});

// ── video import sizing ────────────────────────────────────────────────────
test('targetCanvasFor: presets, matching the source, and the fallbacks', () => {
    assert.deepEqual(targetCanvasFor({ canvasMode: 'landscape' }, 800, 600), { w: 1920, h: 1080 });
    assert.deepEqual(targetCanvasFor({ canvasMode: 'portrait' }, 800, 600), { w: 1080, h: 1920 });
    assert.deepEqual(targetCanvasFor({ canvasMode: 'keep' }, 800, 600), { w: 800, h: 600 });

    // Matching the source is the default, and is what stops a shorts clip being letterboxed.
    assert.deepEqual(targetCanvasFor({ canvasMode: 'source', srcW: 1080, srcH: 1920 }, 1920, 1080), { w: 1080, h: 1920 });

    // Odd dimensions are rounded to even so frames do not resample onto half pixels.
    assert.deepEqual(targetCanvasFor({ canvasMode: 'source', srcW: 1081, srcH: 1921 }, 1920, 1080), { w: 1082, h: 1922 });

    // Without metadata there is nothing to match, so the current canvas stands.
    assert.deepEqual(targetCanvasFor({ canvasMode: 'source', srcW: 0, srcH: 0 }, 1920, 1080), { w: 1920, h: 1080 });
    assert.deepEqual(targetCanvasFor(undefined, 1920, 1080), { w: 1920, h: 1080 });
});

// ── layers ─────────────────────────────────────────────────────────────────
test('flattenLayersInUiOrder: only leaves, and a hidden folder hides its children', () => {
    const layers = [
        { id: 'f1', type: 'folder', parentId: null, visible: true },
        { id: 'a', type: 'layer', parentId: 'f1', visible: true },
        { id: 'f2', type: 'folder', parentId: null, visible: false },
        { id: 'b', type: 'layer', parentId: 'f2', visible: true },
        { id: 'c', type: 'layer', parentId: null, visible: true },
    ];
    const ids = flattenLayersInUiOrder(layers).map(l => l.id);
    assert.ok(ids.includes('a'), 'a visible child of a visible folder is included');
    assert.ok(!ids.includes('f1'), 'folders themselves are not drawable');
    assert.ok(ids.includes('c'), 'a top-level layer is included');
});

// ── cut animation ──────────────────────────────────────────────────────────
test('computeCutAnim: no anim means nothing to apply', () => {
    assert.equal(computeCutAnim({ startTime: 0, endTime: 1 }, 0.5), null);
});

// ── canvas sizing ──────────────────────────────────────────────────────────
// Assigning canvas.width reallocates the backing store even when the value is unchanged. A
// boiling layer redraws ten times a second, and the unconditional `cnv.width = CANVAS_W` on the
// reused canvas was measured churning 79MB a second per layer - the tab ran out of memory.
// A plain object stands in for the canvas: sizeCanvas only reads and writes width/height.
test('sizeCanvas: does not touch a canvas that is already the right size', () => {
    let writes = 0;
    const cnv = { _w: 1920, _h: 1080,
        get width() { return this._w; }, set width(v) { writes++; this._w = v; },
        get height() { return this._h; }, set height(v) { writes++; this._h = v; } };
    assert.equal(sizeCanvas(cnv, 1920, 1080), false, 'reports that it did not reallocate');
    assert.equal(writes, 0, 'the whole point: no assignment, so no 8MB reallocation');
});

test('sizeCanvas: resizes when either dimension differs', () => {
    const mk = (w, h) => ({ width: w, height: h });
    const a = mk(300, 150);
    assert.equal(sizeCanvas(a, 1920, 1080), true);
    assert.deepEqual([a.width, a.height], [1920, 1080]);

    const b = mk(1920, 720); // height alone differs
    assert.equal(sizeCanvas(b, 1920, 1080), true);
    assert.deepEqual([b.width, b.height], [1920, 1080]);

    const c = mk(640, 1080); // width alone differs
    assert.equal(sizeCanvas(c, 1920, 1080), true);
    assert.deepEqual([c.width, c.height], [1920, 1080]);
});

test('sizeCanvas: a true return means the canvas is already blank, so callers may skip clearing', () => {
    const cnv = { width: 300, height: 150 };
    assert.equal(sizeCanvas(cnv, 1920, 1080), true, 'resized, and a resize blanks the bitmap');
    assert.equal(sizeCanvas(cnv, 1920, 1080), false, 'second call is a no-op, caller must clear');
});

// ── fill bleed ─────────────────────────────────────────────────────────────
// A bucket fill stops exactly at the ink that bounds it, which is fine until the layer boils:
// the ink is displaced, the paint is a bitmap and cannot follow, and a gap opens along every
// edge that wobbled outwards. Growing the painted region a few pixels puts paint under the line.
const grid = (rows) => {
    const h = rows.length, w = rows[0].length;
    const m = new Uint8Array(w * h);
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') m[y * w + x] = 1; }));
    return { m, w, h };
};
const show = (m, w, h) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => m[y * w + x] ? '#' : '.').join(''));

test('dilateMask: grows a single pixel into a square of the given radius', () => {
    const { m, w, h } = grid(['.....', '.....', '..#..', '.....', '.....']);
    assert.deepEqual(show(dilateMask(m, w, h, 1), w, h), ['.....', '.###.', '.###.', '.###.', '.....']);
});

test('dilateMask: radius 0 or less is a no-op, and the input is never mutated', () => {
    const { m, w, h } = grid(['...', '.#.', '...']);
    assert.equal(dilateMask(m, w, h, 0), m, 'returns the same mask untouched');
    const before = show(m, w, h);
    dilateMask(m, w, h, 2);
    assert.deepEqual(show(m, w, h), before, 'the original is left alone');
});

test('dilateMask: clips at the edges instead of wrapping to the other side', () => {
    const { m, w, h } = grid(['#...', '....', '....']);
    const out = show(dilateMask(m, w, h, 1), w, h);
    assert.deepEqual(out, ['##..', '##..', '....']);
    assert.ok(!out.some(row => row.endsWith('#')), 'nothing wrapped round to the right edge');
});

test('dilateMask: an empty mask stays empty', () => {
    const { m, w, h } = grid(['...', '...']);
    assert.deepEqual(show(dilateMask(m, w, h, 2), w, h), ['...', '...']);
});

// ── fonts ──────────────────────────────────────────────────────────────────
test('fontGroups: keeps the list order and groups runs together', () => {
    const presets = [
        { value: 'a', label: 'A', group: 'One' },
        { value: 'b', label: 'B', group: 'One' },
        { value: 'c', label: 'C', group: 'Two' },
    ];
    assert.deepEqual(fontGroups(presets).map(([g, fs]) => [g, fs.length]), [['One', 2], ['Two', 1]]);
});

test('fontGroups: a group name repeated later stays a separate run, not merged', () => {
    // Merging would silently reorder the list out from under whoever wrote it.
    const presets = [{ value: 'a', group: 'X' }, { value: 'b', group: 'Y' }, { value: 'c', group: 'X' }];
    assert.deepEqual(fontGroups(presets).map(([g]) => g), ['X', 'Y', 'X']);
});

test('fontGroups: every shipped preset lands in exactly one group, none lost', () => {
    const flat = fontGroups().flatMap(([, fs]) => fs);
    assert.equal(flat.length, FONT_PRESETS.length);
    assert.deepEqual(flat.map(f => f.value), FONT_PRESETS.map(f => f.value));
});

test('the shipped presets have unique values and cover Japanese', () => {
    // A duplicate value would make the select show the wrong entry as chosen.
    const values = FONT_PRESETS.map(f => f.value);
    assert.equal(new Set(values).size, values.length, 'duplicate font values');
    assert.ok(FONT_PRESETS.some(f => f.group === '日本語'), 'no Japanese group');
    assert.ok(FONT_PRESETS.every(f => f.value && f.label), 'every preset needs a value and a label');
});

test('cutDuration: a cut dragged to zero length still has a length to divide by', () => {
    // The whole reason the floor exists. Six places divided by this before it was a function.
    assert.equal(cutDuration({ startTime: 2, endTime: 5 }), 3);
    assert.ok(cutDuration({ startTime: 4, endTime: 4 }) > 0);
    assert.ok(Number.isFinite(1 / cutDuration({ startTime: 4, endTime: 4 })));
    // A cut whose end is before its start is nonsense, not a negative duration.
    assert.ok(cutDuration({ startTime: 9, endTime: 1 }) > 0);
});

test('cutProgress: 0 at the start, 1 at the end, halfway in the middle', () => {
    const ac = { startTime: 10, endTime: 14 };
    assert.equal(cutProgress(ac, 10), 0);
    assert.equal(cutProgress(ac, 12), 0.5);
    assert.equal(cutProgress(ac, 14), 1);
});

test('cutProgress clamps rather than extrapolating', () => {
    // Animations are evaluated for cuts merely near the playhead, so times outside the cut are
    // routine. Extrapolating would send a move past where it was meant to stop.
    const ac = { startTime: 10, endTime: 14 };
    assert.equal(cutProgress(ac, 0), 0);
    assert.equal(cutProgress(ac, 99), 1);
    assert.equal(cutProgress(ac, -5), 0);
});

test('cutProgress on a zero-length cut is a number, not NaN', () => {
    const p = cutProgress({ startTime: 3, endTime: 3 }, 3);
    assert.ok(Number.isFinite(p), `got ${p}`);
    assert.ok(p >= 0 && p <= 1);
});

// --- scratchCanvas -----------------------------------------------------------------------------

/** A canvas-shaped stub: enough of the surface for sizing and clearing. */
function fakeCanvas() {
    const ctx = { cleared: [] , clearRect: (...a) => ctx.cleared.push(a) };
    return { width: 0, height: 0, getContext: () => ctx, _ctx: ctx };
}

test('scratchCanvas allocates once and reuses the same canvas', () => {
    const made = [];
    const realDoc = globalThis.document;
    globalThis.document = { createElement: () => { const c = fakeCanvas(); made.push(c); return c; } };
    try {
        const ref = { current: null };
        const a = scratchCanvas(ref, 100, 50);
        const b = scratchCanvas(ref, 100, 50);
        assert.equal(made.length, 1, 'a second call must not allocate 8MB again');
        assert.equal(a.canvas, b.canvas);
        assert.equal(ref.current, a.canvas);
    } finally { globalThis.document = realDoc; }
});

test('scratchCanvas sizes the canvas it is given', () => {
    const ref = { current: fakeCanvas() };
    const { canvas } = scratchCanvas(ref, 640, 360);
    assert.equal(canvas.width, 640);
    assert.equal(canvas.height, 360);
});

test('a resize does the clearing, so scratchCanvas does not clear as well', () => {
    // Assigning width to a canvas clears it. Clearing again is wasted work on a full-size canvas
    // inside the composite loop, which is exactly where this runs.
    const ref = { current: fakeCanvas() };
    const { ctx } = scratchCanvas(ref, 640, 360);
    assert.deepEqual(ctx.cleared, []);
});

test('a canvas already the right size is cleared, because nothing else did it', () => {
    const c = fakeCanvas();
    c.width = 640; c.height = 360;
    const { ctx } = scratchCanvas({ current: c }, 640, 360);
    assert.deepEqual(ctx.cleared, [[0, 0, 640, 360]]);
});

test('the second call at the same size clears, the first does not', () => {
    const ref = { current: fakeCanvas() };
    const { ctx } = scratchCanvas(ref, 320, 180);
    assert.equal(ctx.cleared.length, 0, 'first call resized');
    scratchCanvas(ref, 320, 180);
    assert.equal(ctx.cleared.length, 1, 'second call had nothing to resize');
});

// --- layerSig ----------------------------------------------------------------------------------

const stroked = (over = {}) => ({ strokes: [{ id: 7, tool: 'pen', points: [1, 2, 3] }], ...over });

test('a layer that is not boiling gets the same key with or without boiling options', () => {
    // The two caches compare their keys against each other. If these ever differ, every
    // non-boiling layer misses the cache and is redrawn every frame - fast to write, invisible
    // to notice.
    const layer = stroked();
    const rough = { roughPhase: 3, roughWave: 2, roughMinSize: 1 };
    assert.equal(layerSig(layer), layerSig(layer, rough));
});

test('a boiling layer gets a different key per phase', () => {
    const layer = stroked({ roughen: 4 });
    const at = (phase) => layerSig(layer, { roughPhase: phase, roughWave: 1, roughMinSize: 0 });
    assert.notEqual(at(0), at(1));
    assert.equal(at(2), at(2));
});

test('the still-frame key of a boiling layer is the phase key without the phase', () => {
    const layer = stroked({ roughen: 4 });
    const withPhase = layerSig(layer, { roughPhase: 0, roughWave: 1, roughMinSize: 0 });
    assert.ok(withPhase.startsWith(layerSig(layer)));
    assert.notEqual(withPhase, layerSig(layer), 'so a boiling layer never hits the still-frame cache');
});

test('the boiling settings are part of the key, not just the phase', () => {
    const layer = stroked({ roughen: 4 });
    const at = (wave, minSize) => layerSig(layer, { roughPhase: 0, roughWave: wave, roughMinSize: minSize });
    assert.notEqual(at(1, 0), at(2, 0), 'a different wavelength is a different picture');
    assert.notEqual(at(1, 0), at(1, 3), 'so is a different minimum width');
});

test('roughen and rev change the key', () => {
    assert.notEqual(layerSig(stroked()), layerSig(stroked({ roughen: 2 })));
    assert.notEqual(layerSig(stroked()), layerSig(stroked({ rev: 1 })),
        'rev is what catches an edit that moves coordinates without changing the stroke list');
});

test('adding a stroke changes the key', () => {
    const one = { strokes: [{ id: 1, tool: 'pen', points: [] }] };
    const two = { strokes: [...one.strokes, { id: 2, tool: 'pen', points: [] }] };
    assert.notEqual(layerSig(one), layerSig(two));
});

test('layerSig survives a layer with nothing in it', () => {
    assert.equal(typeof layerSig({}), 'string');
    assert.equal(typeof layerSig(null), 'string');
});

test('layerSig reproduces both expressions it replaced, byte for byte', () => {
    // The two call sites each built this string by hand. An extraction is only safe if the new
    // one is identical for every shape, so both old expressions are kept here and compared.
    const oldStillFrame = (layer) =>
        strokeSig(layer.strokes) + '|r' + (layer.roughen || 0) + '|v' + (layer.rev || 0);
    const oldBoiling = (layer, boil, rOpts) =>
        strokeSig(layer.strokes) + '|r' + (layer.roughen || 0) + '|v' + (layer.rev || 0)
        + (layer.roughen ? `|b${boil}|w${rOpts.roughWave}|m${rOpts.roughMinSize}` : '');

    const strokeSets = [
        [],
        [{ id: 1, tool: 'pen', points: [1, 2] }],
        [{ id: 1, tool: 'pen', points: [] }, { id: 2, tool: 'paste', bitmapId: 'b7' }],
    ];
    for (const strokes of strokeSets) {
        for (const roughen of [0, 1, 6]) {
            for (const rev of [0, 3]) {
                for (const boil of [0, 2]) {
                    for (const roughWave of [1, 2.5]) {
                        for (const roughMinSize of [0, 4]) {
                            const layer = { strokes, roughen, rev };
                            const rOpts = { roughen, roughPhase: boil, roughWave, roughMinSize };
                            assert.equal(layerSig(layer), oldStillFrame(layer),
                                `still frame differs for ${JSON.stringify(layer)}`);
                            assert.equal(layerSig(layer, rOpts), oldBoiling(layer, boil, rOpts),
                                `boiling differs for ${JSON.stringify({ layer, rOpts })}`);
                        }
                    }
                }
            }
        }
    }
});

// --- seekTarget ---------------------------------------------------------------------------------

test('a seek never lands on the very last frame', () => {
    // Seeking to exactly the duration fires no `seeked` event in some browsers, so the promise
    // waiting for one never settles and the import stops halfway with no error. The scene
    // detector clamped; the frame extractor did not, and it steps right up to the end.
    assert.ok(seekTarget(10, 10) < 10);
    assert.equal(seekTarget(10, 10), 9.98);
    assert.equal(seekTarget(99, 10), 9.98, 'past the end clamps too');
});

test('a seek inside the video is left alone', () => {
    assert.equal(seekTarget(0, 10), 0);
    assert.equal(seekTarget(3.5, 10), 3.5);
    assert.equal(seekTarget(9.97, 10), 9.97);
});

test('a negative time becomes the start', () => {
    assert.equal(seekTarget(-1, 10), 0);
});

test('a duration that makes no sense seeks to the start rather than somewhere negative', () => {
    for (const bad of [0, -5, NaN, Infinity, undefined, null]) {
        assert.equal(seekTarget(3, /** @type {any} */(bad)), 0, `duration ${bad}`);
    }
});

test('a video shorter than the clamp still seeks inside itself', () => {
    const t = seekTarget(1, 0.01);
    assert.ok(t >= 0 && t <= 0.01, `${t} is outside a 0.01s video`);
});

// --- applyCutAnim -------------------------------------------------------------------------------

/** A context that records what was asked of it, which is all this needs to be checked. */
const recorder = () => {
    const calls = [];
    return {
        calls,
        translate: (x, y) => calls.push(['translate', x, y]),
        scale: (x, y) => calls.push(['scale', x, y]),
    };
};

test('a cut animation pivots on the centre of the frame', () => {
    const ctx = recorder();
    applyCutAnim(ctx, { tx: 0, ty: 0, sx: 2, sy: 2 }, 1920, 1080);
    assert.deepEqual(ctx.calls, [
        ['translate', 960, 540],
        ['scale', 2, 2],
        ['translate', -960, -540],
    ]);
});

test('the move is added to the centre, not applied after the scale', () => {
    // Order matters: scaling first would multiply the offset by the scale.
    const ctx = recorder();
    applyCutAnim(ctx, { tx: 100, ty: -50, sx: 2, sy: 2 }, 1000, 800);
    assert.deepEqual(ctx.calls[0], ['translate', 600, 350]);
    assert.deepEqual(ctx.calls[1], ['scale', 2, 2]);
});

test('a cut with no animation touches the context at all', () => {
    for (const nothing of [null, undefined]) {
        const ctx = recorder();
        applyCutAnim(ctx, nothing, 1920, 1080);
        assert.deepEqual(ctx.calls, [], 'a save/restore around nothing is still cheap, a transform is not');
    }
});

test('the artwork and the text over it get the same transform', () => {
    // The whole point of sharing this: if the two disagreed about the pivot, a cut animation
    // would slide its text off its drawing.
    const anim = { tx: 12, ty: -7, sx: 1.4, sy: 0.9 };
    const a = recorder(), b = recorder();
    applyCutAnim(a, anim, 1920, 1080);
    applyCutAnim(b, anim, 1920, 1080);
    assert.deepEqual(a.calls, b.calls);
});

test('a non-uniform scale is passed through as given', () => {
    const ctx = recorder();
    applyCutAnim(ctx, { tx: 0, ty: 0, sx: 0.5, sy: 2 }, 100, 100);
    assert.deepEqual(ctx.calls[1], ['scale', 0.5, 2]);
});
