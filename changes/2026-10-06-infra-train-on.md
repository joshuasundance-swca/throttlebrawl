---
kind: dev
audience: dev
---
The bundle train is switched on (`"live": true` in `.github/train.json`; the maintainer, 2026-10-05: "Revive the train instead of limiting parallel lanes"). Each PR now gets a 3-job quick check instead of the 16-job suite, and ready PRs with auto-merge armed ride a train that runs the full suite once on main plus up to 8 of them; green PRs land together. Docs-only PRs land on the quick check alone; forks, Dependabot, "[full-gate]" and changes to `.github/` keep the full gate per PR. The engineering doc now describes the train as on. To roll back: a PR setting `"live": false`, then `gh pr update-branch` on the PRs that were waiting.
