import { describe, expect, it } from 'vitest';
import {
  fixtureNetwork,
  planStructures,
  terrainAt,
  type BakedTerrainPatch,
  type StructurePlanner,
} from '../../road';
import { gapSimConfig } from '../tumble/gap-fixture';
import { addMover, createWorld } from '../world';
import { copsState, copsSystem, patrolSpots } from './index';
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
        features: opts.gap ? [{ id: 'hole', kind: 'gap', s0: 0, s1: 2000, d0: -20, d1: 20 }] : [],
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

describe('authored grass patrol permission', () => {
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
