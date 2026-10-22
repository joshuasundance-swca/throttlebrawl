import { readFileSync } from 'node:fs';
import { Mesh, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  courseAt,
  planStructures,
  terrainAt,
  type BakedFeature,
  type BakedNetwork,
  type BakedRoad,
  type BakedTerrainPatch,
  type StructureSpec,
} from '../road';
import { landmarkPlaces } from '../road/structures/landmark-places';
import { planner as landmarkPlanner } from '../road/structures/landmarks';
import { iowaParkLayout } from '../road/structures/iowa-park';
import { LandmarkLayer } from './landmarks';
import { createFlatLook } from './look';
import { landmarkKit } from './structures.test-util';

const model = 'models/landmarks/eagle-stone-tower#eagle_stone_tower';
const feature = {
  kind: 'landmark' as const,
  id: 'eagle-stone-tower',
  s0: 194,
  s1: 206,
  d0: 34,
  d1: 46,
  params: { model, scale: 1 },
};
function patch(
  x0 = -120,
  x1 = 120,
  z0 = -650,
  z1 = 50,
  surface: 'grass' | 'water' = 'grass',
): BakedTerrainPatch {
  return {
    surface,
    vertices: [
      [x0, 20 + (x0 * 1.1) / 12, z0],
      [x0, 20 + (x0 * 1.1) / 12, z1],
      [x1, 20 + (x1 * 1.1) / 12, z0],
      [x1, 20 + (x1 * 1.1) / 12, z1],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}
function fixture(patches: BakedTerrainPatch[] = [patch()], f: BakedFeature = feature) {
  const b = fixtureNetwork([{ id: 'park', lengthM: 600, kappa: 0 }]);
  b.roads[0]!.features = [f];
  b.roads[0]!.tags = ['rural', 'iowa-park'].map((tag) => ({ s0: 0, s1: 600, side: 'both' as const, tag }));
  return createRoadNetwork({ ...b, network: { ...b.network, terrain: { patches } } });
}
const root = 'packs/region-clinton/regions/clinton-iowa';
const network = JSON.parse(
  readFileSync(`${root}/networks/osm-clinton-eagle-point.json`, 'utf8'),
) as BakedNetwork;
const roads = network.roads.map(
  (id) => JSON.parse(readFileSync(`${root}/roads/${id}.json`, 'utf8')) as BakedRoad,
);
const actual = () => createRoadNetwork({ network, roads });
const solids = (road: ReturnType<typeof fixture>) => {
  const out: StructureSpec[] = [];
  landmarkPlanner.plan(road, 1, { add: (s) => out.push(s) - 1 });
  return out;
};

// Independent polygon-edge clipping, rather than the planner's four separating axes.
function overlapsPad(
  foot: StructureSpec['foot'],
  tower: { x: number; z: number; foundation?: { halfM: number } },
): boolean {
  const h = tower.foundation!.halfM - 1e-8;
  const points = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({
    x: foot.x - tower.x + u! * foot.hu * foot.ux - v! * foot.hv * foot.uz,
    z: foot.z - tower.z + u! * foot.hu * foot.uz + v! * foot.hv * foot.ux,
  }));
  for (let i = 0; i < 4; i++) {
    const a = points[i]!,
      b = points[(i + 1) % 4]!;
    let enter = 0,
      leave = 1;
    for (const axis of ['x', 'z'] as const) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-12) {
        if (Math.abs(a[axis]) > h) leave = -1;
      } else {
        const t0 = (-h - a[axis]) / delta,
          t1 = (h - a[axis]) / delta;
        enter = Math.max(enter, Math.min(t0, t1));
        leave = Math.min(leave, Math.max(t0, t1));
      }
    }
    if (enter <= leave) return true;
  }
  const dx = tower.x - foot.x,
    dz = tower.z - foot.z;
  return Math.abs(dx * foot.ux + dz * foot.uz) < foot.hu && Math.abs(dz * foot.ux - dx * foot.uz) < foot.hv;
}

