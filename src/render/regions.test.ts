// The region build-out (W-O, the maintainer, 2026-10-01: "polish and build out the regions we have
// now (... better visuals and experience ...)"). The Pacific Northwest and San Francisco should look
// like places: clustered conifers, a sawmill and timber trestle bents in the PNW, terraces of painted
// row houses, cable cars and fog banks in SF, ground under every road so none floats in the void,
// and the PNW's drizzle and overcast light. The checks build the real networks with their real road
// files and the real GLBs, and look at what was built: rays down onto the ground, the instance
// matrices, the models a region asks for, the painted colours, the rain streaks and the lights.
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  Raycaster,
  Scene,
  Vector3,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { oddityFigureFor } from './figures';
import { readGlb } from './glb';
import { GroundTris, openLandEnds } from './land-probe.test-util';
import { createFlatLook } from './look';
import { readAsset } from './model-files.test-util';
import {
  bakeModel,
  MODEL_ASSETS,
  MODEL_KINDS,
  modelKindsFor,
  paintModel,
  type SceneryModels,
} from './models';
import { MAX_DROPS, Rain, rainColourOf } from './rain';
import { buildRoadScene, GROUND_Y, networkTags, type RoadDressing } from './road-mesh';
import { themeAt } from './scenery';
import { defaultRenderParams } from './tuning';
import { EntityViews } from './views';

const look = createFlatLook();

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const regionFiles = import.meta.glob<{
  id: string;
  palette?: Record<string, string>;
  timeOfDayOptions?: { id: string; palette?: Record<string, string> }[];
}>('../../packs/*/regions/*/region.json', { eager: true, import: 'default' });
const trafficFiles = import.meta.glob<{ id: string }>('../../packs/*/traffic/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

function palette(regionId: string, timeOfDay?: string): Record<string, string> {
  const r = Object.values(regionFiles).find((x) => x.id === regionId);
  if (!r) throw new Error(`no region ${regionId}`);
  const light = r.timeOfDayOptions?.find((o) => o.id === timeOfDay);
  return { ...(r.palette ?? {}), ...(light?.palette ?? {}) };
}

function solids(group: Object3D, keep: RegExp): Object3D[] {
  const out: Object3D[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh) && keep.test(o.name)) out.push(o);
  });
  return out;
}

function under(objs: Object3D[], x: number, z: number, top = 200): { name: string; y: number } | null {
  const hit = new Raycaster(new Vector3(x, top, z), new Vector3(0, -1, 0), 0, 400).intersectObjects(
    objs,
    false,
  )[0];
  return hit ? { name: hit.object.name, y: hit.point.y } : null;
}

const models: SceneryModels = {};
for (const k of MODEL_KINDS) models[k] = bakeModel(k, readGlb(await readAsset(MODEL_ASSETS[k], 'glb')));

const GROUND = /^road-(land|water|road|shoulder|shortcut|deck|marking|splitZone|rampMark|boost|cableSlot)/;

