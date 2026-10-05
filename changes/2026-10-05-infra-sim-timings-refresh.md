---
kind: dev
audience: dev
---
Main's sim slice 2 timed out at its 10-minute limit on main's own run (ci 37267558376, at #495's merge) and on several PR runs of playtest 3's wave C, while slice 1 finished in about 6 minutes. The slice plan still guessed one new file (`tests/sim/ai-stay-on-highway.test.ts`) at the table's mean, and wave C's content moved the other files' times. `tests/timings.json` is refreshed with `node scripts/timings.mjs 37267558376 37265532199 37264818263` (main's run at #495, and the sim tiers of #495's and #494's green re-runs): 91 sim files and 50 browser specs measured, none left to a guess. The plan now predicts 419 s for each of the four sim slices (it predicted 511 / 506 / 506 / 506 before, and slice 2 ran past 600). No test, slice count or timeout changes; the CI layout change in #486 replaces this table when it lands.
