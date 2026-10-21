---
kind: fixed
audience: dev
---

The mirrored HUD layout check has a 60-second runner deadline for its rendered measurements and screenshots. Two CI runs exhausted the old 30-second deadline after reporting no layout findings, while the unchanged check passed on retry. Every layout assertion and negative control remains; game frame-time and geometry budgets are unchanged. This avoids rejecting a correct layout because the test harness finishes slowly on a shared runner.
