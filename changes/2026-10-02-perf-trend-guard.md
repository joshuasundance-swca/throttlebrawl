---
kind: dev
audience: dev
---
The perf check's frame and sim step times are now a trend, not a gate (the maintainer, 2026-10-02: "Trend plus 3x guard"). Every CI run prints frame p50, frame p95 and sim step p95 for the classic look and each ink look, with their ratio to the stored baseline, as a `perf trend` line in the log and a table in the job's step summary. The gate fails only above 3x the baseline, a catastrophe guard that runner noise cannot reach. Draw calls, triangles and the download size stay hard limits.

Why: CI draws the game in software at about 7 to 19 frames a second, and its frame times come in whole 16.7 ms steps. On 2026-10-02 the classic frame p95 drifted from about 83 ms in the morning to 150 ms at night, and the same game code printed 100.1 ms in one run and 150 ms in the next. The old rule (fail above 2x the baseline) held main red on that noise. The baseline itself is the fresh one from #356 (8 CI runs on 2026-10-02), so the guards are frame p50 208.4 ms, frame p95 408.2 ms and sim step p95 14.7 ms for classic, and frame p50 258.2 ms and p95 558.2 ms for the ink looks. The highest readings that day were 66.7, 150 and 6.8 ms (classic) and 99.9 and 216.7 ms (ink).

The limit logic moved into `scripts/perf-limits.mjs`, shared by both probes and the perf script. A new unit test, `scripts/perf-limits.test.ts`, shows the guard fires: exactly 3x the baseline in whole frames passes and one frame more fails, for each metric, on the stored baselines too, and a missing number fails. It also shows every reading from 2026-10-02 passes, and that the old 2x rule failed the 149.9 ms reading that held main red. Breaking the guard (never "over", or a factor of 2) makes it fail.

The perf script also prints the first-load JavaScript's headroom under its 500 KB budget, and on CI the pull request's own change against main: it builds the merge base with `origin/main` in a throwaway worktree under `.cache/` (about 4 s locally) and measures it the same way. A growth of 5 KB or more prints a warning; only the budget fails. Locally, `--base origin/main` does the same, and `--size-only` skips the browser probes. The classic probe now prints its draw-call and triangle headroom at the busiest checkpoint every run. The first-load budget went red three times on 2026-10-02, each time from the last of several merges; now each lane sees its own share.

docs/engineering.md's perf section says all this, with the soft tier's rule tagged `[decided]`.
