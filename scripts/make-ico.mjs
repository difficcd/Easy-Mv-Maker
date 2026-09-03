// Bake public/icon.svg into easy-mv-maker.ico, the icon the desktop shortcut uses.
//
// Rendered in a real browser rather than approximated, so the .ico is the same mark the app and
// the favicon show, and rendered with `omitBackground` so it keeps its alpha - the first version
// of this file came out colour type 2, no alpha channel at all, which is a white square behind
// the mark on the desktop.
//
//   node scripts/make-ico.mjs [out.ico]

import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 256];
const out = process.argv[2] || 'easy-mv-maker.ico';
const svg = readFileSync('public/icon.svg', 'utf8');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const pngs = [];
for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    // No margin, no background: the page is the mark and nothing else.
    await page.setContent(
        `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>` +
        svg.replace(/width="\d+"\s+height="\d+"/, `width="${size}" height="${size}"`),
        { waitUntil: 'load' });
    pngs.push(await page.screenshot({ omitBackground: true, type: 'png' }));
}
await browser.close();

// ICONDIR, then one ICONDIRENTRY per image, then the PNGs. A 256px entry writes its size as 0,
// which is how the format says "256" in one byte.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);          // 1 = icon
header.writeUInt16LE(SIZES.length, 4);

const entries = Buffer.alloc(16 * SIZES.length);
let offset = header.length + entries.length;
SIZES.forEach((size, i) => {
    const at = 16 * i;
    entries[at] = size >= 256 ? 0 : size;
    entries[at + 1] = size >= 256 ? 0 : size;
    entries[at + 2] = 0;             // palette entries: none, it is truecolour
    entries[at + 3] = 0;
    entries.writeUInt16LE(1, at + 4);        // colour planes
    entries.writeUInt16LE(32, at + 6);       // bits per pixel, with alpha
    entries.writeUInt32LE(pngs[i].length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += pngs[i].length;
});

const ico = Buffer.concat([header, entries, ...pngs]);
writeFileSync(out, ico);
console.log(`${out}: ${SIZES.map((s, i) => `${s}px ${pngs[i].length}B`).join(', ')} — ${ico.length} bytes total`);
