// Process metrics, read straight out of the repository's own records.
//
// Until this script, "it is fast" and "it got more stable" were judged by feel. A process change
// can only be called an improvement against a number taken before it, so this produces that
// number - the baseline in a Measure -> Analyze -> Change cycle (docs/process/).
//
// Every figure comes from what GitHub and git already record: merged PRs, issues, Actions runs
// and commit history. Nothing to install and nothing to keep in sync, so it can be rerun at the
// end of each cycle and compared line by line.
//
//   node scripts/process-metrics.mjs                 all of history
//   node scripts/process-metrics.mjs --since 30      the last 30 days only
//   node scripts/process-metrics.mjs --json          machine-readable, for diffing two runs
//
// Needs the gh CLI, authenticated against this repository.

import { execFileSync } from 'node:child_process';
import { kindOf, waiverOf } from './commitKind.mjs';

const args = process.argv.slice(2);
const sinceDays = args.includes('--since') ? Number(args[args.indexOf('--since') + 1]) : null;
const asJson = args.includes('--json');
const now = Date.now();
const DAY = 86_400_000;
const since = sinceDays ? now - sinceDays * DAY : 0;

const gh = (...a) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 << 20 }));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });

const t = (iso) => new Date(iso).getTime();
const inWindow = (iso) => iso && t(iso) >= since;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const hours = (ms) => ms == null ? null : Math.round(ms / 36e5 * 10) / 10;
const days = (ms) => ms == null ? null : Math.round(ms / DAY * 10) / 10;



// --- the records -------------------------------------------------------------------------------

// Paged by hand through GraphQL rather than `gh pr list --json commits`. That command asks for
// every commit's authors as well, gh pages at 100 PRs, and 100 x 100 x 100 is twice GitHub's
// 500,000-node ceiling - it fails at any --limit. Asking for the commit headline alone is 2,000.
function mergedPrs() {
    const { owner, name } = gh('repo', 'view', '--json', 'owner,name');
    const q = `query($after: String) { repository(owner: "${owner.login}", name: "${name}") {
        pullRequests(states: MERGED, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { number title createdAt mergedAt author { login }
                    commits(first: 20) { nodes { commit { messageHeadline } } } } } } }`;
    const out = [];
    for (let after = null; ;) {
        const page = gh('api', 'graphql', '-f', `query=${q}`, ...(after ? ['-f', `after=${after}`] : []))
            .data.repository.pullRequests;
        for (const n of page.nodes) out.push({ ...n, commits: n.commits.nodes.map(c => c.commit) });
        if (!page.pageInfo.hasNextPage) return out;
        after = page.pageInfo.endCursor;
    }
}
const prs = mergedPrs().filter(p => inWindow(p.mergedAt));

// A PR's kind is its title's prefix when it has one. 55 titles were written as prose instead -
// the TypeScript migration series ("hooks/ in TypeScript") is most of them - and counting those
// as "other" shrank the denominator of the escape rate. Their commits did carry a prefix, and
// rebase-merge puts exactly those commits on main, so they are the better witness.
const kindOfPr = (p) => {
    const k = kindOf(p.title);
    if (k !== 'other') return k;
    for (const c of p.commits || []) { const ck = kindOf(c.messageHeadline); if (ck !== 'other') return ck; }
    return 'other';
};
const issues = gh('issue', 'list', '--state', 'all', '--limit', '2000', '--json', 'number,title,state,createdAt,closedAt,labels,body');
const runs = gh('run', 'list', '--workflow', 'ci.yml', '--limit', '2000', '--json', 'conclusion,event,createdAt,headBranch')
    .filter(r => inWindow(r.createdAt));

const human = prs.filter(p => !/dependabot/i.test(p.author?.login || ''));
const byKind = {};
for (const p of human) (byKind[kindOfPr(p)] ??= []).push(p);
const count = (k) => (byKind[k] || []).length;

// --- DevOps measures, as the course defines them ------------------------------------------------

// Deployment frequency. Every merge to main deploys to Vercel, so a merge is a deployment.
const spanDays = sinceDays ?? Math.max(1, (now - Math.min(...prs.map(p => t(p.mergedAt)))) / DAY);
const deployPerWeek = Math.round(prs.length / spanDays * 7 * 10) / 10;

// Lead time, PR opened -> merged (deployed). The issue -> close figure is separate because many
// changes never had an issue: they were asked for and done in the same sitting.
const prLead = human.map(p => t(p.mergedAt) - t(p.createdAt));
const closedIssues = issues.filter(i => i.closedAt && inWindow(i.closedAt));
const issueLead = closedIssues.map(i => t(i.closedAt) - t(i.createdAt));

