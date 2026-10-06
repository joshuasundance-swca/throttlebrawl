// The still scenery merged per block, with far stand-ins (run W-S: win back draw-call and triangle
// headroom; the perf re-baseline found up to 108 of 120 draw calls and 133k of 150k triangles, and
// the old instanced scenery cost 21 to 41 draw calls a view). The checks build the real networks
// with the real Blender models and look at what is built: every still prop drawn exactly once, in
// one mesh per block, a far stand-in that keeps the model's size and colours on a fraction of its
// triangles, the switch at the level-of-detail distance, and blocks built near the camera, one a
// frame, and freed behind it.
import { BoxGeometry, Mesh, MeshBasicMaterial, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { readGlb } from './glb';
import { readAsset } from './model-files.test-util';
import { createFlatLook } from './look';
import {
  bakeModel,
  MODEL_ASSETS,
  MODEL_KINDS,
  modelKindsFor,
  type ModelKind,
  type SceneryModels,
} from './models';
import { buildRoadScene, MODEL_OF, networkTags, type RoadDressing } from './road-mesh';
import {
  formsOf,
  MergedScenery,
  SCENERY_BLOCK_M,
  SCENERY_LOD_M,
  THINNABLE_KINDS,
  thinRank,
  type MergeItem,
} from './scenery-merge';

const look = createFlatLook();
/** The examined lines, printed even when the tests pass (console.log is not). */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

async function model(kind: ModelKind) {
  // A model lives in the base pack or, for a region's own (San Francisco's tower modules), its region pack.
  return bakeModel(kind, readGlb(await readAsset(MODEL_ASSETS[kind], 'glb')));
}

const ALL: SceneryModels = {};
for (const k of MODEL_KINDS) ALL[k] = await model(k);

function modelsFor(road: RoadNetwork, dressing: RoadDressing): SceneryModels {
  const { tropical, tags } = networkTags(road, dressing);
  const out: SceneryModels = {};
  for (const k of modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] })) {
    const m = ALL[k];
    if (m) out[k] = m;
  }
  return out;
}

const STILL_MODELS: readonly ModelKind[] = [
  'palms',
  'mangroves',
  'baitShack',
  'powerPole',
  'conifers',
  'rowHouses',
  'sfApartments',
  'sawmill',
  'keysIslets',
];

describe('the far stand-ins', () => {
  it("keep each model's size and colours on a fraction of its triangles", () => {
    const rows: string[] = [];
    for (const kind of STILL_MODELS) {
      ALL[kind]!.variants.forEach((g, v) => {
        const { near, far } = formsOf(g);
        const nearTris = near.n / 3;
        const farTris = far.n / 3;
        rows.push(`${kind}[${v}] ${nearTris}>${farTris}`);
        if (far === near) return;
        expect(farTris, `${kind} ${v}`).toBeLessThanOrEqual(nearTris * 0.6);
        // Inside the model's own box, and coloured from its own colours.
        g.computeBoundingBox();
        const box = g.boundingBox!;
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < near.n * 3; i++) {
          lo[i % 3] = Math.min(lo[i % 3]!, near.col[i] ?? 1);
          hi[i % 3] = Math.max(hi[i % 3]!, near.col[i] ?? 1);
        }
        for (let i = 0; i < far.n; i++) {
          const [x, y, z] = [far.pos[i * 3] ?? 0, far.pos[i * 3 + 1] ?? 0, far.pos[i * 3 + 2] ?? 0];
          expect(x).toBeGreaterThanOrEqual(box.min.x - 1e-3);
          expect(x).toBeLessThanOrEqual(box.max.x + 1e-3);
          expect(y).toBeGreaterThanOrEqual(box.min.y - 1e-3);
          expect(y).toBeLessThanOrEqual(box.max.y + 1e-3);
          expect(z).toBeGreaterThanOrEqual(box.min.z - 1e-3);
          expect(z).toBeLessThanOrEqual(box.max.z + 1e-3);
          for (let c = 0; c < 3; c++) {
            const col = far.col[i * 3 + c] ?? 0;
            expect(col).toBeGreaterThanOrEqual(lo[c]! - 1e-4);
            expect(col).toBeLessThanOrEqual(hi[c]! + 1e-4);
          }
        }
        // As tall as the model, and at least half as wide as it (a crown, not a stick).
        let top = -Infinity;
        let wide = 0;
        for (let i = 0; i < far.n; i++) {
          top = Math.max(top, far.pos[i * 3 + 1] ?? 0);
          wide = Math.max(wide, Math.abs(far.pos[i * 3] ?? 0) - (box.max.x + box.min.x) / 2);
        }
        expect(top).toBeCloseTo(box.max.y, 3);
        expect(wide * 2).toBeGreaterThan((box.max.x - box.min.x) * 0.5);
      });
    }
    print(`[examined] far stand-ins, triangles near>far: ${rows.join(', ')}`);
  });
});

