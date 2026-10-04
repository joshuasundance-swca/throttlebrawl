// Skid marks and tyre smoke (playtest 3, T2.4; the maintainer's round 2: "smoke, skid marks, knee
// down and a camera lean" for the drift). Two meshes and so at most two draw calls, whatever the
// field is doing, each hidden while empty:
//   - one dynamic ribbon, a ring buffer of SKID_QUADS quads (SKID_WIDTH_M wide) laid under a tyre
//     that is sliding (a drift's rear tyre, a stoppie's front one). When the ring is full the
//     oldest quads are overwritten, so a long race never grows it;
//   - one InstancedMesh of SMOKE_MAX tyre-smoke puffs that rise and thin out.
// riders/index.ts owns an instance (the rider rigs are already a lazy chunk, so none of this is in
// the first load) and calls `lay` for every rider each frame. Presentation only: the smoke's
// scatter uses a non-seeded random source, which is allowed (nothing here feeds the sim).
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { mergeBoxes } from './geometry';

/** Quads in the ribbon's ring: at one a 0.3 m step, about 150 m of rubber. */
export const SKID_QUADS = 512;
/** How wide a mark is (a tyre's), m. */
export const SKID_WIDTH_M = 0.18;
/** Puffs of tyre smoke at most. */
export const SMOKE_MAX = 48;

/** Lift over the road so a mark never z-fights it (the blob shadows' number), m. */
const LIFT_M = 0.04;
/** A quad is laid per this much travel, m; a longer jump than MAX_STEP_M starts a new patch. */
const MIN_STEP_M = 0.3;
const MAX_STEP_M = 8;
const SMOKE_LIFE_S = 1.1;
/** Puffs a second under a tyre sliding at full strength. */
const SMOKE_RATE = 36;
const MARK_COLOR = '#0c0c0c';
const MARK_OPACITY = 0.55;
const SMOKE_COLOR = '#dcdcdc';
const SMOKE_OPACITY = 0.5;

interface Tyre {
  x: number;
  y: number;
  z: number;
  /** The unit sideways direction of the last quad (its end's cross-cut). */
  px: number;
  pz: number;
  /** Whether the last point is a live end of a mark (false after a break). */
  valid: boolean;
  /** Smoke owed, in puffs. */
  owed: number;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  size: number;
}

export class Skids {
  /** What the scene holds. */
  readonly root = new Group();
  readonly ribbon: Mesh;
  readonly smokeMesh: InstancedMesh;
  private readonly positions: Float32Array;
  private readonly posAttr: Float32BufferAttribute;
  private readonly tyres = new Map<number, Tyre>();
  private readonly puffs: Puff[] = [];
  /** Quads written so far (past SKID_QUADS the ring has wrapped). */
  private written = 0;
  private dirty = false;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly v = new Vector3();

