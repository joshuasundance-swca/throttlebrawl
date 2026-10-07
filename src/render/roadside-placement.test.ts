import { expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { scatterRoadside, type RoadsideInput, type RoadsideKit } from './roadside';

const small: RoadsideKit = {
  id: 'pnw',
  rules: [
    { id: 'small', v: [0], on: ['forest'], every: 1, rate: 1, across: [1, 0], r: 0.1, understory: true },
  ],
};

function scene(bridge: boolean, long: boolean): RoadsideInput {
  const bundle = fixtureNetwork([{ id: 'road', lengthM: 100, kappa: 0 }]);
  const road = createRoadNetwork(bundle);
  const original = road.splitZones.bind(road);
  const zones = original();
  road.splitZones = () => [
    ...zones,
    { edge: 0, end: 'to', connector: 'test', s0: 45, s1: 55, d0: 5.5, d1: 12, toEdge: 0 },
  ];
  return {
    road,
    dressing: {
      road: {
        tags: [
          { s0: 0, s1: 100, side: 'both' as const, tag: 'forest' },
          ...(bridge ? [{ s0: 45, s1: 55, side: 'both' as const, tag: 'bridge' }] : []),
        ],
      },
    },
    seed: 1,
    density: 1,
    kit: long ? { id: 'pnw', rules: [{ ...small.rules[0]!, id: 'long', along: 3, face: true }] } : small,
    landReach: () => 20,
    spots: [],
  };
}

it('keeps roadside props five metres from bridge ends even when land continues behind a wall', () => {
  const input = scene(true, false);
  input.road.splitZones = () => [];
  const items = scatterRoadside(input);
  expect(items.length).toBeGreaterThan(20);
  expect(items.filter((i) => i.s >= 40 && i.s <= 60)).toEqual([]);
  expect(items.some((i) => i.s > 38 && i.s < 40)).toBe(true);
});

it('keeps a long prop whole out of a painted split zone while retaining short props before it', () => {
  const input = scene(false, true);
  const items = scatterRoadside(input);
  expect(items.length).toBeGreaterThan(20);
  expect(items.filter((i) => i.d > 0 && i.s + 3 >= 45 && i.s - 3 <= 55)).toEqual([]);
  const short = scatterRoadside(scene(false, false));
  expect(short.some((i) => i.d > 0 && i.s > 42 && i.s < 44)).toBe(true);
});