describe.each(['pnw-c1', 'sf-hills'])('the terrain skirt on %s', (id) => {
  const { road, dressing } = track(id);
  const scene = buildRoadScene(road, look, dressing, { seed: 7 });
  const ground = solids(scene.group, GROUND);

  it('puts ground under the land sides out past the strip, down near sea level, so no road floats', () => {
    let checked = 0;
    let onGround = 0;
    for (const e of road.edges) {
      const tags = dressing[e.id]?.tags;
      for (let s = 10; s < e.length - 10; s += 40) {
        for (const side of [-1, 1] as const) {
          const theme = themeAt(tags, side < 0 ? 'left' : 'right', s);
          if (theme === 'water' || theme === 'none') continue;
          const outer = side < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
          // 60 m out: past the 24 m strip, on the skirt's slope or its flat ground.
          const p = road.toWorld(e.index, s, side * (outer + 60), 0);
          const hit = under(ground, p.x, p.z);
          checked++;
          if (hit?.name === 'road-land') onGround++;
        }
      }
    }
    console.log(`[examined] ${id}: ${checked} land-side points 60 m out, ${onGround} on drawn ground`);
    expect(checked).toBeGreaterThan(50);
    // Most land sides have ground there; the rest are squeezed by another road or its water.
    expect(onGround / checked).toBeGreaterThan(0.75);
  });

  it("never covers a water side's sea with ground", () => {
    let checked = 0;
    for (const e of road.edges) {
      const tags = dressing[e.id]?.tags;
      for (let s = 5; s < e.length - 5; s += 20) {
        for (const side of [-1, 1] as const) {
          if (themeAt(tags, side < 0 ? 'left' : 'right', s) !== 'water') continue;
          const outer = side < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
          for (const across of [12, 30, 60]) {
            const p = road.toWorld(e.index, s, side * (outer + across), 0);
            const hit = under(ground, p.x, p.z, 150);
            // Another road's deck may pass over the water; ground never does.
            expect(hit?.name, `${e.id} s ${s} ${across} m out`).not.toBe('road-land');
            checked++;
          }
        }
      }
    }
    console.log(`[examined] ${id}: ${checked} water-side points, none under ground`);
    expect(checked).toBeGreaterThan(10);
  });

  it('lays its flat ground just over the sea', () => {
    let flat = 0;
    for (const e of road.edges) {
      for (let s = 20; s < e.length - 20; s += 50) {
        const p = road.toWorld(e.index, s, e.dMax + 0.6 + 100, 0);
        const hit = under(ground, p.x, p.z);
        if (hit?.name === 'road-land' && Math.abs(hit.y - GROUND_Y) < 0.05) flat++;
      }
    }
    console.log(`[examined] ${id}: ${flat} points 100 m out on the flat ground at y ${GROUND_Y}`);
    expect(flat).toBeGreaterThan(3);
  });
});

describe.each(['pnw-c1', 'sf-hills'])('the far forest on %s', (id) => {
  it('stands every far conifer on drawn ground, never over the water or under a road (run W-O skeptic)', () => {
    const { road, dressing } = track(id);
    let far = 0;
    const wet: string[] = [];
    for (const seed of [1, 2, 3, 7]) {
      const scene = buildRoadScene(road, look, dressing, { seed });
      const ground = solids(scene.group, GROUND);
      for (const t of scene.spots) {
        if (t.kind !== 'conifer' || Math.abs(t.d) <= 40) continue;
        far++;
        const hit = under(ground, t.p.x, t.p.z, t.p.y + 30);
        if (hit?.name !== 'road-land')
          wet.push(
            `seed ${seed}: ${road.edges[t.edge]?.id} s ${t.s.toFixed(0)} d ${t.d.toFixed(0)} over ${hit?.name}`,
          );
      }
      scene.dispose();
    }
    console.log(`[examined] ${id}: ${far} far-forest conifers over 4 seeds, ${wet.length} off drawn ground`);
    if (id === 'pnw-c1') expect(far).toBeGreaterThan(500);
    expect(wet.slice(0, 8)).toEqual([]);
  });
});

describe.each(['keys-m1', 'pnw-c1', 'sf-hills'])('the land on %s', (id) => {
  it('never ends in mid-air: every raised edge of it is closed down to the ground (run W-O skeptic)', () => {
    const { road, dressing } = track(id);
    const scene = buildRoadScene(road, look, dressing, { seed: 7 });
    const ground = new GroundTris(scene.group);
    const { probes, drops, open, joins } = openLandEnds(road, ground);
    console.log(
      `[examined] ${id}: ${ground.count} ground triangles, ${probes} points walked, ${joins} junction steps, ${drops} drops looked under, ${open.length} open`,
    );
    scene.dispose();
    expect(probes).toBeGreaterThan(1000);
    expect(joins).toBeGreaterThan(0);
    expect(open.slice(0, 8)).toEqual([]);
  });
});

