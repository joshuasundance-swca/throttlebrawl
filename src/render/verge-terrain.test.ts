import { Mesh, Raycaster, Vector3, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  DRAWN_VERGE_M,
  fixtureNetwork,
  terrainAt,
  type BakedTerrain,
  type BakedTerrainPatch,
  type BakedVerge,
} from '../road';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { buildTerrainChunks } from './terrain-mesh';
import { VERGE_LIFT_M, VergeLayer } from './verge';

const look = createFlatLook();

function patch(z0: number, z1: number, surface: BakedTerrainPatch['surface']): BakedTerrainPatch {
  return {
    surface,
    vertices: [-20, 20].flatMap((x) =>
      [z0, z1].map((z): [number, number, number] => [x, surface === 'water' ? 6.1 : 3 + x / 10 + z / 100, z]),
    ),
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}

function fixture(terrain?: BakedTerrain, widthM = 6, edge: BakedVerge['edge'] = 'soft', trafficOnly = false) {
  const bundle = fixtureNetwork([{ id: 'road', lengthM: 120, kappa: 0 }]);
  const baked = bundle.roads[0]!;
  baked.tags = [{ s0: 0, s1: 120, side: 'both', tag: 'rural' }];
  baked.laneSections = baked.laneSections.map((section) => ({
    ...section,
    verges: {
      left: { widthM, surface: 'grass', edge },
      right: { widthM, surface: 'grass', edge },
    },
  }));
  const road = createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(terrain ? { terrain } : {}) },
  });
  if (trafficOnly) road.edges[0]!.isTrafficOnly = true;
  const verge = new VergeLayer(road, look, { tags: new Set(['rural']) });
  verge.group.updateMatrixWorld(true);
  return { road, verge };
}

function bands(verge: VergeLayer): Mesh[] {
  return verge.group.children.filter((o): o is Mesh => o instanceof Mesh && o.name === 'verge-band');
}

function ray(meshes: Mesh[], x: number, z: number) {
  return new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0)).intersectObjects(meshes, false);
}

function positions(verge: VergeLayer) {
  return bands(verge).map((m) => Array.from(m.geometry.getAttribute('position').array));
}

function expectInsideRoad(verge: VergeLayer, lo: number, hi: number) {
  expect(bands(verge).length).toBeGreaterThan(0);
  for (const mesh of bands(verge)) {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i)).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(p.getX(i)).toBeLessThanOrEqual(hi + 1e-6);
    }
  }
}

