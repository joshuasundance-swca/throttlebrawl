# AGENTS.md: binding rules for every coding agent

These rules bind Claude Code, Codex, Copilot and any other agent working in this repo; `CLAUDE.md` only imports this file. It is the one home for how agents work here `[decided]` (the maintainer, 2026-10-03: "Consolidate into repo"). [docs/engineering.md](docs/engineering.md) gives the reasons and mechanics and links back. If this file conflicts with a `[decided]` item in `docs/`, the doc wins and this file is fixed in the same PR. `[decided]` traces to the maintainer; everything else is `[default]`. When a rule seems wrong, propose a change in a PR; don't work around it.

throttlebrawl is a public, MIT-licensed browser motorcycle brawler (TypeScript, Three.js, Vite, npm; all `[decided]`), inspired by Road Rash (EA, 1991–2000) but never using that name in names or branding.

## Read first

1. [docs/architecture.md](docs/architecture.md): the module map. It decides which folders your lane owns.
2. [docs/engineering.md](docs/engineering.md): the gate, CI, tests, budgets and deploy.
3. [docs/product-spec.md](docs/product-spec.md) and [docs/playtests/](docs/playtests/README.md): what the game is, and the maintainer's latest feedback and decisions. [docs/roadmap.md](docs/roadmap.md) says when; `docs/milestones/` holds the task plans.
4. [docs/content-packs.md](docs/content-packs.md) before touching `packs/` or `src/content/`; [docs/tone-guide.md](docs/tone-guide.md) before writing player-facing text.

Tags: `[decided]` is the maintainer's call; don't change it without asking. `[default]` is a proposal; an agent may change it in a PR that updates the doc and says why in its `changes/` note. `[open]` waits on the maintainer; don't foreclose it.

## Definition of done

`[decided]` The bar is tests, lint and types, a bot playthrough, a perf check, a plain changelog and the leak scan. A change is done when CI's `gate` check is green on its PR; auto-merge then merges it. The full list is in [the gate](docs/engineering.md#the-gate-definition-of-done). Every PR adds a plain-words note under `changes/` (a Dependabot-only PR is exempt).

- The docs are the spec: derive your tests from your task's **Automated acceptance** list in `docs/milestones/`, and write the failing test first.
- CI runs the whole gate on every PR. Locally, run only what the next section allows; never `npm run check` or a whole tier.
- Report what each check examined, not only that it passed. Performance claims name the device, the renderer and the scene.
- Agents can't test on the benchmark phone: report "done, not phone-verified". The maintainer's playtest phone-verifies; nothing waits for it.
- **Verification** `[decided]` (the maintainer, 2026-10-03: "Tests in CI + one live check"): a bug class that escaped to a playtest or a live check becomes a per-PR CI test (sim, layout or geometry); each run has ONE live check on the game link; independent reviewers only for high-stakes changes (CI infra, budgets, global config, published docs).
- **Tests never wait on wall-clock time or frame counts.** Drive them by sim ticks, the dev hooks or the lockstep seam. Seeded statistics are bands over enough races, never a floor at the measured rate; a test of one behaviour races with the `ISOLATED` profile, and a test that needs a seeded event finds its seed with `firstSeed`; a test asserts the rule it protects, reading content from the packs, never a whole-game list, an exact count, copied pack text or a lucky seed, so another lane's new content does not break it ([details](docs/engineering.md#the-gate-definition-of-done)).
- **Budgets** are hard in CI: draw calls, triangles, download size, and first-load JavaScript (500 KB gzip; a PR that grows it must leave 10 KB of headroom). Frame time is a trend with a 3x guard `[decided]` (2026-10-02). Report your headroom; propose a budget change with its reason, never just raise it.

## The dev machine: what runs locally

Parallel lanes share one dev machine, and on 2026-10-02 they locked it up with software-rendered browsers, builds and tests running at once.

- **No local browsers or dev servers** (Playwright specs, `e2e:one`, perf, `vite preview`) unless your brief grants the run's one browser slot. CI runs the browser tiers. **Never the Playwright MCP tools**, slot or not; the slot holder drives a headless `playwright-core` Chromium from a script.
- Run `npm ci` in your worktree before your first commit; the git hooks need its `node_modules`.
- Unit tests: only the files you touch, with `VITEST_MAX_WORKERS=2`, as often as you need. A seeded sim test you are writing may run alone; never the whole sim batch. Typecheck once before you push.
- `vite build` only for a build or size change; Blender only in an asset brief. Stop every process you start.
- Never run a command that can wait for input: `GIT_EDITOR=true`, `git merge --no-edit`, `git commit -m`. Never bare `git stash` (every worktree shares the stash); use `git stash push -u -m <unique>` and apply it by SHA.
- Inside a lane, wait synchronously: a loop of `gh ...; sleep 60`, under 9 minutes per call. Never the Monitor tool or a background wait; nothing wakes a lane later.

## Runs: lanes, one keeper, one live check

`[default]` A run is several lanes in parallel, plus one keeper and one live check; [.claude/workflows/lane-run.js](.claude/workflows/lane-run.js) is the template. Big parallel runs stay `[decided]` (the maintainer, 2026-10-03: "Keep as is").

