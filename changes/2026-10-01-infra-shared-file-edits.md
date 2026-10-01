---
kind: dev
audience: dev
---
Lanes may now make a small edit to a shared config or script (a package.json script, a config option, a test setup file) in their own PR when only their change needs it, instead of waiting on a separate PR. Dependency and lock-file changes, `.github/`, AGENTS.md and docs/engineering.md still change only in their own PR. The rule is updated in AGENTS.md and docs/engineering.md, at the maintainer's request to cut waiting.
