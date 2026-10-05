// Traffic models (playtest 3, T12.2; assets plan W3): the Blender vehicles CX1 and CX2 built draw in
// place of the code-made boxes, one instanced mesh per model, scaled to the type they stand for,
// tinted with the type's own paint, and falling back to the boxes when a model is missing. The
// checks run on the committed models and the real packs' traffic types and mixes, so a new row in
// a pack's `assets/traffic-models.json` that breaks a rule fails here.
import { Box3, Color, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { EntitySnapshot } from '../sim/api';
import { describe, expect, it } from 'vitest';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeVehicle, loadVehicleSets, trafficModelRows, type VehicleRow } from './vehicles';
import {
  diskManifest,
  entitiesFor,
  modelDrawDelta,
  readRepoFile,
  realSets,
  regionPools,
  snapshotOf,
  typeDef,
  typeFiles,
} from './vehicle-pools.test-util';
import { EntityViews, VEHICLE_PAINT_FALLBACK } from './views';

const look = createFlatLook();
/** The examined lines, printed even when the tests pass (console.log is not). */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;

const MAPPING_FILES = import.meta.glob<unknown>('/packs/*/assets/traffic-models.json', {
  eager: true,
  import: 'default',
});
const rows: ReadonlyMap<string, VehicleRow> = trafficModelRows(MAPPING_FILES);
const modelAssets = [...new Set([...rows.values()].flatMap((r) => r.models))].sort();

/** A model's size: its baked geometry's box. */
function boxOf(g: BufferGeometry): Box3 {
  g.computeBoundingBox();
  return g.boundingBox ?? new Box3();
}

describe('the traffic model rows', () => {
  it('read every pack, and name only road vehicles that exist', () => {
    expect(rows.size).toBeGreaterThan(5);
    const types = typeFiles();
    for (const id of rows.keys()) {
      const t = types.get(id);
      expect(t, `${id} is a traffic type`).toBeDefined();
      expect(['car', 'truck', 'rv', 'oddity'], `${id} is a road vehicle`).toContain(t?.category);
    }
  });

  it("name models that are committed, and a pack file only lists its own types or the base pack's models", async () => {
    expect(modelAssets.length).toBeGreaterThan(5);
    for (const asset of modelAssets) {
      expect(asset, asset).toMatch(/^models\/traffic\/[a-z0-9-]+$/);
      const bytes = await readRepoFile(`packs/base/assets/${asset}.glb`);
      expect(bytes.byteLength, asset).toBeGreaterThan(1000);
    }
    for (const path of Object.keys(MAPPING_FILES)) {
      const pack = /^\/packs\/([^/]+)\//.exec(path)?.[1];
      const file = MAPPING_FILES[path] as { types: Record<string, unknown> };
      for (const id of Object.keys(file.types))
        expect(id.startsWith(`${pack}:`), `${path}: ${id}`).toBe(true);
    }
  });

  it('give each type the paint options its own file lists (the type file is where a paint is edited)', () => {
    const types = typeFiles();
    for (const [id, row] of rows) {
      const own = types.get(id)?.look?.paintOptions ?? [];
      expect(row.paint, id).toEqual(own);
    }
  });

  it('ignore a malformed row, and keep the others', () => {
    const merged = trafficModelRows({
      '/packs/base/assets/traffic-models.json': {
        formatVersion: 1,
        types: {
          'base:ok': { models: ['models/traffic/sedan'], paint: ['#ffffff'] },
          'base:no-models': { models: [], paint: [] },
          'base:not-a-row': 7,
          'base:bad-model': { models: [3], paint: [] },
        },
      },
      '/packs/region-x/assets/traffic-models.json': 'nonsense',
    });
    expect([...merged.keys()]).toEqual(['base:ok']);
  });
});

