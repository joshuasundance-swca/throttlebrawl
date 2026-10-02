// Playtest 1c (2026-09-30), items 2 to 4: the Blender models in the game. Scenery stands on land or
// the verge only, never on a bridge, the road or the water ("in concrete floating in the river
// lol"); the scatter derives from the race's seed; boats bob offshore; the ramp truck is the
// maintainer's pick, lined up with the sim's ramp. The checks build the real tracks with their real
// road files (as app/ does) and look at what was built: rays straight down onto each spot, the
// instanced matrices, and the real GLBs baked the way the browser bakes them.
import { InstancedMesh, Matrix4, Mesh, Raycaster, Vector3, type BufferGeometry, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { createFlatLook } from './look';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createAssetManifest } from '../assets';
import { assetIndex, loadBasePack } from '../content';
import { readGlb } from './glb';
import {
  bakeModel,
  loadSceneryModels,
  MODEL_ASSETS,
  MODEL_KINDS,
  type ModelKind,
  type SceneryModels,
} from './models';
import { buildRoadScene, rampTruckMatrix, type FeatureSpan, type RoadDressing } from './road-mesh';
import { SCENERY_KINDS, themeAt } from './scenery';

const look = createFlatLook();

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
/** The GLBs the build ships (the same glob the content module hands the asset manifest). */
const glbFiles = import.meta.glob<string>('/packs/base/assets/models/**/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
});
/** Reads a repo file in the test runner (Node); the app's own types have no Node, so it is untyped here. */
async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as {
    readFileSync(p: string): Uint8Array;
  };
  const buf = fs.readFileSync(rel.replace(/^\//, ''));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

async function glbOf(kind: ModelKind): Promise<ArrayBuffer> {
  const key = `/packs/base/assets/${MODEL_ASSETS[kind]}.glb`;
  if (!glbFiles[key]) throw new Error(`no GLB for ${kind}`);
  return readRepoFile(key);
}

/** The models as the game bakes them: the game's own GLB reader. */
async function realModels(): Promise<SceneryModels> {
  const out: SceneryModels = {};
  for (const kind of MODEL_KINDS) out[kind] = bakeModel(kind, readGlb(await glbOf(kind)));
  return out;
}

/** The same models read by three's full GLTFLoader (the reference; test-only, not in the build). */
async function referenceModels(): Promise<SceneryModels> {
  const out: SceneryModels = {};
  for (const kind of MODEL_KINDS) {
    const data = await glbOf(kind);
    const scene = await new Promise<Object3D>((resolve, reject) =>
      new GLTFLoader().parse(data, '', (g) => resolve(g.scene), reject),
    );
    out[kind] = bakeModel(kind, scene);
  }
  return out;
}

function solids(group: Object3D, keep: (name: string) => boolean): Object3D[] {
  const out: Object3D[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o instanceof Mesh && keep(o.name)) out.push(o);
  });
  return out;
}

/** What a ray straight down from 60 m above a point meets first among the given meshes. */
function under(objs: Object3D[], x: number, z: number, top = 60): string | null {
  const ray = new Raycaster(new Vector3(x, top, z), new Vector3(0, -1, 0), 0, 200);
  return ray.intersectObjects(objs, false)[0]?.object.name ?? null;
}

const LAND_KINDS = new Set(['palm', 'mangrove', 'shack', 'pole', 'conifer', 'house', 'sawmill']);

describe('scenery tags to themes (docs/content-packs.md, scenery tags)', () => {
  it('reads water over land, no land on a bridge alone, and palm land when a road has no tags', () => {
    const tags = [
      { s0: 0, s1: 100, side: 'left', tag: 'water-shallow' },
      { s0: 0, s1: 100, side: 'both', tag: 'mangrove' },
      { s0: 100, s1: 200, side: 'both', tag: 'bridge' },
      { s0: 100, s1: 200, side: 'both', tag: 'water-open' },
      { s0: 200, s1: 300, side: 'both', tag: 'causeway' },
      { s0: 300, s1: 400, side: 'right', tag: 'forest' },
      { s0: 300, s1: 400, side: 'right', tag: 'fog' },
    ];
    expect(themeAt(tags, 'left', 50)).toBe('water');
    expect(themeAt(tags, 'right', 50)).toBe('mangrove');
    expect(themeAt(tags, 'right', 150)).toBe('water');
    expect(themeAt(tags, 'right', 250)).toBe('none');
    expect(themeAt(tags, 'right', 350)).toBe('forest');
    expect(themeAt(tags, 'left', 350)).toBe('none');
    expect(themeAt([], 'left', 10)).toBe('palms');
    expect(themeAt(undefined, 'right', 10)).toBe('palms');
  });
});

