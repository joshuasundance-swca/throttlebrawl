---
kind: dev
audience: dev
---
The perf check's ink looks (Ink + 1960s film, Sun-bleached wasteland, Kodachrome brush) get their own soft-tier frame-time baseline, `softInk` in `tests/perf/baseline.json`: p50 50 ms and p95 116.7 ms, so the limits are 100 and 233.4 ms. Until now they shared the classic look's 66.6 ms p95 baseline, a limit of 133.2 ms. In software rendering on CI, the ink pass costs about one more 16.7 ms frame at p95, so the kodak look printed 116.6 to 133.4 ms and failed 2 of 7 runs on 2026-10-01, one of them on main. The CI runs are listed in the file. The classic look's baseline and the hard gate (draw calls and triangles) are unchanged. The phone's frame rate still comes from the maintainer's playtest.
