// Does what is drawn while the pen is down match what commits when it lifts?
//
// The live preview adds only the new part of a stroke each frame. If any of what it drew differs
// from the committed stroke, the difference shows as a ghost edge while drawing that settles - or
// jumps - when the pen lifts. This draws the same fast loops with each smoothed tool, reads the
// overlay just before pen-up and the canvas just after, and counts overlay ink that is not in the
// committed stroke. Measured 2026-10-22: Dot 5,197px of ghost before its fix, 0 after; the pen
// (brush) 4,994px and the pencil 5,999px, both still open (docs/perf/curves.md).
//
//   node scripts/live-ghost-check.mjs        needs the dev server (npm run dev)

import { chromium } from 'playwright-core';

const ORIGIN = process.env.MV_ORIGIN || 'http://127.0.0.1:5175/';
// Positions in the tool strip: lasso, move, text, Dot, pen, pencil, airbrush, marker.
const TOOLS = [['Dot', 3], ['pen', 4], ['pencil', 5], ['marker', 7]];

const b = await chromium.launch({ channel: 'chrome' });
try {
    for (const [name, index] of TOOLS) {
        const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
        await p.goto(ORIGIN);
        await p.waitForLoadState('networkidle');
        await p.waitForSelector('.tool-btn');
        await p.locator('.tool-btn').nth(index).click();
        const box = await p.locator('.canvas-stage canvas').first().boundingBox();
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        await p.mouse.move(cx - 160, cy);
        await p.mouse.down();
        for (let i = 0; i <= 26; i++) { const a = i / 26 * Math.PI * 4; await p.mouse.move(cx - 160 + i * 12 + Math.cos(a) * 60, cy + Math.sin(a) * 80); }
        await p.waitForTimeout(200);
        const read = (idx) => p.evaluate((i) => {
            const c = document.querySelectorAll('.canvas-stage canvas')[i];
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            const ink = new Uint8Array(c.width * c.height);
            // The main canvas is white-backed, the overlay transparent.
            for (let k = 0; k < ink.length; k++) ink[k] = i === 0 ? (d[k * 4] < 128 ? 1 : 0) : (d[k * 4 + 3] > 128 ? 1 : 0);
            return Array.from(ink);
        }, idx);
        const live = await read(1);
        await p.mouse.up();
        await p.waitForTimeout(600);
        const done = await read(0);
        let liveInk = 0, ghost = 0;
        for (let k = 0; k < live.length; k++) if (live[k]) { liveInk++; if (!done[k]) ghost++; }
        console.log(`${name.padEnd(7)} overlay ink before pen-up ${String(liveInk).padStart(6)} px; not in the committed stroke ${String(ghost).padStart(6)} px (${liveInk ? (ghost / liveInk * 100).toFixed(1) : 0}%)`);
        await p.close();
    }
} finally {
    await b.close();
}
