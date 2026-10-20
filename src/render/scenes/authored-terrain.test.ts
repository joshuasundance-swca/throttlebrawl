import {
  BufferGeometry,
  BoxGeometry,
  Frustum,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  terrainAt,
  type BakedTerrain,
  type BakedTerrainPatch,
} from '../../road';
import { createFlatLook } from '../look';
import type { SceneryModels } from '../models';
import { bakeRepoModel } from '../model-files.test-util';
import { buildRoadScene, type RoadScene } from '../road-mesh';
import { boatBob } from '../scenery';
import { buildTerrainChunks } from '../terrain-mesh';

function rectangle(x0: number, z0: number, x1: number, z1: number, y = 3, water = false): BakedTerrainPatch {
  return {
    surface: water ? 'water' : 'grass',
    vertices: [
      [x0, y, z0],
      [x0, y, z1],
      [x1, y, z0],
      [x1, y, z1],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}

function scene(terrain?: BakedTerrain, tag = 'forest', density = 0, grade = 0, models?: SceneryModels) {
  const bundle = fixtureNetwork([{ id: 'r', lengthM: 200, kappa: 0, grade }]);
  const tags = [{ s0: 0, s1: 200, side: 'both' as const, tag }];
  bundle.roads[0]!.tags = tags;
  const road = createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(terrain ? { terrain } : {}) },
  });
  const built = buildRoadScene(
    road,
    createFlatLook(),
    { r: { tags, barriers: [{ s0: 10, s1: 40, side: 'left', kind: 'wall' }] } },
    {
      terrainChunks: buildTerrainChunks,
      seed: 7,
      roadsideDensity: density,
      postRoads: () => true,
      ...(models ? { models } : {}),
    },
  );
  built.group.updateMatrixWorld(true);
  return { road, built };
}

function meshes(built: RoadScene, name: string) {
  const out: Mesh[] = [];
  built.group.traverse((o) => {
    if (o instanceof Mesh && o.name === name) out.push(o as Mesh);
  });
  return out;
}

function ray(built: RoadScene, x: number, z: number, names?: string[]) {
  const out: Mesh[] = [];
  built.group.traverse((o) => {
    if (o instanceof Mesh && (!names || names.includes(o.name))) out.push(o as Mesh);
  });
  return new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0)).intersectObjects(out, false);
}

