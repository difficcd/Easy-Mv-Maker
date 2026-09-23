// Where a frame's time actually goes.
//
// scripts/bench.mjs measures the pure helpers and says in its own header what it cannot see: the
// repaint and React's re-render. Every number it prints is microseconds against a 16.7ms budget,
// so whatever the cost is, it is not there - it is on the canvas, and a canvas needs a browser.
//
// Same shape as the smoke tests: one page, playwright-core, no framework. This one instruments
// rather than asserts, so it prints numbers and never fails a build. It is not in `npm run
// check` for that reason - run it when you want to know.
//
//   node scripts/profile-frame.mjs                 against the dev server on 5175
//   PROFILE_URL=http://localhost:4173/ node ...    against a production build
//
// What it measures, and why each one:
//
//   frame time     how long the rAF callback takes. This is the number that decides whether
//                  drawing feels attached to the pen.
//   2d calls       counted per frame. A count that scales with the document rather than with
//                  what changed is the shape of problem worth finding.
//   readbacks      getImageData/putImageData time separately. They stall the GPU pipeline, and
//                  one per frame can cost more than everything else together.
//
// Two things it cannot see, and neither should be read as "fast" when it prints small numbers:
//
//   raster and compositing. The timings are the JS in the rAF callback. Handing the browser two
//   full-size canvases to scale and composite costs real time on a weak GPU and none of it lands
//   here, which matters because that is the likely shape of the tablet problem in #338.
//
//   playback with an empty document. The playback phase only means something once there are cuts
//   worth playing; on the default one-cut document it finishes before the window does.

import { chromium } from 'playwright-core';

const url = process.env.PROFILE_URL || 'http://localhost:5175/';
const SECONDS = Number(process.env.PROFILE_SECONDS || 4);
const STROKES = Number(process.env.PROFILE_STROKES || 40);
/** The pencil button's title, which is its label run through tr(). */
/** The pencil button's title - its label through tr(), so it depends on the UI language. */
const PENCIL = process.env.PROFILE_PENCIL || '연필|Pencil';

const channels = process.env.SMOKE_CHANNEL ? [process.env.SMOKE_CHANNEL] : ['chrome', 'msedge', 'chromium'];
let browser = null;
const tried = [];
for (const channel of channels) {
    try { browser = await chromium.launch({ channel }); break; }
    catch (e) { tried.push(`${channel}: ${String(e.message).slice(0, 100)}`); }
}
if (!browser) {
    console.error('No browser to profile in. Tried:');
    for (const t of tried) console.error('  ' + t);
    process.exit(1);
}

/**
 * Wrap requestAnimationFrame and the 2d context so a run can be measured from inside the page.
 *
 * Wrapping the prototype catches every context the app makes, including the scratch canvases,
 * which is the point: a cost that only appears on a scratch is still a cost.
 */
