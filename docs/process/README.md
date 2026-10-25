# Process cycles

How the way this project is built gets improved, and the record of each time it was.

Each cycle is **Measure → Analyze → Change**, then measure again. The measuring comes first and
is not optional: a process change judged by feel cannot be told apart from one that did nothing,
and without a baseline the next cycle cannot know what to change either. It is also the cheapest
step - every figure comes out of records the repository already keeps.

## Running a cycle

```bash
node scripts/process-metrics.mjs              # all of history
node scripts/process-metrics.mjs --since 30   # the last 30 days - compare this one
node scripts/process-metrics.mjs --json       # for diffing against a saved baseline
```

Then write a new file here, named for the date - **a new file each cycle, never an edit to an old
one**, so the trend stays readable (the same rule as `docs/health/`). Save the `--json` output
beside it, so the next cycle compares numbers rather than prose.

A record says what was measured, what the numbers meant, what was changed because of them and
which number each change is expected to move - so the next cycle can check.

## What the measures are

| measure | from | note |
|---|---|---|
| deployment frequency | merged PRs | every merge to main deploys to Vercel |
| lead time | PRs, issues | PR lead time is near zero because PRs open after the work; issue → close is the real one |
| automated test pass ratio | Actions runs of `ci.yml` | cancelled runs are superseded, not verdicts, and are left out |
| defect escape rate | `fix:` merges ÷ feat + perf + refactor merges | nothing lands without passing CI, so each fix is a defect that passed it |
| MTTR | bug-labelled issues, open → close | only as good as the labelling |
| fixes carrying a test | fix commits touching `test/` | the test-after rate, directly; split into *waived* (a `No-Test:` reason the gate accepted) and *untested*, which is the real gap |
| PR titles without a type | merged PR titles | the convention slipping; such PRs are classified by their commits instead |
| risk indicators | issues, git history | deferred verification, reverts, fixes of a recent fix, stalls |
| defect hotspots | files touched by fix commits | where a test-first rule pays most |

## Records

- [2026-10-14](2026-10-14.md) — cycle 1. The baseline; CI found running four of its ten gates;
  ARCHITECTURE.md missing 29% of the files; fixes required to carry a test.
- [2026-10-21](2026-10-21.md) — cycle 2, an inspection. Runtime vulnerabilities to zero; a threat
  model that matched neither document; coverage measured honestly (50.7%, not 96.8%) and held by a
  ratchet; the most-fixed logic in App moved out under test.
- [2026-10-25](2026-10-25.md) — cycle 3. Cycle 2's N1 and N3 closed: the save path held by the ratchet
  (server/ 70.8%), the fix measure reading waivers; this week's escapes traced to render changes
  checked on one path, and the practice that answers it.
