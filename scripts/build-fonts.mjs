// Download the bundled CJK faces and subset them, so the app has real Japanese and Korean type
// with the network off.
//
// The families came from Google Fonts @import rules, which work in a browser with a connection
// and nowhere else - not in the APK, and not in an installed PWA, because the service worker
// caches the app shell and not a third-party CDN. In both cases the text quietly fell back to
// whatever the system had, which is the situation bundling them is meant to fix.
//
// Why subset rather than bundle what Google serves: Google splits a CJK face into ~120
// unicode-range chunks so a browser fetches only what it needs. Copying those in is 612 files
// and 16.5MB for three Japanese families - measured - which an APK carries forever.
//
// What each language is subset to, and why, is in scripts/charset.py.
//
// Licences: every face here is SIL OFL, checked rather than assumed. Noto reserves the name
// 'Source', not 'Noto' - the CJK faces derive from Source Han - so a subset may keep its family
// name; the others reserve no name at all. The licence text ships beside the fonts in
// public/fonts/.
//
//   node scripts/build-fonts.mjs          both
//   node scripts/build-fonts.mjs ja       one language
//
// Needs pyftsubset (fonttools) with brotli, for woff2 output.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl';
const OUT = 'src/fonts';
const LICENCES = 'public/fonts';
const WORK = 'build/fonts';

/**
 * Regular and bold, except where one variable file covers the range.
 *
 * Three faces a language, chosen to cover the three basic looks rather than to be exhaustive:
 * a gothic, a serif, and a soft one. The rest of the families stay on the CDN, which is fine
 * while there is a connection and is what "not doing parity" means.
 */
const LANGS = {
    ja: {
        css: 'japanese.css',
        label: 'Japanese',
        faces: [
            { family: 'Noto Sans JP', dir: 'notosansjp', file: 'NotoSansJP[wght].ttf', out: 'NotoSansJP-jis1', variable: '400 700' },
            { family: 'Shippori Mincho', dir: 'shipporimincho', file: 'ShipporiMincho-Regular.ttf', out: 'ShipporiMincho-jis1', weight: '400' },
            { family: 'Shippori Mincho', dir: 'shipporimincho', file: 'ShipporiMincho-Bold.ttf', out: 'ShipporiMincho-Bold-jis1', weight: '700' },
            { family: 'Zen Maru Gothic', dir: 'zenmarugothic', file: 'ZenMaruGothic-Regular.ttf', out: 'ZenMaruGothic-jis1', weight: '400' },
            { family: 'Zen Maru Gothic', dir: 'zenmarugothic', file: 'ZenMaruGothic-Bold.ttf', out: 'ZenMaruGothic-Bold-jis1', weight: '700' },
        ],
    },
    ko: {
        css: 'korean.css',
        label: 'Korean',
        faces: [
            { family: 'Noto Sans KR', dir: 'notosanskr', file: 'NotoSansKR[wght].ttf', out: 'NotoSansKR-kr', variable: '400 700' },
            { family: 'Noto Serif KR', dir: 'notoserifkr', file: 'NotoSerifKR[wght].ttf', out: 'NotoSerifKR-kr', variable: '400 700' },
            // Gowun Dodum ships one weight; asking for a bold would synthesise one, which on a
            // soft face looks like a smudge, so the @font-face claims 400 only.
            { family: 'Gowun Dodum', dir: 'gowundodum', file: 'GowunDodum-Regular.ttf', out: 'GowunDodum-kr', weight: '400' },
        ],
    },
};

const only = process.argv[2];
if (only && !LANGS[only]) throw new Error(`unknown language ${only}; expected one of ${Object.keys(LANGS).join(', ')}`);
const langs = only ? [only] : Object.keys(LANGS);

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(LICENCES, { recursive: true });

async function download(url, to) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

let grand = 0;
for (const lang of langs) {
    const { faces, css: cssName, label } = LANGS[lang];
    const charset = join(WORK, `${lang}.txt`);
    execFileSync('python', ['scripts/charset.py', lang, charset], { stdio: 'inherit' });

    for (const dir of [...new Set(faces.map(f => f.dir))]) {
        await download(`${RAW}/${dir}/OFL.txt`, join(LICENCES, `OFL-${dir}.txt`));
    }

    const rows = [];
    for (const face of faces) {
        const src = join(WORK, face.file.replace(/[[\]]/g, '_'));
        await download(`${RAW}/${face.dir}/${encodeURIComponent(face.file)}`, src);
        const dest = join(OUT, `${face.out}.woff2`);
        execFileSync('pyftsubset', [
            src,
            `--text-file=${charset}`,
            `--output-file=${dest}`,
            '--flavor=woff2',
            '--layout-features=*',   // keep vertical forms and the alternates
            '--no-hinting',          // hinting is for small sizes on old screens and costs real bytes
        ], { stdio: 'inherit' });
        rows.push({ ...face, kb: Math.round(statSync(dest).size / 1024), from: Math.round(statSync(src).size / 1024) });
    }

    const count = readFileSync(charset, 'utf8').length;
    writeFileSync(join(OUT, cssName), `/* Generated by scripts/build-fonts.mjs - do not edit by hand.
 *
 * ${label} faces bundled with the app rather than fetched from Google Fonts, so they are there
 * with the network off - in the APK, and in an installed PWA. Subset to ${count} characters;
 * scripts/charset.py says which, and why those.
 *
 * SIL Open Font License 1.1. The licence text is served beside them, in /fonts/.
 */
${rows.map(r => `@font-face {
    font-family: '${r.family}';
    font-style: normal;
    font-weight: ${r.variable || r.weight};
    font-display: swap;
    src: url('./${r.out}.woff2') format('woff2');
}`).join('\n')}
`);

    const total = rows.reduce((n, r) => n + r.kb, 0);
    grand += total;
    for (const r of rows) console.log(`  ${r.out.padEnd(26)} ${String(r.from).padStart(5)} KB -> ${String(r.kb).padStart(4)} KB`);
    console.log(`  ${(label + ' total').padEnd(26)} ${' '.repeat(5)}    ${String(total).padStart(4)} KB\n`);
}

if (langs.length > 1) console.log(`  ${'bundled altogether'.padEnd(26)} ${' '.repeat(5)}    ${String(grand).padStart(4)} KB`);
