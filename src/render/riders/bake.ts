// Bakes a rider or bike GLB into one rigid-skinned part (interview, 2026-10-02: "Real models now").
// Both kinds come from the scripted Blender pipeline (tools/blender/riders/README.md for riders,
// tools/blender/README.md and PR #300's node contract for bikes): every mesh hangs from one named
// bone node, so each vertex is skinned to that bone with weight 1. A rider and its bike then draw
// as one SkinnedMesh, one draw call, posed by moving bones (pose.ts, index.ts).
//
// The GLBs face +Z (glTF); the game's models face -Z, so the part is turned half round about Y here,
// once: after baking, a part's rest frame is the game's (x right, y up, forward -z).
import { Color, Group, Vector3, type Material, type Mesh, type Object3D } from 'three';

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
    extras: { ...root.userData },
    triangles: total / 3,
  };
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
