// The Blender models (playtest 1c item 4, approved 2026-09-30: "We can start"): the ramp truck,
// the palms, mangrove clumps, the bait shack, the power pole and the boats, from the base pack's
// GLBs (tools/blender/README.md has the node contract). Each model loads through the asset manifest
// by id and is baked here into one vertex-coloured geometry per variant: every flat material colour
// becomes a vertex colour, so a whole prop is one draw call per instance batch and every look
// recolours it the way it recolours the code-made props (one `prop` or `vehicle` material, no
// textures). Until a model has loaded, or if it fails, the road scene draws a code-made stand-in.
// The region build-out (W-O, the maintainer, 2026-10-01) adds the Pacific Northwest's conifers,
// sawmill and trestle bent and San Francisco's row houses, cable car and fog banks. They load only
// when a race's network needs them (`modelKindsFor`), and a region palette repaints them by role.
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

/** Each model's asset id (docs/content-packs.md, "Asset references"). */
export const MODEL_ASSETS = {
  truck: 'models/props/tow-truck',
  palms: 'models/scenery/palms',
  mangroves: 'models/scenery/mangroves',
  baitShack: 'models/scenery/bait-shack',
  powerPole: 'models/scenery/power-pole',
  skiff: 'models/scenery/skiff',
  boat: 'models/props/boat',
  conifers: 'models/scenery/conifers',
  rowHouses: 'models/scenery/row-houses',
  sawmill: 'models/scenery/sawmill',
  trestleBent: 'models/scenery/trestle-bent',
  fogBanks: 'models/scenery/fog-banks',
  cableCar: 'models/props/cable-car',
  pnwRoadside: 'models/scenery/pnw-roadside',
  sfRoadside: 'models/scenery/sf-roadside',
  keysRoadside: 'models/scenery/keys-roadside',
  // run W-Q: the little islands off every Keys bridge (scenery.ts, the islet kind)
  keysIslets: 'models/scenery/keys-islets',
} as const;
export type ModelKind = keyof typeof MODEL_ASSETS;
export const MODEL_KINDS = Object.keys(MODEL_ASSETS) as ModelKind[];

/** The root nodes of each model: one variant per root, its origin at the anchor the README names. */
const ROOTS: Readonly<Record<ModelKind, readonly string[]>> = {
  truck: ['tow_truck'],
  palms: ['palm_a', 'palm_b', 'palm_c'],
  mangroves: ['mangrove_a', 'mangrove_b'],
  baitShack: ['bait_shack'],
  powerPole: ['power_pole'],
  skiff: ['skiff'],
  boat: ['boat'],
  conifers: ['conifer_a', 'conifer_b', 'conifer_c', 'conifer_d'],
  rowHouses: ['row_house_a', 'row_house_b', 'row_house_c', 'row_house_d'],
  sawmill: ['sawmill'],
  trestleBent: ['trestle_bent'],
  fogBanks: ['fog_bank_a', 'fog_bank_b'],
  cableCar: ['cable_car'],
  pnwRoadside: [
    'pnw_fern',
    'pnw_salal',
    'pnw_stump',
    'pnw_rock',
    'pnw_mailbox',
    'pnw_firewood',
    'pnw_split_rail',
    'pnw_log_fence',
    'pnw_sign',
    'pnw_espresso',
    'pnw_maple',
    'pnw_alder',
  ],
  sfRoadside: [
    'sf_sedan',
    'sf_hatch',
    'sf_robotaxi',
    'sf_tree',
    'sf_hydrant',
    'sf_scooter',
    'sf_board_ai',
    'sf_board_agi',
    'sf_board_gpu',
    'sf_store',
    'sf_meter',
    'sf_bins',
    'sf_lamp',
  ],
  keysRoadside: [
    'keys_seagrape',
    'keys_seagrape_tree',
    'keys_traps',
    'keys_pelican',
    'keys_trailer',
    'keys_cottage_a',
    'keys_cottage_b',
    'keys_picket',
    'keys_mailbox',
    'keys_bait',
    'keys_pie',
  ],
  keysIslets: ['keys_islet_shack', 'keys_islet_wreck', 'keys_islet_mangrove', 'keys_islet_stilts'],
};

/** The models every network draws (the ramp truck, poles, shacks and boats). */
const ALWAYS: readonly ModelKind[] = ['truck', 'powerPole', 'baitShack', 'skiff', 'boat'];