describe('a baked vehicle model', () => {
  it.each(modelAssets)(
    '%s stands on the ground, centred, front toward -z, true to its own numbers',
    async (asset) => {
      const scene = readGlb(await readRepoFile(`packs/base/assets/${asset}.glb`));
      const baked = bakeVehicle(asset, scene);
      const extras = scene.getObjectByName('vehicle')?.userData as Record<string, number>;
      const box = boxOf(baked.geometry);
      const size = box.getSize(new Vector3());
      const mid = box.getCenter(new Vector3());
      expect(size.x).toBeCloseTo(extras['width_m'] ?? NaN, 1);
      expect(size.z).toBeCloseTo(extras['length_m'] ?? NaN, 1);
      expect(size.y).toBeCloseTo(extras['height_m'] ?? NaN, 1);
      expect(baked.widthM).toBeCloseTo(size.x, 5);
      expect(baked.lengthM).toBeCloseTo(size.z, 5);
      expect(box.min.y).toBeCloseTo(0, 2);
      expect(Math.abs(mid.x)).toBeLessThan(0.01);
      expect(Math.abs(mid.z)).toBeLessThan(0.01);
      // The boxes face -z (a heading of 0 drives toward -z); the models are authored facing +z.
      expect(baked.hoodAt.z).toBeLessThan(0);
      expect(baked.hoodAt.y).toBeCloseTo(extras['hood_top_m'] ?? NaN, 1);
      // Flat faces: every vertex has a unit normal, and the paint (white) is there for the tint.
      const normal = baked.geometry.getAttribute('normal');
      const colour = baked.geometry.getAttribute('color');
      let white = 0;
      for (let i = 0; i < normal.count; i++) {
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
        if (colour.getX(i) > 0.99 && colour.getY(i) > 0.99 && colour.getZ(i) > 0.99) white++;
      }
      expect(white / normal.count, 'paint_primary is white').toBeGreaterThan(0.05);
    },
  );
});

describe('the models fit the types they stand for', () => {
  it('each is within a factor of two of its type on both axes (a wrong model for a type is caught)', async () => {
    const ids = [...rows.keys()];
    const sets = await realSets(ids);
    const worst: string[] = [];
    for (const id of ids) {
      const def = typeDef(id);
      const set = sets.get(id);
      expect(set, `${id} loaded`).toBeDefined();
      for (const v of set?.variants ?? []) {
        const sx = def.widthM / v.widthM;
        const sz = def.lengthM / v.lengthM;
        expect(sx, `${id} width`).toBeGreaterThan(0.5);
        expect(sx, `${id} width`).toBeLessThan(2);
        expect(sz, `${id} length`).toBeGreaterThan(0.5);
        expect(sz, `${id} length`).toBeLessThan(2);
        worst.push(`${id} <- ${v.asset}: x${sx.toFixed(2)} wide, x${sz.toFixed(2)} long`);
      }
    }
    stdout.write(`[examined] traffic model fits (type size / model size):\n  ${worst.join('\n  ')}\n`);
  });
});

