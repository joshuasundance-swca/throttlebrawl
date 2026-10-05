---
kind: dev
audience: dev
---
The bundle train is back (the maintainer, 2026-10-05: "Revive the train instead of limiting parallel lanes"), ported from the parked #350 onto today's CI, and it ships switched off (`"live": false` in `.github/train.json`). Off, every PR runs exactly today's full gate. When it is turned on, each PR gets a quick check of 3 jobs (static with the build and its size budget, and the two unit slices) instead of 16, and ready PRs ride a train that runs the full suite once on main plus up to 8 of them. Green: they all land. Red: the bundle splits, the rest land, and the culprit gets the failing tests in a comment. Docs-only PRs need only the quick check; forks, Dependabot, "[full-gate]" and changes to `.github/` keep the full gate per PR.

- The suite now lives in one shared workflow, `suite.yml`, which `ci.yml` and the train both call, so a PR, a train and main always run the same jobs. Its checks show as `suite / static`, `suite / unit (1/2)` and so on; the required `gate` check is unchanged.
- `ci.yml` gains a `route` job that picks each PR's path. Only a full-path run records the tree it tested for main's skip path.
- `npm run check -- --tier budget` is new: the build plus `perf --size-only`.
- `scripts/timings.mjs` reads the suite's jobs under their new names.
- A red main waits for `rerun-main.yml`'s second attempt instead of re-running it a second time from the train.