describe.each(['keys-m1', 'osm-keys-bahia-honda', 'pnw-c1', 'sf-hills'])('scenery on %s', (id) => {
  const { road, dressing } = track(id);
  const built = buildRoadScene(road, look, dressing, { seed: 7 });
  const { spots, stats } = built;
  const land = spots.filter((s) => LAND_KINDS.has(s.kind));
  const boats = spots.filter((s) => !LAND_KINDS.has(s.kind));
  const ground = solids(built.group, (n) =>
    /^road-(land|water|road|shoulder|shortcut|deck|marking|splitZone|rampMark|boost)/.test(n),
  );
  const counts = SCENERY_KINDS.map((k) => `${k} ${stats.scenery[k]}`).join(', ');

  it('stands on drawn land, beside a land-tagged side, never on a bridge, the road or the water', () => {
    console.log(
      `[examined] ${id}: ${spots.length} spots (${counts}); ${Math.round(stats.sceneryLandM)} m of tagged land side`,
    );
    let checked = 0;
    for (const s of land) {
      const e = road.edges[s.edge]!;
      const side = s.d < 0 ? 'left' : 'right';
      const theme = themeAt(dressing[e.id]?.tags, side, s.s);
      expect(['none', 'water'], `${s.kind} at ${e.id} s ${s.s.toFixed(0)}: ${theme}`).not.toContain(theme);
      expect(['none', 'water'], `${e.id}`).not.toContain(theme);
      // What is under the spot: land, never the sea, a deck or a road surface.
      const hit = under(ground, s.p.x, s.p.z, s.p.y + 30);
      expect(hit, `${s.kind} at ${e.id} s ${s.s.toFixed(0)} d ${s.d.toFixed(1)}`).toBe('road-land');
      checked++;
    }
    console.log(`[examined] ${id}: ${checked} land spots ray-checked onto road-land`);
  });

  it("keeps clear of every road's drawn surface", () => {
    for (const s of spots) {
      let closest = Infinity;
      for (const e of road.edges) {
        for (let k = 0; k < e.count; k++) {
          const dx = s.p.x - (e.x[k] ?? 0);
          const dz = s.p.z - (e.z[k] ?? 0);
          closest = Math.min(closest, Math.hypot(dx, dz) - (Math.max(-e.dMin, e.dMax) + 0.6));
        }
      }
      expect(closest, `${s.kind} at ${s.p.x.toFixed(1)}, ${s.p.z.toFixed(1)}`).toBeGreaterThan(1);
    }
  });

  it('floats its boats on open water, clear of land and roads', () => {
    for (const b of boats) {
      const e = road.edges[b.edge]!;
      expect(themeAt(dressing[e.id]?.tags, b.d < 0 ? 'left' : 'right', b.s)).toBe('water');
      expect(b.p.y).toBe(0);
      expect(under(ground, b.p.x, b.p.z), `${b.kind} at ${b.p.x.toFixed(0)}, ${b.p.z.toFixed(0)}`).toBe(
        'road-water',
      );
    }
    console.log(`[examined] ${id}: ${boats.length} boats ray-checked onto open water`);
  });
});

