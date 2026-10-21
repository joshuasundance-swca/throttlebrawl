import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  groundUnderOf,
  terrainAt,
  type BakedTerrainPatch,
  type RoadNetwork,
} from '../../road';
import { createSimWithWorld } from '../create';
import { riderState } from '../riders';
import { testConfig } from '../riders/testing';
import { initialPedGround, supportedPedMove } from './ground';
import { pedGroundY, pedsState, placePed } from './index';
import { pedsStep } from './step';

const probes = vi.hoisted(() => {
  vi.resetModules();
  return { trace: null as unknown[] | null, groundDepth: 0 };
});
// Observe public query inputs/results while keeping the real physical-ground implementation.
vi.mock('../../road', async (original) => {
  const actual = await original<typeof import('../../road')>();
  const observed =
    (under: ReturnType<typeof actual.groundUnderOf>) =>
    (...query: Parameters<typeof under>) => {
      probes.groundDepth++;
      try {
        const y = under(...query);
        probes.trace?.push(['ground', ...query, y]);
        return y;
      } finally {
        probes.groundDepth--;
      }
    };
  return {
    ...actual,
    groundUnderOf: (...args: Parameters<typeof actual.groundUnderOf>) =>
      observed(actual.groundUnderOf(...args)),
    uncachedGroundUnderOf: (...args: Parameters<typeof actual.uncachedGroundUnderOf>) =>
      observed(actual.uncachedGroundUnderOf(...args)),
    terrainAt: (...args: Parameters<typeof actual.terrainAt>) => {
      const face = actual.terrainAt(...args);
      probes.trace?.push(['dry', args[1], args[2], face]);
      return face;
    },
  };
});
afterEach(() => {
  probes.trace = null;
  probes.groundDepth = 0;
  vi.restoreAllMocks();
});

// Published 68182 support sweep: independent reference for coordinates, probe order,
// centre/corner height ceilings, early exits and the complete movement envelope.
function publishedMove(
  road: RoadNetwork,
  from: { edge: number; s: number; d: number },
  to: { s: number; d: number },
  groundY: number,
  body: { lengthM: number; widthM: number },
) {
  const support = (s: number, d: number, previous: number) => {
    const p = road.toWorld(from.edge, s, d, 0);
    const y = groundUnderOf(road)(p.x, p.z, previous + 0.25);
    if (y === null || !(previous - y <= 0.25)) return null;
    const dryPoint = road.toWorld(from.edge, s, d, 0);
    const face = terrainAt(road.terrain, dryPoint.x, dryPoint.z);
    return face?.surface !== 'water' || face.y < y - 1e-6 ? y : null;
  };
  const ds = to.s - from.s,
    dd = to.d - from.d;
  const n = Math.max(1, Math.ceil(Math.sqrt(ds * ds + dd * dd) / 0.25));
  let last = { s: from.s, d: from.d, y: groundY };
  for (let i = 1; i <= n; i++) {
    const s = from.s + ds * (i / n),
      d = from.d + dd * (i / n);
    const y = support(s, d, last.y);
    if (y === null) break;
    let supported = true;
    for (const along of [-body.lengthM / 2, 0, body.lengthM / 2]) {
      for (const across of [-body.widthM / 2, 0, body.widthM / 2]) {
        if (along !== 0 || across !== 0) {
          if (support(s + along, d + across, y) === null) {
            supported = false;
            break;
          }
        }
      }
      if (!supported) break;
    }
    if (!supported) break;
    last = { s, d, y };
  }
  return last;
}

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

