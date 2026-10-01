---
kind: dev
audience: dev
---
CI runs the seeded sim batch in its own job, split by test file into two parallel slices (`sim (1/2)` and `sim (2/2)`), instead of after the unit tests in one job. The batch had grown to between 167 and 294 s on one runner (three main runs, 2026-10-01), against the job's 10-minute timeout. Nothing is dropped: Vitest's `--shard` puts every file in exactly one slice, and locally the slices held 15 and 14 of the 29 files, 90 and 175 of the 265 tests. `npm run check -- --tier sim --shard 1/2` runs one slice; it refuses a malformed slice or a tier whose steps do not shard. `--tier unit` now runs only the unit tests, and a plain `npm run check` still runs everything. The gate also waits for both slices.
