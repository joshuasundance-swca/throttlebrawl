# AGENTS.md: binding rules for every coding agent

These rules bind Claude Code, Codex, Copilot and any other agent working in this repo. Claude Code leads and the others help. `CLAUDE.md` only imports this file. This file restates the docs for agents. If it conflicts with a `[decided]` item in `docs/`, the doc wins and this file is fixed in the same PR; otherwise this file wins. Rules marked `[decided]` trace to the maintainer; everything else here is `[default]`. When a rule seems wrong, propose a change in a PR; do not work around it.

throttlebrawl is a public, MIT-licensed browser motorcycle brawler (TypeScript, Three.js, Vite, npm; all `[decided]`). It is inspired by Road Rash (EA, 1991–2000), but never uses that name in names or branding.

## Read first

1. This file.
2. [docs/engineering.md](docs/engineering.md): the gate, scripts, CI, deploy and lane rules.
3. [docs/architecture.md](docs/architecture.md): the module map. It decides which folders your lane owns.
4. [docs/product-spec.md](docs/product-spec.md): scope and the v1 launch bar, for anything you build. [docs/roadmap.md](docs/roadmap.md) says when each thing lands, and `docs/milestones/M1.md` to `M5.md` are the task plans.
5. [docs/content-packs.md](docs/content-packs.md): before touching `packs/` or `src/content/`.
6. [docs/tone-guide.md](docs/tone-guide.md): before writing any player-facing text or content.

Tags in docs: `[decided]` is the maintainer's call, so don't change it without asking. `[default]` is a proposal. The maintainer may change it; an agent may change it only in a PR that updates the doc and says why in its `changes/` note. `[open]` waits on the maintainer; don't build anything that forecloses it.

## Definition of done

`[decided]` The bar is tests, lint and types, a bot playthrough, a perf check and a plain changelog; the leak scan is `[decided]` too. The other checks are `[default]` additions. A change is done when CI's `gate` check is green on your PR (auto-merge then merges it). `npm run check` is the same list run locally:

