---
kind: dev
audience: dev
---

After a train fails, branch diagnostics can repeat just its failed shards when the complete current-attempt job inventory is available. Shard identities and the original test partition stay unchanged. Ambiguous, cancelled or incomplete observations retain the full diagnostic suite. Partial diagnostics never establish that a whole branch passed or failed, accept a PR, record a tested tree or deploy a build; those still require full-suite evidence.

Workflow tests now execute the ordinary quick route's tier conditions instead of pinning its shard count. The canonical suite configuration and existing timing budgets still govern shard allocation. Branch-control comments describe observed disagreement without claiming it proves a source-composition cause.
