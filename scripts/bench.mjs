// Measures the pure hot paths so memoisation can be argued from numbers rather than vibes.
//
// Run: node scripts/bench.mjs
// Nothing here touches a canvas. What it cannot measure is the actual repaint and React's
// re-render cost, which need a browser profile - so treat this as "is the CPU work in these
// helpers worth caching", not as a full performance picture.

import { strokeSig, flattenLayersInUiOrder, sampleWave, swayWeightAt, applyEase, pointInPolygon } from '../src/canvasUtils.js';

const bench = (name, fn, iters) => {
    fn(); // warm up
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) fn();
    const ms = (performance.now() - t0) / iters;
    const per = ms < 0.001 ? `${(ms * 1000).toFixed(1)}µs` : `${ms.toFixed(3)}ms`;
    console.log(`  ${name.padEnd(46)} ${per.padStart(9)}  ×${iters}`);
    return ms;
};

const makeCuts = (n) => Array.from({ length: n }, (_, i) => ({
    id: 'c' + i, startTime: i * 0.5, endTime: i * 0.5 + 0.5, track: i % 3,
    partId: i % 20 === 0 ? null : 'p' + Math.floor(i / 20),
    partName: 'Part ' + Math.floor(i / 20),
    videoBatch: 'vb1', videoLabel: 'clip',
}));

// The two per-render aggregations in App.jsx, reproduced exactly in shape.
const aggregateParts = (cuts) => {
    const m = new Map();
    for (const c of cuts) {
        if (!c.partId) continue;
        const p = m.get(c.partId) || { id: c.partId, name: c.partName, count: 0, start: Infinity, end: 0 };
        p.count++; p.start = Math.min(p.start, c.startTime); p.end = Math.max(p.end, c.endTime);
        m.set(c.partId, p);
    }
    return [...m.values()].sort((a, b) => a.start - b.start);
};

const makeStrokes = (n, pts) => Array.from({ length: n }, (_, i) => ({
    id: i, size: 3, color: '#000', pen: 'brush',
    points: Array.from({ length: pts }, (_, j) => ({ x: j, y: (i + j) % 50 })),
}));

const makeLayers = (n) => Array.from({ length: n }, (_, i) => ({
    id: 'L' + i, type: i % 5 === 0 ? 'folder' : 'layer',
    parentId: i % 5 === 0 ? null : 'L' + (Math.floor(i / 5) * 5), visible: true,
}));

console.log('\nPer-render derived values (App.jsx recomputes these on every render)');
for (const n of [50, 200, 1000]) {
    const cuts = makeCuts(n);
    bench(`parts aggregation, ${n} cuts`, () => aggregateParts(cuts), 2000);
}

console.log('\nLayer flattening (runs per painted frame, per cut)');
for (const n of [20, 100]) {
    const layers = makeLayers(n);
    bench(`flattenLayersInUiOrder, ${n} layers`, () => flattenLayersInUiOrder(layers), 5000);
}

console.log('\nCache invalidation signature (runs per layer, per paint)');
for (const [n, pts] of [[20, 50], [200, 50], [200, 500]]) {
    const strokes = makeStrokes(n, pts);
    bench(`strokeSig, ${n} strokes x ${pts} pts`, () => strokeSig(strokes), 5000);
}

console.log('\nAnimation maths (per layer, per frame at 60fps)');
const wave = Array.from({ length: 256 }, (_, i) => Math.sin(i / 40));
const profile = [1, 0.6, 0.2, 0];
bench('sampleWave x1000', () => { for (let i = 0; i < 1000; i++) sampleWave(wave, i / 1000); }, 500);
bench('swayWeightAt x1000', () => { for (let i = 0; i < 1000; i++) swayWeightAt(profile, i / 1000); }, 500);
bench('applyEase x1000', () => { for (let i = 0; i < 1000; i++) applyEase(i / 1000, 'inout', 2); }, 500);

console.log('\nHit testing (lasso, per pointer event)');
const poly = Array.from({ length: 200 }, (_, i) => [Math.cos(i) * 100 + 200, Math.sin(i) * 100 + 200]);
bench('pointInPolygon, 200-vertex lasso', () => pointInPolygon([200, 200], poly), 20000);

console.log('\nA 60fps frame has 16.7ms of budget in total.\n');
