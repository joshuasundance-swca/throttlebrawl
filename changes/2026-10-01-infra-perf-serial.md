---
kind: dev
audience: dev
---
The perf check now runs its probes one at a time (`--workers=1` in `scripts/perf.mjs`). Each probe times frames under 4x CPU throttling with software WebGL. On CI, Playwright's default of 2 workers ran a second probe (the ink look's, from the looks PR) beside the classic one, and both missed the soft frame-time limit. That run measured the contention, not the game: the classic probe printed p95 133.3 ms against a 133.2 ms limit, and the kodak probe printed p50 83.3 ms against 66.6 ms. Run one at a time on the dev machine, both held 16.7 ms.
