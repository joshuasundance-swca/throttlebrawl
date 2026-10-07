// Vitest setup for every project (vitest.config.ts): the structures' planners (src/road/structures/, one lazy
// chunk in the game) load before any test, as the app loads them with a region's road data, so a race the
// test builds on any network can plan its world as it starts (road/structures.ts `raceStructures`; the sim
// meets the plan, sim/riders/structures.ts).
import { loadStructurePlanners } from '../../src/road/structures';

await loadStructurePlanners();
