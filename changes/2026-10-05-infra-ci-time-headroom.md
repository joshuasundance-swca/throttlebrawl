---
kind: dev
audience: dev
---
CI's jobs get room again. On #475's green run every suite job took 520 to 608 s, close to the 10 minutes a sim slice was allowed, and one sim slice timed out. Each job is now planned to finish inside about 7 minutes, with a timeout of about 1.5 times its expected time.

- `static and unit` is now `static` (about 2 minutes) and the unit tests in two slices, planned like the sim slices: `tests/timings.json` has a unit table, which `node scripts/timings.mjs` refreshes with the others, and `npm run check -- --tier unit --shard i/n` runs one slice. The slowest unit file (`tools/gis/region-routes.test.ts`, about 5.5 minutes) gets a slice of its own and starts first.
- The sim batch runs in five slices (was four) and the browser tests in six (was four). A push now runs 14 suite jobs instead of 9.
- The readers of the Easy and Hard batches start first in the sim slice that holds the batch readers, so those batches compute beside the Normal one instead of after it.
- Two slow sim files are split, with every test and assertion unchanged: the held-landings check runs one file per air command (`riders-landings-held.test.ts` for the brake, `riders-landings-held-kick.test.ts` for the kick, sharing `tests/sim/landings-held.ts`), and the grudge A/B left `ai-feel.test.ts` for `ai-grudge-ab.test.ts`, since it reads no batch and need not wait for one.
- Timeouts: static 4 minutes, unit 9, sim 9, browser 10 (was 15; the cached Chromium packages keep a slow Ubuntu mirror out of the normal run). The small jobs (plan, prod build, gate, deploy, release) keep theirs.
