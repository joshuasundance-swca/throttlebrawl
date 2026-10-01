// The Blender models (playtest 1c item 4, approved 2026-09-30: "We can start"): the ramp truck,
// the palms, mangrove clumps, the bait shack, the power pole and the boats, from the base pack's
// GLBs (tools/blender/README.md has the node contract). Each model loads through the asset manifest
// by id and is baked here into one vertex-coloured geometry per variant: every flat material colour
// becomes a vertex colour, so a whole prop is one draw call per instance batch and every look
// recolours it the way it recolours the code-made props (one `prop` or `vehicle` material, no
// textures). Until a model has loaded, or if it fails, the road scene draws a code-made stand-in.
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
}

export type SceneryModels = Partial<Record<ModelKind, SceneryModel>>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Bakes one variant: every mesh under `root`, in the root's frame, flat colours as vertex colours. */
function bakeVariant(root: Object3D): { geometry: BufferGeometry; doubleSided: boolean } {
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
    for (let i = 0; i < count; i++) {
      const k = index ? index.getX(i) : i;
      p.fromBufferAttribute(pos, k).applyMatrix4(m);
      positions.push(p.x, p.y, p.z);
      if (nrm) n.fromBufferAttribute(nrm, k).applyMatrix4(nm).normalize();
      else n.set(0, 1, 0);
      normals.push(n.x, n.y, n.z);
      colors.push(c.r, c.g, c.b);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, doubleSided };
}

/** Bakes a loaded glTF scene into a scenery model. Throws when a root node is missing. */
export function bakeModel(kind: ModelKind, scene: Object3D): SceneryModel {
  scene.updateMatrixWorld(true);
  const variants: BufferGeometry[] = [];
  let doubleSided = false;
  for (const name of ROOTS[kind]) {
    const root = scene.getObjectByName(name);
    if (!root) throw new Error(`${MODEL_ASSETS[kind]} has no node ${name}`);
    const v = bakeVariant(root);
    variants.push(v.geometry);
    doubleSided ||= v.doubleSided;
  }
  const out: SceneryModel = { kind, variants, doubleSided };
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
): Promise<{ models: SceneryModels; report: ModelLoadReport }> {
  const models: SceneryModels = {};
  const report: ModelLoadReport = { loaded: [], fellBack: [] };
  await Promise.all(
    MODEL_KINDS.map(async (kind) => {
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