const instrument = () => {
    const W = window;
    W.__prof = { frames: [], calls: {}, readback: 0, readbackMs: 0 };
    const p = W.__prof;

    const raf = W.requestAnimationFrame.bind(W);
    W.requestAnimationFrame = (cb) => raf((t) => {
        const a = performance.now();
        try { cb(t); } finally { p.frames.push(performance.now() - a); }
    });

    const proto = CanvasRenderingContext2D.prototype;
    const counted = ['drawImage', 'fillText', 'strokeText', 'clearRect', 'fillRect', 'fill',
        'stroke', 'save', 'restore', 'putImageData', 'createLinearGradient', 'beginPath'];
    // Attributed by the canvas drawn onto, not just totalled. "66 fillRects a frame" says
    // nothing until you know whether they are the stroke or a panel redrawing itself for no
    // reason, and the size is enough to tell those apart.
    p.byCanvas = {};
    const who = (ctx) => {
        const c = ctx.canvas;
        return `${c.width}x${c.height}${c.id ? '#' + c.id : ''}${c.className ? '.' + String(c.className).split(' ')[0] : ''}`;
    };
    // Timed as well as counted. Not everything happens inside a rAF callback - committing a
    // stroke repaints the layer cache straight through, so a frame timer reports 0ms for work
    // that is plainly there. Twenty-five thousand draw calls do not take no time.
    p.drawMs = 0; p.msByCanvas = {}; p.msByCall = {};
    for (const m of counted) {
        const orig = proto[m];
        if (typeof orig !== 'function') continue;
        proto[m] = function (...a) {
            p.calls[m] = (p.calls[m] || 0) + 1;
            const k = who(this);
            (p.byCanvas[k] ||= {})[m] = ((p.byCanvas[k] || {})[m] || 0) + 1;
            const t0 = performance.now();
            try { return orig.apply(this, a); }
            finally {
                const dt = performance.now() - t0;
                p.drawMs += dt;
                p.msByCanvas[k] = (p.msByCanvas[k] || 0) + dt;
                p.msByCall[m] = (p.msByCall[m] || 0) + dt;
            }
        };
    }
    // The two that are worth timing rather than counting: they force a pipeline flush.
    for (const m of ['getImageData', 'putImageData']) {
        const orig = proto[m];
        proto[m] = function (...a) {
            const t0 = performance.now();
            try { return orig.apply(this, a); }
            finally { p.readback++; p.readbackMs += performance.now() - t0; }
        };
    }
    // Canvas allocation: a per-frame allocation of a full-size canvas is its own kind of cost.
    const create = Document.prototype.createElement;
    p.canvases = 0;
    Document.prototype.createElement = function (tag, ...rest) {
        if (String(tag).toLowerCase() === 'canvas') p.canvases++;
        return create.call(this, tag, ...rest);
    };
};

/** Zero the counters without re-wrapping anything, so each phase is measured on its own. */
const rearm = () => {
    const p = window.__prof;
    p.frames = []; p.calls = {}; p.readback = 0; p.readbackMs = 0; p.canvases = 0; p.byCanvas = {}; p.drawMs = 0; p.msByCanvas = {}; p.msByCall = {};
};

const stats = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
    return {
        n: s.length,
        mean: s.reduce((a, b) => a + b, 0) / s.length,
        p50: at(0.5), p95: at(0.95), max: s[s.length - 1],
        over16: s.filter(v => v > 16.7).length,
    };
};

