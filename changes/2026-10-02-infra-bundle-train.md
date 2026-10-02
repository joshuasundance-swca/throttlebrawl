---
kind: dev
audience: dev
---
The bundle train is built (the maintainer, 2026-10-02: "Yes, build it"), and ships switched off. When it is on, each PR gets a quick check (static and unit, the build and its size budget, about 4.5 minutes), and ready PRs ride a train that runs the full suite once on main plus the bundle. Green: they all land. Red: the bundle splits, the rest land, and the culprit gets the failing tests in a comment. Docs-only PRs need only the quick check; forks, Dependabot, "[full-gate]" and CI changes keep the full per-PR gate. The suite now lives in one shared workflow, so a PR, a train and main always run the same jobs. Staging deploys again: its smoke test is the boot spec alone, not all 45 e2e specs, which let a newer push cancel 160 of 161 runs on 2026-10-02 before they deployed.
