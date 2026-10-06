---
kind: dev
audience: dev
---
CONTRIBUTING.md now tells a first-time contributor or a coding agent how a pull request lands, in numbered steps, and the pages that describe the train were checked against the code.

- **CONTRIBUTING.md** has a "How a pull request lands" section: open the PR, the `quick` check, arm auto-merge, the train combines the armed PRs and runs the full suite once, green lands, red splits and comments. It says what `quick` and `gate` mean and where to read the gate's text (`gh pr checks <n>`), how to see why a PR waits (the `train` line, then the train run's `plan` log), when to use "[full-gate]", and what changes for forks, Dependabot, docs-only PRs and changes under `.github/`. It gained the `gate` lines it was missing: "waits for the next train", "conflicts with ...; waits" and "passes on its branch, fails on main".
- **README** says plainly where the game stands: playable, not launched, three regions, a career, and mostly agent-written code.
- **docs/engineering.md** opens the train section with a plain-words summary, before the reasons and the detail. Two stale counts are fixed there: the suite is 7 sim and 8 browser slices (18 jobs), not 6 and 7 (16).
- **A test** (`scripts/contributing-docs.test.ts`) reads these pages back against `scripts/train.mjs` and `suite.yml`: the numbered steps and their order, every quoted `train` and `gate` line, the places that count as shipping, the path each kind of PR takes, the suite's size, the relative links, and that no personal detail is in them. Each checker is also run on a planted fault, so a green run shows it can find one.

Docs and a test only: nothing the game or the train does changes. Not phone-verified (no game change).
