// Bakes a rider or bike GLB into one rigid-skinned part (interview, 2026-10-02: "Real models now").
// Both kinds come from the scripted Blender pipeline (tools/blender/riders/README.md for riders,
// tools/blender/README.md and PR #300's node contract for bikes): every mesh hangs from one named
// bone node, so each vertex is skinned to that bone with weight 1. A rider and its bike then draw
// as one SkinnedMesh, one draw call, posed by moving bones (pose.ts, index.ts).
//
// The GLBs face +Z (glTF); the game's models face -Z, so the part is turned half round about Y here,
// once: after baking, a part's rest frame is the game's (x right, y up, forward -z).
import { Box3, Color, Group, Vector3, type Material, type Mesh, type Object3D } from 'three';

/** A rider's bones, flat under its root (tools/blender/riders/_rider_lib.py BONES). */
export const RIDER_BONES = [
  'hips',
  'chest',
  'head',
  'upper_arm_l',
  'forearm_l',
  'upper_arm_r',
  'forearm_r',
  'thigh_l',
  'shin_l',
  'thigh_r',
  'shin_r',
  'coat_l',
  'coat_r',
  'tie',
  'hair',
  'prop',
] as const;
export type RiderBone = (typeof RIDER_BONES)[number];
/** Points the game measures a rider's limbs with: the palm centres and the ankles. */
export const RIDER_MARKERS = ['grip_l', 'grip_r', 'ankle_l', 'ankle_r'] as const;
/** What a rider's prop rides on (the root's `prop_mount` extra). */
export const PROP_MOUNTS = ['head', 'chest', 'hips', 'seat'] as const;
export type PropMount = (typeof PROP_MOUNTS)[number];

/** A bike's moving parts (PR #300's node contract): the frame, the fork and the wheels. */
export const BIKE_BONES = [
  'bike',
  'fork',
  'wheel_front',
  'wheel_rear',
  'wheel_front_l',
  'wheel_front_r',
  'wheel_rear_l',
  'wheel_rear_r',
] as const;
/** Where a rider sits, holds on and puts their feet, and where the lights are. */
export const BIKE_ANCHORS = [
  'seat_anchor',
  'bar_l',
  'bar_r',
  'peg_l',
  'peg_r',
  'light_head',
  'light_tail',
] as const;

export type PartKind = 'rider' | 'bike';

/**
 * The sim's contact box for a rider on a bike, metres (sim/traffic TRAFFIC.riderLengthM and
 * riderWidthM, the same in peds, smash, set pieces and the tumble's crash boxes; scripts/hitboxes.test.ts
 * holds the two equal). Playtest 4 (the maintainer, 2026-10-05: "I'd like all hitboxes on everything
 * to make sense"): every bike draws inside it, give or take `BIKE_FIT_SLACK_M` a side.
 */
export const RIDER_BOX_M = { lengthM: 2.0, widthM: 0.8 } as const;
/** How far a bike may draw past, or short of, the rider's box on each end and side before it is scaled, m. */
export const BIKE_FIT_SLACK_M = 0.12;

/**
 * The scale a bike of this footprint draws at so its ends and sides sit within `BIKE_FIT_SLACK_M` of
 * the rider's box: 1 for most, under 1 for the long tourers and the chopper, over 1 for the stubby
 * mobility scooter. One scale for all three axes, so the wheels stay round when they spin. A bike
 * whose shape cannot fit both ways (the wide, short trike and mower) takes the scale that misses
 * its length and its width by the same amount.
 */
export function bikeFitScale(lengthM: number, widthM: number): number {
  if (!(lengthM > 0) || !(widthM > 0)) return 1;
  const L = RIDER_BOX_M.lengthM;
  const W = RIDER_BOX_M.widthM;
  const [lo, hi] = fitRange(lengthM, widthM);
  // Never up: the rider is not scaled, so a bigger bike's pegs leave his feet (the mobility scooter).
  if (lo > 1) return 1;
  if (lo <= hi) return Math.min(hi, 1);
  // Too short for its width (or too long for it): the scale where the two misses are equal.
  return Math.min(1, (L + W) / (lengthM + widthM));
}

/** The scales that bring a bike's length and width each within the slack of the rider's box. */
function fitRange(lengthM: number, widthM: number): [number, number] {
  const L = RIDER_BOX_M.lengthM;
  const W = RIDER_BOX_M.widthM;
  const k = 2 * BIKE_FIT_SLACK_M;
  return [Math.max((L - k) / lengthM, (W - k) / widthM), Math.min((L + k) / lengthM, (W + k) / widthM)];
}

