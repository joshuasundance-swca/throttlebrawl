---
kind: dev
audience: dev
---
The agents' rules now live in one committed place. AGENTS.md says how work is actually done (lanes end at push, one keeper per run, what may run on the dev machine, tests in CI plus one live check), the engineering doc gives the reasons, the playtest feedback and decisions have their own pages under docs/playtests/, and the product spec carries playtest 3's decisions. A saved run template sits in .claude/workflows/. After review, AGENTS.md also keeps the older rules that were still live: Codex lanes don't push (the coordinator opens their PRs), tests come from each task's acceptance list and are written failing first, `npm ci` runs in every worktree, unlicensed code stays out, and the Playwright MCP tools are never used.
