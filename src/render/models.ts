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
  /** Where the model's own flat deck ends, from the ramp foot, m (the road scene extends it). */
  deckEndM: number;
  /** The deck's colour (display sRGB), for that extension. */
  deckColour: string;
}

/**
 * The truck as the sim rides it (playtest 1c skeptic finding F2; render integration item 5): past
 * the lip the sim keeps a flat deck at the lip height all the way to the feature's end, so nothing of
 * the model may stand above that deck. The car on the top deck is left off (the truck still carries
 * the one under its deck), and the cab is lowered to fit under the deck, which the road scene runs on
 * over it to the front (road-mesh.ts). [default]
 */
export const TRUCK_FIT = {
  /** Nodes left out of the baked truck. */
  drop: ['car_1'] as readonly string[],
  /** The cab's new top, m: just under the deck (2.66 to 2.8 m on the model). */
  cabTopM: 2.6,
} as const;

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

/** Per-node changes a bake applies: nodes to leave out, and nodes scaled vertically from the ground. */
interface BakeFit {
  drop?: readonly string[];
  /** Node name to its vertical scale about y = 0. */
  squash?: Readonly<Record<string, number>>;
}

/** The named node a mesh sits under (itself included), among `names`, or null. */
function underNode(o: Object3D, stop: Object3D, names: readonly string[]): string | null {
  for (let p: Object3D | null = o; p && p !== stop; p = p.parent) if (names.includes(p.name)) return p.name;
  return null;
}

/** Bakes one variant: every mesh under `root`, in the root's frame, flat colours as vertex colours. */
function bakeVariant(root: Object3D, fit: BakeFit = {}): { geometry: BufferGeometry; doubleSided: boolean } {
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
    if (fit.drop && underNode(o, root, fit.drop)) return;
    const squashed = fit.squash ? underNode(o, root, Object.keys(fit.squash)) : null;
    const sy = squashed ? (fit.squash?.[squashed] ?? 1) : 1;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const col = (mat as { color?: Color } | undefined)?.color;
    c.copy(col ?? new Color(1, 1, 1));
    if (mat && mat.side !== 0) doubleSided = true;
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    if (sy !== 1) m.premultiply(new Matrix4().makeScale(1, sy, 1));
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
  const fit = kind === 'truck' ? truckFit(scene) : {};
  for (const name of ROOTS[kind]) {
    const root = scene.getObjectByName(name);
    if (!root) throw new Error(`${MODEL_ASSETS[kind]} has no node ${name}`);
    const v = bakeVariant(root, fit);
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
    const lipM = num(ramp.userData['ramp_lip_height_m']) ?? 2.8;
    const deck = trailerDeck(scene, lipM);
    out.ramp = {
      runM: num(ramp.userData['ramp_run_m']) ?? 11.5,
      lipM,
      widthM: box ? box.max.x - box.min.x : 2.5,
      lengthM: whole ? whole.max.z : 21,
      deckEndM: deck?.endM ?? 16.8,
      deckColour: deck?.colour ?? '#efe6c8',
    };
  }
  return out;
}

/** The truck's bake fit: car_1 left off, the cab squashed under the deck. */
function truckFit(scene: Object3D): BakeFit {
  const cab = scene.getObjectByName('cab');
  let top = 0;
  cab?.updateMatrixWorld(true);
  cab?.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
    if (box) top = Math.max(top, box.max.y);
  });
  return {
    drop: TRUCK_FIT.drop,
    squash: top > TRUCK_FIT.cabTopM ? { cab: TRUCK_FIT.cabTopM / top } : {},
  };
}

/** The trailer's flat top deck: the part whose top is at the lip height, its far end and colour. */
function trailerDeck(scene: Object3D, lipM: number): { endM: number; colour: string } | null {
  const trailer = scene.getObjectByName('trailer');
  let best: { endM: number; colour: string; width: number } | null = null;
  trailer?.updateMatrixWorld(true);
  trailer?.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
    if (!box || Math.abs(box.max.y - lipM) > 0.05) return;
    const width = box.max.x - box.min.x;
    if (best && width <= best.width) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const col = (mat as { color?: Color } | undefined)?.color;
    best = { endM: box.max.z, colour: `#${(col ?? new Color(1, 1, 1)).getHexString()}`, width };
  });
  return best;
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
