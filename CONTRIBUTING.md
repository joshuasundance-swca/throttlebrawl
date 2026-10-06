# Contributing to throttlebrawl

Thank you for looking. This page is for people (and agents) who want to change the game or its tooling.
It says what to do, and what happens to your pull request afterwards, in plain words. The reasons and
the mechanics are in [docs/engineering.md](docs/engineering.md); the binding rules for coding agents
are in [AGENTS.md](AGENTS.md).

## Where to start

- The [README](README.md) says what the game is today and how to run it. The [roadmap](docs/roadmap.md)
  says what is planned, and [docs/](docs/) holds the rest: the [product spec](docs/product-spec.md),
  the [architecture](docs/architecture.md) (which folder owns what) and [engineering](docs/engineering.md)
  (the checks, CI and deploys).
- Coding agents (Codex, Copilot, Claude Code and the like) read [AGENTS.md](AGENTS.md) first. Its rules
  bind them here, and this page is the shorter version for everyone else.
- Small fixes (a typo, a bug with a clear cause) are welcome as they are. For something bigger, open an
  issue or a draft PR first so you do not build something that does not fit the
  [product spec](docs/product-spec.md).
- The game's tone is set out in the [tone guide](docs/tone-guide.md): a homage with flavour and humour,
  never corny or cheesy, and no gore. Read it before writing any text a player will see.
- New content is data where possible: see [content packs](docs/content-packs.md).
- Anything you add that you did not make yourself (art, sound, a model, a font) goes in
  [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) with its licence. Prefer CC0 or CC-BY.

## Make a change

