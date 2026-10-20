---
kind: dev
audience: dev
---
Pushing a dependency-only update now runs the local typecheck without the full unit tier. CI still runs every test. If a push also changes source files, the pre-push hook runs their named unit tests and existing bounded checks. Changes to global test or type configuration still run the full local unit tier, and a missing base reference retains the hook's full-tier fallback. Agents may run additional focused named tests locally when a specific uncertainty warrants them.