/** What a network's dressing says about the models it needs (see `modelKindsFor`). */
export interface ModelNeeds {
  tropical: boolean;
  /** Every scenery tag on the network's roads. */
  tags: ReadonlySet<string>;
  /** The region's palette keys (fog banks follow `fogBank`). */
  palette: ReadonlySet<string>;
  /** Traffic content ids (the cable car follows a `cable-car` type). */
  traffic: readonly string[];
}

/**
 * The models a race needs, so a region's models load only when a race there starts (the GLBs are
 * separate files: a Keys race never fetches San Francisco's houses).
 */
export function modelKindsFor(n: ModelNeeds): ModelKind[] {
  const out = new Set<ModelKind>(ALWAYS);
  if (n.tropical) {
    out.add('palms');
    out.add('mangroves');
    out.add('keysRoadside');
    out.add('keysIslets');
  } else {
    if (n.tags.has('forest') || n.tags.has('sawmill')) out.add('conifers');
    if (n.tags.has('sawmill')) out.add('sawmill');
    if (n.tags.has('forest') && n.tags.has('bridge')) out.add('trestleBent');
    const urban = ['row-houses', 'painted-houses', 'gardens'].some((t) => n.tags.has(t));
    if (urban) {
      out.add('rowHouses');
      out.add('sfRoadside');
    }
    // Run W-P: each region's roadside kit (roadside.ts). San Francisco's forest (Twin Peaks)
    // keeps the city's kit; a forest road with no city on it is the Pacific Northwest's.
    else if (n.tags.has('forest') || n.tags.has('sawmill')) out.add('pnwRoadside');
  }
  if (n.palette.has('fogBank')) out.add('fogBanks');
  if (n.traffic.some((id) => /cable-car/.test(id))) out.add('cableCar');
  return MODEL_KINDS.filter((k) => out.has(k));
}

/**
 * Region palette keys that repaint a model's material roles (docs/content-packs.md, "Region packs
 * at runtime", Palette): the conifers' greens and bark, the row houses' four paints, the cable
 * car's body. Only these models are repainted; the Keys' models keep their own colours.
 */
export const ROLE_PALETTE: Readonly<Partial<Record<ModelKind, Readonly<Record<string, string>>>>> = {
  conifers: { foliage: 'foliage', foliage_dark: 'foliageDark', bark: 'trunk' },
  rowHouses: {
    paint_pink: 'rowHousePink',
    paint_mint: 'rowHouseMint',
    paint_yellow: 'rowHouseYellow',
    paint_blue: 'rowHouseBlue',
  },
  cableCar: { body: 'cableCar' },
};

/** The truck's ramp, measured on the model (the `ramp_surface` node and its extras). */
export interface RampMeasure {
  /** Run from the foot to the lip along the truck, m. */
  runM: number;
  /** Lip height above the ground, m. */
  lipM: number;
  /** The ramp surface's width, m. */
  widthM: number;
  /** The whole truck's length from the ramp foot, m. */
  lengthM: number;
}

export interface SceneryModel {
  kind: ModelKind;
  /** One merged geometry per variant (position, normal, color), in the variant's own frame. */
  variants: BufferGeometry[];
  /** True when a part is single-sided leaf geometry, so the batch draws both faces. */
  doubleSided: boolean;
  /** The truck's ramp numbers (the truck only). */
  ramp?: RampMeasure;
  /** Per variant, the vertex runs of each material role, so a palette can repaint a role. */
  roles?: readonly RoleRun[][];
}

/** A run of vertices baked from one material role. */
export interface RoleRun {
  role: string;
  start: number;
  count: number;
}

export type SceneryModels = Partial<Record<ModelKind, SceneryModel>>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Bakes one variant: every mesh under `root`, in the root's frame, flat colours as vertex colours. */
function bakeVariant(root: Object3D): { geometry: BufferGeometry; doubleSided: boolean; roles: RoleRun[] } {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const m = new Matrix4();
  const nm = new Matrix4();
  const p = new Vector3();
  const n = new Vector3();
  const c = new Color();
  let doubleSided = false;
  const roles: RoleRun[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const col = (mat as { color?: Color } | undefined)?.color;
    c.copy(col ?? new Color(1, 1, 1));
    if (mat && mat.side !== 0) doubleSided = true;
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    nm.copy(m).invert().transpose();
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    const start = positions.length / 3;
    roles.push({ role: mat?.name ?? '', start, count });
    for (let i = 0; i < count; i++) {
      const k = index ? index.getX(i) : i;
      p.fromBufferAttribute(pos, k).applyMatrix4(m);
      positions.push(p.x, p.y, p.z);
      if (nrm) n.fromBufferAttribute(nrm, k).applyMatrix4(nm).normalize();
      else n.set(0, 1, 0);
      normals.push(n.x, n.y, n.z);
      colors.push(c.r, c.g, c.b);
    }
    // A GLB shipped without normals (the roadside kits, run W-P, to halve their bytes) is faceted:
    // each triangle's normal is its face's.
    if (!nrm) faceNormals(positions, normals, start, count);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, doubleSided, roles };
}