// Automated test pass ratio. Cancelled runs are left out: the workflow cancels a branch's older
// run when a newer push arrives, so a cancellation is a superseded run, not a verdict.
const judged = runs.filter(r => r.conclusion === 'success' || r.conclusion === 'failure');
const passRatio = judged.length ? judged.filter(r => r.conclusion === 'success').length / judged.length : null;
const mainRuns = judged.filter(r => r.event === 'push' && r.headBranch === 'main');
const mainFailures = mainRuns.filter(r => r.conclusion === 'failure').length;

// Defect escape rate. Nothing reaches main without passing CI, so every `fix:` that lands is a
// defect that passed CI and shipped - an escape, by the definition in the course. Measured
// against the changes that can introduce one. A proxy, and stated as one: a fix for something
// that was never shipped would count too, and that is rare here because work lands as it goes.
const introducing = count('feat') + count('perf') + count('refactor');
const escapeRate = introducing ? count('fix') / introducing : null;

// MTTR. Time a bug-labelled issue stayed open. MTTD - from the defect being introduced to it
// being noticed - would need blame on every fix and is not attempted; see the cycle notes.
const bugs = closedIssues.filter(i => i.labels.some(l => l.name === 'bug'));
const mttr = bugs.map(i => t(i.closedAt) - t(i.createdAt));

// --- risk indicators, as named in the risk-monitoring section -----------------------------------

// Estimation: verification that has been put off. Unticked checklist items in open issues, plus
// issues explicitly waiting on a check on a device.
const open = issues.filter(i => i.state === 'OPEN');
const unticked = open.reduce((n, i) => n + (String(i.body || '').match(/^\s*[-*] \[ \]/gm) || []).length, 0);
const awaitingCheck = open.filter(i => i.labels.some(l => l.name === 'needs-verification')).length;

// Tools: the agent undoing its own work. Reverts, and fixes landing on a file that another fix
// touched within the previous week - a fix that needed a fix.
const sinceArg = sinceDays ? [`--since=${sinceDays}.days`] : [];
const log = git('log', '--no-merges', '--format=@@%H%x09%ct%x09%s', '--name-only', ...sinceArg);
const commits = [];
for (const chunk of log.split('@@').slice(1)) {
    const [head, ...files] = chunk.trim().split('\n');
    const [hash, ct, subject] = head.split('\t');
    commits.push({ hash, at: Number(ct) * 1000, subject, files: files.filter(Boolean) });
}
const reverts = commits.filter(c => /^revert/i.test(c.subject)).length;
const fixes = commits.filter(c => kindOf(c.subject) === 'fix');
// App is left out of the overlap. Nearly every change wires through it, so two fixes sharing it
// says nothing about one fix needing another - counted in, this read 77 and would never move.
const overlapFile = (x) => x.startsWith('src/') && !/^src\/App\.(jsx|tsx)$/.test(x);
let refix = 0;
for (const f of fixes) {
    if (fixes.some(g => g !== f && g.at < f.at && f.at - g.at < 7 * DAY && g.files.some(x => overlapFile(x) && f.files.includes(x)))) refix++;
}

// Test-after, measured. The plan blames semantic defects on tests written after the code; a fix
// that lands without touching a test is the clearest case of it, because nothing then stops the
// same defect coming back.
const fixesWithTest = fixes.filter(f => f.files.some(x => x.startsWith('test/'))).length;
// A fix without a test is either waived - a `No-Test:` reason the gate accepted, say a change to a
// script or to colour - or untested. Only the second is the gap this measure is about; counting
// them together made the gate working as designed read as the gate failing (cycle 2, N3).
const fixesWaived = fixes.filter(f => !f.files.some(x => x.startsWith('test/')) && waiverOf(git('log', '-1', '--format=%b', f.hash))).length;
// PR titles without a conventional prefix. They are classified by their commits instead (kindOfPr),
// so nothing is lost - but the convention is the process's, and this says when it slipped.
const proseTitles = prs.filter(p => kindOf(p.title) === 'other').length;

// People: work stalling. The longest gap between two merges, and how long open issues have sat.
const mergeTimes = prs.map(p => t(p.mergedAt)).sort((a, b) => a - b);
let longestGap = 0;
for (let i = 1; i < mergeTimes.length; i++) longestGap = Math.max(longestGap, mergeTimes[i] - mergeTimes[i - 1]);
const openAge = open.map(i => now - t(i.createdAt));

