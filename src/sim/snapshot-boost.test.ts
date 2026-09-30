// The playtest 1b quick-wins contract: a rider's `boostS` on the snapshot (seconds of boostPad boost
// left), read from the riding model's state, so render can draw the boost the moment it lands; and
// the two new road feature kinds, which pass the road lint (the content schema's test is beside it).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, lintRoad, type BakedFeature } from '../road';
import { createSimWithWorld } from './create';
import { riderState } from './riders';
import { testConfig } from './riders/testing';

describe('playtest 1b quick wins: the contract', () => {
  it('shows each rider’s boost seconds, 0 by default and for every other kind', () => {
    const { sim, world } = createSimWithWorld(testConfig({ rivals: 1 }));
    for (const e of sim.snapshot().entities) expect(e.boostS).toBe(0);
    const player = sim.snapshot().entities.find((e) => e.slot === 0);
    if (!player) throw new Error('no player');
    riderState(world).boost[player.id] = 90; // scaled ticks
    expect(sim.snapshot().entities[player.id]?.boostS).toBeCloseTo(1.5, 9);
  });

  it('boostPad and rampTruck are road features the road lint accepts', () => {
    const bundle = fixtureNetwork([{ id: 'straight', lengthM: 400, kappa: 0 }]);
    const road = bundle.roads[0];
    if (!road) throw new Error('no road');
    const features: BakedFeature[] = [
      {
        kind: 'boostPad',
        id: 'pad-1',
        s0: 100,
        s1: 106,
        d0: 0.5,
        d1: 3,
        params: { boostMps: 8, holdS: 1.5 },
      },
      {
        kind: 'rampTruck',
        id: 'carrier-1',
        s0: 200,
        s1: 222,
        d0: 1.9,
        d1: 4.4,
        params: { rampLengthM: 11.5, lipHeightM: 2.8 },
      },
    ];
    const withFeatures = { ...road, features };
    expect(lintRoad(withFeatures).filter((i) => i.rule === 'features')).toEqual([]);
    const net = createRoadNetwork({ ...bundle, roads: [withFeatures] });
    expect(net.featuresOf(0, 'boostPad').map((f) => f.id)).toEqual(['pad-1']);
    expect(net.featuresOf(0, 'rampTruck').map((f) => f.id)).toEqual(['carrier-1']);
  });
});
