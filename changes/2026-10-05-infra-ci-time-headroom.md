---
kind: dev
audience: dev
---
CI's jobs get room again. Every job ran 520 to 608 s against its 10-minute guard (#475's green run), and one sim slice timed out. Each job is now planned to finish inside about 7 minutes, with a timeout of about 1.5 times its expected time.

- `static and unit` is two jobs, `static` (about 2 minutes) and `unit`. The unit tests start their slowest file (`tools/gis/region-routes.test.ts`, about 5 minutes) first: `tests/timings.json` now has a unit table, which `node scripts/timings.mjs` refreshes with the others.
- The sim batch runs in five slices (was four) and the browser tests in six (was four). A push now runs 13 suite jobs instead of 9.
- The readers of the Easy and Hard batches start first in the sim slice that holds the batch readers, so those batches compute beside the Normal one instead of after it.
- Two slow sim files are split, with every test and assertion unchanged: the held-landings check runs one file per air command (`riders-landings-held.test.ts` for the brake, `riders-landings-held-kick.test.ts` for the kick, sharing `tests/sim/landings-held.ts`), and the grudge A/B left `ai-feel.test.ts` for `ai-grudge-ab.test.ts`, since it reads no batch and need not wait for one.
- Timeouts: static 4 minutes, unit 9, sim 10, browser 10 (was 15; the cached Chromium packages keep a slow Ubuntu mirror out of the normal run). The small jobs (plan, prod build, gate, deploy, release) keep theirs.
