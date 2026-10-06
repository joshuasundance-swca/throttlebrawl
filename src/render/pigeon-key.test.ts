// Pigeon Key (playtest 4, P4-19: "The real roads do not have the characteristics of the roads in
// question"; the identity study's fix 10, S1): the little island under the old Seven Mile Bridge,
// with the kit's two yellow cottages and its dock. The rules this file asks, whatever the numbers
// are: the island stands on land of its own, never on the water or on a road; its buildings stand
// on that land; it stays inside the box the bake gave it (which the roadside keeps off); boats and
// islets float clear of it; and the kit's one file serves both the bays and the island whichever
// loads first.
import type { BufferAttribute, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import type { AssetManifest } from '../assets';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { BAY_ROOTS } from './bridge-bays';
import { LANDMARK_MID_M, LandmarkLayer, landmarkKitsFor, landmarkPlacements } from './landmarks';
import { createFlatLook } from './look';
import { loadLandmarkKits, loadSceneryModels, type LandmarkKit } from './models';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { pigeonKeyPlan } from './pigeon-key';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);
const look = createFlatLook();

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});

function sevenMile(stripLandmarks = false): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === 'osm-keys-seven-mile');
  if (!network) throw new Error('no osm-keys-seven-mile network');
  const roads = Object.values(roadFiles)
    .filter((r) => network.roads.includes(r.id))
    .map((r) =>
      stripLandmarks ? { ...r, features: (r.features ?? []).filter((f) => f.kind !== 'landmark') } : r,
    );
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/** The shipped files, loaded the way the asset manifest does: each id once, later callers share the first result. */
function fileManifest(): AssetManifest {
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    entries: () => [],
    resolve: () => null,
    progress: () => ({ total: 0, done: 0, fellBack: 0, bytesLoaded: 0, bytesTotal: 0, perAsset: {} }),
    onProgress: () => () => undefined,
    load<T>(id: string, standIn: () => T, o?: { decode?: (data: ArrayBuffer) => T | Promise<T> }) {
      const running = inFlight.get(id);
      if (running) return running as Promise<never>;
      const p = (async () => {
        const mod: string = 'node:fs';
        const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
        const buf = fs.readFileSync(`packs/base/assets/${id}.glb`);
        const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        const value = o?.decode ? await o.decode(data) : standIn();
        return { id, source: 'baked' as const, value, fellBack: false };
      })();
      inFlight.set(id, p);
      return p as Promise<never>;
    },
  };
}

async function seaKit(): Promise<LandmarkKit> {
  const kits = await loadLandmarkKits(fileManifest(), ['seven-mile-kit']);
  const kit = kits.get('seven-mile-kit');
  if (!kit) throw new Error('the seven-mile-kit landmark kit did not load');
  return kit;
}

describe('the Seven Mile kit, one file for the bays and for Pigeon Key', () => {
  for (const order of ['scenery first', 'landmarks first'] as const) {
    it(`serves both whichever loads first (${order})`, async () => {
      const manifest = fileManifest();
      const scenery = () => loadSceneryModels(manifest, ['sevenMileKit']);
      const kits = () => loadLandmarkKits(manifest, ['seven-mile-kit']);
      const [a, b] =
        order === 'scenery first' ? [await scenery(), await kits()] : [await kits(), await scenery()];
      const models = order === 'scenery first' ? a : b;
      const landmark = (order === 'scenery first' ? b : a) as Awaited<ReturnType<typeof kits>>;
      const bays = (models as Awaited<ReturnType<typeof scenery>>).models.sevenMileKit;
      expect(bays?.variants, 'the bays still bake, one variant per root').toHaveLength(BAY_ROOTS.length);
      const kit = landmark.get('seven-mile-kit');
      expect(kit, 'the landmark kit').toBeDefined();
      for (const node of ['pigeon_key_cottage_a', 'pigeon_key_cottage_b', 'pigeon_key_dock'])
        expect(kit?.nodes.has(node), node).toBe(true);
    });
  }
});