describe('authored natural terrain in the road scene', () => {
  it('requires the drawing builder, with explicit pending and ready controls', () => {
    const bundle = fixtureNetwork([{ id: 'r', lengthM: 200, kappa: 0 }]);
    const road = createRoadNetwork({
      ...bundle,
      network: { ...bundle.network, terrain: { patches: [rectangle(-50, -200, 50, 0)] } },
    });
    expect(() => buildRoadScene(road, createFlatLook())).toThrow('requires its drawing builder');
    const pending = buildRoadScene(road, createFlatLook(), undefined, { terrainChunks: null });
    expect(meshes(pending, 'road-terrain-land')).toEqual([]);
    pending.dispose();
    const ready = buildRoadScene(road, createFlatLook(), undefined, { terrainChunks: buildTerrainChunks });
    expect(meshes(ready, 'road-terrain-land').length).toBeGreaterThan(0);
    ready.dispose();
  });
  it('raycasts the actual two-axis slopes and shared boundary at physical Float32 heights and normals', () => {
    const terrain: BakedTerrain = {
      patches: [
        {
          surface: 'dirt',
          vertices: [
            [10, 2.1, -100],
            [10, 4.2, 0],
            [40, 6.3, -100],
            [40, 9.4, 0],
          ],
          triangles: [
            [0, 1, 2],
            [2, 1, 3],
          ],
        },
      ],
    };
    const { built } = scene(terrain);
    try {
      for (const [x, z] of [
        [13, -70],
        [37, -20],
        [25, -50],
        [10, -100],
      ]) {
        const hit = ray(built, x!, z!, ['road-terrain-land'])[0];
        const physical = terrainAt(terrain, x!, z!)!;
        expect(hit).toBeDefined();
        expect(hit!.point.y).toBeCloseTo(physical.y, 6);
        expect(hit!.face!.normal.x).toBeCloseTo(physical.normal.x, 6);
        expect(hit!.face!.normal.y).toBeCloseTo(physical.normal.y, 6);
        expect(hit!.face!.normal.z).toBeCloseTo(physical.normal.z, 6);
      }
    } finally {
      built.dispose();
    }
  });

  it('preserves land gaps, water holes and uncovered space without the legacy sea or ground underneath', () => {
    const { built } = scene({
      patches: [
        rectangle(10, -100, 30, -60),
        rectangle(10, -40, 30, 0),
        rectangle(-40, -100, -20, -60, 6.1, true),
        rectangle(-40, -40, -20, 0, 6.1, true),
      ],
    });
    try {
      expect(ray(built, 20, -80)[0]?.point.y).toBeCloseTo(3);
      expect(ray(built, -30, -80)[0]?.point.y).toBeCloseTo(Math.fround(6.1), 6);
      expect(ray(built, 20, -50)).toEqual([]);
      expect(ray(built, -30, -50)).toEqual([]);
      expect(ray(built, 100, -80)).toEqual([]);
      expect(meshes(built, 'road-land')).toEqual([]);
      expect(meshes(built, 'road-water')).toEqual([]);
      for (const name of [
        'road-road',
        'road-shoulder',
        'road-marking',
        'road-markingCenter',
        'road-deck',
        'road-posts',
      ])
        expect(meshes(built, name).length, name).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });

  it('keeps omitted terrain on the legacy path and treats an explicit empty terrain as no natural surface', () => {
    const legacy = scene().built;
    const empty = scene({ patches: [] }).built;
    try {
      expect(meshes(legacy, 'road-land').length).toBeGreaterThan(0);
      expect(meshes(legacy, 'road-water').length).toBeGreaterThan(0);
      expect(ray(legacy, 15, -50).length).toBeGreaterThan(0);
      expect(ray(empty, 15, -50)).toEqual([]);
      expect(meshes(empty, 'road-terrain-land')).toEqual([]);
      expect(empty.stats.sceneryLandM).toBe(0);
      expect(empty.landReach(0, 1, 40)).toBe(0);
      expect(empty.landTop(0, 1, 40, 10)).toBeNull();
    } finally {
      legacy.dispose();
      empty.dispose();
    }
  });

  it('keeps road-attached geometry and high deck fascias while refusing to invent a continuous land strip', () => {
    const { road, built } = scene({ patches: [rectangle(5.5, -200, 40, 0, 3)] }, 'palms', 0, 0.04);
    const legacy = scene(undefined, 'palms', 0, 0.04).built;
    try {
      for (const name of [
        'road-road',
        'road-shoulder',
        'road-marking',
        'road-markingCenter',
        'road-rail',
        'road-posts',
      ]) {
        expect(
          meshes(built, name).map((m) => Array.from(m.geometry.getAttribute('position').array)),
          name,
        ).toEqual(meshes(legacy, name).map((m) => Array.from(m.geometry.getAttribute('position').array)));
      }
      expect(meshes(built, 'road-deck').length).toBeGreaterThan(0);
      expect(built.landReach(0, 1, 40)).toBe(0);
      const p = road.toWorld(0, 40, road.edges[0]!.dMax + 0.6 + 10, 0);
      expect(terrainAt(road.terrain, p.x, p.z)?.y).toBe(3);
      expect(built.landTop(0, 1, 40, 10)).toBe(3);
      expect(built.landTop(0, -1, 40, 10)).toBeNull();
    } finally {
      built.dispose();
      legacy.dispose();
    }
  });

  it('keeps boats on authored water height through the animated update and omits unsupported water props', () => {
    const full = scene({ patches: [rectangle(-150, -200, 150, 0, 11, true)] }, 'water', 1).built;
    const empty = scene({ patches: [] }, 'water', 1).built;
    try {
      const boats = full.spots.filter((s) => s.kind === 'boat' || s.kind === 'skiff');
      expect(boats.length).toBeGreaterThan(0);
      expect(empty.spots).toHaveLength(0);
      full.update(0, 0, 2, 1000);
      for (const kind of ['skiff', 'boat']) {
        const mine = full.spots.filter((s) => s.kind === kind);
        const batches = meshes(full, `road-${kind}s`) as InstancedMesh[];
        const heights: number[] = [];
        for (const batch of batches)
          for (let i = 0; i < batch.count; i++) {
            const matrix = new Matrix4();
            batch.getMatrixAt(i, matrix);
            heights.push(matrix.elements[13]);
          }
        for (const spot of mine) {
          expect(spot.p.y).toBe(11);
          expect(heights.some((y) => Math.abs(y - (11 + boatBob(2, spot.phase).rise)) < 1e-5)).toBe(true);
        }
      }
    } finally {
      full.dispose();
      empty.dispose();
    }
  });

  it('keeps render-only land solids off playable authored ground, water and uncovered space', () => {
    const full: BakedTerrain = { patches: [rectangle(-150, -200, 150, 0, 7)] };
    const legacy = scene(undefined, 'forest', 1).built;
    const control = scene(full, 'forest', 1).built;
    const selective: BakedTerrain = {
      patches: [rectangle(-150, -200, 0, -100, 7), rectangle(-150, -100, 0, 0, 9, true)],
    };
    const selected = scene(selective, 'forest', 1).built;
    try {
      expect(legacy.spots.some((s) => s.kind === 'conifer')).toBe(true);
      expect(control.spots).toEqual([]);
      expect(selected.spots).toEqual([]);
    } finally {
      legacy.dispose();
      control.dispose();
      selected.dispose();
    }
  });

  it.each([false, true])(
    'releases generated scene and scatter geometry exactly once (authored %s)',
    (authored) => {
      const generated = new Set<BufferGeometry>();
      const disposed: BufferGeometry[] = [];
      const setAttribute = Reflect.get(
        BufferGeometry.prototype,
        'setAttribute',
      ) as BufferGeometry['setAttribute'];
      vi.spyOn(BufferGeometry.prototype as BufferGeometry, 'setAttribute').mockImplementation(function (
        this: BufferGeometry,
        name: string,
        attribute: Parameters<BufferGeometry['setAttribute']>[1],
      ) {
        generated.add(this);
        return setAttribute.call(this, name, attribute);
      });
      vi.spyOn(BufferGeometry.prototype, 'dispose').mockImplementation(function (this: BufferGeometry) {
        disposed.push(this);
      });
      try {
        const { built } = authored
          ? scene({ patches: [rectangle(-150, -200, 150, 0, 7, true)] }, 'water', 1)
          : scene(undefined, 'forest', 1);
        built.update(0, 0, 0, 1000, 1000, Infinity);
        if (authored) expect(built.spots.some((s) => s.kind === 'boat' || s.kind === 'skiff')).toBe(true);
        else expect(built.merged().built).toBeGreaterThan(0);
        built.dispose();
        expect(generated.size).toBeGreaterThan(0);
        for (const geometry of generated)
          expect(
            disposed.filter((g) => g === geometry).length,
            `generated ${geometry.type} geometry disposal`,
          ).toBe(1);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

  it('retains model-cache geometries while disposing a scene with merged land scenery', () => {
    const model = new BoxGeometry(1, 4, 1).translate(0, 2, 0);
    const disposal = vi.spyOn(model, 'dispose');
    const { built } = scene(undefined, 'forest', 1, 0, {
      conifers: { kind: 'conifers', variants: [model], doubleSided: false },
    });
    try {
      expect(built.spots.some((s) => s.kind === 'conifer')).toBe(true);
      built.update(0, 0, 0, 1000, 1000, Infinity);
      expect(built.merged().built).toBeGreaterThan(0);
      built.dispose();
      expect(disposal).not.toHaveBeenCalled();
    } finally {
      disposal.mockRestore();
      model.dispose();
    }
  });

  for (const grade of [0, 0.04]) {
    it(`retains the cached trestle model on scene disposal with ${grade === 0 ? 'no' : 'drawn'} bent instances`, async () => {
      const model = await bakeRepoModel('trestleBent');
      const disposals = model.variants.map((g) => vi.spyOn(g, 'dispose'));
      const bundle = fixtureNetwork([{ id: 'trestle', lengthM: 200, kappa: 0, grade }]);
      const tags = ['bridge', 'trestle'].map((tag) => ({ s0: 0, s1: 200, side: 'both', tag }));
      const road = createRoadNetwork({ ...bundle, network: { ...bundle.network, terrain: { patches: [] } } });
      const built = buildRoadScene(
        road,
        createFlatLook(),
        { trestle: { tags, barriers: [] } },
        {
          roadsideDensity: 0,
          terrainChunks: buildTerrainChunks,
          models: { trestleBent: model },
        },
      );
      try {
        const bents = meshes(built, 'road-trestle') as InstancedMesh[];
        if (grade > 0) {
          expect(bents.length).toBeGreaterThan(0);
          expect(bents.reduce((n, m) => n + m.count, 0)).toBeGreaterThan(0);
          for (const bent of bents) expect(bent.geometry).toBe(model.variants[0]);
        } else {
          expect(bents).toHaveLength(0);
        }
        built.dispose();
        for (const disposal of disposals) expect(disposal).not.toHaveBeenCalled();
      } finally {
        for (const disposal of disposals) disposal.mockRestore();
        for (const geometry of model.variants) geometry.dispose();
      }
    });
  }

  it('keeps authored faces intact across distant chunks, bounds work by supplied faces and disposes each geometry once', () => {
    const terrain: BakedTerrain = { patches: [rectangle(10, -100, 30, 0), rectangle(10000, -100, 10030, 0)] };
    const { built } = scene(terrain);
    const empty = scene({ patches: [] }).built;
    const ground = meshes(built, 'road-terrain-land');
    try {
      expect(ground.length).toBeGreaterThan(1);
      expect(ground.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0)).toBe(
        terrain.patches.reduce((n, p) => n + p.triangles.length, 0),
      );
      expect(built.stats.triangles - empty.stats.triangles).toBe(
        terrain.patches.reduce((n, p) => n + p.triangles.length, 0),
      );
      expect(built.stats.meshes - empty.stats.meshes).toBe(ground.length);
      const camera = new PerspectiveCamera(60, 1, 0.1, 200);
      camera.position.set(20, 40, 40);
      camera.lookAt(20, 0, -50);
      camera.updateMatrixWorld(true);
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      expect(ground.some((m) => frustum.intersectsObject(m))).toBe(true);
      expect(ground.some((m) => !frustum.intersectsObject(m))).toBe(true);
      const geometries = new Set<Mesh['geometry']>();
      built.group.traverse((o) => {
        if (o instanceof Mesh) geometries.add(o.geometry as BufferGeometry);
      });
      const disposals = [...geometries].map((g) => vi.spyOn(g, 'dispose'));
      const materials = new Set(
        ground.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])),
      );
      const materialDisposals = [...materials].map((m) => vi.spyOn(m, 'dispose'));
      built.dispose();
      for (const disposed of disposals) expect(disposed).toHaveBeenCalledTimes(1);
      for (const disposed of materialDisposals) expect(disposed).not.toHaveBeenCalled();
    } catch (error) {
      built.dispose();
      throw error;
    } finally {
      empty.dispose();
    }
  });
});
