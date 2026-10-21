---
kind: dev
audience: dev
---

Changing the CI suite or its calling workflow now runs the existing contributor-guidance check before pushing. This catches stale slice and job counts locally instead of spending a full remote run on them. It selects one bounded test file, retains the current documentation checks, and leaves docs-only and dependency-only pushes unchanged.
