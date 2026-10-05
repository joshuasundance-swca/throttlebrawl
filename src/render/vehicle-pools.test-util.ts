// Test helper (playtest 3, T12.2): the real traffic types, the real regions' traffic pools and the
// real vehicle models, so the tests of the traffic models check the game's own data and not
// fixtures. A pool is the set of traffic types a stretch of road can put in view together: the
// region's own mix, or one area's mix (an area's weights replace the region's where the road runs
// through it, so the types of two areas are never both spawned from one pool).
import { InstancedMesh, Mesh, type Object3D } from 'three';
import type { AssetManifest } from '../assets';
import type { EntitySnapshot, SimSnapshot, SimTrafficTypeDef } from '../sim/api';
import { createFlatLook } from './look';
import { loadVehicleSets, type VehicleSets } from './vehicles';
import { EntityViews } from './views';

interface TypeFile {
  id: string;
  category: SimTrafficTypeDef['category'];
  lengthM: number;
  widthM: number;
  hazard: SimTrafficTypeDef['hazard'];
  look?: { paintOptions?: string[] };
}

interface RegionFile {
  traffic?: {
    mix?: { kind: string }[];
    areas?: { tag: string; mix: { kind: string }[] }[];
  };
}

const TYPE_FILES = import.meta.glob<TypeFile>('/packs/*/traffic/*.json', { eager: true, import: 'default' });
const REGION_FILES = import.meta.glob<RegionFile>('/packs/*/regions/*/region.json', {
  eager: true,
  import: 'default',
});

const packOf = (path: string): string => /^\/packs\/([^/]+)\//.exec(path)?.[1] ?? '';

/** Every traffic type file of every pack, by content id (`<pack>:<id>`). */
export function typeFiles(): Map<string, TypeFile> {
  const out = new Map<string, TypeFile>();
  for (const [path, file] of Object.entries(TYPE_FILES)) out.set(`${packOf(path)}:${file.id}`, file);
  return out;
}

/** The sim's view of a type file: what the renderer is told about each type. */
export function typeDef(contentId: string): SimTrafficTypeDef {
  const file = typeFiles().get(contentId);
  if (!file) throw new Error(`no traffic type ${contentId}`);
  return {
    contentId,
    category: file.category,
    lengthM: file.lengthM,
    widthM: file.widthM,
    cruiseMps: 10,
    hazard: file.hazard,
  };
}

export const isRoadVehicle = (def: SimTrafficTypeDef): boolean =>
  def.category !== 'pedestrian' && def.category !== 'animal';

export interface Pool {
  /** The region and the part of its road the pool is for. */
  name: string;
  /** Content ids of the road vehicles in the pool. */
  ids: string[];
}

/** Every region's traffic pools, road vehicles only. */
export function regionPools(): Pool[] {
  const known = typeFiles();
  const out: Pool[] = [];
  for (const [path, file] of Object.entries(REGION_FILES)) {
    const pack = packOf(path);
    const region = /\/regions\/([^/]+)\//.exec(path)?.[1] ?? pack;
    const idsOf = (mix: { kind: string }[] = []): string[] =>
      mix
        .map((m) => (m.kind.includes(':') ? m.kind : `${pack}:${m.kind}`))
        .filter((id) => {
          const t = known.get(id);
          return t !== undefined && t.category !== 'pedestrian' && t.category !== 'animal';
        });
    out.push({ name: `${region} (its whole mix)`, ids: idsOf(file.traffic?.mix) });
    for (const area of file.traffic?.areas ?? [])
      out.push({ name: `${region}, ${area.tag}`, ids: idsOf(area.mix) });
  }
  return out;
}

/** Reads a repo file in the test runner (Node); the app's own types have no Node, so it is untyped here. */
export async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(rel.replace(/^\//, ''));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * An asset manifest that reads the base pack's models from disk, the way the build's manifest
 * serves them. An id in `failing` falls back to its stand-in, as a missing or corrupt file does.
 */
export function diskManifest(failing: ReadonlySet<string> = new Set()): AssetManifest {
  const load: AssetManifest['load'] = async <T>(
    id: string,
    standIn: () => T,
    opts?: { decode?: (data: ArrayBuffer, entry: never) => T | Promise<T> },
  ) => {
    try {
      if (failing.has(id)) throw new Error('missing');
      const data = await readRepoFile(`packs/base/assets/${id}.glb`);
      if (!opts?.decode) throw new Error('no decoder');
      const value = await opts.decode(data, undefined as never);
      return { id, source: 'baked' as const, value, fellBack: false };
    } catch (err) {
      return { id, source: 'procedural' as const, value: standIn(), fellBack: true, error: String(err) };
    }
  };
  return { load } as unknown as AssetManifest;
}

/** The vehicle sets for these types, loaded from the committed models. */
export function realSets(ids: readonly string[], failing?: ReadonlySet<string>): Promise<VehicleSets> {
  return loadVehicleSets(diskManifest(failing), ids);
}

/** `count` of each type, standing apart in front of the camera. */
export function entitiesFor(ids: readonly string[], count = 2): EntitySnapshot[] {
  const out: EntitySnapshot[] = [];
  let id = 1;
  for (const contentId of ids)
    for (let k = 0; k < count; k++) {
      out.push({
        id: id++,
        kind: 'vehicle',
        mode: 'Road',
        road: { edge: 0, s: id * 10, d: 0, h: 0, dir: 1, yaw: 0 },
        x: 2,
        y: 0,
        z: -20 - id * 12,
        heading: 0,
        speed: 10,
        lean: 0,
        contentId,
        name: `v${id}`,
        faction: 'rider',
        slot: -1,
        throttle: 0,
        rpm: 0,
        gear: 1,
        grounded: true,
        health: 100,
        healthMax: 100,
        attackPhase: 'idle',
        heldWeapon: null,
        targetId: -1,
        lastAttackerId: -1,
        progress: 0,
        distanceToFinish: 1000,
        place: 1,
        finished: false,
      });
    }
  return out;
}

export const snapshotOf = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 1000, finishOrder: [] },
  props: [],
  smashables: [],
});

/** Draw calls under a root: every visible mesh with something to draw (an instanced mesh counts once). */
export function drawCalls(root: Object3D): number {
  let n = 0;
  const walk = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof InstancedMesh) n += o.count > 0 ? 1 : 0;
    else if (o instanceof Mesh) n++;
    for (const c of o.children) walk(c);
  };
  walk(root);
  return n;
}

/**
 * The draw calls the entity views make for one of every type in `ids` (two each, all in view), as
 * the code-made boxes and as the models, and how many model meshes that is.
 */
export async function modelDrawDelta(
  ids: readonly string[],
): Promise<{ boxes: number; models: number; meshes: number }> {
  const entities = entitiesFor(ids, 2);
  const draw = async (withModels: boolean) => {
    const views = new EntityViews(createFlatLook());
    views.setTrafficTypes(ids.map(typeDef));
    if (withModels) views.setVehicleModels(await realSets(ids));
    views.sync(null, snapshotOf(entities), 1, 0);
    const meshes = views.root.children.filter(
      (o) => o instanceof InstancedMesh && o.visible && o.count > 0 && o.name.startsWith('views-vehicle:'),
    ).length;
    return { calls: drawCalls(views.root), meshes };
  };
  const boxes = await draw(false);
  const models = await draw(true);
  return { boxes: boxes.calls, models: models.calls, meshes: models.meshes };
}