describe('Pigeon Key on the old Seven Mile Bridge', () => {
  const { road } = sevenMile();
  const placement = landmarkPlacements(road).find((p) => p.node === 'pigeon_key');

  it('is placed by the bake beside the old road, on the side the new highway is', () => {
    expect(placement, 'the bake places Pigeon Key').toBeDefined();
    expect(placement?.kit).toBe('seven-mile-kit');
    expect(landmarkKitsFor(road)).toContain('seven-mile-kit');
    const f = placement?.feature;
    expect((f?.d0 ?? 0) + (f?.d1 ?? 0), 'a left-hand landmark: the new highway is on the left').toBeLessThan(
      0,
    );
  });

  it('is drawn in the one landmark call, from down the old road, and gone past the layer`s reach', async () => {
    if (!placement) throw new Error('no placement');
    const kit = await seaKit();
    // Fred (on the same network) is composed in code and needs only his kit to be loaded; the highway's
    // mile posts are another file's business (mile-posts.test.ts), so their kit is left out here.
    const fredsKit: LandmarkKit = { id: 'keys-landmarks', nodes: new Map(), doubleSided: false };
    const layer = new LandmarkLayer(
      new Map([
        ['seven-mile-kit', kit],
        ['keys-landmarks', fredsKit],
      ]),
      look,
      { road },
    );
    const posts = landmarkPlacements(road).filter((p) => p.kit === 'keys-identity').length;
    expect(layer.counts().skipped, 'only the mile posts are left out').toBe(posts);
    expect(layer.counts().placed).toBe(2);
    layer.update(placement.x - 300, placement.z);
    expect(layer.counts().drawCalls).toBe(1);
    expect(layer.counts().trianglesDrawn).toBeGreaterThan(500);
    layer.update(placement.x + LANDMARK_MID_M + 500, placement.z);
    expect(layer.counts().drawCalls).toBe(0);
  });

  it('stands on land of its own: above the sea, inside its box, clear of every road, its buildings on it', async () => {
    if (!placement) throw new Error('no placement');
    const kit = await seaKit();
    const layer = new LandmarkLayer(new Map([['seven-mile-kit', kit]]), look, { road });
    layer.update(placement.x, placement.z);
    const mesh = layer.group.children[0] as Mesh;
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const f = placement.feature;
    // The box in road terms: along and across the road at the footprint's middle.
    const sMid = (f.s0 + f.s1) / 2;
    const dMid = (f.d0 + f.d1) / 2;
    const c = road.toWorld(placement.edge, sMid, dMid, 0);
    const t = road.frameAt(placement.edge, sMid);
    const o = road.toWorld(placement.edge, sMid, dMid + 1, 0);
    const nx = o.x - c.x;
    const nz = o.z - c.z;
    const along = (x: number, z: number) => (x - c.x) * t.tx + (z - c.z) * t.tz;
    const across = (x: number, z: number) => (x - c.x) * nx + (z - c.z) * nz;
    // The island's own vertices: the ones within its box's reach (Fred stands kilometres away).
    const mine: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      const v = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
      if (Math.hypot(v.x - c.x, v.z - c.z) < 120) mine.push(v);
    }
    expect(mine.length).toBeGreaterThan(300);
    // 1. Inside the footprint the bake gave it: the roadside, scenery and scenes keep off that box.
    const halfAlong = (f.s1 - f.s0) / 2;
    const halfAcross = Math.abs(f.d1 - f.d0) / 2;
    let outside = 0;
    for (const v of mine)
      if (Math.abs(along(v.x, v.z)) > halfAlong + 0.01 || Math.abs(across(v.x, v.z)) > halfAcross + 0.01)
        outside++;
    expect(outside, 'vertices outside the feature`s box').toBe(0);
    // 2. Clear of every road: its nearest vertex is well past the nearest road's outer edge.
    let nearest = Infinity;
    for (const e of road.edges) {
      const reach = Math.max(-e.dMin, e.dMax) + 0.6;
      for (let i = 0; i < e.count; i++) {
        const ex = e.x[i] ?? 0;
        const ez = e.z[i] ?? 0;
        if (Math.hypot(ex - c.x, ez - c.z) > 400) continue;
        for (const v of mine) nearest = Math.min(nearest, Math.hypot(ex - v.x, ez - v.z) - reach);
      }
    }
    print(`Pigeon Key: ${mine.length} vertices, nearest road edge ${nearest.toFixed(1)} m from any of them`);
    expect(nearest).toBeGreaterThan(10);
    // 3. Land: its ground rises above the waterline and sinks below it at the rim (the sand is a shore,
    // not a floating plate), under the old deck, never touching it.
    const top = Math.max(...mine.filter((v) => v.y < 1.2).map((v) => v.y));
    const low = Math.min(...mine.map((v) => v.y));
    print(`Pigeon Key ground tops out ${top.toFixed(2)} m over the sea; lowest vertex ${low.toFixed(2)} m`);
    expect(top).toBeGreaterThan(0.4);
    expect(low).toBeLessThan(-0.2);
    // 4. The buildings stand on it: each cottage's footprint corners lie inside the island's top, and
    // the dock begins on the island and ends over the water.
    const plan = pigeonKeyPlan(kit);
    for (const b of plan.buildings.filter((x) => x.node !== 'pigeon_key_dock')) {
      for (const [x, z] of b.corners)
        expect(
          plan.insideTop(x, z),
          `${b.node} corner (${x.toFixed(1)}, ${z.toFixed(1)}) on the island`,
        ).toBe(true);
      expect(b.baseY, `${b.node} sits on the island's top`).toBeGreaterThanOrEqual(plan.topY - 0.05);
    }
    const dock = plan.buildings.find((x) => x.node === 'pigeon_key_dock');
    expect(dock, 'the dock').toBeDefined();
    if (dock) {
      const onLand = dock.corners.filter(([x, z]) => plan.insideLand(x, z)).length;
      expect(onLand, 'the dock starts on the island').toBeGreaterThan(0);
      expect(onLand, 'and ends over the water').toBeLessThan(dock.corners.length);
    }
    // 5. The cottages face the road: the dock points away from it, out to the open water.
    const cottage = plan.buildings.find((x) => x.node === 'pigeon_key_cottage_a');
    if (dock && cottage)
      expect(dock.centre[0], 'the dock is farther from the road').toBeGreaterThan(cottage.centre[0]);
    layer.dispose();
  });
});

