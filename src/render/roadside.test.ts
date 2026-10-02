// Roadside density (run W-P, "fill the world"; the maintainer, 2026-10-01b: "the worlds just feel
// very empty"). The checks build the real networks with their real road files and the real kit GLBs,
// then look at what was placed and drawn: every prop on the drawn land at its height (never on a
// road, a bridge or the water), the same scatter for the same seed, props close to the road at a
// density that reads at speed, every kind of prop the region's kit has, and a frame's cost as the
// camera rides the road.
import { Frustum, Matrix4, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { readGlb } from './glb';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { bakeModel, MODEL_ASSETS, modelKindsFor, type ModelKind, type SceneryModel } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import {
  KEYS_KIT,
  PNW_KIT,
  ROADSIDE_DRAW_M,
  RoadsideLayer,
  RoadsideScatter,
  scatterRoadside,
  SF_KIT,
  type RoadsideInput,
  type RoadsideItem,
  type RoadsideKit,
} from './roadside';
import { themeAt, type SideTheme } from './scenery';

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

async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(rel);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function kitModel(kind: ModelKind): Promise<SceneryModel> {
  return bakeModel(kind, readGlb(await readRepoFile(`packs/base/assets/${MODEL_ASSETS[kind]}.glb`)));
}

/** Each region's kit, its model, the land its props line, and the floors its roads must clear. */
interface RegionCase {
  region: string;
  kit: RoadsideKit;
  model: SceneryModel;
  networks: readonly string[];
  /** The themes whose land sides the near-road density is measured over. */
  themes: readonly SideTheme[];
  /** Props per 100 m of such land side, anchored within 4 m of the verge. */
  minNearPer100: number;
  /** Rules that place somewhere on every network, and on at least one. */
  everywhere: readonly string[];
  somewhere: readonly string[];
}

const REGIONS: RegionCase[] = [
  {
    region: 'the Pacific Northwest',
    kit: PNW_KIT,
    model: await kitModel('pnwRoadside'),
    networks: ['pnw-c1', 'osm-pnw-chuckanut', 'osm-pnw-gorge'],
    themes: ['forest', 'sawmill'],
    minNearPer100: 12,
    everywhere: [
      'fern',
      'salal',
      'verge',
      'stump',
      'broadleaf',
      'mailbox',
      'firewood',
      'split-rail',
      'log-fence',
    ],
    somewhere: ['sign', 'espresso', 'espresso-town'],
  },
  {
    region: 'San Francisco',
    kit: SF_KIT,
    model: await kitModel('sfRoadside'),
    networks: ['sf-hills', 'osm-sf-russian-hill', 'osm-sf-twin-peaks'],
    themes: ['urban', 'industrial'],
    minNearPer100: 8,
    everywhere: ['street-tree', 'meter', 'lamp', 'hydrant', 'scooter', 'bins'],
    somewhere: ['parked', 'board', 'store'],
  },
  {
    region: 'the Florida Keys',
    kit: KEYS_KIT,
    model: await kitModel('keysRoadside'),
    networks: ['keys-m1', 'osm-keys-bahia-honda'],
    themes: ['palms', 'beach', 'mangrove', 'commercial'],
    minNearPer100: 8,
    everywhere: ['seagrape', 'seagrape-tree', 'traps', 'trailer', 'pelican'],
    somewhere: ['cottage', 'picket', 'mailbox', 'bait', 'pie'],
  },
];

function scene(id: string, seed: number, kit: RoadsideKit) {
  const { road, dressing } = track(id);
  const built = buildRoadScene(road, look, dressing, { seed });
  const input: RoadsideInput = {
    road,
    dressing,
    seed,
    density: 1,
    kit,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
  };
  return { road, dressing, built, input };
}

for (const rc of REGIONS) {
  const placedSomewhere = new Map<string, number>();

  describe.each(rc.networks)(`${rc.region}'s roadside on %s`, (id) => {
    const { road, dressing, built, input } = scene(id, 7, rc.kit);
    const items = scatterRoadside(input);
    const ground = new GroundTris(built.group);
    for (const it of items) placedSomewhere.set(it.rule, (placedSomewhere.get(it.rule) ?? 0) + 1);

    it('stands every prop on the drawn land at its height, never on a road, a bridge or the water', () => {
      const bad: string[] = [];
      let points = 0;
      for (const it of items) {
        const e = road.edges[it.edge]!;
        const rule = rc.kit.rules.find((r) => r.id === it.rule)!;
        const tags = dressing[e.id]?.tags ?? [];
        if (tags.some((t) => t.tag === 'bridge' && it.s >= t.s0 - 5 && it.s <= t.s1 + 5))
          bad.push(`${it.rule} on the ${e.id} bridge at s ${it.s.toFixed(0)}`);
        // The anchor, and a long or deep prop's far points (a fence's ends, a car's and a store's back).
        const pts = [it.p];
        const out = Math.sign(it.d);
        const along = (rule.along ?? 0) * 0.95;
        if (along > rule.r)
          for (const u of [-along, along]) pts.push(road.toWorld(e.index, it.s + u, it.d, -0.09));
        const back = (rule.back ?? 0) * 0.95;
        if (back > rule.r) pts.push(road.toWorld(e.index, it.s, it.d + out * back, -0.09));
        for (const p of pts) {
          points++;
          const hit = ground.heightAt(p.x, p.z, p.y + 40);
          const ok = hit?.name.startsWith('road-land') && Math.abs(hit.y - p.y) < 0.35;
          if (!ok) {
            bad.push(
              `${it.rule} on ${e.id} s ${it.s.toFixed(0)} d ${it.d.toFixed(1)}: ${hit?.name ?? 'sea'} at ${hit?.y.toFixed(2)} vs ${p.y.toFixed(2)}`,
            );
            break;
          }
        }
      }
      print(`[examined] ${id}: ${items.length} props, ${points} points ray-checked onto drawn land`);
      expect(items.length).toBeGreaterThan(300);
      expect(bad.slice(0, 10)).toEqual([]);
    });

    it('scatters by the seed: the same seed places the same props, another seed others', () => {
      const again = scatterRoadside(input);
      expect(again).toEqual(items);
      // Sliced over frames (one unit at a time, as a race start spreads it), the props are the same.
      const sliced = new RoadsideScatter(input);
      let steps = 0;
      while (!sliced.done) {
        sliced.step(0);
        steps++;
      }
      expect(sliced.items).toEqual(items);
      expect(steps).toBeGreaterThan(road.edges.length);
      const other = scatterRoadside({ ...input, seed: 8 });
      const key = (i: RoadsideItem) => `${i.rule}@${i.edge}:${i.s.toFixed(1)}`;
      const a = new Set(items.map(key));
      const shared = other.filter((i) => a.has(key(i))).length;
      print(
        `[examined] ${id}: seed 7 ${items.length} props, seed 8 ${other.length}, ${shared} in the same spot`,
      );
      // Plot-bound props (meters, cars, stores) share their plots' exact spots across seeds.
      expect(shared / other.length).toBeLessThan(0.35);
    });

    it('lines the road densely enough to read at speed, with every kind of prop the kit has', () => {
      let sideM = 0;
      for (const e of road.edges)
        for (const side of [-1, 1] as const)
          for (let s = 1; s < e.length; s += 2) {
            const th = themeAt(dressing[e.id]?.tags, side < 0 ? 'left' : 'right', s);
            if (rc.themes.includes(th) && built.landReach(e.index, side, s) >= 6) sideM += 2;
          }
      let near = 0;
      for (const it of items) {
        const e = road.edges[it.edge]!;
        const outer = it.d < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
        if (Math.abs(it.d) - outer <= 4) near++;
      }
      const per100 = (near / Math.max(1, sideM)) * 100;
      const kinds = new Map<string, number>();
      for (const it of items) kinds.set(it.rule, (kinds.get(it.rule) ?? 0) + 1);
      print(
        `[examined] ${id}: ${sideM} m of land side, ${near} props within 4 m of the verge (${per100.toFixed(1)} per 100 m); ` +
          [...kinds].map(([k, n]) => `${k} ${n}`).join(', '),
      );
      expect(per100).toBeGreaterThan(rc.minNearPer100);
      for (const k of rc.everywhere) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(0);
    });

    it('costs a few merged draws and a few thousand triangles wherever the camera rides', () => {
      const layer = new RoadsideLayer(rc.model, look, input);
      while (!layer.ready) layer.update(0, 0, 360);
      // The phone's chase view (camera/: 8 m back and 3.2 m up on a 915x412 screen, 18 m look-ahead).
      const camera = new PerspectiveCamera(64, 915 / 412, 0.3, 760);
      const frustum = new Frustum();
      const meshes: number[] = [];
      const tris: number[] = [];
      for (const e of road.edges)
        for (let s = 8; s < e.length - 18; s += 40) {
          const eye = road.toWorld(e.index, s - 8, 2, 3.2);
          const aim = road.toWorld(e.index, s + 18, 2, 0.9);
          camera.position.set(eye.x, eye.y, eye.z);
          camera.lookAt(aim.x, aim.y, aim.z);
          camera.updateMatrixWorld(true);
          frustum.setFromProjectionMatrix(
            new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
          );
          // Settle the streaming: one stretch a frame is built.
          for (let k = 0; k < 16; k++) layer.update(eye.x, eye.z, 360);
          let n = 0;
          let t = 0;
          for (const o of layer.group.children) {
            const m = o as Mesh;
            if (!m.visible || !frustum.intersectsObject(m)) continue;
            n++;
            t += m.geometry.drawRange.count / 3;
          }
          meshes.push(n);
          tris.push(t);
        }
      const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
      const p95 = (xs: number[]) => sorted(xs)[Math.floor(xs.length * 0.95)] ?? 0;
      const c = layer.counts();
      print(
        `[examined] ${id}: ${meshes.length} chase-camera spots; roadside draws max ${Math.max(...meshes)}, p95 ${p95(meshes)}; ` +
          `triangles max ${Math.max(...tris)}, p95 ${p95(tris)}; ${c.chunks} stretches, ${c.built} built at the end`,
      );
      // Regression guards from the measured chase views (2026-10-02: p95 draws 3 to 8, p95 triangles
      // up to 11.6k; the Gorge's stacked loops are the worst case).
      expect(Math.max(...meshes)).toBeLessThanOrEqual(10);
      expect(p95(meshes)).toBeLessThanOrEqual(8);
      expect(p95(tris)).toBeLessThan(13000);
      // Stretches far behind are freed: memory does not grow with the road.
      expect(c.built).toBeLessThan(c.chunks);
      layer.dispose();
      built.dispose();
    });
  });

  it(`${rc.region}'s rarer props each turn up on one of its roads`, () => {
    print(`[examined] ${rc.region}: ${[...placedSomewhere].map(([k, n]) => `${k} ${n}`).join(', ')}`);
    for (const k of rc.somewhere) expect(placedSomewhere.get(k) ?? 0, k).toBeGreaterThan(0);
  });
}

describe('the roadside kits', () => {
  const needs = (id: string, palette: string[] = []) => {
    const { road, dressing } = track(id);
    const { tropical, tags } = networkTags(road, dressing);
    return modelKindsFor({ tropical, tags, palette: new Set(palette), traffic: [] });
  };

  it("load only for their own region's roads", () => {
    for (const id of ['pnw-c1', 'osm-pnw-chuckanut', 'osm-pnw-gorge']) {
      expect(needs(id), id).toContain('pnwRoadside');
      expect(needs(id), id).not.toContain('sfRoadside');
    }
    for (const id of ['sf-hills', 'osm-sf-russian-hill', 'osm-sf-twin-peaks']) {
      expect(needs(id), id).toContain('sfRoadside');
      expect(needs(id), id).not.toContain('pnwRoadside');
    }
    for (const id of ['keys-m1', 'osm-keys-bahia-honda']) {
      expect(needs(id), id).toContain('keysRoadside');
      expect(needs(id), id).not.toContain('pnwRoadside');
      expect(needs(id), id).not.toContain('sfRoadside');
    }
    for (const id of ['pnw-c1', 'sf-hills']) expect(needs(id), id).not.toContain('keysRoadside');
  });

  it('draws the far stretches with their big props only, and nothing past the draw distance', () => {
    const pnw = REGIONS[0]!;
    const { road, input } = scene('pnw-c1', 7, pnw.kit);
    const layer = new RoadsideLayer(pnw.model, look, input);
    while (!layer.ready) layer.update(0, 0, 360);
    const e = road.edges.find((x) => x.id === 'pnw-cedar-hollow')!;
    const p = road.toWorld(e.index, 600, 0, 0);
    for (let k = 0; k < 16; k++) layer.update(p.x, p.z, 360);
    const meshes = layer.group.children.filter((o) => o.visible) as Mesh[];
    const near = new Vector3(p.x, 0, p.z);
    let thinned = 0;
    for (const m of meshes) {
      const g = m.geometry;
      const all = g.getAttribute('position').count;
      const sphere = g.boundingSphere!;
      const dist = sphere.center.clone().setY(0).distanceTo(near) - sphere.radius;
      expect(dist).toBeLessThan(ROADSIDE_DRAW_M + 1);
      if (g.drawRange.count < all) thinned++;
    }
    print(
      `[examined] pnw-c1 at cedar hollow s 600: ${meshes.length} stretches shown, ${thinned} thinned to fewer props`,
    );
    expect(meshes.length).toBeGreaterThan(0);
    expect(thinned).toBeGreaterThan(0);
    layer.dispose();
  });
});
