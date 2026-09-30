---
kind: fixed
audience: dev
---
Dependabot's PRs no longer fail the gate for skipping the changes note. The gate now lists that step as not active, with the reason, instead of treating it as a check that looked at nothing. Dependabot also stops proposing Node type definitions newer than Node 22, which the game runs on, and TypeScript 7, which the linter can't use yet.
