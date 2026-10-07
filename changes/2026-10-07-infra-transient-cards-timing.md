---
kind: dev
audience: dev
---
The browser slices plan `tests/e2e/ui-transient-cards.spec.ts` at its measured time. It had no row in `tests/timings.json`, so `scripts/shard-plan.mjs` planned it at the table's mean, 72 s. After #634 it takes about 300 s of tests: 298.3 s on train 323's browser slice 7/8 and 306.6 s on train 362's (the sum of its 8 tests' times in each log). Both slices hit their 10-minute timeout, and each time the train went red with "timed out" and split its bundle. The row is the mean of the two runs, 302.5 s. With it, the eight browser slices plan at 366 to 370 s of job (about 62% of 600 s); `scripts/shard-plan.test.ts` passes. Only this row changes; the rest of the table waits for its next refresh (`node scripts/timings.mjs`).
