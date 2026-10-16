---
kind: changed
audience: dev
---

Browser CI now uses recorded case durations for newer menu checks and runs independent
road-picker viewport checks in parallel on the existing browser workers. Every test and
negative control remains. The update restores planning margin without changing job counts,
timeouts or budgets.

The timing values guide test allocation; they do not promise run times or phone performance.
