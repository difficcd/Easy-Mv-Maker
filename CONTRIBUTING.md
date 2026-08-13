# How work happens here

This is a one-person project, but changes still go through a branch and a pull request. Three
reasons: every PR gets a Vercel preview, so it can be tried as a real deployment before it
lands; CI is a gate, so broken code cannot reach `main`; and why something was done stays with
the code.

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