describe('the still scenery, merged per block', () => {
  for (const id of ['keys-m1', 'pnw-c1', 'sf-hills', 'osm-sf-twin-peaks']) {
    it(`${id}: every still prop drawn once, one mesh per block, the far ones as stand-ins`, () => {
      const { road, dressing } = track(id);
      const models = modelsFor(road, dressing);
      const scene = buildRoadScene(road, look, dressing, { seed: 3, models });
      const still = scene.spots.filter((s) => !['skiff', 'boat', 'fogBank'].includes(s.kind));
      expect(still.length).toBeGreaterThan(50);
      // Every block built and shown at full detail: the vertices are exactly the placed props'.
      const all = scene.update(0, 0, 0, 1e9, 1e9, Infinity);
      expect(all).toBe(scene.spots.length);
      const meshes: Mesh<BufferGeometry>[] = [];
      scene.group.traverse((o) => {
        if (o instanceof Mesh && o.name === 'road-scenery') meshes.push(o as Mesh<BufferGeometry>);
      });
      expect(meshes.length).toBe(scene.merged().blocks);
      let drawnVerts = 0;
      for (const m of meshes) {
        expect(m.geometry.drawRange.start).toBe(0);
        drawnVerts += m.geometry.drawRange.count;
      }
      let placedVerts = 0;
      for (const s of still) {
        // The renderer's own kind-to-model table, so a new scenery kind needs no entry here.
        const variants = models[MODEL_OF[s.kind]]?.variants;
        expect(variants, s.kind).toBeDefined();
        const g = variants![Math.min(variants!.length - 1, s.variant)]!;
        placedVerts += g.getAttribute('position').count;
      }
      expect(drawnVerts).toBe(placedVerts);
      // Each block holds the props of one SCENERY_BLOCK_M square: no mesh much wider than that.
      for (const m of meshes) {
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!;
        expect(Math.max(b.max.x - b.min.x, b.max.z - b.min.z)).toBeLessThan(SCENERY_BLOCK_M + 60);
      }
      // From the middle of the network: blocks past SCENERY_LOD_M draw their stand-ins.
      const mid = road.toWorld(0, road.edges[0]!.length / 2, 0, 0);
      scene.update(mid.x, mid.z, 0, 1e9, SCENERY_LOD_M, Infinity);
      const c = scene.merged();
      let far = 0;
      for (const m of meshes) if (m.geometry.drawRange.start > 0) far++;
      expect(far).toBe(c.far);
      expect(c.far).toBeGreaterThan(0);
      expect(c.far).toBeLessThan(c.meshes);
      print(
        `[examined] ${id}: ${still.length} still props in ${meshes.length} merged blocks (${placedVerts} vertices, all drawn once); from the middle of edge 0, ${c.meshes} blocks drawn, ${c.far} as far stand-ins, ${Math.round(c.triangles)} triangles`,
      );
      scene.dispose();
    });
  }

  it('builds one block a frame as the camera comes, and frees the blocks left far behind', () => {
    const { road, dressing } = track('pnw-c1');
    const scene = buildRoadScene(road, look, dressing, { seed: 3, models: modelsFor(road, dressing) });
    const at = road.toWorld(0, 20, 0, 0);
    scene.update(at.x, at.z, 0, 360);
    expect(scene.merged().built).toBe(1);
    for (let i = 0; i < 40; i++) scene.update(at.x, at.z, 0, 360);
    const near = scene.merged().built;
    expect(near).toBeGreaterThan(1);
    expect(near).toBeLessThan(scene.merged().blocks);
    // Far away: nothing in range, and everything built here is freed.
    scene.update(at.x + 5000, at.z + 5000, 0, 360);
    expect(scene.merged().built).toBe(0);
    expect(scene.merged().meshes).toBe(0);
    print(
      `[examined] pnw-c1: ${near} of ${scene.merged().blocks} blocks built near the start, 0 after leaving`,
    );
    scene.dispose();
  });
});

