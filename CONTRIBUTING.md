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

Most PRs from a branch of this repo land on their own once you have opened them and armed auto-merge.
That is the train path, and the numbered steps below describe it. Some PRs never ride a train (steps 4
to 6): a docs-only change, whose quick check is its whole gate, and a Dependabot PR, a change under
`.github/` or a PR marked `[full-gate]`, which run the full suite on their own instead of the quick
check. All are set out under "Which path your PR takes" further down. Every PR from a branch of this
repo arms auto-merge all the same (step 3), because auto-merge is what merges it. A PR from a fork takes
the full path too, but a fork author cannot arm auto-merge, so a maintainer merges a fork PR. In order:

1. **Open the PR.** CI starts at once. It first reads what you changed and who opened the PR, and picks a
   path for it (see "Which path your PR takes", below). An ordinary change from a branch of this repo
   takes the train path; a PR from a fork does not (see "Forks", below).
2. **The `quick` check runs**: types, lint, the unit tests, the build and its size budget, a few
   minutes in all. It is a fast first look, not permission to merge. If it is red, open it, fix the
   cause and push.
3. **Arm auto-merge**, in the same step as opening the PR if you can: `gh pr merge --auto --squash`. The
   train only carries PRs that are armed. Without it, a green PR on the train path waits for ever, and
   its `train` line (below) says so. A docs-only or full-path PR has no `train` line (the train never
   carries it), so if one of those is not armed, the reason is in the plan log (below), which says
   `auto-merge is not armed`. Arming needs write access to the repo, so a fork author cannot do this step: a
   maintainer merges a fork PR once its `gate` is green.
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
check then names the red job and its failing tests. On a PR from a fork the cancel is refused (a fork's
token is read-only), so the run goes on and every job reports.

### What `quick` and `gate` mean

- **`quick`** is the fast check of step 2. It tells you your change builds and passes the unit tests.
  Nothing requires it for a merge.
- **`gate`** is the one check that decides whether a PR may merge; GitHub requires it and nothing else.
  On the train path the train posts it as a status on your PR's head commit: pending while the PR rides
  or waits, success once the full suite has passed on a bundle that holds your PR, and failure if it
  fails alone or no longer merges with `main`. On the other paths it is CI's own check on the PR.
- **Where to read what `gate` says.** On the PR page, open the checks list: `gate` carries a line of
  text, and its Details link opens the train's run. From a terminal, `gh pr checks <n>` prints each
  check and status with that text in its description column: the second column when the output goes to
  a terminal (cut short if it is long), the last when it is piped.

### How to see why a PR waits

1. Run `gh pr checks <n>` and read the `train` and `gate` lines. The tables below say what each line
   means and what to do.
2. If neither is there yet: the quick check is still running or is red, no train has planned since it
   went green, or `main` is red (the train waits for `main` and posts no notes at all until it is
   green). A `train` line appears only for an unarmed PR, a draft, or an armed PR in line that has
   never ridden; a PR picked at its first plan gets only the riding `gate` line. A train plans when a
   CI run or a train finishes, and when a PR is armed or a draft is marked ready. A new train waits for the one that is running, and a train takes 10 to 30 minutes, so the line can
   lag.
3. If it still does not say: open the Actions tab, then the newest `train` run whose `plan` job ran (skip
   runs that are queued or cancelled, which have no jobs: GitHub replaces a waiting run with a newer
   one), then its `plan` job. Its log has one line per open PR, such as
   `plan: #123 abc1234: not eligible, auto-merge is not armed`, and it names the first rule the PR
   fails. While `main` is red the log has no per-PR lines: after its first line, `plan: main is <sha>;
   its own ci run: ...`, it has only one line saying that `main` is red and that nobody departs.

#### What `train` says

The `train` line is a note on its own status, which nothing requires, so it never blocks a merge.

