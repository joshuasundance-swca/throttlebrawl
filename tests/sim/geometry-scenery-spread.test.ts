/// <reference types="vite/client" />
// The scenery sweep (geometry-scenery.ts) over the spread seeds: 32-bit seeds as the app's
// createRaceSeeds draws them. The named seeds run in geometry-scenery-named.test.ts.
import { SPREAD_SEEDS } from './geometry-routes';
import { scenerySweep } from './geometry-scenery';

scenerySweep('spread', SPREAD_SEEDS);