describe.each(['keys-m1', 'pnw-c1', 'sf-hills'])('the roads on %s', (id) => {
  // Bundle 1: SF's Park Cut ran in the valley below the Fogline Climb, and the climb's land strip and
  // skirt, looked for other roads at only two points across, lay over the cut, up to 12 m above its
  // road. Land 1.5 m or more over a road buries it (road-mesh.ts BURIED_M). Shallower overlaps where
  // a shortcut meets a sloping road (the stair alley and the logging spur, about 1.4 m) are counted.
  it("are never buried under another road's land", () => {
    const { road, dressing } = track(id);
    const scene = buildRoadScene(road, look, dressing, { seed: 7 });
    const ground = new GroundTris(scene.group);
    let checked = 0;
    let shallow = 0;
    const buried: string[] = [];
    for (const e of road.edges) {
      for (let s = 2; s < e.length - 2; s += 5) {
        for (const d of [e.dMin + 0.5, 0, e.dMax - 0.5]) {
          const q = road.toWorld(e.index, s, d, 0);
          const hit = ground.heightAt(q.x, q.z, q.y + 60);
          checked++;
          if (!hit?.name.startsWith('road-land') || hit.y <= q.y + 0.5) continue;
          if (hit.y < q.y + 1.5) shallow++;
          else
            buried.push(
              `${e.id} s ${s} d ${d.toFixed(1)}: land at ${hit.y.toFixed(1)} over ${q.y.toFixed(1)}`,
            );
        }
      }
    }
    scene.dispose();
    console.log(
      `[examined] ${id}: ${checked} road points looked down on, ${buried.length} buried, ${shallow} under 0.5 to 1.5 m of land`,
    );
    expect(checked).toBeGreaterThan(1000);
    expect(buried.slice(0, 8)).toEqual([]);
  });
});

describe('the Keys keep their look', () => {
  it('draws no terrain skirt, no trestle bents and none of the new scenery on a tropical network', () => {
    const { road, dressing } = track('keys-m1');
    const scene = buildRoadScene(road, look, dressing, { seed: 7, models });
    const st = scene.stats.scenery;
    expect(st.conifer + st.house + st.sawmill + st.fogBank).toBe(0);
    const names = new Set<string>();
    scene.group.traverse((o) => names.add(o.name));
    expect(names.has('road-trestle')).toBe(false);
    expect(names.has('road-cableSlot')).toBe(false);
  });
});