- types, lint and format are clean;
- pack validation, unit tests, sim tests (seeded races that replay to identical hashes) and, once they exist, fixture migrations pass (save fixtures from M4; pack-migration fixtures from the first outside pack) `[default]`;
- the bot plays a race in a real browser and the screenshots are not blank;
- the perf budget holds on the throttled phone-like profile;
- the leak scan and size check are clean;
- the PR adds a plain-words note under `changes/`. A PR that only Dependabot opened and committed to is exempt; the gate checks both ([Dependabot](docs/engineering.md#dependabot)).

Locally, the pre-push hook (typecheck and tests) must pass. Run `npm run check`, or single browser tiers, when you touch render, input, UI or perf-relevant code. Any edit after a green CI run reopens the gate: push and let CI re-run. Report what each check examined, not only that it passed. Performance claims name the device, the renderer and the scene. Agents cannot verify a milestone on the benchmark phone: report "done, not phone-verified"; the maintainer's playtest phone-verifies it, and nothing waits for that.

## Branches and merging

- Work on a branch named `lane/<lane-id>/<topic>`, never directly on `main`. `<lane-id>` is the module folder name from the ownership table in architecture.md (for example `lane/road/junctions`), or `infra` for shared files. `[default]`
- One exception, before any of this applies: the repo's very first commit (the planning docs, made by the lead agent at repo creation, before branch protection exists) goes straight to `main` ([engineering](docs/engineering.md#branch-protection-and-auto-merge)). Every later change is a PR.
- You may push your branches and open PRs without asking. `[decided]`
- Arm auto-merge when you open the PR (`gh pr merge --auto --squash`). Main changes only through green checks. `[decided]`
- Confirm a merge by querying the PR's state (`gh pr view --json state,mergedAt`), not by trusting an exit code.
- Keep PRs small, and open one as soon as something is playable.
- Stay inside your lane's folders, plus your own tests and `changes/` note. A small edit to a shared config or script (a `package.json` script, a config option, a test setup file) may ride in your own PR when only your change needs it; say so in the PR note. Dependency changes, the lock file, `.github/` and this file still go through the infra lane or a tiny separate PR. `[default]` (the maintainer, 2026-10-01: less waiting on extra PRs)
- Never hand-merge `package-lock.json`. Rebase, then run `npm install`.
- Contract changes (data-pack schemas, cross-module interfaces) land first, as their own small PR.
- Parallel agents on one machine each use their own `git worktree`.
- If `main` goes red, fixing it comes before any new work: a fix-forward or revert PR.

## Never

- **Never delete** branches, tags, releases, repos, Spaces or datasets. `[decided]` Removing or renaming files inside a normal PR (refactors, dead code, vetoed content) is ordinary editing and is allowed when the PR note says why. Deploys that replace a Space's files (the source mirror and the build) are also allowed. `[default]` for this reading of "never delete".
- **Never commit to a Space by hand.** GitHub is canonical; each deploy uploads the tracked tree plus `dist/` to the Spaces as a normal commit and overwrites anything else there. `[default]` (the maintainer's "Mirror repo to hf" note, designed in [docs/engineering.md](docs/engineering.md#deploy-game-space-and-staging-space))
- **Never force-push, and never rewrite published history.** `[default]` (the maintainer's standing rule for all repos; not asked in this project's interview)
- **Never skip hooks or checks** (`--no-verify`, disabling a test, loosening a budget without a stated reason). If a hook or test is wrong, fix it in the open, with the reason in the PR note.
- **Never create** repos, Spaces or dataset repos, **change** repo settings, protection or visibility, or **rename** anything public. Those need the maintainer, confirmed at the time. `[decided]`
- **Never schedule unattended or recurring agent work** (cron, scheduled runs, overnight loops) unless the maintainer asks for it. `[decided]` (usage limits).
- **Never ship a secret** in client code. Static Spaces expose their variables to the browser.
- **Never run interactive logins.** If auth fails, stop that task and report which login is needed.

## Public safety

This repo is public. Everything you commit, including commit messages, PR text, branch names, notes and screenshots, is published.

- No employer names, no personal details about the maintainer or anyone else, and no email addresses except no-reply ones.
- Commit as the maintainer's GitHub no-reply address (`<id>+<login>@users.noreply.github.com`), set in user-level git config, never a real address. `[decided]` (cockpit answer, 2026-09-29) The hooks and CI check the author and committer email ([commit identity](docs/engineering.md#commit-identity)).
- No absolute user paths, usernames, machine names, network or proxy details, or certificate settings.
- Refer to "the maintainer". Say "the dev machine", not its paths.
- Machine-specific settings (certificates, proxies, private denylists) live in user-level config, never in the repo.
- Private context about the maintainer stays in agent memory, outside the repo. `[decided]` `scratch/`, `*.local.md` and agent logs are git-ignored working space for notes that are not private; never put anything private there, and never `git add -f` them.
- The pre-commit leak scan is light by design. It does not replace this rule; you are the first filter.
- Assets: log every non-original asset in `THIRD_PARTY_ASSETS.md` with its licence, and label AI-generated ones. `[default]` Prefer CC0 or CC-BY. Avoid non-commercial or no-derivatives licences and unlicensed code; the maintainer's stance on data licences is "all basically fine", so ask if a case is unclear.
- Don't copy Road Rash's characters, track names, HUD layout or logos.

## Velocity

- The maintainer wants velocity, not ceremony. `[decided]` The gate is the complete list of checks; don't add parallel checks, reviews or approval steps.
- Decide only what is hard to change later: save and pack formats, the sim's determinism, coordinate systems. For everything else, leave a seam (an interface, a version field, a config switch) and move on.
- Every milestone is playable on the phone. Crude and playable beats polished and unplayable.
- The maintainer is never a gate. `[decided]` When something is technical, decide it, tag it `[default]` in the docs, and keep going.
- Don't build infrastructure for hypothetical needs. If it has no payoff this milestone, put it on the idea shelf.
- End every session playable: branches pushed, PRs merged or left as drafts with a line saying what's missing, and main green.

## Content latitude and the taste log

- New content should be data (a content pack), not code, wherever feasible: weapons, rivals, bikes, barks, events, event modifiers (weird events), radio stations, regions, HUD pieces.
- You may invent content freely within the tone guide `[decided]`: a Road Rash homage with room for flavor and humor, maybe wild-wasteland (Fallout and Borderlands) style. The register is "about right" but open to change. Deadpan signs, trash talk, absurd physics, satirical billboards and stale-meme nods are all welcome. Never corny, cheesy, cringe or patronizing `[decided]`. No gore.
- The taste log lives in the content docs: new inventions carry `status` in their pack file, and lessons go into the [tone guide's taste log](docs/tone-guide.md#taste-log). The maintainer vetoes after the fact. Nothing waits for approval. `[decided]`
- Vetoes arrive in chat, or as "cut this" flags in a pasted debug report (an in-game long-press on a bark subtitle, billboard or sign, and, from M4, on a radio track in the pause menu's station panel). Removing vetoed content and updating its taste-log entry is your job; don't wait to be asked. The mechanics are in [docs/content-packs.md](docs/content-packs.md#in-game-veto-cut-this). `[decided]`
- The maintainer's taste calls (the look, final names, vetoes) are final. Don't re-litigate a veto.

## Money

`[decided]` Dev-time AI spend is capped at about $25 per batch and $75 per month. Prove small before scaling. Prefer the local GPU or Hugging Face. Ask before any batch that would cross a cap, before adding any new bill, or whenever the month-to-date total is unknown. After each paid run, report one plain line: what ran, where, the cost, and the month-to-date total.

## Ask the maintainer only for

Taste calls, spend over the cap, anything irreversible or public-facing (creating, deleting, renaming or announcing), and repo creation. Ask in plain language that can be answered from memory on a phone, with a recommendation. Everything else, decide and record.

## Where decisions live

- Design decisions are tagged in the `docs/` pages. A new maintainer answer turns `[default]` or `[open]` into `[decided]` in the same PR that acts on it.
- Open questions for the maintainer are listed at the end of each doc, and the lead agent asks them.
- Per-change history is in `changes/` and the GitHub releases.
- Inventions and vetoes are in the pack files (`status`) and the [tone guide's taste log](docs/tone-guide.md#taste-log).