- **Branch** `lane/<lane-id>/<topic>` off `origin/main`, never `main`. `<lane-id>` is the module folder in architecture.md's ownership table, or `infra`. Each parallel agent uses its own `git worktree`.
- **A lane ends at push.** One topic per PR; push only when it is ready (CI runs at most 20 jobs at once, about 9 per push). Open the PR, arm auto-merge (`gh pr merge --auto --squash`), check its checks once, write your report and finish. You may push and open PRs without asking `[decided]` (Codex lanes excepted, below).
- **Codex lanes** build disjoint work (assets such as Blender models first) in their own worktree, with no network. They do not push: the coordinator reviews the work, runs the gates and opens the PR `[default]`.
- **The keeper** owns main's health and lands every PR of its run. It fixes a PR's own red on its branch; for a PR red only because of main, it runs `gh pr update-branch` once main is green (a re-run reuses the old merge commit); when main is red, it fixes forward or reverts the culprit. If your merge broke main, fixing it is your first job; if you see main red, say so in your report. Each run ends with main green and playable `[decided]`.
- Merge `origin/main` into your branch only for a real conflict or code you need. Never rebase a pushed branch. Never hand-merge `package-lock.json`: take main's, then run `npm install`.
- Confirm a merge by the PR's state (`gh pr view --json state,mergedAt`), never by an exit code.
- Stay inside your lane's folders, plus your tests and `changes/` note. A small shared-config edit (a `package.json` script, a config option, a test setup file) may ride in your PR when only your change needs it; say so in the note `[default]` (the maintainer, 2026-10-01). Dependencies, the lock file, `.github/` and this file go in their own PR. Contract changes (pack schemas, cross-module interfaces) land first, as their own PR.
- Write your report to `scratch/m2/lanes/<key>-report.md` (never a file named exactly `report.md`) before any structured return.

## Never

- **Never delete** branches, tags, releases, repos, Spaces or datasets `[decided]`. Removing files inside a normal PR, with the reason in its note, is ordinary editing; deploys that replace a Space's files are allowed `[default]`.
- **Never commit to a Space by hand;** each deploy overwrites it from GitHub ([deploy](docs/engineering.md#deploy-game-space-and-staging-space)).
- **Never force-push or rewrite published history,** and **never skip hooks or checks** (`--no-verify`, disabling a test, loosening a budget without a stated reason). Fix a wrong hook or test in the open.
- **Never create** repos, Spaces or datasets, **change** repo settings, protection or visibility, or **rename** anything public `[decided]`.
- **Never schedule unattended or recurring agent work** unless the maintainer asks `[decided]`.
- **Never ship a secret** in client code, and never print `.env` values or tokens (key names are fine). **Never run interactive logins;** if auth fails, stop that task and say which login is needed.

## Public safety

Everything committed, including commit messages, PR text, branch names, notes and screenshots, is public.

- No employer names, no personal details about the maintainer or anyone else, no absolute user paths, usernames, machine names or network details, and no emails except no-reply ones. Say "the maintainer" and "the dev machine".
- Commit as the maintainer's GitHub no-reply address, set in user-level git config `[decided]`; hooks and CI check it ([commit identity](docs/engineering.md#commit-identity)).
- Private context stays in agent memory, outside the repo `[decided]`. `scratch/` and `*.local.md` are git-ignored space for notes that are not private; never `git add -f` them. The leak scan is light; you are the first filter.
- Log every non-original asset in `THIRD_PARTY_ASSETS.md` with its licence, and label AI-made ones. Prefer CC0 or CC-BY; avoid non-commercial and no-derivatives licences and unlicensed code; ask if a case is unclear. Don't copy Road Rash's characters, track names, HUD layout or logos.

## Velocity and content

- The maintainer wants velocity, not ceremony `[decided]`: the gate is the complete list of checks. The maintainer is never a gate `[decided]`: decide technical things, tag them `[default]` in the docs, and keep going.
- Decide only what is hard to change later (save and pack formats, sim determinism, coordinates); elsewhere leave a seam. Every milestone is playable on the phone. Build no infrastructure for hypothetical needs.
- New content is data (a content pack) wherever feasible. Invent freely within the tone guide `[decided]`: a Road Rash homage with flavor and humor, never corny, cheesy, cringe or patronizing, and no gore.
- The maintainer vetoes after the fact, in chat or by "cut this" flags in a debug report ([mechanics](docs/content-packs.md#in-game-veto-cut-this)). Removing vetoed content and logging the lesson in the [taste log](docs/tone-guide.md#taste-log) is your job. Taste calls are final; don't re-litigate a veto `[decided]`.

## Money, questions and records

- `[decided]` Dev-time AI spend is capped at about $25 per batch and $75 per month. Prove small first; prefer the local GPU or Hugging Face. Ask before crossing a cap, adding any bill, or when the month-to-date total is unknown. After each paid run, report one line: what ran, where, the cost and the month-to-date total.
- Ask the maintainer only for taste calls, spend over the cap, anything irreversible or public-facing, and repo creation: in plain language answerable from memory on a phone, with a recommendation.
- Decisions live in the `docs/` pages, tagged; a new answer turns `[default]` or `[open]` into `[decided]` in the PR that acts on it. Playtest feedback is in [docs/playtests/](docs/playtests/README.md), per-change history in `changes/` and the releases, and inventions and vetoes in the pack files' `status`.
