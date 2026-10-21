import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type BakedTerrainPatch } from '../../road';
import { createSimWithWorld } from '../create';
import { riderState } from '../riders';
import { testConfig } from '../riders/testing';
import { initialPedGround, supportedPedMove } from './ground';
import { pedGroundY, pedsState, placePed } from './index';
import { pedsStep } from './step';

const person = {
  contentId: 'base:test-walker',
  category: 'pedestrian' as const,
  lengthM: 0.5,
  widthM: 0.6,
  heightM: 1.75,
  cruiseMps: 1.2,
  hazard: 'normal' as const,
  weight: 0,
};
function patch(
  x0: number,
  x1: number,
  y: number,
  surface: BakedTerrainPatch['surface'] = 'grass',
): BakedTerrainPatch {
  return {
    surface,
    vertices: [
      [x0, y, -600],
      [x0, y, 0],
      [x1, y, -600],
      [x1, y, 0],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}
function config(patches: BakedTerrainPatch[], bridge = false) {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 600, kappa: 0 }]);
  const raw = bundle.roads[0]!;
  const road = createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, terrain: { patches } },
    roads: [
      {
        ...raw,
        samples: bridge
          ? { ...raw.samples, data: { ...raw.samples.data, y: raw.samples.data['y']!.map(() => 10) } }
          : raw.samples,
        features: bridge ? [{ kind: 'roadsideZone', id: 'walkway', s0: 250, s1: 350, d0: 6, d1: 8 }] : [],
        barriers: bridge ? [{ s0: 200, s1: 400, side: 'right', kind: 'rail', heightM: 1 }] : [],
      },
    ],
  });
  return { ...testConfig({ edges: [{ id: 'a', lengthM: 600, kappa: 0 }] }), road, trafficTypes: [person] };
}

describe('pedestrian support continuity', () => {
  it('projects real source height without turning a grounded person into a dive, and hashes that floor', () => {
    const c = config([patch(6, 20, 3)]),
      { sim, world } = createSimWithWorld(c);
    const id = placePed(world, c, { type: 0, edge: 0, s: 300, d: 10 });
    const snap = sim.snapshot().entities.find((e) => e.id === id)!;
    expect(snap.y).toBe(3);
    expect(snap.road.h).toBe(0);
    expect(snap.grounded).toBe(true);
    const before = sim.hash(),
      st = pedsState(world),
      slot = st.id.indexOf(id);
    st.groundY[slot]! += 0.01;
    expect(sim.hash()).not.toBe(before);
    st.groundY[slot]! -= 0.01;
    expect(sim.hash()).toBe(before);
  });

  it('keeps a bridge walkway above water and refuses a step to the unrelated land below', () => {
    const c = config([patch(-30, 30, 0, 'water')], true);
    const at = { edge: 0, s: 300, d: 7 };
    const y = initialPedGround(c.road, at)!;
    expect(y).toBeGreaterThan(9.8);
    const end = supportedPedMove(c.road, at, { s: 300, d: 20 }, y, person);
    expect(end.d).toBeGreaterThan(at.d);
    expect(end.d).toBeLessThan(20);
    expect(end.y).toBeCloseTo(y, 8);
  });

  it('ignores a rider below a bridge, while a real same-floor contact is still counted', () => {
    const c = config([patch(-30, 30, 0)], true),
      { world } = createSimWithWorld(c);
    const id = placePed(world, c, { type: 0, edge: 0, s: 300, d: 7 });
    const me = world.movers[0]!,
      st = pedsState(world);
    me.pos = { edge: 0, s: 299.5, d: 7, dir: 1 };
    me.speed = 12;
    riderState(world).yAbs[me.id] = 0;
    pedsStep(world, c);
    expect(st.contacts).toBe(0);
    expect(st.dives).toBe(0);
    riderState(world).yAbs[me.id] = pedGroundY(world, id)!;
    pedsStep(world, c);
    expect(st.contacts).toBe(1);
    expect(st.dives).toBe(1);
  });

  it('rejects an unsupported initial placement explicitly and stops walking before a dry support gap', () => {
    const c = config([patch(6, 12, 3)]),
      { world } = createSimWithWorld(c);
    expect(initialPedGround(c.road, { edge: 0, s: 300, d: 15 })).toBeNull();
    expect(() => placePed(world, c, { type: 0, edge: 0, s: 300, d: 15 })).toThrow('no dry supporting ground');
    const end = supportedPedMove(c.road, { edge: 0, s: 300, d: 10 }, { s: 300, d: 15 }, 3, person);
    expect(end.d).toBeGreaterThan(10);
    expect(end.d).toBeLessThan(12);
    expect(end.y).toBe(3);
  });

  it('retains a supported crossing and its far-side recovery', () => {
    const c = config([patch(-20, 20, 0)]),
      { world } = createSimWithWorld(c);
    const id = placePed(world, c, {
      type: 0,
      edge: 0,
      s: 300,
      d: 7,
      crosses: true,
      homeD: 7,
      farD: -7,
      timer: 0,
      lure: false,
    });
    let left = false;
    for (let tick = 0; tick < 900; tick++) {
      pedsStep(world, c);
      world.tick++;
      left ||= world.movers[id]!.pos.d < -6.5;
    }
    expect(left).toBe(true);
    expect(pedsState(world).contacts).toBe(0);
  });
});
