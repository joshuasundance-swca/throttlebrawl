import { describe, expect, it } from 'vitest';
import {
  fixtureNetwork,
  planStructures,
  terrainAt,
  type BakedTerrainPatch,
  type StructurePlanner,
} from '../../road';
import { gapSimConfig } from '../tumble/gap-fixture';
import { addMover, createWorld, riderHitbox } from '../world';
import { clearOfLanes, copsState, copsSystem, patrolSpots } from './index';
import { terrainPatrolSpot } from './terrain-patrol';

function config(
  opts: {
    tag?: boolean;
    ground?: boolean;
    surface?: BakedTerrainPatch['surface'];
    edge?: 'soft' | 'hard';
    height?: number;
    slope?: number;
    narrow?: boolean;
    thin?: boolean;
    barrier?: boolean;
    gap?: boolean;
    lot?: boolean;
  } = {},
) {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: 0 }]);
  const y = opts.height ?? 0;
  const slope = opts.slope ?? 0;
  const r = bundle.roads[0]!;
  const terrain: BakedTerrainPatch = {
    surface: opts.surface ?? 'grass',
    vertices: [
      [-20, y - 20 * slope, opts.thin ? -800.2 : -2100],
      [-20, y - 20 * slope, opts.thin ? -799.8 : 100],
      [20, y + 20 * slope, opts.thin ? -800.2 : -2100],
      [20, y + 20 * slope, opts.thin ? -799.8 : 100],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
  const cfg = gapSimConfig({
    ...bundle,
    network: { ...bundle.network, ...(opts.ground === false ? {} : { terrain: { patches: [terrain] } }) },
    roads: [
      {
        ...r,
        barriers: opts.barrier ? [{ s0: 0, s1: 2000, side: 'right', kind: 'rail', heightM: 1 }] : [],
        features: opts.gap
          ? [{ id: 'hole', kind: 'gap', s0: 0, s1: 2000, d0: -20, d1: 20 }]
          : opts.lot
            ? [{ id: 'lot', kind: 'copSpawn', s0: 90, s1: 110, d0: 3.4, d1: 4.5 }]
            : [],
        tags: opts.tag === false ? [] : [{ s0: 0, s1: r.lengthM, side: 'both', tag: 'patrol-verge' }],
        laneSections: [
          {
            s0: 0,
            lanes:
              opts.narrow === false
                ? r.laneSections[0]!.lanes
                : [{ id: 'R1', dCenterM: 0, widthM: 3, direction: 1, kind: 'drive' }],
            verges: {
              left: { widthM: 0.5, surface: 'grass', edge: opts.edge ?? 'soft' },
              right: { widthM: 0.5, surface: 'grass', edge: opts.edge ?? 'soft' },
            },
          },
        ],
      },
    ],
  });
  return cfg;
}
const pos = { edge: 0, s: 800, d: 0, dir: 1 as const };

function lawWorld(cfg: ReturnType<typeof config>, escape = false) {
  const player = cfg.riders[0]!;
  cfg.riders = [
    player,
    ...Array.from({ length: 4 }, (_, i) => ({
      ...player,
      contentId: `base:cop-${i}`,
      role: 'cop' as const,
      controller: { kind: 'cop' as const },
    })),
  ];
  cfg.event = {
    ...cfg.event,
    kind: escape ? 'cop-escape' : 'classic-race',
    cops: { mode: 'every-race', baseCount: 1, tierScale: 0, chaosSummon: false, randomness: 0, patrolMax: 1 },
  };
  const world = createWorld(cfg);
  cfg.riders.forEach((_, i) => addMover(world, 'rider', { ...pos, s: 40 - i * 8 }, i));
  return world;
}

describe('authored grass patrol permission', () => {
  it('finds grass for unsafe reserves on a tagged shoulder road without changing paved patrol priority', () => {
    const cfg = config({ narrow: false });
    const world = lawWorld(cfg);
    expect(() => copsSystem.init(world, cfg)).not.toThrow();
    const st = copsState(world);
    let pavedPatrol = false;
    let grassReserve = false;
    for (const id of st.cops) {
      const cop = world.movers[id]!;
      expect(clearOfLanes(cfg, cop.pos)).toBe(true);
      if ((st.patrolAt[id] ?? -1) >= 0) {
        expect(
          cfg.road
            .lanesAt(cop.pos.edge, cop.pos.s)
            .some((l) => l.kind === 'shoulder' && l.dCenterM === cop.pos.d),
        ).toBe(true);
        pavedPatrol = true;
      } else {
        expect(terrainPatrolSpot(cfg, cop.pos)).toEqual(cop.pos);
        grassReserve = true;
      }
    }
    expect(pavedPatrol).toBe(true);
    expect(grassReserve).toBe(true);
  });
  it('refuses initialization when explicit waiting permission has no safe supported location', () => {
    const cfg = config({ ground: false });
    const world = lawWorld(cfg);
    expect(() => copsSystem.init(world, cfg)).toThrow('No safe permitted waiting position');
  });

  it('preserves the escape pursuer while parking its inactive reserves', () => {
    const cfg = config();
    const world = lawWorld(cfg, true);
    copsSystem.init(world, cfg);
    expect(world.movers[1]!.pos).toEqual({ ...pos, s: 28 });
    for (const id of copsState(world).cops.slice(1))
      expect(clearOfLanes(cfg, world.movers[id]!.pos)).toBe(true);
  });

  it('preserves ordinary valid paved lot placement and all cop RNG draws', () => {
    const tagged = config({ narrow: false, lot: true });
    const untagged = config({ narrow: false, lot: true, tag: false });
    const a = lawWorld(tagged);
    const b = lawWorld(untagged);
    copsSystem.init(a, tagged);
    copsSystem.init(b, untagged);
    expect(a.movers).toEqual(b.movers);
    expect(a.rng.cops).toEqual(b.rng.cops);
  });
  it('parks every starter and reserve clear of lanes and each other when there is no lot', () => {
    const cfg = config();
    const player = cfg.riders[0]!;
    cfg.riders = [
      player,
      ...Array.from({ length: 4 }, (_, i) => ({
        ...player,
        contentId: `base:cop-${i}`,
        role: 'cop' as const,
        controller: { kind: 'cop' as const },
      })),
    ];
    cfg.event = {
      ...cfg.event,
      cops: {
        mode: 'every-race',
        baseCount: 1,
        tierScale: 0,
        chaosSummon: false,
        randomness: 0,
        patrolMax: 1,
      },
    };
    const world = createWorld(cfg);
    cfg.riders.forEach((_, i) => addMover(world, 'rider', { ...pos, s: 40 - i * 8 }, i));
    copsSystem.init(world, cfg);
    for (const id of copsState(world).cops) {
      const cop = world.movers[id]!;
      expect(clearOfLanes(cfg, cop.pos), `waiting cop ${id}`).toBe(true);
      expect(terrainPatrolSpot(cfg, cop.pos)).toEqual(cop.pos);
      const at = cfg.road.toWorld(cop.pos.edge, cop.pos.s, cop.pos.d, cop.h);
      expect(at.y).toBeCloseTo(terrainAt(cfg.road.terrain, at.x, at.z)!.y, 6);
      const box = riderHitbox(cfg, cop.riderIndex);
      for (const other of world.movers) {
        if (other.id >= cop.id) continue;
        const there = cfg.road.toWorld(other.pos.edge, other.pos.s, other.pos.d, other.h);
        const otherBox = riderHitbox(cfg, other.riderIndex);
        expect(Math.hypot(at.x - there.x, at.z - there.z)).toBeGreaterThan(
          (Math.hypot(box.lengthM, box.widthM) + Math.hypot(otherBox.lengthM, otherBox.widthM)) / 2 + 0.3,
        );
      }
    }
  });
  it('parks the whole body on opted-in physical grass after paved searches fail', () => {
    const cfg = config();
    const spot = terrainPatrolSpot(cfg, pos);
    expect(spot).not.toBeNull();
    expect(spot!.d).toBeGreaterThan(1.5 + 0.4);
    expect(patrolSpots(createWorld(cfg), cfg, 1)).toHaveLength(1);
  });
  it.each([
    { tag: false },
    { ground: false },
    { surface: 'water' as const },
    { edge: 'hard' as const },
    { height: -2 },
    { slope: 0.5 },
    { thin: true },
    { barrier: true },
    { gap: true },
  ])('refuses unsafe support or missing permission %j', (opts) => {
    expect(terrainPatrolSpot(config(opts), pos)).toBeNull();
  });
  it('retains an existing paved placement and consumes the same randomness', () => {
    const tagged = config({ narrow: false });
    const plain = config({ narrow: false, tag: false });
    const a = createWorld(tagged);
    const b = createWorld(plain);
    expect(patrolSpots(a, tagged, 2)).toEqual(patrolSpots(b, plain, 2));
    expect(a.rng.cops).toEqual(b.rng.cops);
  });

  it('stands the waiting cop at the validated grass height', () => {
    const cfg = config({ height: 0.1 });
    cfg.riders = [
      cfg.riders[0]!,
      { ...cfg.riders[0]!, contentId: 'base:cop', role: 'cop', controller: { kind: 'cop' } },
    ];
    cfg.event = {
      ...cfg.event,
      cops: {
        mode: 'every-race',
        baseCount: 0,
        tierScale: 0,
        chaosSummon: false,
        randomness: 0,
        patrolMax: 1,
      },
    };
    const world = createWorld(cfg);
    addMover(world, 'rider', { ...pos, s: 40 }, 0);
    const cop = addMover(world, 'rider', { ...pos, s: 40 }, 1);
    copsSystem.init(world, cfg);
    expect(copsState(world).patrolAt[cop.id]).toBeGreaterThan(0);
    const at = cfg.road.toWorld(cop.pos.edge, cop.pos.s, cop.pos.d, cop.h);
    expect(at.y).toBeCloseTo(terrainAt(cfg.road.terrain, at.x, at.z)!.y, 6);
  });

  it('rejects a body too large for the protected tree-clear belt', () => {
    const cfg = config();
    cfg.riders = [
      { ...cfg.riders[0]!, role: 'cop', controller: { kind: 'cop' }, hitbox: { lengthM: 10, widthM: 4 } },
    ];
    expect(terrainPatrolSpot(cfg, pos)).toBeNull();
  });

  it('rejects a real solid across every candidate', () => {
    const cfg = config();
    const planner: StructurePlanner = {
      plan(_road, _seed, out) {
        out.add({
          rule: 'blocker',
          cls: 'wall',
          model: null,
          edge: 0,
          s: pos.s,
          d: 4,
          foot: { x: 4, z: -pos.s, ux: 1, uz: 0, hu: 4, hv: 5 },
          baseY: 0,
          roof: { kind: 'flat', topM: 2 },
        });
      },
    };
    planStructures(
      cfg.road,
      cfg.seed,
      { blocker: planner },
      { blocker: { tags: ['patrol-verge'], load: () => Promise.resolve(planner) } },
    );
    expect(terrainPatrolSpot(cfg, pos)).toBeNull();
  });
});