describe('the entity views draw the models', () => {
  const sedan = 'base:sedan-rental';
  const pickup = 'base:pickup';
  const convertible = 'base:rental-convertible';

  const instanced = (views: EntityViews): InstancedMesh[] =>
    views.root.children.filter(
      (o): o is InstancedMesh => o instanceof InstancedMesh && o.visible && o.count > 0,
    );

  async function viewsWith(ids: readonly string[], failing?: ReadonlySet<string>) {
    const views = new EntityViews(look);
    views.setTrafficTypes(ids.map(typeDef));
    views.setVehicleModels(await realSets(ids, failing));
    return views;
  }

  it('draws a type with a model as that model, scaled to the type, and the others as the boxes', async () => {
    const ids = [pickup, 'base:salvage-wrecker'];
    const views = await viewsWith(ids);
    views.sync(null, snapshotOf(entitiesFor(ids, 3)), 1, 0);
    const meshes = instanced(views);
    const model = meshes.find((m) => m.name === 'views-vehicle:models/traffic/pickup');
    expect(model, 'the pickup model').toBeDefined();
    expect(model?.count).toBe(3);
    expect(meshes.find((m) => m.name === 'views-truck')?.count, 'the wrecker stays a box').toBe(3);
    // The drawn size is the type's: the model's box under each instance's matrix.
    const def = typeDef(pickup);
    const m4 = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    for (let i = 0; i < 3; i++) {
      model?.getMatrixAt(i, m4);
      m4.decompose(p, q, s);
      const box = boxOf((model as InstancedMesh).geometry)
        .clone()
        .applyMatrix4(new Matrix4().makeScale(s.x, s.y, s.z));
      const size = box.getSize(new Vector3());
      expect(Math.abs(size.x / def.widthM - 1)).toBeLessThan(0.05);
      expect(Math.abs(size.z / def.lengthM - 1)).toBeLessThan(0.05);
    }
  });

  it("turns with the entity's heading, the hood leading as the box's front does", async () => {
    const views = await viewsWith([sedan]);
    const car = { ...entitiesFor([sedan], 1)[0], heading: 1 } as EntitySnapshot;
    views.sync(null, snapshotOf([car]), 1, 0);
    const mesh = instanced(views)[0];
    const hood = (await realSets([sedan])).get(sedan)?.variants[0]?.hoodAt;
    if (!mesh || !hood) throw new Error('no model drawn');
    const m4 = new Matrix4();
    mesh.getMatrixAt(0, m4);
    const front = new Vector3(0, hood.y, hood.z).applyMatrix4(m4).sub(new Vector3(car.x, car.y, car.z));
    // A box's front is its -z turned by the heading (views.ts: the unit boxes face -z).
    const boxFront = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), car.heading);
    expect(front.clone().setY(0).normalize().dot(boxFront)).toBeGreaterThan(0.999);
  });

  it("tints each instance with one of the type's paints, and shares a model between the types that use it", async () => {
    const ids = [pickup, 'region-pnw:muddy-pickup'];
    const views = await viewsWith(ids);
    views.sync(null, snapshotOf(entitiesFor(ids, 3)), 1, 0);
    const meshes = instanced(views).filter((m) => m.name.startsWith('views-vehicle:'));
    expect(meshes, 'one mesh for both pickups').toHaveLength(1);
    expect(meshes[0]?.count).toBe(6);
    const colours = new Set<string>();
    const c = (meshes[0] as InstancedMesh).instanceColor;
    expect(c).not.toBeNull();
    for (let i = 0; i < 6; i++) {
      const col = { r: c?.getX(i) ?? 0, g: c?.getY(i) ?? 0, b: c?.getZ(i) ?? 0 };
      colours.add(`${col.r.toFixed(3)},${col.g.toFixed(3)},${col.b.toFixed(3)}`);
    }
    expect(colours.size, 'a mix of paints, not one').toBeGreaterThan(1);
  });

  it('gives a row with no paint a muted default, never the generic box colours', async () => {
    expect(VEHICLE_PAINT_FALLBACK.length).toBeGreaterThan(1);
    const views = new EntityViews(look);
    const def = typeDef(pickup);
    views.setTrafficTypes([def]);
    const sets = await realSets([pickup]);
    const set = sets.get(pickup);
    if (!set) throw new Error('no set');
    views.setVehicleModels(new Map([[pickup, { ...set, paint: [] }]]));
    views.sync(null, snapshotOf(entitiesFor([pickup], 4)), 1, 0);
    const mesh = instanced(views).find((m) => m.name.startsWith('views-vehicle:'));
    expect(mesh?.count).toBe(4);
    const fallback = VEHICLE_PAINT_FALLBACK.map((c) => new Color(c).getHexString());
    const ic = mesh?.instanceColor;
    if (!ic) throw new Error('no instance colours');
    for (let i = 0; i < 4; i++)
      expect(fallback, `instance ${i}`).toContain(
        new Color(ic.getX(i), ic.getY(i), ic.getZ(i)).getHexString(),
      );
  });

  it("takes one of a type's models by entity, each its own mesh", async () => {
    const two = new Map([
      [sedan, { models: ['models/traffic/sedan', 'models/traffic/hatchback'], paint: ['#ffffff'] }],
    ]);
    const sets = await loadVehicleSets(diskManifest(), [sedan], two);
    expect(sets.get(sedan)?.variants).toHaveLength(2);
    const views = new EntityViews(look);
    views.setTrafficTypes([typeDef(sedan)]);
    views.setVehicleModels(sets);
    views.sync(null, snapshotOf(entitiesFor([sedan], 4)), 1, 0);
    const names = instanced(views)
      .map((m) => m.name)
      .sort();
    expect(names).toEqual(['views-vehicle:models/traffic/hatchback', 'views-vehicle:models/traffic/sedan']);
    expect(instanced(views).map((m) => m.count)).toEqual([2, 2]);
  });

  it('draws boxes until the models arrive, and keeps drawing every entity either way', async () => {
    const ids = [sedan, convertible];
    const views = new EntityViews(look);
    views.setTrafficTypes(ids.map(typeDef));
    const entities = entitiesFor(ids, 2);
    views.sync(null, snapshotOf(entities), 1, 0);
    expect(instanced(views).some((m) => m.name.startsWith('views-vehicle:'))).toBe(false);
    expect(views.liveCount()).toBe(entities.length);
    views.setVehicleModels(await realSets(ids));
    views.sync(null, snapshotOf(entities), 1, 0.1);
    expect(instanced(views).filter((m) => m.name.startsWith('views-vehicle:')).length).toBeGreaterThan(0);
    expect(views.liveCount()).toBe(entities.length);
    expect(views.viewCounts().vehicles).toBe(entities.length);
  });

  it('keeps the boxes for a type whose model failed to load, and never throws', async () => {
    const ids = [pickup, convertible];
    const sets = await realSets(ids, new Set(['models/traffic/pickup']));
    expect(sets.has(pickup)).toBe(false);
    expect(sets.has(convertible)).toBe(true);
    const views = new EntityViews(look);
    views.setTrafficTypes(ids.map(typeDef));
    views.setVehicleModels(sets);
    views.sync(null, snapshotOf(entitiesFor(ids, 2)), 1, 0);
    const names = instanced(views).map((m) => m.name);
    expect(names).toContain('views-car');
    expect(names).toContain('views-vehicle:models/traffic/rental-convertible');
  });

  it('forgets a model for a type the next race does not use', async () => {
    const views = await viewsWith([pickup]);
    views.setTrafficTypes([typeDef(sedan)]);
    views.sync(null, snapshotOf(entitiesFor([pickup], 1)), 1, 0);
    // The pickup is not in this race's catalog any more: it is drawn by the generic shape.
    expect(instanced(views).some((m) => m.name.startsWith('views-vehicle:'))).toBe(false);
  });

  it('loads only what a race needs, and one failing model leaves the rest', async () => {
    const ids = [sedan, pickup, 'base:golf-cart'];
    const sets = await loadVehicleSets(diskManifest(new Set(['models/traffic/sedan'])), ids);
    expect([...sets.keys()], 'no golf cart (no row), no sedan (it failed)').toEqual([pickup]);
    expect(sets.get(pickup)?.variants.map((v) => v.asset)).toEqual(['models/traffic/pickup']);
  });
});

describe("a region's traffic with models draws at most 2 more calls than with boxes", () => {
  const DRAW_CAP = 2;
  const MODELS_PER_POOL_CAP = 8;
  const pools = regionPools().filter((p) => p.ids.length > 0);

  it('holds for every pool of every region, with at most 8 distinct models in view', async () => {
    expect(pools.length).toBeGreaterThan(3);
    const lines: string[] = [];
    for (const pool of pools) {
      const { boxes, models, meshes } = await modelDrawDelta(pool.ids);
      lines.push(
        `${pool.name}: ${boxes} draw calls as boxes, ${models} with models (+${models - boxes}), ${meshes} model meshes`,
      );
      expect(models - boxes, pool.name).toBeLessThanOrEqual(DRAW_CAP);
      expect(meshes, pool.name).toBeLessThanOrEqual(MODELS_PER_POOL_CAP);
    }
    stdout.write(
      `[examined] draw calls by pool, every type of the pool in view at once:\n  ${lines.join('\n  ')}\n`,
    );
  });
});
