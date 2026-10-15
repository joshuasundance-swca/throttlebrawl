import { expect, it } from 'vitest';
import { createHeadlessRace } from '../../app';
import type { RouteQueries } from '../../sim/api';
import { createBot } from './index';

it('avoids a vehicle projected across a road boundary, without changing snapshots', () => {
  const { sim } = createHeadlessRace();
  const initial = sim.snapshot();
  const player = initial.entities.find((e) => e.slot === 0)!;
  const me = {
    ...player,
    id: 0,
    speed: 30,
    grounded: true,
    mode: 'Road' as const,
    road: { ...player.road, edge: 0, s: 100, d: 1.7, dir: 1 as const },
  };
  const car = {
    ...me,
    id: 1,
    slot: -1,
    kind: 'vehicle' as const,
    speed: 0,
    road: { ...me.road, edge: 1, s: 5 },
  };
  const snap = { ...initial, tick: 1, entities: [me, car] };
  const saved = structuredClone(snap);
  const drive = (visible: boolean) => {
    const route: RouteQueries = {
      lanesAt: () => [{ id: 'R1', kind: 'drive', direction: 1, widthM: 3.4, dCenterM: 1.7 }],
      kappaAt: () => 0,
      distanceToFinish: (_e, s) => 1000 - s,
      edgeLength: () => 200,
      projectPosition: (_a, b) => (visible ? { ...b, edge: 0, s: 115 } : null),
    };
    const actions = {
      throttle: 0,
      brake: 0,
      steer: 0,
      attack: false,
      attackSide: 0 as const,
      kick: false,
      lookBack: false,
      skipRunBack: false,
    };
    createBot().drive(snap, 0, route, actions);
    return actions;
  };
  expect(drive(true).brake).toBeGreaterThan(0);
  expect(drive(true).throttle).toBe(0);
  expect(drive(false).throttle).toBe(1);
  expect(snap).toEqual(saved);
});