// Where the defects are. Source files touched most often by fixes - the place a test-first rule
// buys the most, which is the targeted adoption the plan calls for.
// Two corrections, or the list says the wrong thing. The TypeScript migration renamed App.jsx to
// App.tsx, so one file's history was split across two names; the extension is dropped so they
// count as one. And the translation tables are left out: every fix that changes a UI string adds
// its translations, so they rank high for touching, not for breaking.
const NOISE = /^src\/i18n(\.\w+)?\.(js|ts)$|\.css$/;
const stem = (x) => x.replace(/\.(jsx|tsx|js|ts)$/, '');
const hot = {};
for (const f of fixes) for (const x of f.files) if (x.startsWith('src/') && !NOISE.test(x)) hot[stem(x)] = (hot[stem(x)] || 0) + 1;
const hotspots = Object.entries(hot).sort((a, b) => b[1] - a[1]).slice(0, 8);

// --- report ------------------------------------------------------------------------------------

const result = {
    window: sinceDays ? `last ${sinceDays} days` : 'all history',
    measuredAt: new Date(now).toISOString().slice(0, 10),
    merges: prs.length,
    mergesByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1])),
    deploymentsPerWeek: deployPerWeek,
    prLeadTimeHours: { median: hours(median(prLead)), p90: hours(pct(prLead, 0.9)) },
    issueLeadTimeDays: { median: days(median(issueLead)), p90: days(pct(issueLead, 0.9)), closed: closedIssues.length },
    ciPassRatio: passRatio == null ? null : Math.round(passRatio * 1000) / 10,
    ciRunsJudged: judged.length,
    mainBranchFailures: mainFailures,
    defectEscapeRate: escapeRate == null ? null : Math.round(escapeRate * 1000) / 10,
    fixMerges: count('fix'),
    introducingMerges: introducing,
    mttrDays: { median: days(median(mttr)), bugsClosed: bugs.length },
    fixCommitsWithATest: fixes.length ? Math.round(fixesWithTest / fixes.length * 1000) / 10 : null,
    fixCommitsWaived: fixesWaived,
    fixCommitsUntested: fixes.length - fixesWithTest - fixesWaived,
    prTitlesWithoutType: proseTitles,
    fixCommits: fixes.length,
    risk: {
        untickedChecklistItems: unticked,
        issuesAwaitingVerification: awaitingCheck,
        reverts,
        fixesOfARecentFix: refix,
        longestGapBetweenMergesDays: days(longestGap),
        openIssues: open.length,
        oldestOpenIssueDays: days(Math.max(0, ...openAge)),
    },
    defectHotspots: hotspots,
};

if (asJson) {
    console.log(JSON.stringify(result, null, 2));
} else {
    const r = result;
    console.log(`Process metrics - ${r.window}, measured ${r.measuredAt}\n`);
    console.log('DevOps measures');
    console.log(`  deployment frequency      ${r.deploymentsPerWeek} merges/week (${r.merges} merges; each deploys)`);
    console.log(`  lead time, PR -> deploy   median ${r.prLeadTimeHours.median}h, p90 ${r.prLeadTimeHours.p90}h`);
    console.log(`  lead time, issue -> close median ${r.issueLeadTimeDays.median}d, p90 ${r.issueLeadTimeDays.p90}d (${r.issueLeadTimeDays.closed} issues)`);
    console.log(`  automated test pass ratio ${r.ciPassRatio}% of ${r.ciRunsJudged} CI runs; ${r.mainBranchFailures} failed on main`);
    console.log(`  defect escape rate        ${r.defectEscapeRate}% (${r.fixMerges} fixes / ${r.introducingMerges} feat+perf+refactor)`);
    console.log(`  MTTR (bug issues)         median ${r.mttrDays.median}d over ${r.mttrDays.bugsClosed} bugs`);
    console.log(`  fixes carrying a test     ${r.fixCommitsWithATest}% of ${r.fixCommits} fix commits (waived ${r.fixCommitsWaived}, untested ${r.fixCommitsUntested})`);
    console.log(`  PR titles without a type  ${r.prTitlesWithoutType} of ${r.merges}`);
    console.log(`  merges by kind            ${Object.entries(r.mergesByKind).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log('\nRisk indicators');
    console.log(`  estimation   unticked checklist items in open issues: ${r.risk.untickedChecklistItems}; awaiting verification: ${r.risk.issuesAwaitingVerification}`);
    console.log(`  tools        reverts: ${r.risk.reverts}; fixes landing on a file another fix touched that week (App aside): ${r.risk.fixesOfARecentFix}`);
    console.log(`  people       longest gap between merges: ${r.risk.longestGapBetweenMergesDays}d; open issues: ${r.risk.openIssues}, oldest ${r.risk.oldestOpenIssueDays}d`);
    console.log('\nDefect hotspots (src files most touched by fixes)');
    for (const [f, n] of r.defectHotspots) console.log(`  ${String(n).padStart(3)}  ${f}`);
}
