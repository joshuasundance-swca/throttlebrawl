---
kind: dev
audience: dev
---
CI's browser tier is now three parallel jobs instead of one: two e2e slices (`browser (1/2)`, `browser (2/2)`), split by spec file through Playwright's own `--shard`, and a separate `perf` job. The e2e step was the gate's critical path, about 390 s of an 8-minute browser job, so every PR waited on it. Nothing is dropped: Playwright puts every spec file in exactly one slice (locally 30 + 26 = 56 tests in 18 + 7 = 25 files), each slice builds and tests its own build, and perf still runs its probes one at a time, now on a runner with no e2e beside it. The deploy ships perf's build. `npm run check -- --tier browser --shard 1/2` runs one slice, `--tier perf` runs perf, and a plain `npm run check` still runs everything with one build. This also fixes a slip from the sim-slices PR, which had run the sim paragraph and the "gate is the only required check" paragraph together in docs/engineering.md.
