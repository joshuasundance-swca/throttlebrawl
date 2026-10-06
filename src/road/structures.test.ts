// The physical world's contract (the maintainer, 2026-10-06: "consistent physics and gameplay is important
// here so players know what to expect and how to interact with the world"; road/structures.ts): a structure
// is an oriented box in world metres with a base and a roof; one plan per network and seed, worked out by
// the layers the network needs and kept, which render draws and the sim meets; a model's box is a fixed
// table row, never what has loaded.
import { describe, expect, it } from 'vitest';
import { fixtureNetwork } from './fixture';
import { createRoadNetwork, type RoadNetwork } from './network';
import {
  ensureStructures,
  footContains,
  modelFoot,
  modelSolid,
  planStructures,
  requireStructures,
  STRUCTURE_MODELS,
  structureLayersFor,
  structureModel,
  structuresAt,
  structuresOf,
  topAt,
  type StructureLayerSpec,
  type StructurePlan,
  type StructurePlanner,
  type StructureSpec,
} from './structures';
import type { BakedRoad } from './types';

/** A fresh straight road (north from the origin), with these tags and features: plans are kept per network. */
function road(patch: Partial<BakedRoad> = {}): RoadNetwork {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 400, kappa: 0 }]);
  return createRoadNetwork({ ...bundle, roads: [{ ...(bundle.roads[0] as BakedRoad), ...patch }] });
}
const tag = (name: string, side: 'both' | 'left' | 'right' = 'both') => ({ s0: 0, s1: 100, side, tag: name });

/** A flat-roofed box structure, axis-aligned, its middle at (x, z). */
const box = (x: number, z: number, hu: number, hv: number, topM: number, baseY = 0): StructureSpec => ({
  rule: 'box',
  cls: 'building',
  model: null,
  edge: 0,
  s: -z,
  d: x,
  foot: { x, z, ux: 1, uz: 0, hu, hv },
  baseY,
  roof: { kind: 'flat', topM },
});

const planner = (specs: readonly StructureSpec[], seen?: number[]): StructurePlanner => ({
  plan(_road, seed, out) {
    seen?.push(seed);
    for (const s of specs) out.add(s);
  },
});

const layers = (load: StructureLayerSpec['load'] = () => Promise.resolve(planner([]))) =>
  ({
    towers: { tags: ['towers'], load },
    marks: { features: ['landmark'], load },
  }) satisfies Record<string, StructureLayerSpec>;

/** These structures planned on a fresh road whose one layer, `t`, they stand in. */
function planOf(specs: readonly StructureSpec[], seed = 1): StructurePlan {
  const t = { tags: ['t'], load: () => Promise.resolve(planner([])) };
  return planStructures(road({ tags: [tag('t')] }), seed, { t: planner(specs) }, { t });
}

