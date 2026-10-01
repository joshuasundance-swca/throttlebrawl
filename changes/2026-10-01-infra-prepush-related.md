---
kind: dev
audience: dev
---
The pre-push hook now runs the typecheck plus only the unit tests related to what changed since origin/main, instead of the whole unit suite on every push. A config or package.json change still reruns them all, and CI still runs every test on the PR. Pushes were costing a median 1.4 minutes each across 388 lane pushes; this cuts the wait without changing the gate.