describe('authored terrain bounds the legacy verge surface', () => {
  it.each(['grass', 'water'] as const)(
    'leaves source %s slopes/levels and holes clear of flat bands and shallows',
    (surface) => {
      const terrain: BakedTerrain = { patches: [patch(-120, -70, surface), patch(-50, 0, surface)] };
      const authored = fixture(terrain, 6, surface === 'water' ? 'water' : 'soft');
      const legacy = fixture(undefined, 6, surface === 'water' ? 'water' : 'soft');
      const scene = buildRoadScene(
        authored.road,
        look,
        {},
        { terrainChunks: buildTerrainChunks, roadsideDensity: 0 },
      );
      scene.group.updateMatrixWorld(true);
      const source: Mesh[] = [];
      scene.group.traverse((o) => {
        if (o instanceof Mesh && o.name.startsWith('road-terrain-')) source.push(o as Mesh);
      });
      try {
        const e = authored.road.edges[0]!;
        for (const side of [-1, 1] as const) {
          const v = authored.road.vergeAt(0, 30, side < 0 ? 'left' : 'right');
          for (const d of [v.dInner + side * 2, v.dOuter + side]) {
            // Grass has no shallows; water's positive control exercises both old strips.
            if (surface === 'grass' && Math.abs(d) > Math.abs(v.dOuter)) continue;
            for (const s of [30, 60, 90]) {
              const p = authored.road.toWorld(0, s, d, 0);
              expect(ray(bands(legacy.verge), p.x, p.z).length).toBeGreaterThan(0);
              const physical = terrainAt(terrain, p.x, p.z);
              const hit = ray([...source, ...bands(authored.verge)], p.x, p.z)[0];
              if (s === 60) {
                expect(physical).toBeNull();
                expect(hit).toBeUndefined();
              } else {
                expect(physical).not.toBeNull();
                expect(hit?.point.y).toBeCloseTo(physical!.y, 6);
                expect(ray(bands(authored.verge), p.x, p.z)).toEqual([]);
              }
            }
          }
          const inside = authored.road.toWorld(0, 30, v.dInner + (side * DRAWN_VERGE_M) / 2, 0);
          expect(ray(bands(authored.verge), inside.x, inside.z)[0]?.point.y).toBeCloseTo(VERGE_LIFT_M);
        }
        expectInsideRoad(authored.verge, e.dMin - DRAWN_VERGE_M, e.dMax + DRAWN_VERGE_M);
        expect(authored.verge.counts().shallowsM).toBe(0);
        if (surface === 'water') expect(legacy.verge.counts().shallowsM).toBeGreaterThan(0);
      } finally {
        authored.verge.dispose();
        legacy.verge.dispose();
        scene.dispose();
      }
    },
  );

  it('keeps a narrow Eagle-style band byte-for-byte and preserves drawn fence and brush instances', () => {
    for (const edge of ['fence', 'brush'] as const) {
      const authored = fixture({ patches: [] }, Math.min(0.5, DRAWN_VERGE_M), edge);
      const legacy = fixture(undefined, Math.min(0.5, DRAWN_VERGE_M), edge);
      try {
        expect(positions(authored.verge)).toEqual(positions(legacy.verge));
        expect(positions(authored.verge).length).toBeGreaterThan(0);
        for (const v of [authored.verge, legacy.verge]) v.update(0, -60, null, 0);
        const name = edge === 'fence' ? 'verge-fence' : 'verge-brush';
        const a = authored.verge.group.getObjectByName(name) as InstancedMesh;
        const b = legacy.verge.group.getObjectByName(name) as InstancedMesh;
        expect(a.count).toBeGreaterThan(0);
        expect(a.count).toBe(b.count);
        expect(Array.from(a.instanceMatrix.array)).toEqual(Array.from(b.instanceMatrix.array));
        expect(authored.verge.edgeKitPoints()).toEqual(legacy.verge.edgeKitPoints());
      } finally {
        authored.verge.dispose();
        legacy.verge.dispose();
      }
    }
  });

  it('omits synthetic shallows even when the water-edge band already fits inside the shoulder', () => {
    const authored = fixture({ patches: [] }, DRAWN_VERGE_M / 2, 'water');
    const legacy = fixture(undefined, DRAWN_VERGE_M / 2, 'water');
    try {
      const v = authored.road.vergeAt(0, 60, 'right');
      const p = authored.road.toWorld(0, 60, v.dOuter + 1, 0);
      expect(ray(bands(legacy.verge), p.x, p.z).length).toBeGreaterThan(0);
      expect(legacy.verge.counts().shallowsM).toBeGreaterThan(0);
      expect(ray(bands(authored.verge), p.x, p.z).length).toBe(0);
      expect(authored.verge.counts().shallowsM).toBe(0);
    } finally {
      authored.verge.dispose();
      legacy.verge.dispose();
    }
  });

  it('caps traffic fill bands at the actual road fill span and draws no zero-width bands', () => {
    const authored = fixture({ patches: [] }, 6, 'soft', true);
    const zero = fixture({ patches: [] }, 0);
    const scene = buildRoadScene(
      authored.road,
      look,
      {},
      { terrainChunks: buildTerrainChunks, roadsideDensity: 0 },
    );
    scene.group.updateMatrixWorld(true);
    try {
      const e = authored.road.edges[0]!;
      expectInsideRoad(authored.verge, e.dMin - DRAWN_VERGE_M, e.dMax + DRAWN_VERGE_M);
      const roadMeshes: Mesh[] = [];
      scene.group.traverse((o) => {
        if (o instanceof Mesh && o.name === 'road-road') roadMeshes.push(o as Mesh);
      });
      for (const side of [-1, 1] as const) {
        const outer = side < 0 ? e.dMin - DRAWN_VERGE_M : e.dMax + DRAWN_VERGE_M;
        expect(ray(roadMeshes, outer - side * 0.1, -60).length).toBeGreaterThan(0);
        expect(ray(bands(authored.verge), outer + side * 0.1, -60)).toEqual([]);
      }
      expect(bands(zero.verge)).toEqual([]);
      expect(Object.values(zero.verge.counts().bandM).every((m) => m === 0)).toBe(true);
    } finally {
      authored.verge.dispose();
      zero.verge.dispose();
      scene.dispose();
    }
  });
});
