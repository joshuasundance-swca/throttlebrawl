// The course and its edges (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest
// edges; road/course.ts): in bounds is the road, its verge band, any structure top (and anything standing on
// it) and another road of the network; everything else is out. The query says what a rider at a point would
// come down on: the highest of those at or under him, or nothing.
import { describe, expect, it } from 'vitest';
import { COURSE_STEP_M, courseAt, lanesNear } from './course';
import { fixtureNetwork } from './fixture';
import { createRoadNetwork, type RoadNetwork } from './network';
import { planStructures, type StructurePlan, type StructureSpec } from './structures';
import type { BakedNetworkBundle, BakedRoad } from './types';

/** Two straight roads north from z 0, 300 m long: `a` along x 0, `b` along x `apart` (not joined). */
function twoRoads(apart = 40): RoadNetwork {
  const a = fixtureNetwork([{ id: 'a', lengthM: 300, kappa: 0 }], 'two');
  const b = fixtureNetwork([{ id: 'b', lengthM: 300, kappa: 0 }], 'two');
  const rb = b.roads[0] as BakedRoad;
  const xs = (rb.samples.data['x'] ?? []).map((x) => x + apart);
  const roadB: BakedRoad = {
    ...rb,
    from: 'k0',
    to: 'k1',
    tags: [{ s0: 0, s1: 300, side: 'both', tag: 't' }],
    samples: { ...rb.samples, data: { ...rb.samples.data, x: xs } },
  };
  const bundle: BakedNetworkBundle = {
    network: {
      ...a.network,
      roads: ['a', 'b'],
      junctions: [
        ...a.network.junctions,
        ...b.network.junctions.map((j) => ({
          ...j,
          id: j.id.replace('j', 'k'),
          x: j.x + apart,
          ends: j.ends.map((e) => ({ ...e, road: 'b' })),
        })),
      ],
    },
    roads: [a.roads[0] as BakedRoad, roadB],
  };
  return createRoadNetwork(bundle);
}

const block = (x: number, z: number, hu: number, hv: number, topM: number, baseY = 0): StructureSpec => ({
  rule: 'block',
  cls: 'building',
  model: null,
  edge: 0,
  s: -z,
  d: x,
  foot: { x, z, ux: 1, uz: 0, hu, hv },
  baseY,
  roof: { kind: 'flat', topM },
});

/** The roads, with a 6 m block between them at s 80..120 and a deck over road b at s 190..210 (3 m to 4 m). */
function world(): { road: RoadNetwork; plan: StructurePlan } {
  const road = twoRoads();
  const specs = [block(20, -100, 8, 20, 6), block(40, -200, 10, 10, 1, 3)];
  const plan = planStructures(
    road,
    1,
    { t: { plan: (_r, _s, out) => specs.forEach((s) => out.add(s)) } },
    { t: { tags: ['t'], load: () => Promise.resolve({ plan: () => undefined }) } },
  );
  return { road, plan };
}