/** Sets the normals of `count` triangle-list vertices from `start` to their faces' normals. */
function faceNormals(positions: number[], normals: number[], start: number, count: number): void {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let v = start; v + 2 < start + count; v += 3) {
    a.fromArray(positions, v * 3);
    b.fromArray(positions, v * 3 + 3).sub(a);
    c.fromArray(positions, v * 3 + 6).sub(a);
    b.cross(c).normalize();
    for (let k = 0; k < 3; k++) b.toArray(normals, (v + k) * 3);
  }
}

/** Bakes a loaded glTF scene into a scenery model. Throws when a root node is missing. */
export function bakeModel(kind: ModelKind, scene: Object3D): SceneryModel {
  scene.updateMatrixWorld(true);
  const variants: BufferGeometry[] = [];
  const roles: RoleRun[][] = [];
  let doubleSided = false;
  for (const name of ROOTS[kind]) {
    const root = scene.getObjectByName(name);
    if (!root) throw new Error(`${MODEL_ASSETS[kind]} has no node ${name}`);
    const v = bakeVariant(root);
    variants.push(v.geometry);
    roles.push(v.roles);
    doubleSided ||= v.doubleSided;
  }
  const out: SceneryModel = { kind, variants, doubleSided, roles };
  if (kind === 'truck') {
    const ramp = scene.getObjectByName('ramp_surface') as Mesh | undefined;
    if (!ramp?.isMesh) throw new Error(`${MODEL_ASSETS.truck} has no ramp_surface`);
    ramp.geometry.computeBoundingBox();
    const box = ramp.geometry.boundingBox;
    const whole = variants[0]?.boundingBox;
    out.ramp = {
      runM: num(ramp.userData['ramp_run_m']) ?? 11.5,
      lipM: num(ramp.userData['ramp_lip_height_m']) ?? 2.8,
      widthM: box ? box.max.x - box.min.x : 2.5,
      lengthM: whole ? whole.max.z : 21,
    };
  }
  return out;
}

/**
 * The model repainted by a region palette: a copy whose variants carry the palette's colour for
 * each role `ROLE_PALETTE` maps, or the model itself when the palette repaints nothing. The copy's
 * geometries are new (the road scene that asked for them disposes them).
 */
export function paintModel(
  model: SceneryModel,
  palette: Readonly<Record<string, string>> | undefined,
): SceneryModel {
  const map = ROLE_PALETTE[model.kind];
  if (!map || !palette || !model.roles) return model;
  const colours = new Map<string, Color>();
  for (const [role, key] of Object.entries(map)) {
    const hex = palette[key];
    if (hex) colours.set(role, new Color(hex));
  }
  if (!colours.size) return model;
  const variants = model.variants.map((g, v) => {
    const copy = g.clone();
    const col = copy.getAttribute('color');
    for (const run of model.roles?.[v] ?? []) {
      const c = colours.get(run.role);
      if (!c) continue;
      for (let i = run.start; i < run.start + run.count; i++) col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    return copy;
  });
  return { ...model, variants };
}

export interface ModelLoadReport {
  loaded: ModelKind[];
  /** Kinds that fell back to the code-made stand-in, with the manifest's reason. */
  fellBack: { kind: ModelKind; error: string }[];
}

/**
 * Loads every model through the asset manifest. A model that is missing, fails its hash or does not
 * parse is left out (the road scene keeps its stand-in) and listed in the report.
 */
export async function loadSceneryModels(
  manifest: AssetManifest,
  kinds: readonly ModelKind[] = MODEL_KINDS,
): Promise<{ models: SceneryModels; report: ModelLoadReport }> {
  const models: SceneryModels = {};
  const report: ModelLoadReport = { loaded: [], fellBack: [] };
  await Promise.all(
    kinds.map(async (kind) => {
      const res = await manifest.load<SceneryModel | null>(MODEL_ASSETS[kind], () => null, {
        decode: (data) => bakeModel(kind, readGlb(data)),
      });
      if (res.value) {
        models[kind] = res.value;
        report.loaded.push(kind);
      } else report.fellBack.push({ kind, error: res.error ?? 'no stand-in model' });
    }),
  );
  return { models, report };
}
