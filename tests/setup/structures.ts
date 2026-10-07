// Vitest setup for every project (vitest.config.ts): the structures' planners (src/road/structures/, one lazy
// chunk in the game) load before any test, as the app loads them with a region's road data, so a race the
// test builds on any network can plan its world as it starts (road/structures.ts `raceStructures`; the sim
// meets the plan, sim/riders/structures.ts). The systems' steps (src/sim/late.ts, the sim's step chunk) load
// with them, as the app loads them before any race.
import { loadStructurePlanners } from '../../src/road/structures';
import { loadSimSteps } from '../../src/sim/late';

await Promise.all([loadStructurePlanners(), loadSimSteps()]);
