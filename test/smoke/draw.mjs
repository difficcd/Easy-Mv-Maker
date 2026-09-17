// Does a stroke actually reach the canvas?
//
// boot.mjs asks whether the page comes up. This asks whether the thing the app is for still
// works, which nothing else does: there are over a thousand unit tests and not one of them
// draws. Every one of them ends at the edge of a canvas, because a canvas needs a browser.
//
// That gap matters more than it used to. The per-tool half of the draw pipeline moved into a
// dispatch table (#237) and the gesture state moved into a hook (#236), so "pointer down lays
// ink on the layer" now passes through a table lookup, a context object and a commit path that
// resolves and reveals the target layer. All of that is reachable from a unit test in pieces,
// and from nothing at all as a whole.
//
// Kept to the same shape as boot.mjs: one page, a handful of assertions, no framework.

import { chromium } from 'playwright-core';

const url = process.env.SMOKE_URL || 'http://localhost:4173/';
const errors = [];

const channels = process.env.SMOKE_CHANNEL ? [process.env.SMOKE_CHANNEL] : ['chrome', 'msedge', 'chromium'];
let browser = null;
const tried = [];
for (const channel of channels) {
    try {
        browser = await chromium.launch({ channel });
        break;
    } catch (e) {
        tried.push(`${channel}: ${String(e.message).slice(0, 100)}`);
    }
}
if (!browser) {
    console.error('No browser to run the draw smoke test in. Tried:');
    for (const t of tried) console.error('  ' + t);
    process.exit(1);
}

/** Pixels on the main canvas that are neither white nor transparent - i.e. ink. */
const inkCount = (page) => page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')]
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;                       // transparent
        if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) continue;  // the white ground
        n++;
    }
    return n;
});

let failure = null;
let page = null;
try {
    page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(`uncaught: ${e.message}`));
    // A recovered autosave would put someone else's drawing on the canvas and make the ink
    // count meaningless. Always decline.
    page.on('dialog', d => d.dismiss().catch(() => { }));

    const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    if (!res || !res.ok()) throw new Error(`the page did not load: ${res && res.status()}`);
    await page.waitForSelector('canvas', { timeout: 15_000 });

    const box = await page.evaluate(() => {
        const c = [...document.querySelectorAll('canvas')]
            .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (!box || box.w < 80 || box.h < 60) throw new Error(`the canvas is not on screen: ${JSON.stringify(box)}`);

    const before = await inkCount(page);

    // A mouse, not a finger: touch is rejected on purpose (palm rejection), so a drag that
    // reported itself as touch would prove the opposite of what this is checking.
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    await page.mouse.move(cx - box.w * 0.2, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx - box.w * 0.2 + (box.w * 0.4 * i) / 8, cy + Math.sin(i) * 8);
    await page.mouse.up();

    // The stroke is committed to layer state and the frame repainted, neither of which is
    // synchronous with the pointer up.
    await page.waitForTimeout(600);
    const after = await inkCount(page);
    if (after <= before) {
        throw new Error(`the drag laid down nothing: ${before} ink pixels before, ${after} after`);
    }

    // Undo has to reach it too. A stroke that cannot be taken back is worse than one that was
    // never laid, and this is the cheapest place that the whole commit path is observable.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    const undone = await inkCount(page);
    if (undone >= after) {
        throw new Error(`undo did not remove the stroke: ${after} ink pixels, ${undone} after undo`);
    }

    if (errors.length) throw new Error('console errors:' + errors.map(e => '\n  ' + e).join(''));
    console.log(`draw smoke passed - ${after - before} ink pixels from one drag, undo cleared to ${undone}`);
} catch (e) {
    failure = e;
    try { if (page) await page.screenshot({ path: 'draw-smoke-failure.png', fullPage: true }); } catch { }
} finally {
    await browser.close();
}

if (failure) {
    console.error('draw smoke failed:', failure.message);
    process.exit(1);
}
