// The still scene along every Pacific Northwest route, at its peak view (scene-cost.test.ts says how and why; the
// sweep is scene-cost.test-util.ts, split by pack so CI runs the three files side by side).
import { describe, it } from 'vitest';
import { checkRoute, routesOf } from './scene-cost.test-util';

describe('the still scene along every Pacific Northwest route, at its peak view', () => {
  for (const route of routesOf('region-pnw')) {
    it(
      `${route.id}: inside its share of the draw-call and triangle budget`,
      () => checkRoute(route),
      300_000,
    );
  }
});