const report = (label, p) => {
    const f = stats(p.frames);
    console.log(`\n${label}`);
    if (!f) { console.log('  no frames - nothing was animating'); }
    else {
        console.log(`  frames            ${f.n} in ${SECONDS}s  (${(f.n / SECONDS).toFixed(0)}/s)`);
        console.log(`  frame time        mean ${f.mean.toFixed(2)}ms   p50 ${f.p50.toFixed(2)}ms   p95 ${f.p95.toFixed(2)}ms   max ${f.max.toFixed(2)}ms`);
        console.log(`  over budget       ${f.over16} frame(s) past 16.7ms`);
        const per = (n) => (n / Math.max(1, f.n)).toFixed(1);
        const calls = Object.entries(p.calls).sort((a, b) => b[1] - a[1]);
        if (calls.length) console.log('  2d calls/frame    ' + calls.map(([k, v]) => `${k} ${per(v)}`).join('  '));
        for (const [c, ms] of Object.entries(p.byCanvas || {})) {
            const tot = Object.values(ms).reduce((a, b) => a + b, 0);
            console.log(`    on ${c.padEnd(18)} ${per(tot).padStart(6)}/frame   ` +
                Object.entries(ms).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${per(v)}`).join('  '));
        }
    }
    console.log(`  image readback    ${p.readback} call(s), ${p.readbackMs.toFixed(1)}ms total`);
    console.log(`  canvases made     ${p.canvases}`);
};

let failure = null;
let page = null;
try {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(`uncaught: ${e.message}`));
    page.on('dialog', d => d.dismiss().catch(() => { }));

    // Before the app's scripts, not after: a module that captures requestAnimationFrame once at
    // load would otherwise keep the real one and every frame it schedules would go unseen. The
    // first run of this script measured 0.08ms frames for exactly that reason.
    await page.addInitScript(instrument);

    const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    if (!res || !res.ok()) throw new Error(`the page did not load: ${res && res.status()}`);
    await page.waitForSelector('canvas', { timeout: 15_000 });
    await page.waitForTimeout(800);

    const box = await page.evaluate(() => {
        const c = [...document.querySelectorAll('canvas')]
            .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (!box || box.w < 80) throw new Error(`the canvas is not on screen: ${JSON.stringify(box)}`);

    // --- 1. idle -------------------------------------------------------------------------
    // Nothing is happening. Anything here is work the app does for no reason, which is the
    // cheapest kind of overhead to remove.
    await page.evaluate(rearm);
    await page.waitForTimeout(SECONDS * 1000);
    report(`IDLE - nothing touched, ${SECONDS}s`, await page.evaluate(() => window.__prof));

    // --- 2. drawing ----------------------------------------------------------------------
    // The one that decides whether the pen feels attached (#338). A slow continuous drag, so
    // the cost per move is measured rather than the cost of one flick.
    await page.evaluate(rearm);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const steps = SECONDS * 60;
    await page.mouse.move(cx - box.w * 0.35, cy);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
            cx - box.w * 0.35 + (box.w * 0.7 * i) / steps,
            cy + Math.sin(i / 6) * box.h * 0.25,
        );
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    report(`DRAWING - one continuous ${steps}-move drag`, await page.evaluate(() => window.__prof));

    // --- 3. drawing on top of what is already there ---------------------------------------
    // The same drag again, with the first stroke now on the layer. If this is dearer than the
    // one above, the cost grows with what has been drawn - which is what "it gets slower the
    // longer I work" means, and the thing most worth finding.
    await page.evaluate(rearm);
    await page.mouse.move(cx - box.w * 0.35, cy + 30);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
            cx - box.w * 0.35 + (box.w * 0.7 * i) / steps,
            cy + 30 + Math.sin(i / 6) * box.h * 0.25,
        );
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    report(`DRAWING AGAIN - same drag, one stroke already on the layer`, await page.evaluate(() => window.__prof));

    // --- 4. playback -------------------------------------------------------------------------
    // The only phase that runs the whole paint path - evaluateFrame, the layer cache, the camera,
    // the texts. Drawing does not: the live overlay appends the new tail and leaves the rest
    // alone, which is why phases 2 and 3 show no clearRect and no drawImage at all.
    const playButton = () => {
        const wanted = /play|pause|재생|정지/i;
        return [...document.querySelectorAll('button')]
            .find(b => wanted.test(b.title || '') || wanted.test(b.getAttribute('aria-label') || ''));
    };
    // A boolean, not the element: a DOM node does not cross back out of the page.
    const played = await page.evaluate(`!!(${playButton})()`).catch(() => false);
    if (!played) {
        console.log('\nPLAYBACK - skipped, no play button found');
    } else {
        await page.evaluate(`(${playButton})().click()`);
        await page.evaluate(rearm);
        await page.waitForTimeout(SECONDS * 1000);
        report(`PLAYBACK - ${SECONDS}s`, await page.evaluate(() => window.__prof));
        await page.evaluate(`(${playButton})().click()`);
    }

    // --- 5. does it get slower the more you have drawn? ---------------------------------------
    // The question worth asking, and the one the phases above cannot answer: they draw twice.
    // Committing a stroke invalidates the layer and the cache repaints it, and a repaint that
    // redraws every stroke costs more each time - which is what "it gets heavy after a while"
    // means. Measured per stroke, drag and commit separately, because they fail differently:
    // a slow drag lags the pen, a slow commit hitches once when you lift it.
    const pickTool = (pattern) => {
        const re = new RegExp(`^(${pattern})$`, 'i');
        const b = [...document.querySelectorAll('button')].find(x => re.test((x.title || '').trim()));
        if (b) b.click();
        return !!b;
    };
    const gotPencil = await page.evaluate(`(${pickTool})(${JSON.stringify(PENCIL)})`).catch(() => false);
    console.log(`
STROKE SCALING - ${STROKES} pencil strokes, one at a time` +
        (gotPencil ? '' : `  (could not find the "${PENCIL}" button; using whatever tool was active)`));
    console.log('  stroke   drag p95    commit draw    commit frames   2d calls on commit');

    const rows = [];
    for (let i = 1; i <= STROKES; i++) {
        const y = box.y + 40 + ((i * 17) % Math.max(40, box.h - 80));
        const x0 = box.x + 40;
        await page.evaluate(rearm);
        await page.mouse.move(x0, y);
        await page.mouse.down();
        for (let k = 1; k <= 10; k++) await page.mouse.move(x0 + k * (box.w * 0.06), y + Math.sin(k) * 6);
        const drag = await page.evaluate(() => window.__prof.frames.slice());

        // Re-armed between the drag and the lift, so the commit repaint is measured on its own.
        await page.evaluate(rearm);
        await page.mouse.up();
        await page.waitForTimeout(220);
        const commit = await page.evaluate(() => {
            const p = window.__prof;
            return { frames: p.frames.slice(), calls: { ...p.calls }, canvases: p.canvases, readbackMs: p.readbackMs, drawMs: p.drawMs, msByCanvas: { ...p.msByCanvas }, msByCall: { ...p.msByCall } };
        });
        rows.push({ i, drag, commit });

        if ([1, 5, 10, 20, 30, 40, 50].includes(i) || i === STROKES) {
            const d = stats(drag), total = commit.drawMs;
            const calls = Object.values(commit.calls).reduce((a, b) => a + b, 0);
            console.log(
                `  ${String(i).padStart(6)}   ${(d ? d.p95.toFixed(2) : '-').padStart(8)}ms   ` +
                `${total.toFixed(2).padStart(9)}ms   ${String(commit.frames.length).padStart(13)}   ${String(calls).padStart(18)}`);
        }
    }

    const last = rows[rows.length - 1];
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]) => `${k} ${v.toFixed(1)}ms`).join('  ');
    console.log(`
  where the last commit's time went`);
    console.log(`    by canvas   ${top(last.commit.msByCanvas)}`);
    console.log(`    by call     ${top(last.commit.msByCall)}`);

    // The trend is the answer, so say it rather than leaving it to be eyeballed.
    const commitTotal = (r) => r.commit.drawMs;
    const early = rows.slice(0, 5), late = rows.slice(-5);
    const mean = (xs, f) => xs.reduce((a, b) => a + f(b), 0) / Math.max(1, xs.length);
    const e = mean(early, commitTotal), l = mean(late, commitTotal);
    const eCalls = mean(early, r => Object.values(r.commit.calls).reduce((a, b) => a + b, 0));
    const lCalls = mean(late, r => Object.values(r.commit.calls).reduce((a, b) => a + b, 0));
    console.log(`
  first 5 strokes   commit ${e.toFixed(2)}ms, ${eCalls.toFixed(0)} 2d calls`);
    console.log(`  last 5 strokes    commit ${l.toFixed(2)}ms, ${lCalls.toFixed(0)} 2d calls`);
    console.log(`  growth            ${(e > 0 ? (l / e).toFixed(2) : 'n/a')}x time, ${(eCalls > 0 ? (lCalls / eCalls).toFixed(2) : 'n/a')}x calls`);
    // Say which of the two it is rather than printing a maxim that may not apply. They mean
    // different things: more calls is the layer being redrawn from every stroke it holds, the
    // same calls costing more is the same drawing getting dearer to raster.
    const callGrowth = eCalls > 0 ? lCalls / eCalls : 1;
    console.log(callGrowth > 1.8
        ? '  Calls grow with the stroke count: the whole layer is redrawn on every commit.'
        : '  Calls are flat, so only the new stroke is drawn - any growth is in what each call costs.');

    if (errors.length) console.log('\npage errors:' + errors.map(e => '\n  ' + e).join(''));
} catch (e) {
    failure = e;
} finally {
    await browser.close();
}

if (failure) {
    console.error('profile failed:', failure.message);
    process.exit(1);
}