1. Fork the repo (or, with write access, branch from `main`; agents use `lane/<lane-id>/<topic>`).
2. `npm ci`, then `npm run hooks:install`. The git hooks check what you commit (lint, format, the leak
   scan and file sizes) and, before a push, run the typecheck and the unit tests named by what you
   changed. `npm run check` runs every test tier on your machine, as CI does. Agents on the shared dev
   machine follow the narrower rules in [AGENTS.md](AGENTS.md#the-dev-machine-what-runs-locally).
3. Write the failing test first, then the change. Tests never wait on wall-clock time: drive them by sim
   ticks or the test hooks ([testing seams](docs/architecture.md#testing-seams)).
4. Add a short note under `changes/`, named `changes/<yyyy-mm-dd>-<slug>.md`, in plain words (the
   existing notes show the format: a `kind:` and an `audience:` line, then what changed and why).
5. Everything you commit is public, so use your GitHub no-reply address as the commit email
   ([commit identity](docs/engineering.md#commit-identity)) and keep personal details out of commits,
   notes and PR text.

## How a pull request lands

Most PRs land on their own once you have opened them and armed auto-merge. In order:

1. **Open the PR.** CI starts at once. It first reads what you changed and who opened the PR, and picks a
   path for it (see "Which path your PR takes", below). An ordinary change takes the train path.
2. **The `quick` check runs**: types, lint, the unit tests, the build and its size budget, a few
   minutes in all. It is a fast first look, not permission to merge. If it is red, open it, fix the
   cause and push.
3. **Arm auto-merge**, in the same step as opening the PR if you can: `gh pr merge --auto --squash`. The
   train only carries PRs that are armed. Without it, a green PR waits for ever, and its `train` line
   (below) says so.
4. **The bundle train** gathers the PRs that are armed and have a green quick check, oldest first, up to
   8. It combines them on top of `main` and runs the full suite (sim races, the browser tests, perf)
   once on the combination. One train runs at a time, so your PR may wait for the one in progress.
5. **Green: the PR lands.** The train posts `gate` = success on each PR it carried, and auto-merge
   squash-merges them.
6. **Red: the bundle splits.** The train cannot yet tell which PR is at fault, so it drops each PR into
   a smaller bundle and runs again, and whatever passes lands. A PR that fails alone gets `gate` =
   failure and a comment naming the failing tests; fix it and push. A PR that no longer merges with
   `main` gets a comment too: merge `origin/main` into your branch and push.
7. **After the merge**, `main` runs its checks again and the game deploys by itself.

A new push gives the PR a new head commit, which rides a later train. When a PR's CI run goes red,
its first red job cancels the rest of that run to free the runners, and the run's own `quick` or `gate`
check then names the red job and its failing tests.

### What `quick` and `gate` mean

- **`quick`** is the fast check of step 2. It tells you your change builds and passes the unit tests.
  Nothing requires it for a merge.
- **`gate`** is the one check that decides whether a PR may merge; GitHub requires it and nothing else.
  On the train path the train posts it as a status on your PR's head commit, once the full suite has
  passed on a bundle that holds your PR. On the other paths it is CI's own check on the PR.
- **Where to read what `gate` says.** On the PR page, open the checks list: `gate` carries a line of
  text, and its Details link opens the train's run. From a terminal, `gh pr checks <n>` prints each
  check and status with that text in its last column.

### How to see why a PR waits

1. Run `gh pr checks <n>` and read the `train` and `gate` lines. The tables below say what each line
   means and what to do.
2. If neither is there yet: the quick check is still running or is red, or no train has planned since
   it went green. A `train` line appears when a train next plans, which is when a CI run or a train
   finishes, so it can lag a little.
3. If it still does not say: open the Actions tab, then the newest `train` run, then its `plan` job,
   whose log has one line per open PR, such as `plan: #123 abc1234: not eligible, auto-merge is not armed`.
   It names the first rule the PR fails.

#### What `train` says

The `train` line is a note on its own status, which nothing requires, so it never blocks a merge.

| What `train` says | What it means | What to do |
|---|---|---|
| `waiting: arm auto-merge ...` | The quick check is green but auto-merge is not armed, so no train will carry it | Run `gh pr merge --auto --squash` |
| `waiting: mark it ready for review, then arm auto-merge ...` | The PR is a draft | Mark it ready, then arm auto-merge |
| `waiting: armed and in line for a train ...` | You are in line; one train runs at a time, oldest PRs first | Nothing; it will ride |
| `picked up by train N ...` or `merged ...` | Nothing to wait for here any more; `gate` says the rest | Nothing |
| `not waiting for a train: ...` | The PR takes the full path (see below) or its quick check is red, so its own CI run gives `gate` | If no CI run is under way (for example `[full-gate]` was added to the title after CI ran, or the quick check is red), push a commit to start one |

#### What `gate` says

Once the PR has ridden, the `gate` line says where it is.

| What `gate` says | What it means | What to do |
|---|---|---|
| `riding train N: main abc1234 + #1 #2` | Your PR is on the train that is running | Nothing |
| `train N was red with ... splits` | The bundle failed and was split to find the cause; your PR rides again in a smaller bundle | Nothing, unless it is later marked as failing alone |
| `train N: ... waits for the next train` | The train did not conclude: `main` moved while it ran, a PR of the bundle changed (a push, closed, back to draft, auto-merge off), the run did not finish, or the landing did not complete | Nothing; a new train carries it |
| `train N: conflicts with ...; waits` | Your PR conflicts with an earlier PR of the same bundle | Nothing; once that PR lands, this one is told if it now conflicts with `main` |
| `train N: ... timed out; rides once more alone` | A test job ran past its time limit while your PR rode alone; it rides once more before anything is blamed | Nothing |
| `train N: ... timed out alone, not blamed (...); rides once main is past abc1234` | It timed out alone, but your change cannot reach that job, or `main` did not pass that job itself, so it is not blamed; it rides again once `main` moves on | Nothing; push again if you want it tested sooner |
| `train N: fails alone on main ...` or `train N: timed out alone on main ...` | Your change fails the full suite by itself (or makes a job run past its limit); the PR comment names the failing tests | Fix it and push |
| `train N: passes on its branch, fails on main ...` | Your branch is fine alone, but fails on top of what landed on `main` since; the PR comment lists those PRs | Merge `origin/main` into your branch, fix what breaks and push |
| `train N: conflicts with main ...` | Your branch no longer merges with `main` | Merge `origin/main` into your branch and push (do not rebase a pushed branch) |
| `passed train N: ...` | Green; auto-merge lands it | Nothing |

### Which path your PR takes

- **A docs-only change** gets the quick check as its `gate`, and nothing else runs. Docs-only means
  every file is under `docs/` or `changes/`, or ends in `.md`, and none of them ships. These end up in
  the game or its page, so a change to one is an ordinary change:

  `README.md`, `THIRD_PARTY_ASSETS.md` and anything under `space/`, `public/`, `src/`, `packs/` or `tests/`.

- **An ordinary change** takes the train path: steps 2 to 6 above.
- **The full path.** A PR from a fork, a Dependabot PR, a change under `.github/`, or a PR with
  `[full-gate]` in its title (or alone on a line of its description) runs the whole suite on its own
  and gets `gate` from that run, with no train. A sentence in the description that mentions the marker
  does not count. A change to CI cannot use a train, because a train runs `main`'s workflows, not yours.
- **When to use `[full-gate]`.** When the train cannot carry your PR: `main` is red (the train does not
  depart while it is), or the change is to how CI itself works outside `.github/`, such as
  `scripts/train.mjs`, which a train runs from `main`, not from your branch. The marker is read when CI
  runs: add it before you open the PR, or push again after adding it.
- **Forks.** Your PR runs the full suite on its own. GitHub may hold the first run of a new
  contributor until a maintainer approves it. You cannot arm auto-merge without write access to the
  repo, so a maintainer merges your PR once `gate` is green. A fork PR gets no `train` line.
- **Dependabot** PRs take the full path too; the safe ones are armed for you.

If your PR sits with no movement for a long time, read its `train` and `gate` lines first; they are
meant to say why. If they do not, that is a bug in the train: please say so in the PR. One known case:
a PR that rode a train and was then closed and reopened on the full path keeps the train's `gate`
line; push a new commit (an empty one is fine) to start clean.

After every merge, `main` runs the full suite again as a backstop, unless a full-path PR run already
tested exactly the code `main` now has; then `main` runs only the production build before it deploys.

## What always needs the maintainer

Taste calls (the look, names, whether a joke stays), anything irreversible or public-facing, spending
money, and changes to repo settings. The maintainer vetoes content after the fact, so build the
sensible default and keep going. The full list is in
[docs/engineering.md](docs/engineering.md#what-always-needs-the-maintainer).

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
