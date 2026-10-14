// A fix has to bring the test that would have caught it.
//
// Measured on 2026-10-14 (docs/process/): 56% of all fix commits in this repository had landed
// without touching a test, and 40% of the last month's still did. A fix with no test is the
// cleanest case of test-after development - nothing stops the same defect coming back - and the
// process review put most of the semantic bugs that pass CI down to exactly that.
//
// Full test-first would be the textbook answer and is not realistic here. This is the targeted
// version the review asked for: the place where a test is cheapest to write and worth most is
// the moment a defect has just been understood, so that is where it is required.
//
// The rule: if a branch carries a `fix:` commit, the branch must change something under test/.
// A fix that genuinely cannot be tested - a stylesheet, a config value - says so with a trailer
// in its commit message, and the reason stays in history next to the change:
//
//     No-Test: colour only; nothing here a test can observe
//
// Compared against origin/main, so it checks a branch and not the whole history. On main itself,
// or with no origin/main to compare against, there is nothing to check and it passes.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { kindOf } from './commitKind.mjs';

/**
 * Whether a branch's fixes carry a test.
 *
 * @param {Array<{subject: string, body?: string}>} commits the branch's commits
 * @param {string[]} files every path the branch changes
 * @returns {{ok: boolean, why: string, fixes?: string[]}}
 */
export function verdict(commits, files) {
    const fixes = commits.filter(c => kindOf(c.subject) === 'fix');
    if (!fixes.length) return { ok: true, why: 'no fix commits on this branch' };
    if (files.some(f => f.startsWith('test/'))) return { ok: true, why: `${fixes.length} fix commit(s), with a test` };
    for (const c of commits) {
        const m = /^No-Test:[ \t]*(\S.*)$/mi.exec(c.body || '');
        if (m) return { ok: true, why: `waived - ${m[1].trim()}` };
    }
    return { ok: false, why: 'fix without a test', fixes: fixes.map(c => c.subject) };
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let base;
    try { base = git('merge-base', 'origin/main', 'HEAD').trim(); } catch {
        console.log('Fix-needs-a-test skipped - no origin/main to compare against.');
        process.exit(0);
    }
    const SEP = '\u001e';
    const commits = git('log', '--no-merges', `--format=%s%x1f%b${SEP}`, `${base}..HEAD`)
        .split(SEP).map(x => x.trim()).filter(Boolean)
        .map(x => { const [subject, body = ''] = x.split('\u001f'); return { subject, body }; });
    const files = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    const v = verdict(commits, files);
    if (!v.ok) {
        console.error(`This branch fixes something without changing a test:`);
        for (const s of v.fixes) console.error(`  ${s}`);
        console.error(`
Add the test that fails without the fix - that is what keeps the defect from coming back. If
nothing here can be observed by a test, say why with a trailer in the commit message:

    No-Test: <the reason>`);
        process.exit(1);
    }
    console.log(`Fix-needs-a-test passed - ${v.why}.`);
}
