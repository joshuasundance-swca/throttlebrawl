---
kind: dev
audience: dev
---

Main's preflight can retry a complete empty CI-run listing for a proven descendant
while its existing time and request budgets allow another decision. Each retry
reads main and proves ancestry again before checking successor eligibility. Empty
or unavailable evidence never accepts a tree; exhausted budgets still run the
full suite. This covers transient listing visibility in deterministic tests,
without guaranteeing that a live delay will fit the remaining budget.