function sweepCase(kind: string) {
  let road: RoadNetwork;
  let from = { edge: 0, s: 300, d: 10 };
  let to = { s: 301, d: 15 };
  if (kind === 'straight' || kind === 'curved bank' || kind === 'road gap') {
    const bundle = fixtureNetwork([
      {
        id: 'a',
        lengthM: 600,
        kappa: kind === 'curved bank' ? 1 / 200 : 0,
        grade: kind === 'curved bank' ? 0.01 : 0,
      },
    ]);
    road = createRoadNetwork({
      ...bundle,
      roads: bundle.roads.map((r) => ({
        ...r,
        samples: {
          ...r.samples,
          data: {
            ...r.samples.data,
            bankRad: r.samples.data['bankRad']!.map(() => (kind === 'curved bank' ? 0.04 : 0)),
          },
        },
        features: kind === 'road gap' ? [{ kind: 'gap', id: 'hole', s0: 301, s1: 302, d0: -10, d1: 10 }] : [],
      })),
    });
    from = { edge: 0, s: 300, d: 2 };
    to = { s: 303, d: -2 };
  } else if (kind === 'source slope') {
    const slope = patch(6, 20, 3);
    road = config([
      { ...slope, vertices: slope.vertices.map(([x, , z]) => [x, 3 + (x - 6) * 0.05, z] as const) },
    ]).road;
  } else if (kind === 'dry gap') road = config([patch(6, 12, 3)]).road;
  else if (kind === 'water') road = config([patch(6, 20, 3), patch(12, 20, 3.01, 'water')]).road;
  else {
    road = config([patch(-30, 30, 0, kind === 'bridge water' ? 'water' : 'grass')], true).road;
    from = { edge: 0, s: 300, d: 7 };
    to = { s: 300, d: 20 };
  }
  return { road, from, to, y: initialPedGround(road, from)! };
}

describe('pedestrian footprint projection', () => {
  for (const kind of [
    'straight',
    'curved bank',
    'road gap',
    'source slope',
    'dry gap',
    'water',
    'bridge water',
    'bridge lower land',
  ]) {
    it(`matches the published full sweep and probe sequence on ${kind}, cold and warm`, () => {
      for (const body of [
        person,
        { lengthM: 2.4, widthM: 0.8 },
        { lengthM: 0.4, widthM: 0.3 },
        { lengthM: 0, widthM: 0 },
      ]) {
        const reference = sweepCase(kind),
          current = sweepCase(kind);
        for (const warmth of ['cold', 'warm']) {
          probes.trace = [];
          const expected = publishedMove(reference.road, reference.from, reference.to, reference.y, body);
          const expectedTrace = probes.trace;
          probes.trace = [];
          const result = supportedPedMove(current.road, current.from, current.to, current.y, body);
          expect(result, warmth).toEqual(expected);
          expect(probes.trace, warmth).toEqual(expectedTrace);
          expect(expectedTrace.length).toBeGreaterThan(0);
          if (['road gap', 'dry gap', 'water', 'bridge water', 'bridge lower land'].includes(kind))
            expect(result).not.toEqual({ ...current.to, y: result.y });
        }
      }
    });
  }

  it('retains all nine real ground probes while reducing redundant frame projections', () => {
    const c = config([patch(6, 20, 3)]),
      at = { edge: 0, s: 300, d: 10 },
      to = { s: 300.1, d: 10 };
    // Observe footprint transforms outside the physical query. The moving query deliberately
    // does real projection work even when the cached reference has seen these points before.
    const expected = publishedMove(c.road, at, to, 3, person);
    let transforms = 0;
    const frame = c.road.frameAt.bind(c.road),
      world = c.road.toWorld.bind(c.road);
    vi.spyOn(c.road, 'frameAt').mockImplementation((...args) => {
      if (probes.groundDepth === 0) transforms++;
      return frame(...args);
    });
    vi.spyOn(c.road, 'toWorld').mockImplementation((...args) => {
      if (probes.groundDepth === 0) transforms++;
      return world(...args);
    });
    probes.trace = [];
    expect(publishedMove(c.road, at, to, 3, person)).toEqual(expected);
    const oldTransforms = transforms;
    const oldTrace = probes.trace;
    expect(oldTransforms).toBeGreaterThan(3);
    expect(oldTrace.filter((p) => (p as unknown[])[0] === 'ground')).toHaveLength(9);
    expect(oldTrace.filter((p) => (p as unknown[])[0] === 'dry')).toHaveLength(9);
    transforms = 0;
    probes.trace = [];
    expect(supportedPedMove(c.road, at, to, 3, person)).toEqual(expected);
    expect(probes.trace).toEqual(oldTrace);
    const newTransforms = transforms;
    expect(newTransforms).toBeLessThanOrEqual(3);
    console.log(
      `[examined] supported footprint: ${oldTransforms} to ${newTransforms} projections, same nine ground/water probes`,
    );
  });
});

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