  constructor(private readonly random: () => number = Math.random) {
    const geo = new BufferGeometry();
    // (The attribute copies what it is given, so the ring writes into the attribute's own array.)
    this.posAttr = new Float32BufferAttribute(new Float32Array(SKID_QUADS * 12), 3);
    this.positions = this.posAttr.array as Float32Array;
    geo.setAttribute('position', this.posAttr);
    const index = new Uint16Array(SKID_QUADS * 6);
    for (let i = 0; i < SKID_QUADS; i++) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    geo.setIndex(new Uint16BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    // Marks on the road, like the blob shadows: flat, unlit, no depth write, pulled toward the eye.
    const mat = new MeshBasicMaterial({
      color: MARK_COLOR,
      transparent: true,
      opacity: MARK_OPACITY,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.ribbon = new Mesh(geo, mat);
    this.ribbon.name = 'skid-marks';
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 1;
    this.ribbon.visible = false;

    this.smokeMesh = new InstancedMesh(
      // A turned cube, like the hurt bike's smoke (riders/index.ts): no new geometry class to load.
      mergeBoxes([{ size: [1, 1, 1], at: [0, 0, 0], color: SMOKE_COLOR, rotY: Math.PI / 4 }]),
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: SMOKE_OPACITY,
        depthWrite: false,
      }),
      SMOKE_MAX,
    );
    this.smokeMesh.name = 'tyre-smoke';
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 2;
    this.smokeMesh.count = 0;
    this.smokeMesh.visible = false;

    this.root.name = 'skids';
    this.root.add(this.ribbon, this.smokeMesh);
  }

  /**
   * One rider's tyre this frame: `at` is where it meets the road (world), or null when it is not
   * sliding (the mark breaks there). `strength` (0 to 1) scales the smoke, `dt` is the world's
   * seconds this frame (0 in a hit-stop).
   */
  lay(id: number, at: Vector3 | null, strength: number, dt: number): void {
    let t = this.tyres.get(id);
    if (!t) {
      t = { x: 0, y: 0, z: 0, px: 0, pz: 0, valid: false, owed: 0 };
      this.tyres.set(id, t);
    }
    if (!at) {
      t.valid = false;
      t.owed = 0;
      return;
    }
    if (t.valid) {
      const dx = at.x - t.x;
      const dz = at.z - t.z;
      const len = Math.hypot(dx, dz);
      if (len > MAX_STEP_M) t.valid = false;
      else if (len >= MIN_STEP_M) {
        const nx = -dz / len;
        const nz = dx / len;
        // The first quad of a patch is square to its own travel; later ones start where the last
        // ended (its cross-cut), so the ribbon has no seam.
        const sx = t.px === 0 && t.pz === 0 ? nx : t.px;
        const sz = t.px === 0 && t.pz === 0 ? nz : t.pz;
        this.write(t.x, t.y, t.z, sx, sz, at.x, at.y, at.z, nx, nz);
        t.x = at.x;
        t.y = at.y;
        t.z = at.z;
        t.px = nx;
        t.pz = nz;
      }
    }
    if (!t.valid) {
      t.x = at.x;
      t.y = at.y;
      t.z = at.z;
      t.px = 0;
      t.pz = 0;
      t.valid = true;
    }
    // The smoke owed at this strength; a puff leaves for each whole one.
    t.owed += SMOKE_RATE * Math.max(0, Math.min(1, strength)) * Math.max(0, dt);
    while (t.owed >= 1) {
      t.owed -= 1;
      this.puff(at, strength);
    }
  }

  private write(
    x0: number,
    y0: number,
    z0: number,
    px0: number,
    pz0: number,
    x1: number,
    y1: number,
    z1: number,
    px1: number,
    pz1: number,
  ): void {
    const h = SKID_WIDTH_M / 2;
    const slot = (this.written % SKID_QUADS) * 12;
    const p = this.positions;
    const ya = y0 + LIFT_M;
    const yb = y1 + LIFT_M;
    p.set(
      [
        x0 + px0 * h,
        ya,
        z0 + pz0 * h,
        x0 - px0 * h,
        ya,
        z0 - pz0 * h,
        x1 + px1 * h,
        yb,
        z1 + pz1 * h,
        x1 - px1 * h,
        yb,
        z1 - pz1 * h,
      ],
      slot,
    );
    this.written++;
    this.dirty = true;
  }

  private puff(at: Vector3, strength: number): void {
    if (this.puffs.length >= SMOKE_MAX) this.puffs.shift();
    const r = this.random;
    this.puffs.push({
      x: at.x + (r() - 0.5) * 0.3,
      y: at.y + 0.12,
      z: at.z + (r() - 0.5) * 0.3,
      vx: (r() - 0.5) * 1.4,
      vy: 0.5 + r() * 0.7,
      vz: (r() - 0.5) * 1.4,
      age: 0,
      size: 0.5 + 0.5 * strength + r() * 0.3,
    });
  }

  /** Forgets a rider's tyre (its entity left the snapshot), so a new rider on that id starts fresh. */
  forget(id: number): void {
    this.tyres.delete(id);
  }

  /** Wipes the marks and the smoke (a new race). */
  clear(): void {
    this.written = 0;
    this.dirty = true;
    this.positions.fill(0);
    this.puffs.length = 0;
    this.tyres.clear();
    this.sync();
    this.smokeMesh.count = 0;
    this.smokeMesh.visible = false;
  }

  /** Once a frame, after every rider's `lay`: ages the smoke and pushes the buffers to the GPU. */
  endFrame(dt: number): void {
    const step = Math.max(0, dt);
    for (const p of this.puffs) {
      p.age += step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.z += p.vz * step;
      const damp = Math.exp(-1.8 * step);
      p.vx *= damp;
      p.vz *= damp;
    }
    while (this.puffs.length && (this.puffs[0]?.age ?? 0) > SMOKE_LIFE_S) this.puffs.shift();
    let n = 0;
    for (const p of this.puffs) {
      const k = Math.min(1, p.age / SMOKE_LIFE_S);
      // It swells as it rises, then thins away over its last third (the shrinking is the fade:
      // one material cannot give each puff its own opacity).
      const fade = k > 0.7 ? (1 - k) / 0.3 : 1;
      this.s.setScalar(Math.max(0.001, p.size * (0.3 + 0.9 * k) * fade));
      this.v.set(p.x, p.y, p.z);
      this.m.compose(this.v, this.q.identity(), this.s);
      this.smokeMesh.setMatrixAt(n++, this.m);
    }
    this.smokeMesh.count = n;
    this.smokeMesh.visible = n > 0;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.sync();
  }

  private sync(): void {
    const quads = Math.min(this.written, SKID_QUADS);
    this.ribbon.geometry.setDrawRange(0, quads * 6);
    this.ribbon.visible = quads > 0;
    if (this.dirty) {
      this.posAttr.needsUpdate = true;
      this.dirty = false;
    }
  }

  counts(): { quads: number; smoke: number } {
    return { quads: Math.min(this.written, SKID_QUADS), smoke: this.puffs.length };
  }

  dispose(): void {
    this.ribbon.geometry.dispose();
    (this.ribbon.material as MeshBasicMaterial).dispose();
    this.smokeMesh.geometry.dispose();
    (this.smokeMesh.material as MeshBasicMaterial).dispose();
    this.smokeMesh.dispose();
  }
}