| What `train` says | What it means | What to do |
|---|---|---|
| `waiting: arm auto-merge ...` | The quick check is green but auto-merge is not armed, so no train will carry it | Run `gh pr merge --auto --squash` |
| `waiting: mark it ready for review, then arm auto-merge ...` | The PR is a draft | Mark it ready, then arm auto-merge |
| `waiting: armed and in line for a train ...` | You are in line; one train runs at a time, oldest PRs first | Nothing; it will ride |
| `picked up by train N ...` or `merged ...` | Nothing to wait for here any more; `gate` says the rest | Nothing |
| `not waiting for a train: ...` | The PR takes the full path (see below), where its own CI run gives `gate`, or its quick check is red, which gives no `gate` and keeps the PR off the train | If no CI run is under way (for example `[full-gate]` was added to the title after CI ran), push a commit to start one; if the quick check is red, fix the cause and push |

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
| `train N: main abc1234 is red; waits` | Your PR failed alone, but `main` is red too, so nothing is blamed on your change; it waits for `main` to be fixed | Nothing; it rides again once `main` is green |
| `train N: fails alone on main ...` or `train N: timed out alone on main ...` | Your change fails the full suite by itself (or makes a job run past its limit); the PR comment names the failing tests | Fix it and push |
| `train N: passes on its branch, fails on main ...` or `train N: passes on its branch, timed out on main ...` | Your branch is fine alone, but fails on top of what landed on `main` since; the PR comment lists those PRs | Merge `origin/main` into your branch, fix what breaks and push |
| `train N: conflicts with main ...` | Your branch no longer merges with `main` | Merge `origin/main` into your branch and push (do not rebase a pushed branch) |
| `passed train N: ...` | Green; auto-merge lands it | Nothing |

A pending line ends with ` [cap N]` (the table leaves it out): N is the most PRs of a bundle your PR may
ride in next. It starts at 8. When a bundle your PR rode in is red, it becomes half that bundle's size,
rounded up (a bundle of 3 gives 2). A lone PR that times out, or that fails while `main` is red, sets
it straight to 1. So a PR that keeps failing ends up riding alone. It is the train's own bookkeeping;
you do not act on it.

### Which path your PR takes

- **A docs-only change** gets the quick check as its `gate`, and nothing else runs. It never rides a
  train, but arm auto-merge all the same (step 3): that is what merges it. Docs-only means
  every file is under `docs/` or `changes/`, or ends in `.md`, and none of them ships. These end up in
  the game or its page, so a change to one is an ordinary change:

  `README.md`, `THIRD_PARTY_ASSETS.md` and anything under `space/`, `public/`, `src/`, `packs/` or `tests/`.

- **An ordinary change** takes the train path: steps 2 to 6 above.
- **The full path.** A PR from a fork, a Dependabot PR, a change under `.github/`, or a PR with
  `[full-gate]` in its title (or alone on a line of its description) runs the whole suite on its own
  and gets `gate` from that run, with no train. Unless it is from a fork, arm auto-merge all
  the same (step 3); a maintainer merges a fork's. A sentence in the description that mentions the marker
  does not count. A change to CI cannot use a train, because a train runs `main`'s workflows, not yours.
- **When to use `[full-gate]`.** Rarely. Use it for the PR that fixes a red `main` (the train does not
  depart while `main` is red, so that fix cannot wait for one; the keeper, who looks after `main`, does
  this), or when the maintainer asks for a change to land alone. Every other PR on the train path leaves
  it out, even while `main` is red: it waits, and rides once `main` is green again. (A docs-only PR
  never rides a train: its quick check is its `gate`, so it can land while `main` is red.) If your PR's own `quick` (or
  `gate`) went red only because `main` was red, run `gh pr update-branch <n>` or push again once `main`
  is green: a re-run reuses the old merge, and a train only takes a PR whose `quick` is green on its
  head. The marker is read when CI runs: add it before you open the PR, or push again after adding it.
- **Forks.** Your PR runs the full suite on its own, whatever it changes. It gets no `quick` check and no
  `train` line: its CI result is named `gate`. GitHub may hold the first run of a new contributor until
  a maintainer approves it. You cannot arm auto-merge without write access to the repo, so steps 2 to 6
  above do not apply to you: a maintainer merges your PR once `gate` is green.
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