describe('scenery by theme', () => {
  it('puts palms and shacks on the Keys, mangroves on mangrove sides, and no palms or mangroves in the PNW or SF', () => {
    const keys = track('keys-m1');
    const k = buildRoadScene(keys.road, look, keys.dressing).stats.scenery;
    expect(k.palm).toBeGreaterThan(100);
    expect(k.mangrove).toBeGreaterThan(50);
    expect(k.shack).toBeGreaterThan(3);
    expect(k.pole).toBeGreaterThan(20);
    expect(k.skiff + k.boat).toBeGreaterThan(10);
    const pnw = track('pnw-c1');
    const p = buildRoadScene(pnw.road, look, pnw.dressing).stats.scenery;
    expect(p.palm + p.mangrove).toBe(0);
    const sf = track('sf-hills');
    const f = buildRoadScene(sf.road, look, sf.dressing).stats.scenery;
    expect(f.palm + f.mangrove).toBe(0);
    expect(p.pole).toBeGreaterThan(10);
    console.log(
      `[examined] keys-m1 palm ${k.palm}, mangrove ${k.mangrove}, shack ${k.shack}, pole ${k.pole}, boats ${k.skiff + k.boat}; pnw-c1 palm ${p.palm}, pole ${p.pole}`,
    );
  });
});

describe('the seed (playtest 1c item 2: "I want randomness")', () => {
  const { road, dressing } = track('keys-m1');
  const at = (seed: number) =>
    buildRoadScene(road, look, dressing, { seed }).spots.map(
      (s) => `${s.kind}@${s.p.x.toFixed(2)},${s.p.z.toFixed(2)}`,
    );

  it('repeats a fixed seed exactly and moves the scenery for another seed', () => {
    const a = at(1);
    expect(at(1)).toEqual(a);
    const b = at(2);
    const same = b.filter((x) => new Set(a).has(x)).length;
    console.log(`[examined] seed 1: ${a.length} spots, seed 2: ${b.length} spots, ${same} in the same place`);
    expect(same / Math.max(a.length, b.length)).toBeLessThan(0.05);
    // The land itself does not move with the seed: only what stands on it.
    expect(buildRoadScene(road, look, dressing, { seed: 2 }).stats.sceneryLandM).toBe(
      buildRoadScene(road, look, dressing, { seed: 1 }).stats.sceneryLandM,
    );
  });

  it('density 0 places nothing, and more density places more', () => {
    expect(buildRoadScene(road, look, dressing, { roadsideDensity: 0 }).spots).toEqual([]);
    const one = buildRoadScene(road, look, dressing, { roadsideDensity: 1 }).spots.length;
    const two = buildRoadScene(road, look, dressing, { roadsideDensity: 2 }).spots.length;
    expect(two).toBeGreaterThan(one * 1.5);
  });
});

describe('draw distance and the bobbing boats', () => {
  const { road, dressing } = track('keys-m1');
  const scene = buildRoadScene(road, look, dressing);
  const batches = () => solids(scene.group, (n) => /^road-(palm|mangrove|shack|pole|skiff|boat)s$/.test(n));

  it('hides far scenery batches and shows near ones', () => {
    const first = scene.spots[0]!;
    const near = scene.update(first.p.x, first.p.z, 0, 420);
    const all = batches().length;
    const shown = batches().filter((b) => b.visible).length;
    expect(near).toBeGreaterThan(0);
    expect(shown).toBeLessThan(all);
    expect(scene.update(first.p.x, first.p.z, 0, 100000)).toBe(scene.spots.length);
    expect(scene.update(1e6, 1e6, 0, 420)).toBe(0);
    console.log(
      `[examined] ${all} scenery batches; ${shown} within 420 m of the first spot (${near} instances)`,
    );
  });

  it('bobs the boats over time and leaves the land scenery still', () => {
    const boat = batches().find((b) => b.name === 'road-skiffs') as InstancedMesh;
    const palm = batches().find((b) => b.name === 'road-palms') as InstancedMesh;
    const m = new Matrix4();
    const y = (mesh: InstancedMesh, t: number) => {
      scene.update(0, 0, t, 1e9);
      mesh.getMatrixAt(0, m);
      return new Vector3().setFromMatrixPosition(m).y;
    };
    const ys = [0, 0.7, 1.4, 2.1].map((t) => y(boat, t));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.05);
    expect(Math.max(...ys.map(Math.abs))).toBeLessThan(0.2);
    expect(y(palm, 0)).toBe(y(palm, 1.3));
  });
});

