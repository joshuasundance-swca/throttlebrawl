---
kind: dev
audience: dev
---
CI's test slices are now planned as whole jobs and sit well inside their 10-minute limit. Until now the plan counted only test seconds. Each job also spends time on setup, npm install and the file listing: 11 to 25 s for unit and sim jobs, and 37 to 70 s for browser jobs, which also install Chromium and build. So sim slice 3/6 took 590 to 597 s of its 600 on three runs, and browser slices planned at 355 s took up to 573 s.

- **The plan counts the setup.** `scripts/timings.mjs` now measures each tier's setup seconds from the same green runs as the file times, and writes them into `tests/timings.json`. The plan adds them to every slice.
- **Sim files timed at 0 s are planned as the mean file.** Eight sim files race while Vitest collects them, which its per-file time leaves out, so the table timed them at 0 s, and the plan put all eight in one slice. That slice took 488 s on this PR's first run, against a plan of 340 s; the other sim slices took 200 to 399 s.
- **Parallel specs are spread.** A browser spec that runs its tests in parallel (`ui-settings.spec.ts`) is planned across both of the runner's workers. Planned as one worker's file, it had put its slice at 537 s; it ran in 258 s.
- **The table is refreshed** from the first three green full-suite runs after the test diet (37442774709, 37443954405 and 37443974626).
- **One more sim slice and one more browser slice:** 7 sim and 8 browser, so a full suite is 18 jobs instead of 16. The plan now puts unit slices at 236 s (49% of 8 minutes), sim slices at 329 to 343 s and browser slices at 327 to 329 s (55 to 57% of 10).
  - Refreshed at the old counts they would plan at 68% and 62%, just under the 70% line. The cost of the eight sim files above is only estimated, and browser specs vary up to 1.66 times between runs.
  - Two suites queued against GitHub's 20 runners take about 5 s longer between them. A lone suite's slowest slice is 44 to 65 s shorter.
- **A unit test guards the line.** It plans the checked-in table with `suite.yml`'s own slice counts and timeouts, and fails if any slice passes 70% of its timeout. On CI, `npm run check` also warns when one does.

Not phone-verified (no game change).
