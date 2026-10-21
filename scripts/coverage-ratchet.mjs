// Runs the unit tests with coverage, and fails if the honest coverage of src/ goes down.
//
// "Honest" is the point. Node's coverage report only lists files a test loaded, so a file no test
// touches is not a 0 in the table - it is not in the table at all. On 2026-10-21 the report said
// 96.8%, while 67 of the 150 files under src/ - every hook, every component, App.tsx - were never
// loaded by anything; counted in, src/ was 50.7% covered. And App.tsx, the untested file, was
// where the defects landed: 63 fixes, against 11 for the next file (docs/process/).
//
// So the files no test loads are counted, at their full length, as uncovered - the same way Node
// counts a loaded file, every line including comments, so the two halves are comparable.
//
// A ratchet, like the hook baseline: the figure may not fall below the pinned one. It does not
// demand a number; it demands that untested code stops accumulating. New code arrives with tests
// or it drags the figure down and fails here; logic moved out of App into a tested module pushes
// it up, and the baseline is raised to keep the ground gained.
//
//   node scripts/coverage-ratchet.mjs            run the tests, check the figure
//   UPDATE=1 node scripts/coverage-ratchet.mjs   raise the baseline to the current figure
//
// It replaces `npm test` in `npm run check`: coverage costs nothing measurable here (7s either
// way), so there is no reason to run the suite twice.

import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASELINE = 'scripts/coverage-baseline.json';
// Below the baseline by more than this fails. Covered-line counts are exact, so this only absorbs
// the rounding of the stored percentage.
const TOLERANCE = 0.05;

/**
 * Per-file line counts from an lcov report, keyed by repository path with forward slashes.
 *
 * @param {string} lcov
 * @returns {Map<string, {lf: number, lh: number}>}
 */
export function parseLcov(lcov) {
    const out = new Map();
    for (const rec of lcov.split('end_of_record')) {
        const sf = /^SF:(.+)$/m.exec(rec);
        if (!sf) continue;
        const lf = Number((/^LF:(\d+)$/m.exec(rec) || [])[1] || 0);
        const lh = Number((/^LH:(\d+)$/m.exec(rec) || [])[1] || 0);
        out.set(sf[1].trim().split('\\').join('/'), { lf, lh });
    }
    return out;
}

/**
 * Line coverage of a set of source files, with the ones no test loaded counted as uncovered.
 *
 * @param {Map<string, {lf: number, lh: number}>} covered what the test run reported
 * @param {string[]} files every source file that should be counted
 * @param {(file: string) => number} linesOf a file's line count, measured the way Node measures one
 * @returns {{lf: number, lh: number, pct: number, untested: string[]}}
 */
export function honestCoverage(covered, files, linesOf) {
    let lf = 0, lh = 0;
    const untested = [];
    for (const f of files) {
        const c = covered.get(f);
        if (c) { lf += c.lf; lh += c.lh; continue; }
        untested.push(f);
        lf += linesOf(f);
    }
    return { lf, lh, pct: lf ? Math.round(lh / lf * 10000) / 100 : 100, untested };
}

/** A file's lines as Node's coverage counts them: every line, the final newline not one. */
const nodeLines = (file) => Math.max(0, readFileSync(file, 'utf8').split('\n').length - 1);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const dir = mkdtempSync(join(tmpdir(), 'mv-cov-'));
    const lcovFile = join(dir, 'lcov.info');
    try {
        // The same flags as `npm test`, plus coverage. The dot reporter, not TAP: TAP printed 8,186
        // lines for a passing run (one per subtest, then the coverage table), which buried the one
        // line anyone reads; dot prints 67, and on a failure the same test name, assertion and
        // location TAP would. `npm test` keeps TAP for anyone running the suite by hand.
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', '--no-warnings=ExperimentalWarning',
            '--experimental-test-coverage',
            '--test-reporter=dot', '--test-reporter-destination=stdout',
            '--test-reporter=lcov', `--test-reporter-destination=${lcovFile}`,
            '--test', 'test/**/*.test.js',
        ], { stdio: 'inherit' });
        if (run.status !== 0) process.exit(run.status ?? 1);

        // --others as well as the index: a new file is untracked until it is added, and without
        // this a new untested file was invisible here - the gate passed locally and failed in CI.
        // Found the first time it was used, on a module that had not been `git add`ed yet.
        const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { encoding: 'utf8' })
            .split('\n').filter(f => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));
        const r = honestCoverage(parseLcov(readFileSync(lcovFile, 'utf8')), files, nodeLines);

        const byFolder = {};
        for (const f of r.untested) {
            const k = f.split('/').length > 2 ? f.split('/').slice(0, 2).join('/') + '/' : f;
            byFolder[k] = (byFolder[k] || 0) + nodeLines(f);
        }
        const gaps = Object.entries(byFolder).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');

        if (process.env.UPDATE) {
            writeFileSync(BASELINE, JSON.stringify({ srcLinePct: r.pct, measured: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
            console.log(`Coverage baseline set to ${r.pct}%.`);
            process.exit(0);
        }
        const base = JSON.parse(readFileSync(BASELINE, 'utf8')).srcLinePct;
        if (r.pct < base - TOLERANCE) {
            console.error(`Coverage of src/ fell to ${r.pct}% from a baseline of ${base}% (${r.lh} of ${r.lf} lines).`);
            console.error(`Untested files: ${r.untested.length}. Lines in them: ${gaps}.`);
            console.error(`\nNew code needs its tests - a file nothing loads counts at its full length. If logic was\nmoved rather than added, its tests should have moved with it.`);
            process.exit(1);
        }
        console.log(`Coverage passed - src/ at ${r.pct}% (${r.lh} of ${r.lf} lines), baseline ${base}%. ${r.untested.length} files no test loads: ${gaps}.`);
        if (r.pct > base + 0.5) console.log(`  That is ${(r.pct - base).toFixed(2)} points above the baseline - keep the ground: UPDATE=1 node ${BASELINE.replace('-baseline.json', '-ratchet.mjs')}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