/**
 * Whether a bike is fitted to the rider's box, and so centred on it along its length. The ones that
 * are not (too short to fit without growing, or too wide and short for any one scale) keep their
 * modelled place under the rider: moving the lawnmower 0.08 m along its length leaves the riders'
 * feet short of its pegs (tools/blender/riders/riders.test.ts). scripts/hitboxes.test.ts names them.
 */
export function bikeFits(lengthM: number, widthM: number): boolean {
  if (!(lengthM > 0) || !(widthM > 0)) return true;
  const [lo, hi] = fitRange(lengthM, widthM);
  return lo <= hi && lo <= 1;
}

export interface BakedBone {
  name: string;
  /** The bone's rest position in the part's frame. */
  rest: Vector3;
  /** The nearest bone above it in the node tree, or -1. */
  parent: number;
}

export interface RoleRun {
  role: string;
  start: number;
  count: number;
}

export interface BakedPart {
  kind: PartKind;
  bones: BakedBone[];
  /** Triangle soup in the part's rest frame: 3 floats a vertex. */
  positions: Float32Array;
  /** Face normals (the GLBs ship without normals; every face is flat). */
  normals: Float32Array;
  /** Flat material colours, linear, 3 floats a vertex. */
  colors: Float32Array;
  /** The bone each vertex moves with. */
  boneOf: Uint8Array;
  /** Vertices of the core parts; `detail` parts (faces, prints, letters) follow them. */
  coreCount: number;
  /** Named points in the rest frame: a rider's markers, a bike's anchors. */
  points: Record<string, Vector3>;
  /** The bone each named point moves with. */
  pointBone: Record<string, number>;
  /** Vertex runs by material role, so a palette can repaint a role. */
  roles: RoleRun[];
  /** The root node's extras (a rider's `prop_mount` and `seat_m`; a bike's `wheelbase_m`). */
  extras: Record<string, unknown>;
  triangles: number;
}

const ROOT_NAME: Record<PartKind, string> = { rider: 'rider', bike: 'bike' };
const REQUIRED: Record<PartKind, readonly string[]> = {
  rider: [...RIDER_BONES, ...RIDER_MARKERS],
  bike: ['bike', 'fork', 'wheel_front', 'wheel_rear', 'seat_anchor', 'bar_l', 'bar_r', 'peg_l', 'peg_r'],
};

function isDetail(o: Object3D | null, stop: Object3D): boolean {
  for (let n = o; n && n !== stop; n = n.parent) if (n.userData['detail'] === true) return true;
  return false;
}

/**
 * Bakes a parsed GLB scene (glb.ts `readGlb`) into a part. Throws when a node the contract names is
 * missing, so a broken model falls back to the code-made rider instead of drawing wrongly.
 */