describe('a structure is an oriented box in world metres with a base and a roof', () => {
  it('holds a point inside its turned box, and not one inside only its axis-aligned bounds', () => {
    // u = (0.6, 0.8); v = (-uz, ux) = (-0.8, 0.6).
    const foot = { x: 10, z: -50, ux: 0.6, uz: 0.8, hu: 5, hv: 2 };
    const p = (u: number, v: number) => [10 + 0.6 * u - 0.8 * v, -50 + 0.8 * u + 0.6 * v] as const;
    expect(footContains(foot, ...p(0, 0))).toBe(true);
    expect(footContains(foot, ...p(4.9, 1.9))).toBe(true);
    expect(footContains(foot, ...p(-4.9, -1.9))).toBe(true);
    expect(footContains(foot, ...p(5.1, 0))).toBe(false);
    expect(footContains(foot, ...p(0, 2.1))).toBe(false);
    // Negative control: (14, -50) is inside the box's axis-aligned bounds (x 5.4..14.6), not in the box.
    expect(footContains(foot, 14, -50)).toBe(false);
  });

  it('stands a flat roof at its base plus its top over the whole footprint, and nothing past it', () => {
    const [s] = planOf([box(20, -100, 8, 5, 6, 2)]).items;
    if (!s) throw new Error('no structure');
    expect(topAt(s, 20, -100)).toBe(8);
    expect(topAt(s, 27.9, -95.1)).toBe(8);
    expect(topAt(s, 28.1, -100)).toBeNull();
  });

  it('pitches a roof from its eaves on the long sides up to its ridge on the ridge line', () => {
    const pitched: StructureSpec = {
      ...box(0, 0, 6, 4, 0),
      roof: { kind: 'pitched', eaveM: 3, ridgeM: 5, ridge: 'u' },
    };
    const [s] = planOf([pitched]).items;
    if (!s) throw new Error('no structure');
    // The ridge runs along u (x here): the top falls across v (z), from 5 on the line to 3 at the eaves.
    expect(topAt(s, 0, 0)).toBeCloseTo(5, 9);
    expect(topAt(s, 5, 0)).toBeCloseTo(5, 9);
    expect(topAt(s, 0, 2)).toBeCloseTo(4, 9);
    expect(topAt(s, 0, -4)).toBeCloseTo(3, 9);
    const [t] = planOf([{ ...pitched, roof: { kind: 'pitched', eaveM: 3, ridgeM: 5, ridge: 'v' } }]).items;
    if (!t) throw new Error('no structure');
    expect(topAt(t, 0, 3)).toBeCloseTo(5, 9);
    expect(topAt(t, 3, 0)).toBeCloseTo(4, 9);
    expect(topAt(t, -6, 0)).toBeCloseTo(3, 9);
  });

  it('places a model by its fixed box as render turns a model (+Z to (sin, cos), +X to (cos, -sin))', () => {
    const castIron = structureModel('models/scenery/pdx-downtown#0');
    expect(castIron).toMatchObject({ x0: -7.5, x1: 7.5, z0: -14, z1: 0 });
    // Unturned at (100, 0): the front (z 0) faces +z, the body runs back to z -14.
    const a = modelFoot(castIron, { x: 100, z: 0, yaw: 0, scale: 1 });
    expect(footContains(a, 100, -0.1)).toBe(true);
    expect(footContains(a, 100, 0.1)).toBe(false);
    expect(footContains(a, 92.6, -7)).toBe(true);
    expect(footContains(a, 92.4, -7)).toBe(false);
    expect(footContains(a, 100, -14.1)).toBe(false);
    // Turned a quarter: the front faces +x and the body runs back along -x; at scale 2 twice as big.
    const b = modelFoot(castIron, { x: 0, z: 0, yaw: Math.PI / 2, scale: 2 });
    expect(b.hu).toBeCloseTo(15, 9);
    expect(b.hv).toBeCloseTo(14, 9);
    expect(footContains(b, -27.9, 14.9)).toBe(true);
    expect(footContains(b, 0.1, 0)).toBe(false);
    expect(footContains(b, -28.1, 0)).toBe(false);
    // As a solid: the model's id, its footprint, its base on the ground it stands on and its flat top.
    const solid = modelSolid('models/scenery/pdx-downtown#0', { x: 100, y: 5, z: 0, yaw: 0, scale: 1 });
    expect(solid).toMatchObject({
      model: 'models/scenery/pdx-downtown#0',
      baseY: 5,
      roof: { kind: 'flat', topM: 12 },
    });
    expect(solid.foot).toEqual(a);
  });

  it('takes a model box from the fixed table only: an unknown model id is an error, never a guess', () => {
    expect(() => structureModel('models/scenery/no-such-kit#0')).toThrow(/no-such-kit#0/);
    expect(Object.keys(STRUCTURE_MODELS).length).toBeGreaterThan(0);
    for (const [id, m] of Object.entries(STRUCTURE_MODELS)) {
      expect(m.x0, id).toBeLessThan(m.x1);
      expect(m.y0, id).toBeLessThan(m.y1);
      expect(m.z0, id).toBeLessThan(m.z1);
      expect(id).toMatch(/^models\/[a-z-]+\/[a-z-]+#\d+$/);
    }
  });
});

describe('the registry: one plan per network and seed, worked out by the layers the network needs', () => {
  it('names the layers a network needs from its tags and features, and none for a plain road', () => {
    expect(structureLayersFor(road(), layers())).toEqual([]);
    expect(structureLayersFor(road({ tags: [tag('towers')] }), layers())).toEqual(['towers']);
    const landmark = { id: 'm', kind: 'landmark', s0: 10, s1: 20, d0: 12, d1: 20, params: {} };
    const both = road({ tags: [tag('towers', 'left')], features: [landmark] });
    expect(structureLayersFor(both, layers())).toEqual(['marks', 'towers']);
  });

  it('plans once per network and seed, runs the layers in name order, and numbers the structures', () => {
    const net = road({ tags: [tag('towers')] });
    const seeds: number[] = [];
    // Listed out of order: the plan runs `alpha` before `towers` whatever order the record has.
    const planners = {
      towers: planner([box(20, -50, 5, 5, 9), box(-20, -60, 5, 5, 12)], seeds),
      alpha: planner([box(20, -150, 5, 5, 3)], seeds),
    };
    const table = { ...layers(), alpha: { tags: ['towers'], load: () => Promise.resolve(planner([])) } };
    const plan = planStructures(net, 7, planners, table);
    expect(plan.items.map((s) => [s.id, s.layer, s.foot.z])).toEqual([
      [0, 'alpha', -150],
      [1, 'towers', -50],
      [2, 'towers', -60],
    ]);
    expect(seeds).toEqual([7, 7]);
    expect(planStructures(net, 7, planners, table)).toBe(plan);
    expect(structuresOf(net, 7)).toBe(plan);
    expect(structuresOf(net, 8)).toBeNull();
    expect(planStructures(net, 8, planners, table)).not.toBe(plan);
    expect(seeds).toEqual([7, 7, 8, 8]);
  });

  it('refuses to plan a network whose layer has no planner: never a world with a piece missing', () => {
    const net = road({ tags: [tag('towers')] });
    expect(() => planStructures(net, 1, {}, layers())).toThrow(/towers/);
    expect(structuresOf(net, 1)).toBeNull();
  });

  it('hands the sim the kept plan, an empty one for a network that needs none, and an error otherwise', () => {
    const plain = road();
    const empty = requireStructures(plain, 3, layers());
    expect(empty.items).toEqual([]);
    expect(requireStructures(plain, 4, layers())).toBe(empty);
    const net = road({ tags: [tag('towers')] });
    expect(() => requireStructures(net, 3, layers())).toThrow(/not planned/);
    const plan = planStructures(net, 3, { towers: planner([box(20, -50, 5, 5, 9)]) }, layers());
    expect(requireStructures(net, 3, layers())).toBe(plan);
  });

  it('loads only the planners a network needs, then plans', async () => {
    const loaded: string[] = [];
    const table = {
      towers: {
        tags: ['towers'],
        load: () => (loaded.push('towers'), Promise.resolve(planner([box(20, -50, 5, 5, 9)]))),
      },
      marks: { features: ['landmark'], load: () => (loaded.push('marks'), Promise.resolve(planner([]))) },
    } satisfies Record<string, StructureLayerSpec>;
    const net = road({ tags: [tag('towers')] });
    const plan = await ensureStructures(net, 5, table);
    expect(loaded).toEqual(['towers']);
    expect(plan.items).toHaveLength(1);
    expect(await ensureStructures(net, 5, table)).toBe(plan);
    expect(loaded).toEqual(['towers']);
  });

  it('finds the structures standing at a point, in id order, a long one from any of its cells', () => {
    const plan = planOf([box(30, -120, 6, 6, 8), { ...box(30, -200, 3, 150, 4), rule: 'long' }], 9);
    expect(structuresAt(plan, 30, -120).map((s) => s.id)).toEqual([0, 1]);
    expect(structuresAt(plan, 30, -340).map((s) => s.rule)).toEqual(['long']);
    expect(structuresAt(plan, 30, -60).map((s) => s.rule)).toEqual(['long']);
    expect(structuresAt(plan, 40, -120)).toEqual([]);
    expect(structuresAt(plan, 30, -360)).toEqual([]);
  });
});