describe('the course: what a rider would come down on', () => {
  const { road, plan } = world();
  const rightEdge = road.vergeAt(0, 100, 'right').dOuter;
  const leftEdge = road.vergeAt(0, 100, 'left').dOuter;

  it('is the road on its lanes and on its verge band, at the road surface', () => {
    expect(rightEdge).toBeGreaterThan(5); // the fixture's lanes end at 4.9; its untagged band is past them
    for (const d of [0, 4, 4.95, rightEdge - 0.05, leftEdge + 0.05]) {
      const c = courseAt(road, plan, { edge: 0, s: 100, d }, 2);
      expect(c, `d ${d}`).toMatchObject({ kind: 'road', edge: 0, s: 100, d });
      if (c.kind === 'road') expect(c.y).toBeCloseTo(road.surfaceHeight(0, 100, d), 9);
    }
  });

  it('is out past the band with nothing under it: the road plane runs on there, the course does not', () => {
    // Negative control: the road's own plane is defined past its band (surfaceHeight does not stop).
    expect(Number.isFinite(road.surfaceHeight(0, 30, rightEdge + 3))).toBe(true);
    expect(courseAt(road, plan, { edge: 0, s: 30, d: rightEdge + 0.5 }, 1)).toEqual({ kind: 'out' });
    expect(courseAt(road, plan, { edge: 0, s: 30, d: leftEdge - 0.5 }, 1)).toEqual({ kind: 'out' });
  });

  it('is a structure top over its footprint at or above its roof, and what lies under it otherwise', () => {
    const over = courseAt(road, plan, { edge: 0, s: 100, d: 20 }, 6.5);
    expect(over).toEqual({ kind: 'top', id: 0, y: 6 });
    // Resting on it, a hair under its roof, still counts (COURSE_STEP_M).
    expect(courseAt(road, plan, { edge: 0, s: 100, d: 20 }, 6 - COURSE_STEP_M / 2)).toEqual(over);
    // Lower, in the block's walls: no top under him, no road: out (walls are the contact rules' business).
    expect(courseAt(road, plan, { edge: 0, s: 100, d: 20 }, 4)).toEqual({ kind: 'out' });
    // Past its footprint: out.
    expect(courseAt(road, plan, { edge: 0, s: 125, d: 20 }, 9)).toEqual({ kind: 'out' });
  });

  it('is another road of the network where it lies under the rider: its lanes and its band, by its own s and d', () => {
    const c = courseAt(road, plan, { edge: 0, s: 60, d: 40.5 }, 1);
    expect(c.kind).toBe('road');
    if (c.kind !== 'road') return;
    expect(c.edge).toBe(1);
    expect(c.s).toBeCloseTo(60, 6);
    expect(c.d).toBeCloseTo(0.5, 6);
    const bandB = road.vergeAt(1, 60, 'left').dOuter;
    const onBand = courseAt(road, plan, { edge: 0, s: 60, d: 40 + bandB + 0.05 }, 1);
    expect(onBand).toMatchObject({ kind: 'road', edge: 1 });
    expect(courseAt(road, plan, { edge: 0, s: 60, d: 40 + bandB - 0.5 }, 1)).toEqual({ kind: 'out' });
  });

  it('takes the highest support at or under the rider: the road under a deck, the deck from above', () => {
    // On road b's surface, under the deck (its underside 3 m up): the road.
    expect(courseAt(road, plan, { edge: 0, s: 200, d: 40 }, 0)).toMatchObject({ kind: 'road', edge: 1 });
    // Above the deck's top (4 m): the deck.
    expect(courseAt(road, plan, { edge: 0, s: 200, d: 40 }, 5)).toEqual({ kind: 'top', id: 1, y: 4 });
    // Between the underside and the top (inside the deck): the road under it.
    expect(courseAt(road, plan, { edge: 0, s: 200, d: 40 }, 3.5)).toMatchObject({ kind: 'road', edge: 1 });
  });

  it('gives the same answer for the same question, from either road', () => {
    const a = courseAt(road, plan, { edge: 0, s: 60, d: 40.5 }, 1);
    expect(courseAt(road, plan, { edge: 0, s: 60, d: 40.5 }, 1)).toEqual(a);
    const fromB = courseAt(road, plan, { edge: 1, s: 60, d: 0.5 }, 1);
    expect(fromB).toMatchObject({ kind: 'road', edge: 1, s: 60, d: 0.5 });
    const backOnA = courseAt(road, plan, { edge: 1, s: 60, d: -40 }, 1);
    expect(backOnA).toMatchObject({ kind: 'road', edge: 0 });
    if (backOnA.kind === 'road') expect(backOnA.d).toBeCloseTo(0, 6);
  });
});

it('lane clearance excludes the empty space between a one-sided lane and its reference line', () => {
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
  expect(lanesNear(road, 0.55, -50, -1, 0.3)).toBe(false);
  expect(lanesNear(road, 1.1, -50, -1, 0.3)).toBe(true);
});
