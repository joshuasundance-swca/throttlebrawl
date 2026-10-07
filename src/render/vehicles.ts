// Traffic models (playtest 3, T12.2; the assets plan's W3): the Blender vehicles from the Codex
// batches (the shared kit, CX1, and the Keys' own, CX2) drawn in place of the code-made car and
// truck boxes. A pack says which model stands for which of its traffic types in its own render-only
// data file, `assets/traffic-models.json`, and never in the type's JSON (which the sim reads: a
// model is presentation, so it cannot reach the sim's replay key or content hash). This module is a
// lazy chunk: views.ts fetches it with a race's traffic types, never in the first load.
//
// A vehicle model (tools/blender/README.md, "Vehicles") is a root `vehicle` on the ground under the
// middle of its wheelbase, front +Z, with every part, wheels included, in one mesh and the paint
// authored white. It is baked here into one vertex-coloured geometry, turned to face -z like the
// boxes (a heading of 0 drives toward -z) and centred on its box, so views.ts places it where it
// placed a box. The instance tint (the type's paint) multiplies every colour, so only the white
// paint takes it; the glass, tyres and lamps stay dark.
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three';
import type { AssetManifest } from '../assets';
import { readGlb } from './glb';

/** A pack's mapping of one traffic type to its models (see `assets/traffic-models.json`). */
export interface VehicleRow {
  /** Asset ids of the models (`models/traffic/<name>`); an entity takes one by its id, for variety. */
  readonly models: readonly string[];
  /** The paints the type's instances wear, from the type file's own `look.paintOptions`. */
  readonly paint: readonly string[];
}

/** What the data file holds. `types` is keyed by content id (`<pack>:<id>`). */
export interface TrafficModelsFile {
  formatVersion: 1;
  notes?: string;
  types: Record<string, VehicleRow>;
}

/** A vehicle model baked for drawing: metres, front toward -z, centred on its box, ground at y = 0. */
export interface BakedVehicle {
  /** The model's asset id: also what its instanced mesh is keyed by. */
  readonly asset: string;
  /** Position, normal (flat faces) and colour, as a triangle list with no index. */
  readonly geometry: BufferGeometry;
  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM: number;
  /** The `hood` empty, in the baked frame: the middle of the hood's top (the wheelie launch seam). */
  readonly hoodAt: { readonly y: number; readonly z: number };
}

/** One traffic type's models and paints, as drawn. */
export interface VehicleSet {
  readonly variants: readonly BakedVehicle[];
  readonly paint: readonly string[];
}

/** The types of a race that draw from a model, by content id. */
export type VehicleSets = ReadonlyMap<string, VehicleSet>;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/**
 * The rows of every pack's data file, merged (a row that is not `{ models: string[], paint: string[] }`
 * with at least one model is left out, so one bad row never costs a race its other models).
 */
export function trafficModelRows(files: Readonly<Record<string, unknown>>): Map<string, VehicleRow> {
  const out = new Map<string, VehicleRow>();
  for (const file of Object.values(files)) {
    const types = (file as { types?: unknown } | null)?.types;
    if (!types || typeof types !== 'object') continue;
    for (const [id, row] of Object.entries(types)) {
      const r = row as { models?: unknown; paint?: unknown } | null;
      if (!r || !isStrings(r.models) || r.models.length === 0) continue;
      out.set(id, { models: r.models, paint: isStrings(r.paint) ? r.paint : [] });
    }
  }
  return out;
}

/** Every pack's data file, bundled into this lazy chunk (a few hundred bytes each). */
const FILES = import.meta.glob<unknown>('/packs/*/assets/traffic-models.json', {
  eager: true,
  import: 'default',
});
const ROWS = trafficModelRows(FILES);

/** Sets the normals of each triangle of a flat triangle list to its face's. */
function faceNormals(positions: number[]): number[] {
  const out: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let v = 0; v + 2 < positions.length / 3; v += 3) {
    a.fromArray(positions, v * 3);
    b.fromArray(positions, v * 3 + 3).sub(a);
    c.fromArray(positions, v * 3 + 6).sub(a);
    b.cross(c).normalize();
    for (let k = 0; k < 3; k++) out.push(b.x, b.y, b.z);
  }
  return out;
}

/** Bakes a loaded vehicle GLB (see the file header). Throws when the scene has no `vehicle` root. */
export function bakeVehicle(asset: string, scene: Object3D): BakedVehicle {
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('vehicle');
  if (!root) throw new Error(`${asset} has no vehicle node`);
  const toRoot = root.matrixWorld.clone().invert();
  // Front +z to front -z: a half turn about y (the boxes' own facing).
  const turn = new Matrix4().makeRotationY(Math.PI);
  const positions: number[] = [];
  const colours: number[] = [];
  const m = new Matrix4();
  const p = new Vector3();
  const c = new Color();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    c.copy((mat as { color?: Color } | undefined)?.color ?? new Color(1, 1, 1));
    m.multiplyMatrices(turn, toRoot).multiply(mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
      positions.push(p.x, p.y, p.z);
      colours.push(c.r, c.g, c.b);
    }
  });
  if (positions.length === 0) throw new Error(`${asset} has no geometry`);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error(`${asset} has no bounds`);
  // Centre on the box (x and z), so an entity's position is the middle of the vehicle, as for a box.
  const midX = (box.min.x + box.max.x) / 2;
  const midZ = (box.min.z + box.max.z) / 2;
  geometry.translate(-midX, 0, -midZ);
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(faceNormals(Array.from(geometry.getAttribute('position').array)), 3),
  );
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const hood = scene.getObjectByName('hood');
  const hoodAt = new Vector3();
  if (hood) hoodAt.setFromMatrixPosition(hood.matrixWorld).applyMatrix4(toRoot).applyMatrix4(turn);
  return {
    asset,
    geometry,
    lengthM: box.max.z - box.min.z,
    widthM: box.max.x - box.min.x,
    heightM: box.max.y,
    hoodAt: { y: hoodAt.y, z: hoodAt.z - midZ },
  };
}

/**
 * Loads the models the given traffic types draw from, through the asset manifest, once each (a model the
 * host held back is asked for again at the next race, polish batch L). A model
 * that is missing, fails its hash or does not parse is left out; a type whose every model is left
 * out is left out too, and views.ts keeps drawing its box.
 */
export async function loadVehicleSets(
  assets: AssetManifest,
  contentIds: readonly string[],
  rows: ReadonlyMap<string, VehicleRow> = ROWS,
): Promise<VehicleSets> {
  const wanted = contentIds.filter((id) => rows.has(id));
  const needed = [...new Set(wanted.flatMap((id) => rows.get(id)?.models ?? []))];
  const baked = new Map<string, BakedVehicle>();
  await Promise.all(
    needed.map(async (asset) => {
      const res = await assets.load<BakedVehicle | null>(asset, () => null, {
        decode: (data) => bakeVehicle(asset, readGlb(data)),
      });
      if (res.value) baked.set(asset, res.value);
    }),
  );
  const out = new Map<string, VehicleSet>();
  for (const id of wanted) {
    const row = rows.get(id);
    const variants = (row?.models ?? []).flatMap((a) => baked.get(a) ?? []);
    if (row && variants.length) out.set(id, { variants, paint: row.paint });
  }
  return out;
}
