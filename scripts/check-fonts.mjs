// Do the bundled faces still render, distinctly, with the network off?
//
// Serves the built app, blocks every request that leaves the origin, then draws the same line in
// each bundled family and compares the pixels.
//
// Pixels, not widths: CJK faces are full-width by design, so the same text in three different
// Japanese fonts measures the same number of pixels across. Width tells you nothing here - only
// what the glyphs actually look like does.
//
// Not part of `npm run check`: it needs a build, a preview server and a real Chrome. Run it after
// touching the bundled fonts.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/check-fonts.mjs http://localhost:4173/
//   node scripts/check-fonts.mjs http://localhost:4173/ ko     one language

import { chromium } from 'playwright-core';

const LANGS = {
    ja: {
        label: 'Japanese',
        text: '夜明けまで強がらなくてもいい',
        families: ['Noto Sans JP', 'Shippori Mincho', 'Zen Maru Gothic'],
        // Gowun Dodum ships one weight, so only the faces that have a bold are asked for one.
        noBold: [],
    },
    ko: {
        label: 'Korean',
        text: '새벽이 오기 전까지 강한 척 안 해도 돼',
        families: ['Noto Sans KR', 'Noto Serif KR', 'Gowun Dodum'],
        noBold: ['Gowun Dodum'],
    },
};

const url = process.argv[2] || 'http://localhost:4173/';
const only = process.argv[3];
if (only && !LANGS[only]) throw new Error(`unknown language ${only}; expected one of ${Object.keys(LANGS).join(', ')}`);
const langs = only ? [only] : Object.keys(LANGS);

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

/**
 * Draw the line in one face and fingerprint what came out.
 *
 * Screenshotted out of the page itself. An SVG loaded as an `<img>` is a separate document and
 * cannot see the page's webfonts, so rendering that way silently measures whatever the system has
 * installed - which is how a working face can look broken and a missing one can look fine.
 */
async function shot(family, weight, text) {
    await page.evaluate(async ({ family, weight, text }) => {
        document.getElementById('probe')?.remove();
        const el = document.createElement('div');
        el.id = 'probe';
        el.textContent = text;
        el.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#000;'
            + `padding:8px;white-space:nowrap;font:${weight} 64px '${family}', sans-serif`;
        document.body.appendChild(el);
        await document.fonts.load(`${weight} 64px '${family}'`, text);
        await document.fonts.ready;
    }, { family, weight, text });
    await page.waitForTimeout(120);
    const png = await page.locator('#probe').screenshot();
    let hash = 2166136261;
    for (const b of png) { hash ^= b; hash = Math.imul(hash, 16777619); }
    return { hash: (hash >>> 0).toString(16), bytes: png.length };
}

let failures = 0;
for (const lang of langs) {
    const { label, text, families, noBold } = LANGS[lang];
    const fallback = await shot('__no_such_family__', 400, text);
    const seen = new Map();

    console.log(`\n${label}  (fallback ${fallback.hash})`);
    for (const family of families) {
        const r400 = await shot(family, 400, text);
        const loaded = r400.hash !== fallback.hash;
        if (!loaded) failures++;

        let boldNote = '';
        if (!noBold.includes(family)) {
            const r700 = await shot(family, 700, text);
            if (r700.hash === r400.hash) { boldNote = ', *** bold identical to regular ***'; failures++; }
        }
        const clash = seen.get(r400.hash);
        if (clash) { boldNote += `, *** renders identically to ${clash} ***`; failures++; }
        seen.set(r400.hash, family);

        console.log(`  ${family.padEnd(18)} ${r400.hash}  ${String(r400.bytes).padStart(5)}B  `
            + `${loaded ? 'loaded' : '*** fell back ***'}${boldNote}`);
    }
}

const declared = await page.evaluate(() => [...document.fonts]
    .map(f => `${f.family} ${f.weight} ${f.status}`)
    .filter(l => /Noto Sans (JP|KR)|Noto Serif KR|Shippori|Zen Maru|Gowun/.test(l)));
await browser.close();

const hosts = [...new Set(blocked)];
console.log(`\noff-origin requests blocked: ${hosts.length ? hosts.join(', ') : 'none attempted'}`);
console.log(`declared: ${declared.join(' | ')}`);
console.log(failures ? `\n${failures} problem(s)` : '\nevery bundled face loaded and rendered distinctly');
process.exitCode = failures ? 1 : 0;
