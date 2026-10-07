import { expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, lanesNear, type BakedRoad } from '../road';
import { EdgeLocator } from './overlap';

it('render clearance uses a one-sided lane extent, with visible lane and empty-reference controls', () => {
  const bundle = fixtureNetwork([{ id: 'cut', lengthM: 100, kappa: 0 }]);
  const r = bundle.roads[0] as BakedRoad;
  const road = createRoadNetwork({
    ...bundle,
    roads: [
      {
        ...r,
        laneSections: [
          { s0: 0, lanes: [{ id: 'S1', dCenterM: 5, widthM: 8, direction: 1, kind: 'shortcut' }] },
        ],
      },
    ],
  });
  const locator = new EdgeLocator(road);
  expect(locator.onLanes(0.55, -50, -1, 0.3)).toBe(false);
  expect(locator.onLanes(1.1, -50, -1, 0.3)).toBe(true);
  const empty = createRoadNetwork({ ...bundle, roads: [{ ...r, laneSections: [{ s0: 0, lanes: [] }] }] });
  expect(empty.lanesAt(0, 50)).toHaveLength(0);
  const emptyLocator = new EdgeLocator(empty);
  for (const [x, found] of [
    [0, true],
    [1, false],
  ] as const) {
    expect(emptyLocator.onLanes(x, -50, -1, 0.1)).toBe(found);
    expect(lanesNear(empty, x, -50, -1, 0.1)).toBe(found);
  }
});
