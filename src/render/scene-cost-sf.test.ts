// The still scene along every San Francisco route, at its peak view (scene-cost.test.ts says how and why; the
// sweep is scene-cost.test-util.ts, split by pack so CI runs the three files side by side).
import { describe, it } from 'vitest';
import { checkRoute, routesOf, SCENE_COST_SHARDS } from './scene-cost.test-util';

describe('the still scene along every San Francisco route, at its peak view', () => {
  for (const route of SCENE_COST_SHARDS.sf.flatMap(routesOf)) {
    it(
      `${route.id}: inside its share of the draw-call and triangle budget`,
      () => checkRoute(route),
      300_000,
    );
  }
});
