---
kind: dev
audience: dev
---
CI's jobs get room again. On #475's green run every suite job took 520 to 608 s, close to the 10 minutes a sim slice was allowed, and one sim slice timed out. Each job is now planned to finish inside about 7 minutes, with a timeout of about 1.5 times its expected time.

- `static and unit` is now `static` (about 2 minutes) and the unit tests in two slices, planned like the sim slices: `tests/timings.json` has a unit table, which `node scripts/timings.mjs` refreshes with the others, and `npm run check -- --tier unit --shard i/n` runs one slice. The slowest unit file (`tools/gis/region-routes.test.ts`, up to about 5.5 minutes) starts first, and the plan adds about 0.8 s per unit file for the setup and import that Vitest's per-file times leave out.
- The sim batch runs in six slices (was four) and the browser tests in six (was four). A push now runs 15 suite jobs instead of 9.
- The sim slice that holds the batch readers now holds nothing else, and the readers of the Easy and Hard batches start first in it, so those batches compute beside the Normal one instead of after it.
- `npm run check` reads Vitest's file list from a JSON file instead of a pipe: a 325-file list came back cut short on CI, which would plan slices that leave files out.
- Three slow sim files are split, with every test and assertion unchanged: the held-landings check runs one file per air command (`riders-landings-held.test.ts` for the brake, `riders-landings-held-kick.test.ts` for the kick, sharing `tests/sim/landings-held.ts`), the grudge A/B left `ai-feel.test.ts` for `ai-grudge-ab.test.ts`, since it reads no batch and need not wait for one, and the cop-parking check runs by region (`cops-parking.test.ts` for the coverage check and the Keys, `-pnw` and `-sf`, sharing `tests/sim/cops-parking.ts`).
- Timeouts: static 4 minutes, unit 8, sim 10, browser 10 (was 15; the cached Chromium packages keep a slow Ubuntu mirror out of the normal run). The small jobs (plan, prod build, gate, deploy, release) keep theirs.
