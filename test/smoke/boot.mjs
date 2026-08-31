// Does the app actually come up?
//
// `vite build` succeeding says the bundler resolved every import. It says nothing about whether
// the page runs: a component that returns undefined, a module-level throw, a null deref during
// the first render - all of those build cleanly and produce a white screen. Every other check in
// this repository is static, so nothing before this one has ever opened the page.
//
// Deliberately shallow. It loads the built bundle, waits for the app to mount, and asserts the
// drawing canvas and the toolbar exist and that nothing was logged as an error. Anything deeper
// belongs in a real end-to-end suite; this is the smallest thing that catches a white screen.

// playwright-core rather than playwright: the full package downloads its own browser builds on
// install, which is over a hundred megabytes for a check that only needs to open one page. This
// drives a browser that is already on the machine - Chrome on the CI runners, Chrome or Edge on
// a Windows desktop - and says which ones it tried when it cannot find any.
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
    console.error('No browser to run the smoke test in. Tried:');
    for (const t of tried) console.error('  ' + t);
    process.exit(1);
}

let failure = null;
let page = null;
try {
    page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(`uncaught: ${e.message}`));

    const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    if (!res || !res.ok()) throw new Error(`the page did not load: ${res && res.status()}`);

    // The canvas is created by React, so waiting for it is waiting for the first render to have
    // happened rather than merely for the bundle to have been fetched.
    await page.waitForSelector('canvas', { timeout: 15_000 });

    // The biggest canvas on the page is the drawing surface - the others are the colour wheel
    // and the live stroke overlay. Picking it by size rather than by a test-only attribute keeps
    // the hook out of the application, and the size assertion is the real check anyway: a
    // drawing canvas that came up at 174x174 has not been given the project's dimensions.
    const size = await page.evaluate(() => [...document.querySelectorAll('canvas')]
        .map(c => ({ w: c.width, h: c.height }))
        .sort((a, b) => b.w * b.h - a.w * a.h)[0] || null);
    if (!size || size.w < 640 || size.h < 360) {
        throw new Error(`no full-size drawing canvas: largest was ${JSON.stringify(size)}`);
    }

    // A white screen usually still has a canvas somewhere, so this also checks that the chrome
    // around it rendered: the tool buttons and the timeline are separate subtrees, and one of
    // them throwing while the other survives is exactly the failure worth catching.
    const counts = await page.evaluate(() => ({
        buttons: document.querySelectorAll('button').length,
        panels: document.querySelectorAll('.panel-title, .tl-tracks, .toolbar').length,
    }));
    if (counts.buttons < 5) throw new Error(`only ${counts.buttons} buttons rendered - the UI did not come up`);
    // Counted separately on purpose: the panels and the timeline are different subtrees from the
    // toolbar, and one of them throwing while the others survive is exactly the failure a button
    // count on its own sails straight past.
    if (counts.panels < 2) throw new Error(`only ${counts.panels} panels rendered - part of the UI is missing`);

    // The regression this test was written after was the built app having no backend: the API
    // proxy is configured for the dev server, and `vite preview` does not inherit it. The console
    // says nothing about that - the app catches the failed probe and quietly calls itself offline
    // - so the check has to be made from the page, against the origin the page actually uses.
    const api = await page.evaluate(async () => {
        try { return (await fetch('/api/projects')).status; } catch (e) { return String(e); }
    });
    if (api !== 200) throw new Error(`the API is not reachable from the page: /api/projects gave ${api}`);

    // A failed asset or a caught-but-real exception shows up here and nowhere else.
    if (errors.length) throw new Error('console errors:' + errors.map(e => '\n  ' + e).join(''));

    console.log(`smoke passed - canvas ${size.w}x${size.h}, ${counts.buttons} buttons, API reachable, no console errors`);
} catch (e) {
    failure = e;
    // A screenshot is the only way to tell "white screen" from "loaded but missing an element"
    // when this fails on a machine nobody is sitting at.
    try { if (page) await page.screenshot({ path: 'smoke-failure.png', fullPage: true }); } catch { }
} finally {
    await browser.close();
}

if (failure) {
    console.error('smoke failed:', failure.message);
    process.exit(1);
}
