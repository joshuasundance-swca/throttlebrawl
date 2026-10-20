import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedTerrainPatch } from '../../road';
import { planTerrainTrees } from '../../road/structures/terrain-trees';
import type { SimConfig, SimEvent } from '../types';
import { riderState } from './index';
import { input, riderHarness, testConfig } from './testing';
import { trunkTouch } from './terrain-trees';
import { worldHash } from '../world';

function countryside(y: number): SimConfig {
  const base = testConfig({ tuning: { 'ground.offRoad': 1 } });
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 600, kappa: 0 }]);
  bundle.roads[0]!.tags = [{ s0: 0, s1: 600, side: 'both', tag: 'rural' }];
  const patch: BakedTerrainPatch = {
    surface: 'grass',
    vertices: [
      [-120, y, -650],
      [-120, y, 50],
      [120, y, -650],
      [120, y, 50],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
  const road = createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, terrain: { patches: [patch] } },
  });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 590 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road, route };
}

function ride(config: SimConfig, height: number | null, offset = 0, speed = 20) {
  const tree = planTerrainTrees(config.road, config.seed).items.find((t) => t.s > 30 && t.s < 550);
  if (!tree) throw new Error('fixture must have a physical tree');
  const h = riderHarness(config, { s: tree.s - 5, d: tree.d + offset, speed });
  if (height !== null) {
    h.rider.mode = 'Airborne';
    h.rider.h = height;
    const st = riderState(h.world);
    st.yAbs[h.rider.id] = height;
    st.vy[h.rider.id] = 0;
    st.lastTick[h.rider.id] = -2;
  }
  const events: SimEvent[] = [];
  for (let tick = 0; tick < 60 && h.rider.pos.s < tree.s + 4; tick++) {
    events.push(...h.step(input(1)));
    if (events.some((e) => e.type === 'crash')) break;
  }
  return { tree, h, events, contacts: events.filter((e) => e.data['terrainTree'] !== undefined) };
}

describe('source-rooted rural trunks met by riders', () => {
  it.each([-8, 4])(
    'a grounded head-on hit at source height %s uses the heavy fixed-object crash rule',
    (y) => {
      const r = ride(countryside(y), null);
      expect(r.events.find((e) => e.type === 'crash')?.data).toMatchObject({
        cause: 'barrier',
        object: 'rural-tree',
        terrainTree: String(r.tree.id),
      });
      expect(r.h.rider.pos.s).toBeLessThan(r.tree.s);
    },
  );

  it('meets a trunk in the air below the reference road; truly over its top or beside it stays clear', () => {
    const config = countryside(-8);
    expect(ride(config, -5).contacts.some((e) => e.type === 'crash')).toBe(true);
    const above = ride(config, 5);
    expect(above.contacts).toEqual([]);
    expect(above.h.rider.pos.s).toBeGreaterThan(above.tree.s + 3);
    const beside = ride(config, null, 3);
    expect(beside.contacts).toEqual([]);
    expect(beside.h.rider.pos.s).toBeGreaterThan(beside.tree.s + 3);
  });

  it('a crawl and side brush remain forgiving, without repeated contact credit', () => {
    const config = countryside(-4);
    for (const r of [ride(config, null, 0, 5), ride(config, null, 0.6)]) {
      expect(r.contacts.some((e) => e.type === 'crash')).toBe(false);
      expect(r.contacts.filter((e) => e.type === 'wobble')).toHaveLength(1);
    }
  });

  it('sweeps through a thin trunk with clear endpoints and respects both finite height bounds', () => {
    const config = countryside(-8);
    const tree = planTerrainTrees(config.road, config.seed).items[0]!;
    const pos = { edge: tree.edge, s: tree.s + 5, d: tree.d, dir: 1 as const };
    const move = { s0: tree.s - 5, d0: tree.d, s1: pos.s, d1: tree.d };
    const hit = trunkTouch(config, pos, 0, move, tree.baseY + 1, tree.baseY + 1);
    expect(hit?.piece.tree).toBe(tree);
    expect(hit!.t).toBeGreaterThan(0);
    expect(hit!.t).toBeLessThan(1);
    expect(trunkTouch(config, pos, 0, move, tree.baseY - 3, tree.baseY - 3)).toBeNull();
    expect(trunkTouch(config, pos, 0, move, tree.topY + 1, tree.topY + 1)).toBeNull();
    const over = { ...pos, s: tree.s };
    const still = { s0: tree.s, s1: tree.s, d0: tree.d, d1: tree.d };
    expect(trunkTouch(config, over, 0, still, tree.topY + 2, tree.topY - 2)?.cap).toBe(true);
    expect(trunkTouch(config, over, 0, still, tree.topY, tree.topY - 1)?.cap).toBe(true);
  });

  it('finds the same world trunk through another reference road', () => {
    const config = countryside(-4);
    const bundle = fixtureNetwork([
      { id: 'a', lengthM: 600, kappa: 0 },
      { id: 'other', lengthM: 600, kappa: 0 },
    ]);
    bundle.roads[0]!.tags = [{ s0: 0, s1: 600, side: 'both', tag: 'rural' }];
    const columns = bundle.roads[1]!.samples.data;
    columns['x'] = columns['x']!.map((x) => x + 100);
    columns['z'] = columns['z']!.map((z) => z + 600);
    const road = createRoadNetwork({
      ...bundle,
      network: { ...bundle.network, terrain: config.road.terrain },
    });
    const other = { ...config, road };
    const tree = planTerrainTrees(road, config.seed).items[0]!;
    const pos = { edge: 1, s: tree.s + 2, d: tree.d - 100, dir: 1 as const };
    const move = { s0: tree.s - 2, s1: pos.s, d0: pos.d, d1: pos.d };
    expect(trunkTouch(other, pos, 0, move, tree.baseY, tree.baseY)?.piece.tree.id).toBe(tree.id);
  });

  it('repeats contacts after cold/warm planning and restores interrupted plain world state exactly', () => {
    const config = countryside(-4);
    const tree = planTerrainTrees(config.road, config.seed).items[0]!;
    const h = riderHarness(config, { s: tree.s - 2, d: tree.d, speed: 5 });
    for (let tick = 0; tick < 60 && !h.world.systems['terrainTrees']; tick++) h.step(input(1));
    expect(h.world.systems['terrainTrees']).toBeDefined();
    const saved = structuredClone(h.world);
    const trace = () =>
      Array.from({ length: 20 }, () => {
        const events = h.step(input(1));
        return { hash: worldHash(h.world), events };
      });
    const first = trace();
    planTerrainTrees(config.road, config.seed + 1).near(0, 0, 100);
    Object.assign(h.world, structuredClone(saved));
    h.rider = h.world.movers[h.rider.id]!;
    expect(trace()).toEqual(first);
    const baseline = worldHash(h.world);
    h.world.systems['terrainTrees'] = { touch: [1000] };
    expect(worldHash(h.world)).not.toBe(baseline);
  });
});
