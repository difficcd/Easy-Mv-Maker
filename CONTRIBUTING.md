# How work happens here

This is a one-person project that takes outside contributions. Every change - the maintainer's
included - goes through a branch and a pull request. Three reasons: every PR gets a Vercel
preview, so it can be tried as a real deployment before it lands; CI is a gate, so broken code
cannot reach `main`; and why something was done stays with the code.

## Contributing from outside

Pull requests from anyone are welcome, and they are accepted **selectively**. Saying how that
works up front, so nobody writes a week of work into a wall:

- **Open an issue before anything larger than a small fix.** A patch that arrives with no issue
  behind it may be a thing this project does not want, and finding that out after it is written
  is the worst possible order.
- **The core is not redesigned by pull request.** The document model (`src/document.d.ts`), the
  cuts reducer, the render pipeline and the gate are what everything else stands on. Changes
  there start as a conversation, not as a diff.
- **Send these straight in:** a bug fix, a failing case with a test for it, a translation, a
  documentation correction, a dependency bump.
- **The gate has to pass.** `npm run check` is what CI runs; a red PR is not reviewed.
- **The maintainer decides.** A pull request can be declined for not fitting the direction, not
  only for being wrong. That is not a judgement of the work.

By opening a pull request you offer your contribution under [AGPL-3.0](LICENSE), the same
licence as the project. There is no separate agreement to sign and no copyright to hand over -
you keep yours; the project simply distributes it under the licence it already uses.

One consequence worth knowing, because it is easier to say now than to discover later: since
every contributor keeps their copyright, the project cannot be relicensed - to ship in an app
store, say, whose terms AGPL does not fit - without asking each of them. That is the trade for
having no CLA, and it is deliberate: the licence staying put is the point.


**Before writing a helper, look in [HELPERS.md](HELPERS.md).** It indexes every shared export,
and `npm run check` fails when one is missing from it. The reason it exists is that the same
helpers kept being written twice.

**Write issues, pull requests, commit messages and code comments in English.** It is the
convention for a public repository and keeps everything in one language.

## The loop

```bash
gh issue create                       # say what and why first
git switch -c fix/12-short-description
# ... work ...
npm run check                         # do not commit until this passes
git commit -m "fix: ..."
git push -u origin HEAD
gh pr create --fill                   # put "Closes #12" in the body
gh pr checks                          # CI
gh pr merge --squash --delete-branch
```

## `main` is protected

Pushing straight to `main` is rejected — including for the repository owner, which is the only
setting that makes the rule mean anything on a one-person project. Everything lands through a
pull request whose `check` run has passed, and force pushes and branch deletion are off.

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
```

If you ever genuinely need to bypass it:

```bash
gh api -X DELETE repos/difficcd/Easy-Mv-Maker/branches/main/protection/enforce_admins
# ... push ...
gh api -X POST   repos/difficcd/Easy-Mv-Maker/branches/main/protection/enforce_admins
```

Turning it back on is the part that gets forgotten, so do both in one sitting.

## Verifying

```bash
npm run check   # typecheck → tests → hook-warning baseline → build
```

**Passing this proves less than it looks.** A component that returns `undefined` is legal
React and valid JS, so the typecheck and the build have both passed while a screen rendered
nothing. If you changed structure, open the affected screen and look at it.

The hook baseline (`scripts/hook-baseline.mjs`) holds the *count* of
`react-hooks/exhaustive-deps` warnings: fewer passes, more fails. More usually means an effect
now references a function that the component rebuilds every render. The fix is a ref, not
adding it to the dependency list — adding it re-runs the effect on every render.

## Commits

One commit is one logical change. The test is whether reverting just that commit would make
sense. Commit at roughly 100+ lines or one meaningful piece of work, not once per bug fixed.

```
<type>: <imperative one-line summary>

<why it was done this way. the diff already says what changed.>
```

`feat` `fix` `refactor` `perf` `docs` `test` `chore`

For a performance change, put the measurements in the body. Six months later they are the only
evidence you will have.

## Where code goes

The folders under `src/` say what a file is allowed to touch. The details are in
[ARCHITECTURE.md](ARCHITECTURE.md) — **read it before editing App.jsx.**

```
core/     pure logic — no React, no DOM, no canvas. Everything here has tests.
canvas/   drawing. Pure apart from the 2D context it is handed.
ui/       components
hooks/    React hooks wiring state to behaviour
```

New logic goes in a module, not in App.jsx: anything that is a function of its arguments
belongs next to its tests. Take the impure part as an argument — that is why `measureTextBox`
takes a context, `cloneCutContents` takes a bitmap copier, and `loadKeymap` takes its storage.

A file in `core/` importing React or reaching for `document` means it is in the wrong folder,
or the part that needs them should have stayed in the component.

## Documentation

`ARCHITECTURE.md` is worse than nothing when it is wrong. It spent a while claiming the canvas
was 854×480 (it is 1920×1080) and that bitmaps were never collected, months after a collector
was added. If you changed the structure, fix it in the same PR.
