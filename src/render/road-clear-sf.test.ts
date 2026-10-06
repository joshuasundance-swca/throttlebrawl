// Nothing drawn stands in the road, on every San Francisco network (road-clear.test-util.ts says how and why;
// split by pack so CI runs the three files side by side).
import { describe, it } from 'vitest';
import { checkNetwork, networksOf } from './road-clear.test-util';

describe('the ride column over every road of every San Francisco network: no building cuts it', () => {
  for (const id of networksOf('region-sf')) it(`${id}, seed 1`, () => checkNetwork(id, 1), 300_000);
});
