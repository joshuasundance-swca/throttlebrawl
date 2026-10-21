---
kind: fixed
audience: dev
---
Lombard drift probes now expose each bike comparison and each bike/floor experiment as an independently named simulation case. The original GORGE, G5, premise, numeric assertions, seeds, tuning, per-experiment report rows and floor inventory remain. The pooled 18-row report becomes three six-row per-bike summaries, and the floor sweep is split across three files so CI can distribute its existing work. This does not claim a speedup.
