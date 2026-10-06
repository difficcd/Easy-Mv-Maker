// Does the video importer keep every frame it should?
//
// #124 sat open for months as "the exact-duplicate dedupe looks slightly off", with no way to
// say which direction it erred in - the reporter had a video, the repository did not, and a
// threshold can be wrong in two opposite ways. This builds its own video instead: one second at
// 30fps where every single frame is a different colour. In `exact` mode nothing in it can
// legitimately be merged, so `skipped` must be 0 at any import rate, and anything else is a bug
// with a number on it.
//
// That is how the cause was found. Importing at 30fps kept 21 of 30 and merged 9, in the
// giveaway pattern holds=[1,2,1,2,...]; at 6 and 15fps nothing merged, which is why it only ever
// looked "slightly" off. The signature was innocent - the merged captures really were
// byte-identical, because seeking to exactly a frame boundary returned the frame before it.
//
//   node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/video-dedupe-check.mjs
//
// Needs ffmpeg on PATH and the dev server running (npm run dev).

import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.MV_ORIGIN || 'http://127.0.0.1:5175/';
const FRAMES = 30;

/** A clip whose every frame is a different colour, so any merge at all is a wrong answer. */
function buildClip(dir) {
    const out = join(dir, 'distinct.mp4');
    execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=black:s=320x240:r=${FRAMES}:d=1`,
        '-vf', "geq=r='mod(N*37+10,256)':g='mod(N*91+20,256)':b='mod(N*53+30,256)'",
        '-frames:v', String(FRAMES),
        // Lossless, so two frames can never become identical through compression - which would
        // make a merge correct and the test meaningless.
        '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', out,
    ]);
    return out;
}

const dir = mkdtempSync(join(tmpdir(), 'mv-dedupe-'));
let bad = 0;
try {
    const clip = readFileSync(buildClip(dir)).toString('base64');
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
        const page = await browser.newPage();
        await page.goto(ORIGIN);
        await page.waitForLoadState('networkidle');
        const rows = await page.evaluate(async (b64) => {
            const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const file = new Blob([bin], { type: 'video/mp4' });
            const mod = await import('/src/canvas/videoFrames.ts');
            const out = [];
            for (const fps of [30, 15, 6]) {
                const t0 = performance.now();
                const r = await mod.extractVideoFrames(file, { fps, dedupe: 'exact', scale: 1, format: 'png' });
                out.push({ fps, kept: r.frames.length, skipped: r.skipped, holds: r.holds.join(','), ms: Math.round(performance.now() - t0) });
            }
            return out;
        }, clip);

        console.log(`A one-second ${FRAMES}fps clip whose frames are all different colours.`);
        console.log('In "exact" mode nothing in it can be merged, so skipped must be 0.\n');
        for (const r of rows) {
            const ok = r.skipped === 0;
            if (!ok) bad++;
            console.log(`  ${ok ? 'ok  ' : 'BAD '} fps=${String(r.fps).padStart(2)}  kept=${String(r.kept).padStart(2)}  skipped=${r.skipped}  ${String(r.ms).padStart(4)}ms  holds=[${r.holds}]`);
        }
        console.log(bad
            ? `\n${bad} import rate(s) merged frames that differ. A holds pattern of [1,2,1,2,...] is the\nseek landing on a frame boundary and returning the frame before it - see seekTarget.`
            : '\nEvery frame survived at every rate.');
    } finally {
        await browser.close();
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
