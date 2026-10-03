// The roadside smashables (run W-T, the pitch deck's #4 part 2, "the road fights back"), drawn from
// SimSnapshot.smashables: lobster-trap stacks, mailbox rows, parking meters, a startup's pop-up desk,
// cafe tables and an honour-system firewood stand. Code-made, flat-coloured boxes (every look
// recolours them through the `prop` material; no textures, no grime). Every standing one, of every
// kind, is in one batched mesh (prop-batch.ts, run W-T's draw-call headroom; it was one instanced
// mesh per kind), so a race costs one draw call for them all. A smashed one comes apart: each of its
// boxes flies off as a piece of debris along whatever hit it, tumbles, and lies where it lands (one
// more instanced mesh for all the debris). The debris runs on the sim's time scale, so it hangs in
// the air through a takedown's slow motion.
// Presentation only: wall-clock time and Math.random are fine here.
import {
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { SimSnapshot, SmashableKind, SmashableSnapshot } from '../sim/api';
import { mergeBoxes, type BoxPart } from './geometry';
import type { LookStyle } from './look';
import { cullByInstances, PropBatch } from './prop-batch';

type Parts = BoxPart[];
const box = (
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  color: string,
  rot: { rotX?: number; rotY?: number } = {},
): BoxPart => ({ size, at, color, ...rot });

// ---- shapes (models face -z, toward the road; origin on the ground at the middle) -------------
// Drawn larger than life so they read at 100 mph (the sim's contact boxes match: sim/smash KIND_SPEC).

const WOOD = '#9a6a3f';
const DARK = '#2b2b2b';
const WHITE = '#f4f4f0';

function lobsterTraps(): Parts {
  const parts: Parts = [box([1.8, 0.16, 1.4], [0, 0.08, 0], WOOD)];
  const colors = ['#2f8f6b', '#e0b23a', '#2f8f6b', '#d8572a'];
  let k = 0;
  for (const y of [0.45, 1.02])
    for (const x of [-0.45, 0.45])
      for (const z of [-0.33, 0.33]) {
        if (y > 1 && x > 0 && z > 0) continue;
        parts.push(box([0.85, 0.55, 0.62], [x, y, z], colors[k++ % colors.length] ?? '#2f8f6b'));
      }
  // Buoys hung on the stack.
  parts.push(box([0.2, 0.34, 0.2], [0.7, 1.5, -0.4], '#ff6a13'));
  parts.push(box([0.2, 0.34, 0.2], [-0.3, 1.55, -0.45], WHITE));
  return parts;
}

function mailbox(): Parts {
  return [
    box([0.12, 1.1, 0.12], [0, 0.55, 0], '#6d5a44'),
    box([0.42, 0.4, 0.7], [0, 1.28, 0], '#cfd3d6'),
    box([0.46, 0.08, 0.74], [0, 1.5, 0], '#cfd3d6'),
    box([0.04, 0.3, 0.08], [0.24, 1.42, 0.2], '#c81d25'),
  ];
}

function parkingMeter(): Parts {
  return [
    box([0.1, 1.15, 0.1], [0, 0.575, 0], '#7a7f85'),
    box([0.32, 0.42, 0.24], [0, 1.36, 0], '#4a4f57'),
    box([0.22, 0.14, 0.03], [0, 1.42, -0.13], '#e8e2a0'),
    box([0.36, 0.06, 0.28], [0, 1.6, 0], '#3a3e45'),
  ];
}

function popUpDesk(): Parts {
  return [
    box([1.9, 0.9, 0.8], [0, 0.45, 0], WHITE),
    box([1.9, 0.6, 0.04], [0, 0.5, -0.42], '#6a2bd9'),
    box([0.5, 0.03, 0.34], [-0.4, 0.92, 0.05], DARK),
    box([0.5, 0.32, 0.03], [-0.4, 1.06, 0.2], '#3a3e45', { rotX: -0.25 }),
    box([0.06, 2.4, 0.06], [0.85, 1.2, 0.3], '#7a7f85'),
    box([0.04, 1.3, 0.55], [0.85, 1.65, 0.0], '#19b5b0'),
  ];
}

function cafeTable(): Parts {
  return [
    box([0.08, 0.72, 0.08], [0, 0.36, 0], '#3a3e45'),
    box([0.85, 0.05, 0.85], [0, 0.74, 0], '#e7e2d5'),
    box([0.06, 1.5, 0.06], [0, 1.5, 0], '#7a7f85'),
    box([1.7, 0.12, 1.7], [0, 2.2, 0], '#c0392b'),
    box([0.42, 0.05, 0.42], [-0.62, 0.45, 0], '#c0392b'),
    box([0.05, 0.45, 0.42], [-0.82, 0.68, 0], '#c0392b'),
    box([0.42, 0.05, 0.42], [0.62, 0.45, 0], DARK),
    box([0.05, 0.45, 0.42], [0.82, 0.68, 0], DARK),
  ];
}

function firewoodStand(): Parts {
  const parts: Parts = [
    box([1.6, 0.08, 0.9], [0, 0.5, 0], WOOD),
    box([0.08, 1.4, 0.08], [-0.76, 0.7, 0.4], WOOD),
    box([0.08, 1.4, 0.08], [0.76, 0.7, 0.4], WOOD),
    box([1.7, 0.08, 1.0], [0, 1.42, 0.05], '#5b7d4a'),
    box([0.8, 0.45, 0.04], [0, 1.78, -0.3], WHITE),
    box([0.26, 0.2, 0.2], [0.55, 0.64, -0.25], '#2b5fa8'),
  ];
  for (const x of [-0.5, 0, 0.5]) parts.push(box([0.42, 0.3, 0.62], [x, 0.7, 0.05], '#a8754a'));
  parts.push(box([0.42, 0.3, 0.62], [-0.25, 1.0, 0.05], '#b9824f'));
  return parts;
}

const SHAPES: Readonly<Record<SmashableKind, () => Parts>> = {
  'lobster-traps': lobsterTraps,
  mailbox,
  'parking-meter': parkingMeter,
  'pop-up-desk': popUpDesk,
  'cafe-table': cafeTable,
  'firewood-stand': firewoodStand,
};

/** A kind's boxes (an unknown kind: a magenta block, so a missing shape shows). */
export function smashableParts(kind: string): Parts {
  const shape = SHAPES[kind as SmashableKind];
  return shape ? shape() : [box([0.6, 0.6, 0.6], [0, 0.3, 0], '#ff00ff')];
}

// ---- debris -------------------------------------------------------------------------------

/** The most debris pieces on screen; the oldest wreck's pieces go first past it. */
export const MAX_DEBRIS = 480;
const GRAVITY = 9.81;
/** Share of the hitter's velocity a piece takes, and the spread and pop added. */
const CARRY = 0.55;
const SPREAD_MPS = 3.5;
const POP_MPS = 3;

interface Piece {
  owner: number;
  pos: Vector3;
  vel: Vector3;
  rot: Euler;
  spin: Vector3;
  size: Vector3;
  color: Color;
  /** Ground height under it (the prop's foot), m. */
  floor: number;
  resting: boolean;
}

/** What the last frame drew, for tests. */
export interface SmashableCounts {
  standing: Record<string, number>;
  smashed: number;
  debris: number;
}

export class Smashables {
  readonly root = new Group();
  /** Every standing one, of every kind, in one mesh (run W-T's draw-call headroom). */
  private readonly standing: PropBatch;
  private readonly geometries = new Map<string, BufferGeometry>();
  private debrisMesh: InstancedMesh | null = null;
  private readonly pieces: Piece[] = [];
  private readonly broken = new Set<number>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly yAxis = new Vector3(0, 1, 0);
  private lastT = -1;
  private last: SmashableCounts = { standing: {}, smashed: 0, debris: 0 };

  /**
   * `shared`: a batch on the same `prop` material to draw the standing ones in (the renderer passes
   * the road events' still batch, so the two draw as one); without it they get a batch of their own.
   */
  constructor(
    private readonly look: LookStyle,
    private readonly random: () => number = Math.random,
    shared?: PropBatch,
  ) {
    this.root.name = 'smashables';
    this.standing = shared ?? new PropBatch(this.material(), 'smashable-standing');
    if (!shared) this.root.add(this.standing.mesh);
  }

  private material(): Material {
    return this.look.material('prop', { vertexColors: true });
  }

  /** A kind's merged boxes, made once. */
  private geometry(kind: string): BufferGeometry {
    let g = this.geometries.get(kind);
    if (!g) {
      g = mergeBoxes(smashableParts(kind));
      this.geometries.set(kind, g);
    }
    return g;
  }

  private debris(): InstancedMesh {
    if (this.debrisMesh) return this.debrisMesh;
    const mesh = new InstancedMesh(
      mergeBoxes([box([1, 1, 1], [0, 0, 0], '#ffffff')]),
      this.material(),
      MAX_DEBRIS,
    );
    mesh.name = 'smashable-debris';
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.debrisMesh = mesh;
    this.root.add(mesh);
    return mesh;
  }

  /** Breaks one: its boxes become debris, thrown along what hit it. */
  private shatter(p: SmashableSnapshot): void {
    this.broken.add(p.id);
    const rnd = this.random;
    this.q.setFromAxisAngle(this.yAxis, p.heading);
    for (const part of smashableParts(p.kind)) {
      const at = new Vector3(part.at[0], part.at[1], part.at[2]).applyQuaternion(this.q);
      const vel = new Vector3(
        p.hitVx * CARRY + (rnd() - 0.5) * 2 * SPREAD_MPS,
        POP_MPS * (0.6 + rnd()),
        p.hitVz * CARRY + (rnd() - 0.5) * 2 * SPREAD_MPS,
      );
      this.pieces.push({
        owner: p.id,
        pos: new Vector3(p.x + at.x, p.y + at.y, p.z + at.z),
        vel,
        rot: new Euler(part.rotX ?? 0, p.heading + (part.rotY ?? 0), 0),
        spin: new Vector3((rnd() - 0.5) * 14, (rnd() - 0.5) * 10, (rnd() - 0.5) * 14),
        size: new Vector3(part.size[0], part.size[1], part.size[2]),
        color: new Color(part.color),
        floor: p.y,
        resting: false,
      });
    }
    if (this.pieces.length > MAX_DEBRIS) this.pieces.splice(0, this.pieces.length - MAX_DEBRIS);
  }

  /** Moves the debris by `dt` seconds of world time. */
  private fly(dt: number): void {
    if (dt <= 0) return;
    for (const piece of this.pieces) {
      if (piece.resting) continue;
      piece.vel.y -= GRAVITY * dt;
      piece.pos.addScaledVector(piece.vel, dt);
      piece.rot.x += piece.spin.x * dt;
      piece.rot.y += piece.spin.y * dt;
      piece.rot.z += piece.spin.z * dt;
      const lie = piece.floor + Math.min(piece.size.x, piece.size.y, piece.size.z) / 2;
      if (piece.pos.y <= lie) {
        piece.pos.y = lie;
        if (piece.vel.y < -2) {
          // A bounce, losing most of it, and a scrape along the ground.
          piece.vel.y *= -0.3;
          piece.vel.x *= 0.5;
          piece.vel.z *= 0.5;
          piece.spin.multiplyScalar(0.5);
        } else {
          piece.resting = true;
          // Flat on a face: the nearest quarter turn about x and z.
          piece.rot.x = Math.round(piece.rot.x / (Math.PI / 2)) * (Math.PI / 2);
          piece.rot.z = Math.round(piece.rot.z / (Math.PI / 2)) * (Math.PI / 2);
        }
      }
    }
  }

  /**
   * Draws the snapshot's smashables. `t` is wall-clock seconds; the debris moves by the frame's
   * time × the snapshot's time scale (frozen in a hit-stop, slow in a takedown's slow motion).
   */
  sync(snap: SimSnapshot | null, t: number): void {
    const list = snap?.smashables ?? [];
    const dtWall = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const present = new Set<number>();
    const standing = new Map<string, SmashableSnapshot[]>();
    let smashed = 0;
    for (const p of list) {
      present.add(p.id);
      if (p.smashedTick >= 0) {
        smashed++;
        if (!this.broken.has(p.id)) this.shatter(p);
        continue;
      }
      const group = standing.get(p.kind);
      if (group) group.push(p);
      else standing.set(p.kind, [p]);
    }
    // Wrecks left behind (out of the snapshot's window) are dropped.
    if (this.pieces.some((piece) => !present.has(piece.owner))) {
      const keep = this.pieces.filter((piece) => present.has(piece.owner));
      this.pieces.length = 0;
      this.pieces.push(...keep);
    }
    for (const id of [...this.broken]) if (!present.has(id)) this.broken.delete(id);
    this.fly(dtWall * (snap?.timeScale ?? 1));

    const counts: Record<string, number> = {};
    this.standing.begin('smashables');
    for (const [kind, group] of standing) {
      counts[kind] = group.length;
      const geometry = this.geometry(kind);
      for (const p of group) {
        this.v.set(p.x, p.y, p.z);
        this.q.setFromAxisAngle(this.yAxis, p.heading);
        this.s.set(1, 1, 1);
        this.standing.add(geometry, this.m.compose(this.v, this.q, this.s));
      }
    }
    // Rewritten only when one is smashed or the snapshot's window moves on.
    this.standing.end();
    if (this.pieces.length > 0 || this.debrisMesh) {
      const mesh = this.debris();
      this.pieces.forEach((piece, i) => {
        this.q.setFromEuler(piece.rot);
        this.m.compose(piece.pos, this.q, piece.size);
        mesh.setMatrixAt(i, this.m);
        mesh.setColorAt(i, piece.color);
      });
      mesh.count = this.pieces.length;
      mesh.visible = this.pieces.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // A wreck left behind (it stays in the snapshot for 450 m) is not drawn while out of view.
      cullByInstances(mesh);
    }
    this.last = { standing: counts, smashed, debris: this.pieces.length };
  }

  counts(): SmashableCounts {
    return this.last;
  }
}