export function bakePart(scene: Object3D, kind: PartKind): BakedPart {
  const turn = new Group();
  turn.rotation.y = Math.PI;
  turn.add(scene);
  turn.updateMatrixWorld(true);
  let fit = 1;
  if (kind === 'bike') {
    // A bike is drawn at the rider's contact box's size (bikeFitScale), anchors and all,
    const box = new Box3().setFromObject(scene);
    fit = bikeFitScale(box.max.z - box.min.z, box.max.x - box.min.x);
    turn.scale.setScalar(fit);
    turn.updateMatrixWorld(true);
    // And centred on it along its length: the rider's box is centred on the rider's position.
    if (bikeFits(box.max.z - box.min.z, box.max.x - box.min.x)) {
      const fitted = new Box3().setFromObject(scene);
      turn.position.z = -(fitted.min.z + fitted.max.z) / 2;
      turn.updateMatrixWorld(true);
    }
  }
  for (const name of REQUIRED[kind]) {
    if (!scene.getObjectByName(name)) throw new Error(`${kind} model has no ${name} node`);
  }
  const root = scene.getObjectByName(ROOT_NAME[kind]) as Object3D;
  const boneNames: readonly string[] = kind === 'rider' ? RIDER_BONES : BIKE_BONES;
  const nodes: Object3D[] = [];
  const names: string[] = [];
  for (const name of boneNames) {
    const node = scene.getObjectByName(name);
    if (!node) continue;
    nodes.push(node);
    names.push(name);
  }
  const indexOf = new Map(nodes.map((n, i) => [n, i]));
  /** The bone a node moves with: itself or its nearest bone ancestor (a bike's frame by default). */
  const boneFor = (o: Object3D | null, fallback = kind === 'bike' ? 0 : -1): number => {
    for (let n: Object3D | null = o; n; n = n.parent) {
      const i = indexOf.get(n);
      if (i !== undefined) return i;
    }
    return fallback;
  };
  const v = new Vector3();
  const bones: BakedBone[] = nodes.map((n, i) => ({
    name: names[i] ?? '',
    rest: n.getWorldPosition(new Vector3()),
    parent: boneFor(n.parent, -1),
  }));
  const points: Record<string, Vector3> = {};
  const pointBone: Record<string, number> = {};
  for (const name of kind === 'rider' ? RIDER_MARKERS : BIKE_ANCHORS) {
    const node = scene.getObjectByName(name);
    if (!node) continue;
    points[name] = node.getWorldPosition(new Vector3());
    pointBone[name] = boneFor(node.parent);
  }

  type Run = { mesh: Mesh; bone: number; detail: boolean };
  const runs: Run[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const bone = boneFor(mesh);
    if (bone < 0) throw new Error(`${kind} mesh ${mesh.name || mesh.parent?.name || '?'} hangs from no bone`);
    runs.push({ mesh, bone, detail: kind === 'rider' && isDetail(mesh, root) });
  });
  const ordered = [...runs.filter((r) => !r.detail), ...runs.filter((r) => r.detail)];
  let total = 0;
  for (const r of ordered) {
    const g = r.mesh.geometry;
    total += g.getIndex()?.count ?? g.getAttribute('position').count;
  }
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const boneOf = new Uint8Array(total);
  const roles: RoleRun[] = [];
  const c = new Color();
  let at = 0;
  let coreCount = -1;
  for (const r of ordered) {
    if (r.detail && coreCount < 0) coreCount = at;
    const g = r.mesh.geometry;
    const pos = g.getAttribute('position');
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    const mat = (Array.isArray(r.mesh.material) ? r.mesh.material[0] : r.mesh.material) as
      (Material & { color?: Color }) | undefined;
    c.copy(mat?.color ?? new Color(1, 1, 1));
    roles.push({ role: mat?.name ?? '', start: at, count });
    const m = r.mesh.matrixWorld;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
      v.toArray(positions, (at + i) * 3);
      c.toArray(colors, (at + i) * 3);
      boneOf[at + i] = r.bone;
    }
    at += count;
  }
  if (coreCount < 0) coreCount = at;
  faceNormals(positions, normals);
  turn.remove(scene);
  return {
    kind,
    bones,
    positions,
    normals,
    colors,
    boneOf,
    coreCount,
    points,
    pointBone,
    roles,
    extras: fitExtras(root.userData, fit),
    triangles: total / 3,
  };
}

/** The root's extras, with a bike's measured `wheelbase_m` scaled with the bike. */
function fitExtras(data: Record<string, unknown>, fit: number): Record<string, unknown> {
  const out = { ...data };
  const wb = Number(out['wheelbase_m']);
  if (fit !== 1 && Number.isFinite(wb)) out['wheelbase_m'] = wb * fit;
  return out;
}

/** Each triangle's normal from its winding (the faceted look; the GLBs carry no normals). */
export function faceNormals(positions: Float32Array, out: Float32Array): void {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i + 8 < positions.length; i += 9) {
    a.fromArray(positions, i);
    b.fromArray(positions, i + 3).sub(a);
    c.fromArray(positions, i + 6).sub(a);
    b.cross(c);
    if (b.lengthSq() > 0) b.normalize();
    else b.set(0, 1, 0);
    for (let k = 0; k < 3; k++) b.toArray(out, i + k * 3);
  }
}

/** The bone index by name in a part, or -1. */
export function boneIndex(part: BakedPart, name: string): number {
  return part.bones.findIndex((b) => b.name === name);
}

/**
 * The bike's paint repainted with a rider's palette: `paint_primary` from the first colour,
 * `paint_secondary` from the third (or second), `paint_accent` and the sticker roles from the rest.
 * Returns new colours (the part's own are kept for the next rider on the same bike).
 */
export function paintedColors(part: BakedPart, palette: readonly string[] | null): Float32Array {
  const out = part.colors.slice();
  if (!palette || palette.length === 0) return out;
  const pick = (i: number) => palette[i] ?? palette[i % palette.length] ?? palette[0] ?? '#ffffff';
  const map: Record<string, string> = {
    paint_primary: pick(0),
    paint_secondary: palette.length > 2 ? pick(2) : pick(1),
    paint_accent: palette.length > 3 ? pick(3) : pick(1),
    decal_a: pick(1),
    decal_b: palette.length > 2 ? pick(2) : pick(0),
    decal_c: palette.length > 3 ? pick(3) : pick(1),
  };
  const c = new Color();
  for (const run of part.roles) {
    const hex = map[run.role];
    if (!hex) continue;
    c.set(hex);
    for (let i = run.start; i < run.start + run.count; i++) c.toArray(out, i * 3);
  }
  return out;
}
