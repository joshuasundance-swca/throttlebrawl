# Contributing to throttlebrawl

Thank you for looking. This page is for people (and agents) who want to change the game or its tooling.
It says what to do, and what happens to your pull request afterwards, in plain words. The reasons and
the mechanics are in [docs/engineering.md](docs/engineering.md); the binding rules for coding agents
are in [AGENTS.md](AGENTS.md).

## Before you start

- Read the [README](README.md) to run the game, and the [roadmap](docs/roadmap.md) for what is planned.
- Small fixes (a typo, a bug with a clear cause) are welcome as they are. For something bigger, open an
  issue or a draft PR first so you do not build something that does not fit the [product spec](docs/product-spec.md).
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

## What happens to your pull request

One check decides whether it can merge: **`gate`**. How you get it depends on what the PR changes.

- **A docs-only change** gets a quick check that is its `gate`. Nothing else runs. Docs-only means
  every file is under `docs/` or `changes/`, or ends in `.md`, and none of them ships: `README.md`,
  `THIRD_PARTY_ASSETS.md` and anything under `space/`, `public/`, `src/`, `packs/` or `tests/` end up in
  the game or its page, so a change to one is an ordinary change.
- **An ordinary change** gets the quick check first (types, lint, unit tests, the build and its size
  budget). A green quick check does not give you `gate`: your PR then waits for the **bundle train**,
  which combines the ready PRs, runs the full suite (sim races, the browser tests, perf) once on the
  combination, and posts `gate` on each PR of a green bundle. A red bundle splits to find the culprit,
  and the rest still land. To be ready, a PR must have auto-merge armed:

  ```bash
  gh pr merge --auto --squash
  ```

  Do this when you open the PR. Two lines on the PR then show where it is. **`train`** says why a
  ready PR is waiting; nothing requires it, so it never blocks a merge:

  | What `train` says | What it means | What to do |
  |---|---|---|
  | `waiting: arm auto-merge ...` | The quick check is green but auto-merge is not armed, so no train will carry it | Run `gh pr merge --auto --squash` |
  | `waiting: mark it ready for review, then arm auto-merge ...` | The PR is a draft | Mark it ready, then arm auto-merge |
  | `waiting: armed and in line for a train ...` | You are in line; one train runs at a time, oldest PRs first | Nothing; it will ride |
  | `picked up by train N ...`, `not waiting for a train: ...`, `merged ...` | Nothing to wait for here any more; `gate` says the rest | Nothing |

  Once the PR has ridden, **`gate`** says where it is:

  | What `gate` says | What it means | What to do |
  |---|---|---|
  | `riding train N: main abc1234 + #1 #2` | Your PR is on the train that is running | Nothing |
  | `train N was red with ... splits` | The bundle failed and was split to find the cause; your PR rides again in a smaller bundle | Nothing, unless it is later marked as failing alone |
  | `train N: ... timed out; rides once more alone` | A test job ran past its time limit while your PR rode alone; it rides once more before anything is blamed | Nothing |
  | `train N: ... timed out alone, not blamed (...); rides once main is past abc1234` | It timed out again, but your change cannot reach that job, or `main` did not pass that job itself, so it is not blamed; it rides again once `main` moves on | Nothing; push again if you want it tested sooner |
  | `train N: fails alone on main ...` or `train N: timed out alone on main ...` | Your change fails the full suite by itself (or makes a job run past its limit); the PR comment names the failing tests | Fix it and push |
  | `train N: conflicts with main` | Your branch no longer merges with `main` | Merge `origin/main` into your branch and push (do not rebase a pushed branch) |
  | `passed train N: ...` | Green; auto-merge lands it | Nothing |

  A new push gives the PR a new head commit, which waits for a later train.
- **A PR from a fork**, a Dependabot PR, a change under `.github/`, or a PR with `[full-gate]` in its
  title (or alone on a line of its description) runs the full suite on its own and gets `gate` from that
  run. A sentence in the description that mentions the marker does not count. A change to CI itself
  cannot use a train, because a train runs `main`'s workflows, not yours. The author of a fork PR
  cannot arm auto-merge without write access to the repo; a maintainer merges it once `gate` is green.

If your PR sits with no movement for a long time, read its `train` and `gate` lines first; they are
meant to say why. If they do not, that is a bug in the train: please say so in the PR. One known case:
a PR that rode a train and was then closed and reopened on the full path keeps the train's `gate`
line; push a new commit (an empty one is fine) to start clean.

Main runs the full suite again after every merge, as a backstop. The first red job in a pull request's
run cancels the rest of that run to free the runners; the run's own `gate` (or `quick`) check then
names the red job and its failing tests.

## What always needs the maintainer

Taste calls (the look, names, whether a joke stays), anything irreversible or public-facing, spending
money, and changes to repo settings. The maintainer vetoes content after the fact, so build the
sensible default and keep going. The full list is in
[docs/engineering.md](docs/engineering.md#what-always-needs-the-maintainer).

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
