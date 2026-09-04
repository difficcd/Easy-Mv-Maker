// Does Japanese still render as distinct faces with the network off?
//
// Serves the built app, blocks every request that leaves the origin, then draws the same line in
// each bundled family and compares the pixels.
//
// Pixels, not widths: CJK faces are full-width by design, so the same text in three different
// Japanese fonts measures the same number of pixels across. Width tells you nothing here - only
// what the glyphs actually look like does.
//
// Not part of `npm run check`: it needs a build, a preview server and a real Chrome. Run it
// after touching the bundled fonts.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/check-jp-fonts.mjs http://localhost:4173/

import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

const blocked = [];
await page.route('**/*', (route) => {
    const target = new URL(route.request().url());
    if (target.host !== new URL(url).host) { blocked.push(target.host); return route.abort(); }
    return route.continue();
});

await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const TEXT = '夜明けまで強がらなくてもいい';
const FAMILIES = ['Noto Sans JP', 'Shippori Mincho', 'Zen Maru Gothic'];

// Screenshotted out of the page itself. An SVG loaded as an <img> is a separate document and
// cannot see the page's webfonts, so rendering that way silently measures whatever the system
// has installed - which is how a working face can look broken and a missing one can look fine.
async function shot(family, weight) {
    const id = 'probe';
    await page.evaluate(async ({ id, family, weight, text }) => {
        document.getElementById(id)?.remove();
        const el = document.createElement('div');
        el.id = id;
        el.textContent = text;
        el.style.cssText = `position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#000;`
            + `padding:8px;white-space:nowrap;font:${weight} 64px '${family}', sans-serif`;
        document.body.appendChild(el);
        await document.fonts.load(`${weight} 64px '${family}'`, text);
        await document.fonts.ready;
    }, { id, family, weight, text: TEXT });
    await page.waitForTimeout(120);
    const png = await page.locator('#probe').screenshot();
    let hash = 2166136261, ink = 0;
    for (const b of png) { hash ^= b; hash = Math.imul(hash, 16777619); }
    // Ink from the PNG bytes is not meaningful; size stands in as a rough proxy for how much
    // was drawn, and the hash is what actually decides whether two renderings differ.
    ink = png.length;
    return { hash: (hash >>> 0).toString(16), ink };
}

const result = { faces: {} };
result.fallback = await shot('__no_such_family__', 400);
for (const f of FAMILIES) result.faces[f] = { r400: await shot(f, 400), r700: await shot(f, 700) };
result.declared = await page.evaluate(() => [...document.fonts]
    .filter(f => /Noto Sans JP|Shippori|Zen Maru/.test(f.family))
    .map(f => `${f.family} ${f.weight} ${f.status}`));

await browser.close();

const hosts = [...new Set(blocked)];
console.log(`off-origin requests blocked: ${hosts.length ? hosts.join(', ') : 'none attempted'}`);
console.log(`fallback: ink ${result.fallback.ink}, hash ${result.fallback.hash}\n`);

let fellBack = 0;
const hashes = new Set();
for (const [family, r] of Object.entries(result.faces)) {
    const loaded = r.r400.hash !== result.fallback.hash;
    const boldDiffers = r.r700.hash !== r.r400.hash;
    hashes.add(r.r400.hash);
    if (!loaded) fellBack++;
    console.log(`${family.padEnd(18)} 400 ink ${String(r.r400.ink).padStart(5)} ${r.r400.hash}   `
        + `700 ink ${String(r.r700.ink).padStart(5)} ${r.r700.hash}   `
        + `${loaded ? 'loaded' : '*** fell back ***'}${loaded && !boldDiffers ? ', bold identical to regular' : ''}`);
}
console.log(`\ndeclared: ${result.declared.join(' | ')}`);
console.log(`${hashes.size} distinct renderings across ${Object.keys(result.faces).length} families`);
process.exitCode = fellBack === 0 && hashes.size === Object.keys(result.faces).length ? 0 : 1;
