import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  terrainAt,
  type BakedTerrainPatch,
  type BakedNetwork,
  type BakedRoad,
} from '../index';
import { iowaParkLayout } from './iowa-park';
import { landmarkPlaces } from './landmark-places';
import { isParkTreeNetwork, planTerrainTrees } from './terrain-trees';

function ground(y: number, surface: 'grass' | 'water' = 'grass'): BakedTerrainPatch {
  return {
    surface,
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
}

function road(patches?: BakedTerrainPatch[], tag = 'rural') {
  const bundle = fixtureNetwork([{ id: 'country', lengthM: 600, kappa: 0, grade: 0 }]);
  bundle.roads[0]!.tags = [{ s0: 0, s1: 600, side: 'both', tag }];
  return createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(patches ? { terrain: { patches } } : {}) },
  });
}

describe('physical trees on authored rural land', () => {
  it.each([-8, 4])('roots real trees on dry land at world height %s, not the reference road', (y) => {
    const network = road([ground(y)]);
    const plan = planTerrainTrees(network, 7);
    expect(plan.items.length).toBeGreaterThan(0);
    for (const tree of plan.items) {
      expect(terrainAt(network.terrain, tree.x, tree.z)?.surface).toBe('grass');
      expect(tree.baseY).toBeCloseTo(y, 6);
      expect(tree.scale).toBeGreaterThan(0);
      expect(tree.topY).toBeGreaterThan(tree.baseY);
      expect(plan.near(tree.x, tree.z, 0)).toContain(tree);
      // World discovery intentionally takes no edge: a neighboring-road projection cannot hide it.
      expect(plan.near(tree.x + 0.1, tree.z, 0.2)).toContain(tree);
      expect(plan.near(tree.x + 1000, tree.z, 1)).not.toContain(tree);
    }
  });

  it('keeps missing terrain, water, holes and submerged land free of physical trees', () => {
    for (const network of [
      road(),
      road([]),
      road([ground(0, 'water')]),
      road([ground(-2), ground(1, 'water')]),
    ]) {
      expect(planTerrainTrees(network, 7).items).toEqual([]);
    }
  });

  it('does not invent this rural tree cohort on other themes', () => {
    for (const tag of ['headlands', 'forest', 'palms']) {
      expect(planTerrainTrees(road([ground(-4)], tag), 7).items).toEqual([]);
    }
  });

  it('rejects a root with dry centre but uncovered rim, and a steep source footprint', () => {
    const tree = planTerrainTrees(road([ground(-4)]), 7).items[0]!;
    const narrow: BakedTerrainPatch = {
      surface: 'grass',
      vertices: [
        [tree.x - 0.05, -4, tree.z - 0.05],
        [tree.x - 0.05, -4, tree.z + 0.05],
        [tree.x + 0.05, -4, tree.z - 0.05],
        [tree.x + 0.05, -4, tree.z + 0.05],
      ],
      triangles: [
        [0, 1, 2],
        [2, 1, 3],
      ],
    };
    const strip = road([narrow]);
    expect(terrainAt(strip.terrain, tree.x, tree.z)?.surface).toBe('grass');
    expect(planTerrainTrees(strip, 7).items).toEqual([]);
    const slope = ground(-4);
    const steep = { ...slope, vertices: slope.vertices.map(([x, y, z]) => [x, y + x * 2, z] as const) };
    expect(planTerrainTrees(road([steep]), 7).items).toEqual([]);
  });

  it('keeps placement deterministic without consuming a simulation random stream', () => {
    const network = road([ground(-4)]);
    const first = planTerrainTrees(network, 7).items;
    expect(first.length).toBeGreaterThan(0);
    expect(planTerrainTrees(network, 7).items).toEqual(first);
    const other = planTerrainTrees(network, 8).items;
    expect(other).not.toEqual(first);
    expect(planTerrainTrees(network, 7).items).toEqual(first);
  });

  it('keeps whole crowns and a recovery strip clear of another road, including a wide carriageway', () => {
    const bundle = fixtureNetwork([
      { id: 'country', lengthM: 600, kappa: 0 },
      {
        id: 'beside',
        lengthM: 600,
        kappa: 0,
        lanes: [{ id: 'wide', dCenterM: 0, widthM: 80, direction: 1, kind: 'drive' }],
      },
    ]);
    bundle.roads[0]!.tags = [{ s0: 0, s1: 600, side: 'both', tag: 'rural' }];
    const columns = bundle.roads[1]!.samples.data;
    bundle.roads[1]!.samples.data = {
      ...columns,
      x: columns['x']!.map((x) => x + 65),
      z: columns['z']!.map((z) => z + 600),
    };
    const network = createRoadNetwork({
      ...bundle,
      network: { ...bundle.network, terrain: { patches: [ground(0)] } },
    });
    const trees = planTerrainTrees(network, 7).items;
    expect(trees.length).toBeGreaterThan(0);
    // Independent straight-road geometry: it doesn't call the planner's lane finder.
    const violates = (x: number, scale: number) => Math.abs(x - 65) < 40 + 8 + 4.8 * scale;
    expect(trees.filter((t) => violates(t.x, t.scale))).toEqual([]);
    expect(violates(65, 1), 'a deliberately planted tree in the other lane must fail this detector').toBe(
      true,
    );
    const out = [trees[0]!];
    expect(planTerrainTrees(network, 7).near(10000, 10000, 0, out)).toBe(out);
    expect(out).toEqual([]);
  });
});

