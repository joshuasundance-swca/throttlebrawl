---
kind: changed
audience: dev
---

Train bundles now run at most six browser slices at once as a scheduling experiment. Every slice
still runs, including perf and the final slice's artifact duties. Other suite calls retain full
matrix concurrency. This may leave room for quick checks alongside a train, but it reserves no
runner slots and claims no measured speed or cost saving.
