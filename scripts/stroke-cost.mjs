// What drawing one pen, pencil or marker stroke costs, in Chrome on the GPU, by length.
//
// Each stroke is simplified, smoothed and drawn from scratch, as a commit does - and as a
// full-redraw preview would, every frame. Measured 2026-10-22 (docs/perf/curves.md): before
// renderer v2 a 200-sample pen stroke took 21ms and a pencil one 124ms, almost all of it stroking
// segments 0.25px apart; v2's 1px spacing took them to 6ms and 34ms.
//
//   node scripts/stroke-cost.mjs      needs the dev server; opens a real (off-screen) window
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--window-position=-2400,0'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:5175/');
await p.waitForLoadState('networkidle');
const rows = await p.evaluate(async ({ V, TOOLS }) => {
    const { drawStrokesOnCtx } = await import('/src/canvas/strokes.ts');
    const { lightenStroke } = await import('/src/core/simplifyStroke.ts');
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
    const ctx = c.getContext('2d');
    const out = [];
    for (const tool of TOOLS) {
        for (const n of [200, 600, 1200, 2400]) {
            // A hand-like stroke: 120Hz samples, a few px apart, wandering over the canvas.
            const pts = Array.from({ length: n }, (_, i) => ({ x: 200 + i * 0.6 + Math.sin(i / 40) * 150, y: 540 + Math.sin(i / 23) * 300, pressure: 0.5 + 0.3 * Math.sin(i / 17) }));
            const st = lightenStroke({ id: 1, tool, color: '#222244', opacity: 1, size: 8, pen: true, v: V, points: pts });
            drawStrokesOnCtx(ctx, [st], true, new Map());   // warm
            ctx.getImageData(0, 0, 1, 1);
            const t0 = performance.now(); const reps = 10;
            for (let r = 0; r < reps; r++) { const s2 = lightenStroke({ ...st, points: pts }); drawStrokesOnCtx(ctx, [s2], true, new Map()); }
            ctx.getImageData(0, 0, 1, 1);   // wait for the GPU to finish
            out.push({ tool, n, stored: st.points.length, ms: +((performance.now() - t0) / reps).toFixed(2) });
        }
    }
    return out;
}, { V: Number(process.env.V ?? 3), TOOLS: (process.env.TOOLS ?? 'brush,pencil,marker').split(',') });
console.log('full redraw per frame (simplify + smooth + draw), 1920x1080:');
for (const r of rows) console.log(`  ${r.tool.padEnd(7)} ${String(r.n).padStart(5)} samples (${String(r.stored).padStart(4)} stored)  ${String(r.ms).padStart(6)} ms`);
await b.close();