describe('the Blender models (playtest 1c item 4)', async () => {
  const models = await realModels();

  it("read the same with the game's small GLB reader as with three's GLTFLoader", async () => {
    const ref = await referenceModels();
    let vertices = 0;
    for (const kind of MODEL_KINDS) {
      const a = models[kind]!;
      const b = ref[kind]!;
      expect(a.variants.length, kind).toBe(b.variants.length);
      expect(a.doubleSided, kind).toBe(b.doubleSided);
      expect(a.ramp, kind).toEqual(b.ramp);
      a.variants.forEach((g, v) => {
        const h = b.variants[v]!;
        for (const attr of ['position', 'normal', 'color']) {
          const x = g.getAttribute(attr).array;
          const y = h.getAttribute(attr).array;
          expect(x.length, `${kind} ${v} ${attr}`).toBe(y.length);
          let worst = 0;
          for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs((x[i] ?? 0) - (y[i] ?? 0)));
          expect(worst, `${kind} ${v} ${attr}`).toBeLessThan(1e-5);
        }
        vertices += g.getAttribute('position').count;
      });
    }
    console.log(
      `[examined] ${MODEL_KINDS.length} GLBs, ${vertices} baked vertices: positions, normals and colours match GLTFLoader`,
    );
  });

  it('bake into flat-coloured variants, one draw each, from the real GLBs', () => {
    const want: Record<ModelKind, number> = {
      truck: 1,
      palms: 3,
      mangroves: 2,
      baitShack: 1,
      powerPole: 1,
      skiff: 1,
      boat: 1,
      conifers: 4,
      rowHouses: 4,
      sawmill: 1,
      trestleBent: 1,
      fogBanks: 2,
      cableCar: 1,
      pnwRoadside: 12,
      sfRoadside: 13,
      keysRoadside: 11,
    };
    const lines: string[] = [];
    for (const kind of MODEL_KINDS) {
      const m = models[kind]!;
      expect(m.variants.length, kind).toBe(want[kind]);
      for (const g of m.variants) {
        expect(g.getAttribute('color'), kind).toBeDefined();
        const box = g.boundingBox!;
        // Each variant sits on its own anchor: the ground (or the waterline) at y = 0, centred in x.
        expect(box.min.y, kind).toBeGreaterThan(-0.7);
        expect(box.min.y, kind).toBeLessThan(0.05);
        expect(Math.abs((box.min.x + box.max.x) / 2), kind).toBeLessThan(
          kind === 'palms' || kind === 'sawmill' ? 3.5 : 1.6,
        );
        const colours = new Set<string>();
        const c = g.getAttribute('color');
        for (let i = 0; i < c.count; i += 3) colours.add(`${c.getX(i).toFixed(2)},${c.getY(i).toFixed(2)}`);
        // A roadside kit's fern or fence section is one flat colour; the kit as a whole has many.
        const single = kind === 'fogBanks' || kind.endsWith('Roadside');
        expect(colours.size, `${kind} keeps its flat colours`).toBeGreaterThan(single ? 0 : 1);
      }
      if (kind.endsWith('Roadside')) {
        const all = new Set<string>();
        for (const g of m.variants) {
          const c = g.getAttribute('color');
          for (let i = 0; i < c.count; i += 3) all.add(`${c.getX(i).toFixed(2)},${c.getY(i).toFixed(2)}`);
        }
        expect(all.size, `${kind}: colours across the kit`).toBeGreaterThan(9);
      }
      lines.push(`${kind} ${m.variants.map((g) => g.getAttribute('position').count / 3).join('/')} tris`);
    }
    expect(models.palms!.doubleSided).toBe(true);
    const ramp = models.truck!.ramp!;
    expect([ramp.runM, ramp.lipM, ramp.widthM]).toEqual([11.5, 2.8, 2.5]);
    expect(ramp.lengthM).toBeCloseTo(21.05, 1);
    console.log(`[examined] ${lines.join('; ')}`);
  });

  it('replace every stand-in when they have loaded', () => {
    const { road, dressing } = track('keys-m1');
    const scene = buildRoadScene(road, look, dressing, { models });
    expect([...scene.stats.sceneryModels].sort()).toEqual([...SCENERY_KINDS].sort());
    expect(scene.stats.rampTruckModels).toBe(scene.stats.rampTrucks);
    const geos = new Set<BufferGeometry>();
    scene.group.traverse((o) => {
      if (o instanceof InstancedMesh && /^road-(palm|mangrove|shack|pole|skiff|boat)s$/.test(o.name))
        geos.add(o.geometry as BufferGeometry);
    });
    const modelGeos = new Set(Object.values(models).flatMap((m) => m.variants));
    for (const g of geos) expect(modelGeos.has(g)).toBe(true);
    // A rebuild (a new seed) keeps the shared model geometry alive.
    scene.dispose();
    expect(models.palms!.variants[0]!.getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('the ramp-truck model against the sim ramp (13.7 degrees, 11.5 m, 2.8 m lip)', async () => {
  const models = await realModels();
  const road = createRoadNetwork(fixtureNetwork([{ id: 'r', lengthM: 400, kappa: 0.002, grade: 0.01 }]));
  const truck: FeatureSpan = {
    kind: 'rampTruck',
    s0: 200,
    s1: 222,
    d0: 3.8,
    d1: 6.4,
    params: { lipHeightM: 2.8, rampLengthM: 11.5 },
  };
  const scene = buildRoadScene(road, look, { r: { features: [truck] } }, { roadsideDensity: 0, models });
  const trucks = solids(scene.group, (n) => n === 'road-rampTrucks');
  const mid = (truck.d0 + truck.d1) / 2;
  const down = (s: number, d: number) => {
    const p = road.toWorld(0, s, d, 0);
    const hit = new Raycaster(new Vector3(p.x, p.y + 20, p.z), new Vector3(0, -1, 0), 0, 40).intersectObjects(
      trucks,
      false,
    )[0];
    return hit ? hit.point.y - p.y : null;
  };

  it('is the model, with its ramp foot at s0 and the lip where the sim launches riders', () => {
    expect(scene.stats.rampTruckModels).toBe(1);
    expect(trucks.length).toBe(1);
    const lines: string[] = [];
    for (const x of [0.5, 2, 4, 6, 8, 10, 11.3]) {
      const h = down(truck.s0 + x, mid);
      const want = (2.8 * x) / 11.5;
      lines.push(`+${x} m ${h?.toFixed(2)} (sim ${want.toFixed(2)})`);
      expect(h, `ramp at +${x} m`).not.toBeNull();
      expect(Math.abs(h! - want), `ramp at +${x} m`).toBeLessThan(0.08);
    }
    // The slope: 13.7 degrees, as the sim's 2.8 m over 11.5 m.
    const slope = (Math.atan2(down(truck.s0 + 10, mid)! - down(truck.s0 + 2, mid)!, 8) * 180) / Math.PI;
    expect(slope).toBeCloseTo(13.7, 0);
    // Just past the lip the flat trailer deck sits at the lip height, as the sim's deck does.
    expect(Math.abs(down(truck.s0 + 11.7, mid)! - 2.8)).toBeLessThan(0.08);
    console.log(
      `[examined] model ramp heights over the road: ${lines.join('; ')}; slope ${slope.toFixed(2)} deg`,
    );
  });

  it("fits the ramp to the feature's width, off the traffic lanes", () => {
    for (const d of [truck.d0 + 0.08, mid, truck.d1 - 0.08])
      expect(down(truck.s0 + 6, d), `d ${d}`).not.toBeNull();
    for (const d of [truck.d0 - 0.3, truck.d1 + 0.3, -1.7])
      expect(down(truck.s0 + 6, d), `d ${d}`).toBeNull();
  });

  it('stays inside the feature box end to end', () => {
    // The model's front bumper falls inside s1 (21.05 m of a 22 m box).
    expect(down(truck.s1 + 0.3, mid)).toBeNull();
    expect(down(truck.s1 - 1.5, mid)).not.toBeNull();
  });

  it("draws the sim's truck: the lip platform, then the parked car as the solid body (#211)", () => {
    // Since #211 (riders, skeptic 1c F2) the sim keeps the lip height for a 0.45 m platform past
    // the lip, then the truck's body is solid to s1, its top 1.16 m above the lip (the top-deck
    // car's roof): src/sim/riders/features.ts TRUCK_PLATFORM_M and TRUCK_BODY_ABOVE_LIP_M, scaled
    // with the ramp. So the drawn truck must show a deck on the platform, the car where the body
    // starts, and nothing standing above the body's top anywhere.
    const lip = 2.8;
    const bodyS = 11.5 + 0.45;
    const bodyTop = lip + 1.16;
    const lines: string[] = [];
    let worstPlatform = 0;
    for (const x of [11.6, 11.7, 11.8])
      worstPlatform = Math.max(worstPlatform, Math.abs(down(truck.s0 + x, mid)! - lip));
    lines.push(`platform +11.6 to +11.8 m worst ${worstPlatform.toFixed(3)} m off ${lip} m`);
    expect(worstPlatform).toBeLessThan(0.1);
    // The car fills the body's first metres: its roof reaches the body's top.
    const carRoof = Math.max(
      ...Array.from({ length: 45 }, (_, i) => down(truck.s0 + 12 + i * 0.1, mid) ?? 0),
    );
    lines.push(`car roof ${carRoof.toFixed(2)} m (body top ${bodyTop.toFixed(2)} m)`);
    expect(Math.abs(carRoof - bodyTop)).toBeLessThan(0.1);
    expect(down(truck.s0 + bodyS + 0.3, mid)!).toBeGreaterThan(lip + 0.3);
    // Nothing drawn stands above the body's top, over the whole box.
    let highest = 0;
    for (let x = 11.5; x <= truck.s1 - truck.s0; x += 0.25)
      for (const d of [mid - 1, mid, mid + 1]) highest = Math.max(highest, down(truck.s0 + x, d) ?? 0);
    lines.push(`highest drawn point ${highest.toFixed(2)} m`);
    expect(highest).toBeLessThan(bodyTop + 0.05);
    console.log(`[examined] the truck against the sim's body: ${lines.join('; ')}`);
  });

  it('places the same way for a non-default ramp: a 2 m lip over 9 m', () => {
    const f: FeatureSpan = { ...truck, params: { lipHeightM: 2, rampLengthM: 9 } };
    const m = rampTruckMatrix(road, 0, f, models.truck!.ramp);
    const lip = new Vector3(0, 2.8, 11.5).applyMatrix4(m);
    const want = road.toWorld(0, f.s0 + 9, mid, 2);
    expect(lip.distanceTo(new Vector3(want.x, want.y, want.z))).toBeLessThan(0.1);
    const foot = new Vector3(0, 0, 0).applyMatrix4(m);
    const wantFoot = road.toWorld(0, f.s0, mid, 0);
    expect(foot.distanceTo(new Vector3(wantFoot.x, wantFoot.y, wantFoot.z))).toBeLessThan(0.01);
    expect(m.determinant()).toBeGreaterThan(0); // not mirrored: its faces still face out
  });

  it("draws every live truck candidate (Keys, PNW, SF) within the sim's body and on its ramp", () => {
    // Each truck is a seeded candidate (#208's slots): build seeds until every candidate is drawn.
    const lines: string[] = [];
    let candidates = 0;
    for (const id of ['keys-m1', 'pnw-c1', 'sf-hills']) {
      const t = track(id);
      const all = t.road.edges.flatMap((e) =>
        (t.dressing[e.id]?.features ?? []).filter((x) => x.kind === 'rampTruck').map((f) => ({ e, f })),
      );
      candidates += all.length;
      const checked = new Set<string>();
      for (let seed = 1; seed <= 16 && checked.size < all.length; seed++) {
        const built = buildRoadScene(t.road, look, t.dressing, { roadsideDensity: 0, models, seed });
        const solid = solids(built.group, (n) => n === 'road-rampTrucks');
        const drawn = new Set(built.stats.setPieces.map((p) => p.id));
        for (const { e, f } of all) {
          const fid = f.id ?? '';
          if (checked.has(fid) || !drawn.has(fid)) continue;
          checked.add(fid);
          const lip = Number(f.params?.['lipHeightM'] ?? 2.8);
          const run = Number(f.params?.['rampLengthM'] ?? 11.5);
          const top = lip + (1.16 * lip) / 2.8;
          const dm = (f.d0 + f.d1) / 2;
          const at = (x: number, d: number) => {
            const base = t.road.toWorld(e.index, f.s0 + x, d, 0);
            const hit = new Raycaster(
              new Vector3(base.x, base.y + 20, base.z),
              new Vector3(0, -1, 0),
              0,
              40,
            ).intersectObjects(solid, false)[0];
            return hit ? hit.point.y - base.y : null;
          };
          let rampOff = 0;
          for (const x of [2, 5, 8, 11])
            rampOff = Math.max(rampOff, Math.abs((at(x, dm) ?? 0) - (lip * x) / run));
          let highest = 0;
          for (let x = run; x <= f.s1 - f.s0; x += 0.25)
            for (const d of [dm - 0.8, dm, dm + 0.8]) highest = Math.max(highest, at(x, d) ?? 0);
          lines.push(
            `${id} ${fid} (seed ${seed}): ramp worst ${rampOff.toFixed(3)} m off, highest ${highest.toFixed(2)} m of ${top.toFixed(2)} m`,
          );
          expect(rampOff, `${id} ${fid} ramp`).toBeLessThan(0.1);
          expect(highest, `${id} ${fid} body`).toBeLessThan(top + 0.05);
        }
        built.dispose();
      }
      expect(checked.size, `${id}: every truck candidate drawn by some seed`).toBe(all.length);
    }
    console.log(`[examined] live trucks: ${lines.join('; ')}`);
    expect(lines.length).toBe(candidates);
    expect(candidates).toBeGreaterThanOrEqual(3);
  });
});

describe('loading through the asset manifest (docs/architecture.md, "Asset manifest")', () => {
  it('lists every base-pack model by asset id, as a baked mesh', () => {
    const entries = assetIndex(loadBasePack());
    const ids = entries.map((e) => e.id);
    for (const kind of MODEL_KINDS) expect(ids, kind).toContain(MODEL_ASSETS[kind]);
    for (const e of entries) {
      expect(e.kind).toBe('mesh');
      expect(e.source).toBe('baked');
      expect(e.packId).toBe('base');
      expect(e.path).toMatch(/\.glb$/);
    }
    console.log(`[examined] ${entries.length} asset manifest rows: ${ids.join(', ')}`);
  });

  it('loads the models that arrive and keeps the stand-in for one that fails', async () => {
    const entries = assetIndex(loadBasePack());
    const manifest = createAssetManifest(() => entries, {
      baseUrl: 'http://test/',
      fetchFn: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const entry = entries.find((e) => new URL(e.path, 'http://test/').href === url);
        if (!entry || entry.id === MODEL_ASSETS.boat) return new Response('missing', { status: 404 });
        return new Response(await readRepoFile(`/packs/base/assets/${entry.id}.glb`));
      },
    });
    const { models, report } = await loadSceneryModels(manifest);
    expect(report.fellBack.map((f) => f.kind)).toEqual(['boat']);
    expect(report.fellBack[0]?.error).toMatch(/404/);
    expect([...report.loaded].sort()).toEqual(MODEL_KINDS.filter((k) => k !== 'boat').sort());
    expect(models.boat).toBeUndefined();
    expect(models.palms?.variants.length).toBe(3);
    // The boats then draw their stand-in, the rest their models.
    const { road, dressing } = track('keys-m1');
    const stats = buildRoadScene(road, look, dressing, { models }).stats;
    expect(stats.sceneryModels).not.toContain('boat');
    expect(stats.sceneryModels).toContain('skiff');
  });
});
