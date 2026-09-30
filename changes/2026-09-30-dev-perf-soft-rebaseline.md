---
kind: dev
audience: dev
---
The perf check's soft tier compares the throttled sim step time with a stored baseline. That baseline goes from 2.1 ms to 3.7 ms (p95), so the limit rises from 4.2 ms to 7.4 ms. The old number was measured on PR 52, before M2 added traffic contacts, rider bumps, the combat shove and style scoring. Ten CI runs of this check on 2026-09-30 printed a sim step p95 of 2.9 to 5.1 ms, with a median of 3.65 ms. Two of them failed the old limit on changes that did not touch the sim, one of them a run on main. The runs are listed in `tests/perf/baseline.json`. The frame-time baselines are unchanged, and the hard gate (draw calls and triangles) is unchanged.