describe('the Pacific Northwest', () => {
  const { road, dressing } = track('pnw-c1');
  const scene = buildRoadScene(road, look, dressing, {
    seed: 7,
    models,
    palette: palette('pacific-northwest'),
  });

  it('grows clustered conifers of every size on its forest sides, clear of the road', () => {
    const trees = scene.spots.filter((s) => s.kind === 'conifer');
    const variants = new Set(trees.map((t) => t.variant));
    expect(trees.length).toBeGreaterThan(800);
    expect([...variants].sort()).toEqual([0, 1, 2, 3]);
    // Clustered: many trees have a neighbour within 6 m.
    let close = 0;
    for (const t of trees)
      if (trees.some((o) => o !== t && Math.hypot(o.p.x - t.p.x, o.p.z - t.p.z) < 6)) close++;
    for (const t of trees) {
      const e = road.edges[t.edge]!;
      const outer = t.d < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
      // A tree's trunk stands at least 4.5 m past the verge, so the boughs never hang over the road.
      expect(Math.abs(t.d) - outer, `conifer at ${e.id} s ${t.s.toFixed(0)}`).toBeGreaterThan(4.4);
    }
    console.log(
      `[examined] pnw-c1: ${trees.length} conifers, variants ${[...variants].join('/')}, ${close} with a neighbour within 6 m`,
    );
    expect(close / trees.length).toBeGreaterThan(0.3);
  });

  it('stands one sawmill on the sawmill side, facing the road, on land', () => {
    const mills = scene.spots.filter((s) => s.kind === 'sawmill');
    expect(mills.length).toBeGreaterThanOrEqual(1);
    const ground = solids(scene.group, GROUND);
    for (const m of mills) {
      const e = road.edges[m.edge]!;
      expect(themeAt(dressing[e.id]?.tags, m.d < 0 ? 'left' : 'right', m.s)).toBe('sawmill');
      // Its front faces the road: the model's +Z points back toward the centre line.
      const toRoad = road.toWorld(e.index, m.s, 0, 0);
      const facing = new Vector3(Math.sin(m.turn), 0, Math.cos(m.turn));
      const want = new Vector3(toRoad.x - m.p.x, 0, toRoad.z - m.p.z).normalize();
      expect(facing.dot(want)).toBeGreaterThan(0.95);
      // The whole yard is on land: its front and its back.
      const back = road.toWorld(e.index, m.s, m.d + Math.sign(m.d) * 16, 0);
      expect(under(ground, back.x, back.z)?.name).toBe('road-land');
    }
  });

  it('stands its bridges on timber trestle bents, every few metres, capped under the deck', () => {
    const bents: Matrix4[] = [];
    scene.group.traverse((o) => {
      if (o instanceof InstancedMesh && o.name === 'road-trestle')
        for (let i = 0; i < o.count; i++) {
          const m = new Matrix4();
          o.getMatrixAt(i, m);
          bents.push(m);
        }
    });
    const bridge = (dressing['pnw-trestle']?.tags ?? []).find((t) => t.tag === 'bridge')!;
    expect(bents.length).toBeGreaterThan(((bridge.s1 - bridge.s0) / 8) * 0.9);
    // Every bridge stretch of the network: the trestle, and (run W-U) the ferry slip's two spans.
    const bridges = road.edges.flatMap((e) =>
      (dressing[e.id]?.tags ?? []).filter((t) => t.tag === 'bridge').map((t) => ({ e, t })),
    );
    const p = new Vector3();
    const q = new Vector3();
    const top = new Vector3();
    for (const m of bents) {
      p.setFromMatrixPosition(m);
      // The cap's top: the model's (0, 10, 0).
      top.set(0, 10, 0).applyMatrix4(m);
      q.set(p.x, 0, p.z);
      let best = Infinity;
      let deck = 0;
      for (const { e, t } of bridges)
        for (let s = t.s0; s <= t.s1; s += 1) {
          const w = road.toWorld(e.index, s, 0, 0);
          const d = Math.hypot(w.x - p.x, w.z - p.z);
          if (d < best) {
            best = d;
            deck = w.y;
          }
        }
      expect(best, 'a bent stands under a bridge').toBeLessThan(1.5);
      expect(top.y).toBeLessThan(deck);
      expect(top.y).toBeGreaterThan(deck - 1.2);
      expect(p.y).toBeLessThan(0);
    }
    console.log(`[examined] pnw-c1: ${bents.length} trestle bents, each capped within 1.2 m under the deck`);
  });

  it('draws no concrete pylons under the trestle once the bents have loaded', () => {
    const plain = buildRoadScene(road, look, dressing, { seed: 7 });
    const count = (sc: typeof scene) => {
      let n = 0;
      sc.group.traverse((o) => {
        if (o instanceof InstancedMesh && o.name === 'road-pylons') n += o.count;
      });
      return n;
    };
    expect(count(scene)).toBeLessThan(count(plain));
  });

  it('asks for drizzle in a grey-green light, in the lights that rain and not in the dawn fog', () => {
    const env = { timeOfDay: 'noon', palette: palette('pacific-northwest', 'noon') };
    expect(env.palette['rain']).toMatch(/^#/);
    expect(rainColourOf(env)).toBe(env.palette['rain']);
    const dawn = { timeOfDay: 'dawn', palette: palette('pacific-northwest', 'dawn') };
    expect(rainColourOf(dawn)).toBeNull();
    const s = new Scene();
    look.setupScene(s, env);
    const sun = s.children.find((c): c is DirectionalLight => c instanceof DirectionalLight)!;
    const sky = s.children.find((c): c is HemisphereLight => c instanceof HemisphereLight)!;
    expect(sun.color.getHexString()).toBe(new Color(env.palette['sunlight']).getHexString());
    expect(sky.color.getHexString()).toBe(new Color(env.palette['skylight']).getHexString());
    // A region without the keys keeps the classic light.
    const keys = new Scene();
    look.setupScene(keys, { timeOfDay: 'noon' });
    const keysSun = keys.children.find((c): c is DirectionalLight => c instanceof DirectionalLight)!;
    expect(keysSun.color.getHexString()).toBe(new Color('#ffe2b0').getHexString());
  });
});

describe('San Francisco', () => {
  const { road, dressing } = track('sf-hills');
  const pal = palette('san-francisco');
  const scene = buildRoadScene(road, look, dressing, { seed: 7, models, palette: pal });
  const houses = scene.spots.filter((s) => s.kind === 'house');

  it('lines its streets with terraces of row houses facing the road, every kind of house', () => {
    expect(houses.length).toBeGreaterThan(200);
    expect(new Set(houses.map((h) => h.variant)).size).toBe(4);
    let terraced = 0;
    for (const h of houses) {
      const e = road.edges[h.edge]!;
      const toRoad = road.toWorld(e.index, h.s, 0, 0);
      const facing = new Vector3(Math.sin(h.turn), 0, Math.cos(h.turn));
      const want = new Vector3(toRoad.x - h.p.x, 0, toRoad.z - h.p.z).normalize();
      expect(facing.dot(want)).toBeGreaterThan(0.95);
      if (
        houses.some(
          (o) =>
            o !== h && o.edge === h.edge && Math.sign(o.d) === Math.sign(h.d) && Math.abs(o.s - h.s) < 7.5,
        )
      )
        terraced++;
    }
    console.log(`[examined] sf-hills: ${houses.length} row houses, ${terraced} with a next-door neighbour`);
    expect(terraced / houses.length).toBeGreaterThan(0.7);
  });

  it('steps its houses down the hills: neither front corner floats above the land', () => {
    let hills = 0;
    for (const h of houses) {
      const e = road.edges[h.edge]!;
      const a = road.toWorld(e.index, h.s - 3.2, h.d, 0).y;
      const b = road.toWorld(e.index, h.s + 3.2, h.d, 0).y;
      if (Math.abs(a - b) > 0.5) hills++;
      // The house's base is at or under both front corners' land.
      expect(
        h.p.y,
        `${e.id} s ${h.s.toFixed(1)} d ${h.d.toFixed(1)} a ${a.toFixed(2)} b ${b.toFixed(2)}`,
      ).toBeLessThanOrEqual(Math.min(a, b) + 0.01);
    }
    console.log(`[examined] sf-hills: ${hills} houses on a slope steeper than 0.5 m across their front`);
    expect(hills).toBeGreaterThan(10);
  });

  it('lays fog banks offshore only when the palette names a fog bank, and never over a road', () => {
    const banks = scene.spots.filter((s) => s.kind === 'fogBank');
    expect(banks.length).toBeGreaterThan(0);
    for (const b of banks) {
      const e = road.edges[b.edge]!;
      expect(themeAt(dressing[e.id]?.tags, b.d < 0 ? 'left' : 'right', b.s)).toBe('water');
      for (const o of road.edges)
        for (let k = 0; k < o.count; k++)
          expect(Math.hypot((o.x[k] ?? 0) - b.p.x, (o.z[k] ?? 0) - b.p.z)).toBeGreaterThan(60);
    }
    const plain = buildRoadScene(road, look, dressing, { seed: 7, models });
    expect(plain.spots.filter((s) => s.kind === 'fogBank').length).toBe(0);
    console.log(`[examined] sf-hills: ${banks.length} fog banks offshore`);
  });

  it('cuts cable slots into its cable-line road', () => {
    const names: string[] = [];
    scene.group.traverse((o) => names.push(o.name));
    expect(names).toContain('road-cableSlot');
  });

  it('draws its cable-car traffic from the cable car model, fitted to the traffic type', () => {
    expect(oddityFigureFor('region-sf:cable-car')).toBe('cableCar');
    const views = new EntityViews(look);
    const car = models.cableCar!.variants[0]!;
    views.setFigureModel('cableCar', car);
    const fitted = (views as unknown as { figureModels: Map<string, BufferGeometry> }).figureModels.get(
      'cableCar',
    )!;
    fitted.computeBoundingBox();
    const box = fitted.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(1, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(1, 5);
    expect(box.max.y).toBeCloseTo(1, 5);
    expect(box.min.y).toBeGreaterThanOrEqual(0);
    expect(box.min.y).toBeLessThan(0.02);
  });
});

describe('which models a race loads', () => {
  const traffic = Object.values(trafficFiles).map((t) => t.id);
  const needs = (id: string, regionId: string) => {
    const { road, dressing } = track(id);
    const { tropical, tags } = networkTags(road, dressing);
    return modelKindsFor({ tropical, tags, palette: new Set(Object.keys(palette(regionId))), traffic: [] });
  };

  it("loads a region's own models only for that region's races", () => {
    const keys = needs('keys-m1', 'florida-keys');
    const pnw = needs('pnw-c1', 'pacific-northwest');
    const sf = needs('sf-hills', 'san-francisco');
    expect(keys).toEqual(expect.arrayContaining(['palms', 'mangroves', 'truck']));
    for (const k of ['conifers', 'rowHouses', 'sawmill', 'trestleBent', 'fogBanks', 'cableCar'] as const)
      expect(keys).not.toContain(k);
    expect(pnw).toEqual(expect.arrayContaining(['conifers', 'sawmill', 'trestleBent']));
    expect(pnw).not.toContain('palms');
    expect(pnw).not.toContain('rowHouses');
    expect(sf).toEqual(expect.arrayContaining(['rowHouses', 'fogBanks']));
    expect(sf).not.toContain('conifers');
    console.log(`[examined] keys ${keys.join(',')}; pnw ${pnw.join(',')}; sf ${sf.join(',')}`);
    expect(traffic).toContain('cable-car');
    expect(
      modelKindsFor({
        tropical: false,
        tags: new Set(),
        palette: new Set(),
        traffic: ['region-sf:cable-car'],
      }),
    ).toContain('cableCar');
  });
});

describe('a region palette repaints its models', () => {
  it("paints the row houses and the conifers by role, and leaves a model alone when the palette doesn't say", () => {
    const red = '#ff0000';
    const painted = paintModel(models.rowHouses!, { rowHousePink: red });
    expect(painted).not.toBe(models.rowHouses);
    const runs = models.rowHouses!.roles![0]!.filter((r) => r.role === 'paint_pink');
    expect(runs.length).toBeGreaterThan(0);
    const c = painted.variants[0]!.getAttribute('color');
    const run = runs[0]!;
    expect([c.getX(run.start), c.getY(run.start), c.getZ(run.start)]).toEqual([1, 0, 0]);
    // The original stays as it was, and so does a role the palette does not name.
    const orig = models.rowHouses!.variants[0]!.getAttribute('color');
    expect(orig.getX(run.start)).not.toBe(1);
    expect(paintModel(models.palms!, { foliage: red })).toBe(models.palms);
    expect(paintModel(models.conifers!, {})).toBe(models.conifers);
    const pine = paintModel(models.conifers!, { foliageDark: red });
    const dark = models.conifers!.roles![0]!.find((r) => r.role === 'foliage_dark')!;
    expect(pine.variants[0]!.getAttribute('color').getY(dark.start)).toBe(0);
  });
});

describe('the drizzle', () => {
  it('rains only when the region asks, as many streaks as the slider says, and moves them', () => {
    const params = defaultRenderParams();
    const rain = new Rain(look, params);
    rain.update(30, 1 / 60);
    expect(rain.count()).toBe(0);
    rain.set('#c4ceca');
    rain.update(30, 1 / 60);
    expect(rain.count()).toBe(MAX_DROPS / 2);
    const m = new Matrix4();
    const a = new Vector3();
    const b = new Vector3();
    rain.root.getMatrixAt(0, m);
    a.setFromMatrixPosition(m);
    for (let i = 0; i < 10; i++) rain.update(30, 1 / 60);
    rain.root.getMatrixAt(0, m);
    b.setFromMatrixPosition(m);
    expect(a.distanceTo(b)).toBeGreaterThan(0.5);
    params.rainAmount = 0;
    rain.update(30, 1 / 60);
    expect(rain.count()).toBe(0);
    params.rainAmount = 2;
    rain.update(30, 1 / 60);
    expect(rain.count()).toBe(MAX_DROPS);
    rain.set(null);
    rain.update(30, 1 / 60);
    expect(rain.count()).toBe(0);
    expect(rainColourOf({ timeOfDay: 'noon' })).toBeNull();
    expect(rainColourOf({ timeOfDay: 'noon', weather: 'drizzle' })).not.toBeNull();
  });
});