describe('boats and islets keep off Pigeon Key', () => {
  const KEEP_M = 8;
  /** The boats, skiffs and islets of a scene that float within `m` of the island's box. */
  function intrusions(strip: boolean, seeds: readonly number[], m: number): number {
    const { road, dressing } = sevenMile(strip);
    const real = sevenMile();
    const placement = landmarkPlacements(real.road).find((p) => p.node === 'pigeon_key');
    if (!placement) throw new Error('no placement');
    const f = placement.feature;
    const sMid = (f.s0 + f.s1) / 2;
    const dMid = (f.d0 + f.d1) / 2;
    const c = real.road.toWorld(placement.edge, sMid, dMid, 0);
    const t = real.road.frameAt(placement.edge, sMid);
    const o = real.road.toWorld(placement.edge, sMid, dMid + 1, 0);
    const nx = o.x - c.x;
    const nz = o.z - c.z;
    let n = 0;
    for (const seed of seeds) {
      const scene = buildRoadScene(road, look, dressing, { seed });
      for (const sp of scene.spots) {
        if (!['skiff', 'boat', 'islet'].includes(sp.kind)) continue;
        const a = (sp.p.x - c.x) * t.tx + (sp.p.z - c.z) * t.tz;
        const d = (sp.p.x - c.x) * nx + (sp.p.z - c.z) * nz;
        if (Math.abs(a) < (f.s1 - f.s0) / 2 + m && Math.abs(d) < Math.abs(f.d1 - f.d0) / 2 + m) n++;
      }
      scene.dispose();
    }
    return n;
  }
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);

  it('floats nothing within a few metres of the island, whatever the seed', () => {
    const n = intrusions(false, seeds, KEEP_M);
    print(`${seeds.length} seeds: ${n} boats, skiffs or islets within ${KEEP_M} m of the island`);
    expect(n).toBe(0);
  });

  it('would, without the rule (the control: the same scatter with the island`s feature taken out)', () => {
    const n = intrusions(true, seeds, KEEP_M);
    print(`control, no landmark features: ${n} within ${KEEP_M} m`);
    expect(n).toBeGreaterThan(0);
  });
});