const ROOT = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const eagle = read<BakedNetwork>(`${ROOT}/networks/osm-clinton-eagle-point.json`);
const eagleRoads = eagle.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
const withoutPark = (roads: BakedRoad[]) =>
  roads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== 'iowa-park') }));

// Independent circle-versus-triangle detector: a reserved approach fans from the facility
// to road stations on either side. Crown clearance is tested, not just the trunk centre.
function approachDistance(x: number, z: number, points: { x: number; z: number }[]): number {
  const signs = points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    return (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
  });
  if (signs.every((s) => s >= 0) || signs.every((s) => s <= 0)) return 0;
  return Math.min(
    ...points.map((a, i) => {
      const b = points[(i + 1) % points.length]!;
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
    }),
  );
}

describe('Eagle park groves', () => {
  it('keeps full crowns off the tower foundation and its road-facing opening across seeds and query orders', () => {
    const park = createRoadNetwork({ network: eagle, roads: eagleRoads });
    const at = landmarkPlaces(park).find((p) => p.foundation)!;
    expect(at).toBeDefined();
    const s = (at.feature.s0 + at.feature.s1) / 2;
    const opening = [at, park.toWorld(at.edge, s - 35, 0, 0), park.toWorld(at.edge, s + 35, 0, 0)];
    expect(approachDistance(at.x, at.z, opening), 'a planted blocker is detected').toBe(0);
    let examined = 0;
    for (let seed = 1; seed <= 32; seed++) {
      const trees = planTerrainTrees(park, seed).items;
      const cold = createRoadNetwork({ network: eagle, roads: eagleRoads });
      iowaParkLayout(cold, seed);
      expect(planTerrainTrees(cold, seed).items).toEqual(trees);
      planTerrainTrees(park, seed + 1);
      expect(planTerrainTrees(park, seed).items).toEqual(trees);
      for (const tree of trees) {
        const h = at.foundation!.halfM;
        expect(
          Math.hypot(Math.max(0, Math.abs(tree.x - at.x) - h), Math.max(0, Math.abs(tree.z - at.z) - h)),
        ).toBeGreaterThanOrEqual(4.8 * tree.scale);
        expect(approachDistance(tree.x, tree.z, opening)).toBeGreaterThanOrEqual(4.8 * tree.scale);
        examined++;
      }
    }
    expect(examined).toBeGreaterThan(0);
  });
  it('adds a deterministic park profile while preserving facility sites and cold/warm results', () => {
    const park = createRoadNetwork({ network: eagle, roads: eagleRoads });
    const rural = createRoadNetwork({ network: eagle, roads: withoutPark(eagleRoads) });
    for (let seed = 1; seed <= 8; seed++) {
      const warmLayout = iowaParkLayout(park, seed);
      const sites = structuredClone(warmLayout);
      const trees = planTerrainTrees(park, seed).items;
      expect(trees.length).toBeGreaterThan(0);
      expect(trees).not.toEqual(planTerrainTrees(rural, seed).items);
      const cold = createRoadNetwork({ network: eagle, roads: eagleRoads });
      // Querying trees first must not influence the subsequent facility layout.
      expect(planTerrainTrees(cold, seed).items).toEqual(trees);
      expect(iowaParkLayout(cold, seed)).toEqual(sites);
      expect(iowaParkLayout(park, seed)).toBe(warmLayout);
      expect(warmLayout).toEqual(sites);
      planTerrainTrees(park, seed + 1);
      expect(planTerrainTrees(park, seed).items).toEqual(trees);
      for (const tree of trees) {
        expect(terrainAt(park.terrain, tree.x, tree.z)?.surface).toBe('grass');
        expect(planTerrainTrees(park, seed).near(tree.x, tree.z, 0)).toContainEqual(tree);
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          expect(
            terrainAt(
              park.terrain,
              tree.x + Math.cos(a) * 0.38 * tree.scale,
              tree.z + Math.sin(a) * 0.38 * tree.scale,
            )?.surface,
          ).toBe('grass');
        }
        // Independent segment distances cover the actual curved road, not the planner's lane query.
        for (const edge of park.edges) {
          let nearest = Infinity;
          for (let i = 1; i < edge.count; i++) {
            const ax = edge.x[i - 1]!,
              az = edge.z[i - 1]!;
            const dx = edge.x[i]! - ax,
              dz = edge.z[i]! - az;
            const t = Math.max(
              0,
              Math.min(1, ((tree.x - ax) * dx + (tree.z - az) * dz) / (dx * dx + dz * dz)),
            );
            nearest = Math.min(nearest, Math.hypot(tree.x - ax - t * dx, tree.z - az - t * dz));
          }
          expect(nearest).toBeGreaterThanOrEqual(
            Math.max(-edge.dMin, edge.dMax) + 8 + 4.8 * tree.scale - 0.01,
          );
        }
      }
    }
  });

  it('reserves full canopy space around facilities and ordinary road-facing approaches', () => {
    const park = createRoadNetwork({ network: eagle, roads: eagleRoads });
    expect(isParkTreeNetwork(park)).toBe(true);
    let checked = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const trees = planTerrainTrees(park, seed).items;
      for (const facility of iowaParkLayout(park, seed).facilities) {
        const edge = park.edges[facility.edge]!;
        const opening = [
          facility,
          park.toWorld(edge.index, Math.max(0, facility.s - 35), 0, 0),
          park.toWorld(edge.index, Math.min(edge.length, facility.s + 35), 0, 0),
        ];
        expect(approachDistance(facility.x, facility.z, opening), 'blocked control is detected').toBe(0);
        for (const tree of trees) {
          const crown = 4.8 * tree.scale;
          expect(Math.hypot(tree.x - facility.x, tree.z - facility.z), facility.id).toBeGreaterThanOrEqual(
            facility.radiusM + crown,
          );
          expect(approachDistance(tree.x, tree.z, opening), `${facility.id} approach`).toBeGreaterThanOrEqual(
            crown,
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('leaves mixed, partial and untagged networks on the ordinary rural plan', () => {
    const controls = [
      withoutPark(eagleRoads),
      eagleRoads.map((r, i) => (i ? r : withoutPark([r])[0]!)),
      eagleRoads.map((r) => ({
        ...r,
        tags: r.tags?.map((t) => (t.tag === 'iowa-park' ? { ...t, s0: r.lengthM / 2 } : t)),
      })),
      eagleRoads.map((r) => ({
        ...r,
        tags: r.tags?.map((t) => (t.tag === 'iowa-park' ? { ...t, side: 'left' as const } : t)),
      })),
      eagleRoads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== 'rural') })),
    ];
    for (const roads of controls) {
      const mixed = createRoadNetwork({ network: eagle, roads });
      expect(isParkTreeNetwork(mixed)).toBe(false);
      const ordinary = createRoadNetwork({ network: eagle, roads: withoutPark(roads) });
      for (let seed = 1; seed <= 3; seed++)
        expect(planTerrainTrees(mixed, seed).items).toEqual(planTerrainTrees(ordinary, seed).items);
    }
    for (const terrain of [
      undefined,
      { patches: [] },
      { patches: eagle.terrain!.patches.map((p) => ({ ...p, surface: 'water' as const })) },
    ]) {
      const unsupported = createRoadNetwork({ network: { ...eagle, terrain }, roads: eagleRoads });
      expect(isParkTreeNetwork(unsupported)).toBe(false);
      expect(planTerrainTrees(unsupported, 1).items).toEqual([]);
    }
  });
});
