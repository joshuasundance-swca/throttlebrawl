---
kind: dev
audience: dev
---
A pull request's CI now stops at its first red job. Each PR run holds 16 suite jobs plus the gate, and GitHub runs about 20 jobs at once, so a PR that was already red kept holding slots that other PRs needed.

- On a PR run, the last step of every suite job (static, unit, sim, browser) cancels the whole run when its job failed. The unit, sim and browser matrices also fail fast on PR runs.
- Those four jobs can now write to Actions, which is what cancelling a run needs. No other job can. A fork's token is read-only, so on a fork's PR the cancel is refused, the step logs a notice and the run goes on as before.
- A cancelled run is still red: `gate` runs after a cancel and fails on any cancelled job. The red job's own log and screenshots are the result to read.
- A push to main is unchanged: every job runs to the end, and `rerun-main` re-runs only the failed ones.
- `scripts/tested-tree.test.ts` checks the wiring: the cancel step is each suite job's last step and runs on PRs only, only the suite jobs get the Actions permission, and every matrix fails fast on PRs only.