// Roadmap M5 (playtest 4 run C, punch item 9): a lower quality tier draws only a share of the trees
// (quality.ts `treeShare`), ranked by where each stands, and never thins a building. A share is still
// one draw range per block, near or far, so the layout must hold exactly the right props in it.
describe("a quality tier's share of the trees", () => {
  const box = new BoxGeometry(1, 1, 1);
  const mat = new MeshBasicMaterial();
  /** Ten houses and forty trees in one block, 3 m apart along x: a triangle's prop is its x / 3. */
  const items: MergeItem[] = Array.from({ length: 50 }, (_, i) => ({
    spot: {
      kind: i % 5 === 0 ? 'house' : 'conifer',
      variant: 0,
      p: { x: 3 * i + 0.5, y: 0, z: 0.5 },
      turn: 0,
      size: 1,
      phase: 0,
      edge: 0,
      s: 0,
      d: 0,
    },
    geometry: box,
    material: mat,
  }));
  /** The props whose triangles the block's draw range holds, by index. */
  const drawnProps = (merged: MergedScenery): Set<number> => {
    const mesh = merged.group.children[0] as Mesh;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const out = new Set<number>();
    if (!mesh.visible) return out;
    for (let v = g.drawRange.start; v < g.drawRange.start + g.drawRange.count; v++)
      out.add(Math.floor(pos.getX(v) / 3));
    return out;
  };
  const expected = (share: number) =>
    items.flatMap((it, i) =>
      THINNABLE_KINDS.has(it.spot.kind) && thinRank(it.spot.p.x, it.spot.p.z) >= share ? [] : [i],
    );

  for (const pass of ['near', 'far'] as const) {
    it(`draws every building and only the trees ranked under the share (${pass})`, () => {
      const merged = new MergedScenery(items);
      const lodM = pass === 'near' ? 1e9 : -1e9;
      const seen: number[] = [];
      for (const share of [1, 0.7, 0.4, 0]) {
        const props = merged.update(0, 0, 1e9, lodM, 1, share);
        const drawn = [...drawnProps(merged)].sort((a, b) => a - b);
        expect(drawn).toEqual(expected(share));
        expect(props).toBe(drawn.length);
        seen.push(drawn.length);
      }
      // Every tier's trees are a subset of the next tier's, and the houses always stand.
      expect(seen[0]).toBe(50);
      expect(seen[3]).toBe(10);
      expect(seen[1]!).toBeGreaterThan(seen[2]!);
      expect(seen[2]!).toBeGreaterThan(seen[3]!);
      print(
        `[examined] one block of 10 houses and 40 trees, ${pass}: props drawn at shares 1, 0.7, 0.4, 0: ${seen.join(', ')}`,
      );
      merged.dispose();
    });
  }

  it('at a share of 1 draws the whole near run or the whole far run, as before tiers', () => {
    const merged = new MergedScenery(items);
    merged.update(0, 0, 1e9, 1e9, 1);
    const g = (merged.group.children[0] as Mesh).geometry;
    const nearN = items.reduce((n, it) => n + formsOf(it.geometry).near.n, 0);
    const farN = items.reduce((n, it) => n + formsOf(it.geometry).far.n, 0);
    expect([g.drawRange.start, g.drawRange.count]).toEqual([0, nearN]);
    merged.update(0, 0, 1e9, -1e9, 1);
    expect([g.drawRange.start, g.drawRange.count]).toEqual([nearN, farN]);
    merged.dispose();
  });
});