describe('Eagle tower shared source-ground foundation', () => {
  it('samples the final translated and scaled frame instead of honoring a road-plane baseY', () => {
    const f = { ...feature, params: { ...feature.params, yawDeg: -90, scale: 1.5, frontM: 2, baseY: -500 } };
    const road = fixture([patch()], f);
    const at = landmarkPlaces(road)[0]!;
    const center = road.toWorld(0, 200, 40, 0);
    expect(at.x).toBeCloseTo(center.x + Math.sin(at.yaw) * 3, 4);
    expect(at.z).toBeCloseTo(center.z + Math.cos(at.yaw) * 3, 4);
    expect(at.foundation!.halfM).toBe(9);
    expect(at.y).toBeCloseTo(terrainAt(road.terrain, at.x + 9, at.z)!.y + 0.08, 5);
    expect(at.foundation!.bottomY).toBeCloseTo(terrainAt(road.terrain, at.x - 9, at.z)!.y - 0.05, 5);
    const steep = { ...patch(), vertices: patch().vertices.map(([x, , z]) => [x, x, z] as const) };
    expect(iowaParkLayout(fixture([steep]), 1).facilities).toEqual([]);
    expect(iowaParkLayout(fixture(), 1).facilities.length).toBeGreaterThan(0);
  });
  it('covers a 1.1 m graded footprint and the finer real site, with model origin at the pad top', () => {
    for (const road of [fixture(), actual()]) {
      const at = landmarkPlaces(road).find((p) => p.kit === 'eagle-stone-tower')!;
      expect(at).toBeDefined();
      const pad = at.foundation!;
      expect(pad).toBeDefined();
      const ys: number[] = [];
      const n = Math.ceil((2 * pad.halfM) / 0.25);
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n; j++) {
          const g = terrainAt(
            road.terrain,
            at.x + ((2 * i) / n - 1) * pad.halfM,
            at.z + ((2 * j) / n - 1) * pad.halfM,
          );
          expect(g?.surface).toBe('grass');
          ys.push(g!.y);
        }
      expect(at.y).toBe(pad.topY);
      expect(pad.topY).toBeCloseTo(Math.max(...ys) + 0.08, 5);
      expect(pad.bottomY).toBeCloseTo(Math.min(...ys) - 0.05, 5);
      expect(pad.topY - pad.bottomY).toBeGreaterThan(1.2);
      const physical = solids(road).filter((s) => s.rule.endsWith(':foundation'));
      expect(physical).toHaveLength(1);
      expect(physical[0]!.foot).toEqual({ x: at.x, z: at.z, ux: 1, uz: 0, hu: pad.halfM, hv: pad.halfM });
      expect(physical[0]!.baseY).toBe(pad.bottomY);
      expect(physical[0]!.roof).toEqual({ kind: 'flat', topM: pad.topY - pad.bottomY });
      for (const e of road.edges)
        for (let s = 0; s <= e.length; s += 0.5) {
          const p = road.toWorld(e.index, s, 0, 0);
          expect(Math.hypot(at.x - p.x, at.z - p.z) - Math.SQRT2 * pad.halfM).toBeGreaterThanOrEqual(
            Math.max(-e.dMin, e.dMax) + 6.6 - 0.01,
          );
        }
    }
  });

  it('rejects missing support, water at the rim/interior, wrong node and recovery overlap', () => {
    expect(landmarkPlaces(fixture())).toHaveLength(1);
    const at = landmarkPlaces(fixture())[0]!;
    const wet = (x: number, z: number) => ({
      ...patch(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 'water'),
      vertices: patch(x - 0.3, x + 0.3, z - 0.3, z + 0.3).vertices.map(([x, y, z]) => [x, y + 1, z] as const),
    });
    for (const road of [
      createRoadNetwork({ network: { ...network, terrain: undefined }, roads }),
      fixture([]),
      fixture([patch(), wet(at.x, at.z)]),
      fixture([patch(), wet(at.x + 6, at.z)]),
      fixture([patch(at.x - 5, at.x + 5)]),
      fixture([patch()], { ...feature, d0: 0, d1: 12 }),
      fixture([patch()], { ...feature, params: { model: model + '-missing', scale: 1 } }),
    ]) {
      expect(landmarkPlaces(road)).toEqual([]);
      expect(solids(road)).toEqual([]);
    }
    const legacy = fixture([patch()], {
      ...feature,
      params: { model: 'models/landmarks/sf-landmarks#coit_tower', scale: 1, baseY: -7 },
    });
    expect(landmarkPlaces(legacy)[0]!.y).toBe(-7);
    expect(landmarkPlaces(legacy)[0]!.foundation).toBeUndefined();
    const absent = createRoadNetwork({
      network,
      roads: roads.map((r) => ({ ...r, features: r.features?.filter((f) => f.id !== feature.id) })),
    });
    expect(landmarkPlaces(absent).filter((p) => p.kit === 'eagle-stone-tower')).toEqual([]);
    const b = fixtureNetwork([
      { id: 'park', lengthM: 600, kappa: 0 },
      { id: 'neighbor', lengthM: 600, kappa: 0 },
    ]);
    b.roads[0]!.features = [feature];
    const data = b.roads[1]!.samples.data;
    b.roads[1]!.samples = {
      ...b.roads[1]!.samples,
      data: {
        ...data,
        x: data.x!.map(() => at.x),
        z: data.z!.map((_, i) => 50 - i * b.roads[1]!.sampleSpacingM),
      },
    };
    expect(
      landmarkPlaces(createRoadNetwork({ ...b, network: { ...b.network, terrain: { patches: [patch()] } } })),
    ).toEqual([]);
  });

  it('draws a matching physical pad only with a loaded node, retaining both terrace and parapet heights', async () => {
    const road = actual();
    const at = landmarkPlaces(road).find((p) => p.kit === 'eagle-stone-tower')!;
    const kit = await landmarkKit('eagle-stone-tower');
    const layer = new LandmarkLayer(new Map([[kit.id, kit]]), createFlatLook(), { road });
    const blank = new LandmarkLayer(new Map(), createFlatLook(), { road });
    const noNode = new LandmarkLayer(new Map([[kit.id, { ...kit, nodes: new Map() }]]), createFlatLook(), {
      road,
    });
    try {
      layer.update(at.x, at.z);
      layer.group.updateMatrixWorld(true);
      expect(blank.group.children).toEqual([]);
      expect(noNode.group.children).toEqual([]);
      const mesh = layer.group.children.find((c) => c instanceof Mesh) as Mesh;
      const ray = new Raycaster();
      const height = (x: number, z: number) => {
        const wx = at.x + Math.cos(at.yaw) * x + Math.sin(at.yaw) * z;
        const wz = at.z - Math.sin(at.yaw) * x + Math.cos(at.yaw) * z;
        ray.set(new Vector3(wx, at.y + 20, wz), new Vector3(0, -1, 0));
        return ray.intersectObject(mesh)[0]?.point.y;
      };
      expect(height(0, 0)! - at.y).toBeCloseTo(9.4, 3);
      expect(height(4, 0)! - at.y).toBeCloseTo(3.35, 3);
      const specs = solids(road);
      const plan = planStructures(
        road,
        1,
        { landmarks: landmarkPlanner },
        { landmarks: { features: ['landmark'], load: () => Promise.resolve(landmarkPlanner) } },
      );
      for (const [wx, wz, top] of [
        [at.x, at.z, at.y + 9.4],
        [at.x + Math.cos(at.yaw) * 4, at.z - Math.sin(at.yaw) * 4, at.y + 3.35],
        [at.x + 5.9, at.z + 5.9, at.y],
      ] as const) {
        // Solve the actual road frame: a nearest-polyline projection far off a curve is only a hint.
        let s = (at.feature.s0 + at.feature.s1) / 2,
          d = (at.feature.d0 + at.feature.d1) / 2;
        for (let i = 0; i < 12; i++) {
          const p = road.toWorld(at.edge, s, d, 0),
            a = road.toWorld(at.edge, s + 0.001, d, 0),
            b = road.toWorld(at.edge, s, d + 0.001, 0);
          const ax = (a.x - p.x) / 0.001,
            az = (a.z - p.z) / 0.001,
            bx = (b.x - p.x) / 0.001,
            bz = (b.z - p.z) / 0.001;
          const dx = wx - p.x,
            dz = wz - p.z,
            det = ax * bz - az * bx;
          s += (dx * bz - dz * bx) / det;
          d += (ax * dz - az * dx) / det;
        }
        expect(road.toWorld(at.edge, s, d, 0).x).toBeCloseTo(wx, 6);
        expect(road.toWorld(at.edge, s, d, 0).z).toBeCloseTo(wz, 6);
        const support = courseAt(road, plan, { edge: at.edge, s, d }, top + 0.1);
        expect(support.kind).toBe('top');
        if (support.kind === 'top') expect(support.y).toBeCloseTo(top, 1);
      }
      const physicalTop = (x: number, z: number) => {
        const wx = at.x + Math.cos(at.yaw) * x + Math.sin(at.yaw) * z;
        const wz = at.z - Math.sin(at.yaw) * x + Math.cos(at.yaw) * z;
        return Math.max(
          ...specs
            .filter((s) => {
              const dx = wx - s.foot.x,
                dz = wz - s.foot.z;
              return (
                Math.abs(dx * s.foot.ux + dz * s.foot.uz) <= s.foot.hu &&
                Math.abs(dz * s.foot.ux - dx * s.foot.uz) <= s.foot.hv
              );
            })
            .map((s) => s.baseY + (s.roof.kind === 'flat' ? s.roof.topM : 0)),
        );
      };
      for (const radius of [2.55, 5]) {
        const merlon = physicalTop(radius, 0);
        const gap = physicalTop(radius * Math.cos(Math.PI / 8), radius * Math.sin(Math.PI / 8));
        expect(merlon - gap).toBeGreaterThan(0.5);
        expect(merlon).toBeCloseTo(height(radius, 0)!, 1);
        expect(gap).toBeCloseTo(height(radius * Math.cos(Math.PI / 8), radius * Math.sin(Math.PI / 8))!, 1);
      }
      const pad = at.foundation!;
      ray.set(new Vector3(at.x + 5.9, at.y + 1, at.z + 5.9), new Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(pad.topY, 4);
      mesh.position.y += 1;
      mesh.updateMatrixWorld(true);
      expect(ray.intersectObject(mesh)[0]?.point.y).not.toBeCloseTo(pad.topY, 4);
      expect(height(0, 0)).not.toBeCloseTo(physicalTop(0, 0), 1);
      expect(at.y).not.toBeCloseTo(
        road.toWorld(at.edge, (at.feature.s0 + at.feature.s1) / 2, (at.feature.d0 + at.feature.d1) / 2, 0).y,
        1,
      );
      expect(at.y).not.toBeCloseTo(pad.bottomY + 0.05, 1);
    } finally {
      layer.dispose();
      blank.dispose();
      noNode.dispose();
      for (const n of kit.nodes.values()) n.geometry.dispose();
    }
  });

  it('preserves facility sites when none overlap and otherwise retains ordinary spacing across seeds', () => {
    const withTower = actual();
    const withoutTower = createRoadNetwork({
      network,
      roads: roads.map((r) => ({ ...r, features: r.features?.filter((f) => f.id !== feature.id) })),
    });
    const at = landmarkPlaces(withTower).find((p) => p.kit === 'eagle-stone-tower')!;
    for (let seed = 1; seed <= 24; seed++) {
      const before = iowaParkLayout(withoutTower, seed).facilities;
      const after = iowaParkLayout(withTower, seed).facilities;
      expect(after.map((f) => f.id)).toEqual(before.map((f) => f.id));
      const overlaps = before.some((f) =>
        overlapsPad(f.specs.find((s) => s.rule.endsWith(':foundation'))!.foot, at),
      );
      if (!overlaps) expect(after).toEqual(before);
      for (const f of after)
        expect(overlapsPad(f.specs.find((s) => s.rule.endsWith(':foundation'))!.foot, at)).toBe(false);
      for (let i = 0; i < after.length; i++)
        for (let j = i + 1; j < after.length; j++)
          expect(Math.hypot(after[i]!.x - after[j]!.x, after[i]!.z - after[j]!.z)).toBeGreaterThanOrEqual(
            120,
          );
    }
  });

  it('rejects a deliberately overlapping facility candidate without applying 120 m tower spacing', () => {
    const control = fixture([patch()], { ...feature, params: { model: 'unknown#none' } });
    let example: { seed: number; s: number; d: number; id: string } | undefined;
    for (let seed = 1; seed <= 32 && !example; seed++) {
      const f = iowaParkLayout(control, seed).facilities.find((f) => Math.abs(f.d) > 24);
      if (f) example = { seed, s: f.s, d: f.d, id: f.id };
    }
    expect(example).toBeDefined();
    const e = example!;
    const road = fixture([patch()], { ...feature, s0: e.s - 6, s1: e.s + 6, d0: e.d - 6, d1: e.d + 6 });
    const tower = landmarkPlaces(road)[0]!;
    expect(tower).toBeDefined();
    const facilities = iowaParkLayout(road, e.seed).facilities;
    expect(facilities.find((f) => f.id === e.id)).not.toEqual(
      iowaParkLayout(control, e.seed).facilities.find((f) => f.id === e.id),
    );
    expect(facilities.some((f) => Math.hypot(f.x - tower.x, f.z - tower.z) < 120)).toBe(true);
    const cold = fixture([patch()], { ...feature, s0: e.s - 6, s1: e.s + 6, d0: e.d - 6, d1: e.d + 6 });
    expect(iowaParkLayout(cold, e.seed)).toEqual(iowaParkLayout(road, e.seed));
    for (const f of facilities) {
      const pad = f.specs.find((s) => s.rule.endsWith(':foundation'))!.foot;
      expect(overlapsPad(pad, tower)).toBe(false);
    }
  });
});
