---
kind: dev
audience: dev
---
Main fix-forward: the perf check's soft tier is re-measured on CI runners, because the scene it times has grown. Main (b86069b) failed only "frame p95 within 2x the baseline": 149.9 ms against a 141.5 ms limit, on a baseline from 2026-09-30 (frame p50 33.3 ms, p95 66.6 ms, sim step p95 3.7 ms).

Since then the seed-1 bot race has gained real rider and bike models (#300, #346), blob shadows, roadside weapons, the off-road ground band (#343), rivals from the region's cast with seeded light (#323) and the cop roadblock (#338). Triangles at the last checkpoint went from about 68,000 to about 116,000 on 2026-10-02 alone.

The new numbers come from the 8 CI runs on current main code (main 3309a1f, the six rounds of #355, main b86069b), read from the CI logs:

- Classic look: frame p95 printed 83.4, 100.1, 116.6, 133.3, 133.3, 149.9, 150 and 150 ms (5 to 9 frames; 3 of the 8 failed the old limit, one on main). Frame p50 was 50 to 66.7 ms; sim step p95 was 4.7 to 6.8 ms.
- New `soft` baseline (the medians, rounded to whole frames): p50 66.7 ms, p95 133.3 ms, step p95 4.9 ms. The limits become 141.7, 274.9 and 9.8 ms. Every one of the 8 runs passes. Twice the baseline still passes and one frame more fails, as the docs say.
- Ink looks (24 results): frame p95 printed 133.3 to 216.7 ms and p50 66.6 to 99.9 ms. None failed yet, but 5 printed a p50 of 99.9 ms against the old 108.3 ms limit, one frame from failing.
- New `softInk` baseline: p50 83.3 ms, p95 183.3 ms. The limits become 174.9 and 374.9 ms.

Part of this is the scene's real cost on CI's software renderer (SwiftShader): the triangle count really grew. But the timings themselves are noisy: the same code ranged about 2x across runners (frame p95 83.4 to 150 ms in the 8 runs above), so the new baseline is a rough median, not a precise measure of how much slower the scene got. The biggest step came with the off-road ground: in its own CI runs the last checkpoint drew about 98,000 to 117,000 triangles, while main drew about 67,000 to 86,000 in the same hours. Frame p50 moved from 3 to 4 frames once it merged with #323 and #338. The hard gate is unchanged, but it is getting close: the last checkpoint peaked at 133,293 triangles against the 150,000 budget, and at 108 draw calls against 120. The phone's frame rate still comes from the maintainer's playtest.

Two spec comments that quoted the old baselines in the present tense now use the past tense. No test logic changed.
