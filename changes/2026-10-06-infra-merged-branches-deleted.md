---
kind: dev
audience: dev
---
Merged branches are now cleaned up. The maintainer asked on 2026-10-05 to delete remote branches already merged into main: 543 branches whose tip was exactly a merged PR's head were deleted (each merged PR keeps a Restore-branch button), and the repo's "automatically delete head branches" setting is on, so a merged PR's branch goes away by itself. The never-delete rule in AGENTS.md and docs/engineering.md now names that one exception; deleting any branch by hand, and every tag, release, repo, Space and dataset, stays forbidden.
