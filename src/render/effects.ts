// render-2's feel effects (docs/milestones/M2.md, render-2): the spark burst on a hit or a crash,
// the splash when a body goes over the bridge rail (water, a ring and a gator or a fisherman who
// reacts), and the cool slow-motion tint over the screen. Purely visual, so it may use wall-clock
// time and Math.random (docs/architecture.md, "Rendering, Structure"). Everything is pooled: sparks
// and droplets are one instanced draw call each, and nothing allocates per frame.
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
  type Camera,
  type PerspectiveCamera,
} from 'three';
import { CALM_SHARE } from './calm';
import { mergeBoxes, type BoxPart } from './geometry';
import type { LookStyle } from './look';
import type { RenderParams } from './tuning';

/** Sea level: the water plane a splash lands on (docs/architecture.md, "Crash tumble"). */
export const WATER_Y = 0;
const SPARK_CAP = 128;
/**
 * A hit's spark is a chip this big, m (G7, the wave B live check: at 0.12 m a burst beside the
 * player's bike, two metres from the lens, was a cloud of big flat yellow polygons over the lower
 * left of the screen). Inside SPARK_NEAR_M of the lens a chip is also scaled down with its
 * distance, so its size on screen stops growing: the closer the burst, the finer its chips.
 */
const SPARK_SIZE_M = 0.09;
const SPARK_NEAR_M = 6;
/** The least a spark shrinks to, as a share of its size, however close it is to the lens. */
const SPARK_NEAR_FLOOR = 0.25;
const DROP_CAP = 96;
/** W-T: sheets of paper from a burst briefcase; they drift down slowly (a light gravity). */
const PAPER_CAP = 64;
const PAPER_SHEETS = 28;
const PAPER_GRAVITY = 1.6;
const RING_CAP = 3;
const RING_S = 1.1;
const TINT_FADE_S = 0.15;
const GRAVITY = 9.81;

export type ReactorKind = 'gator' | 'fisherman';

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** A pool of short-lived particles drawn as one instanced mesh. */
class Particles {
  readonly mesh: InstancedMesh;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private live = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();

  constructor(
    name: string,
    geometry: BufferGeometry,
    material: InstancedMesh['material'],
    private readonly capacity: number,
    private readonly gravity: number,
    /** Particles below this y while falling die (droplets back into the sea). */
    private readonly floorY: number | null,
    /**
     * Where the camera is, or null: with it, a particle closer to the lens than `nearM` is drawn
     * smaller in proportion (never below `nearFloor` of its size), so its size on screen stays put.
     */
    private readonly eye: Vector3 | null = null,
    private readonly nearM = 0,
    private readonly nearFloor = 1,
  ) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
  }

  /** Live particles. */
  get count(): number {
    return this.live;
  }

  spawn(at: Point, vx: number, vy: number, vz: number, life: number): void {
    // Full: the oldest slot is overwritten (slot 0 after compaction holds the oldest).
    const i = this.live < this.capacity ? this.live++ : Math.floor(Math.random() * this.capacity);
    this.p[i * 3] = at.x;
    this.p[i * 3 + 1] = at.y;
    this.p[i * 3 + 2] = at.z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.live; i++) {
      const life = (this.life[i] ?? 0) - dt;
      let vy = (this.v[i * 3 + 1] ?? 0) - this.gravity * dt;
      const x = (this.p[i * 3] ?? 0) + (this.v[i * 3] ?? 0) * dt;
      const y = (this.p[i * 3 + 1] ?? 0) + vy * dt;
      const z = (this.p[i * 3 + 2] ?? 0) + (this.v[i * 3 + 2] ?? 0) * dt;
      const sunk = this.floorY !== null && vy < 0 && y < this.floorY;
      if (life <= 0 || sunk) continue;
      if (this.floorY === null && y < -50) continue;
      if (w !== i) {
        this.v[w * 3] = this.v[i * 3] ?? 0;
        this.v[w * 3 + 2] = this.v[i * 3 + 2] ?? 0;
        this.maxLife[w] = this.maxLife[i] ?? 1;
      }
      // Sparks fall no faster than this (they live well under a second).
      if (this.floorY === null && vy < -8) vy = -8;
      this.v[w * 3 + 1] = vy;
      this.p[w * 3] = x;
      this.p[w * 3 + 1] = y;
      this.p[w * 3 + 2] = z;
      this.life[w] = life;
      const k = life / (this.maxLife[w] || 1);
      let size = 0.35 + 0.65 * k;
      if (this.eye && this.nearM > 0) {
        const d = Math.hypot(x - this.eye.x, y - this.eye.y, z - this.eye.z);
        size *= Math.min(1, Math.max(this.nearFloor, d / this.nearM));
      }
      this.mesh.setMatrixAt(w, this.m.compose(this.pos.set(x, y, z), this.q, this.scale.setScalar(size)));
      w++;
    }
    this.live = w;
    this.mesh.count = w;
    this.mesh.visible = w > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Ring {
  mesh: Mesh;
  t: number;
}

interface Reactor {
  root: Group;
  /** Seconds since it appeared, or -1 when idle. */
  t: number;
  /** Where the splash landed, to face. */
  lookX: number;
  lookZ: number;
  baseY: number;
}

// ---- Placeholder models (face -z) -----------------------------------------------------------

const GATOR_PARTS: BoxPart[] = [
  { size: [0.7, 0.34, 1.0], at: [0, 0.1, 0.1], color: '#3f6b3a' },
  { size: [0.46, 0.2, 0.95], at: [0, 0.04, -0.85], color: '#4d7d45' },
  { size: [0.48, 0.05, 0.9], at: [0, -0.05, -0.85], color: '#f2efe0' },
  { size: [0.15, 0.15, 0.15], at: [-0.2, 0.32, 0.0], color: '#e8d25a' },
  { size: [0.15, 0.15, 0.15], at: [0.2, 0.32, 0.0], color: '#e8d25a' },
  { size: [0.06, 0.08, 0.04], at: [-0.2, 0.34, -0.08], color: '#111111' },
  { size: [0.06, 0.08, 0.04], at: [0.2, 0.34, -0.08], color: '#111111' },
  { size: [0.9, 0.2, 1.6], at: [0, -0.05, 1.3], color: '#355c31' },
];

const SKIFF_PARTS: BoxPart[] = [
  { size: [1.3, 0.45, 3.2], at: [0, 0.1, 0], color: '#e4ddcb' },
  { size: [1.1, 0.1, 3.0], at: [0, 0.3, 0], color: '#8a6f4a' },
  // The fisherman: boots, legs, a yellow slicker, a face and a bucket hat.
  { size: [0.4, 0.8, 0.26], at: [0, 0.75, 0.4], color: '#3a4a5a' },
  { size: [0.5, 0.62, 0.32], at: [0, 1.46, 0.4], color: '#f2c14e' },
  { size: [0.26, 0.28, 0.26], at: [0, 1.92, 0.4], color: '#d9a27a' },
  { size: [0.44, 0.08, 0.44], at: [0, 2.08, 0.4], color: '#6b5a3a' },
  // A rod propped in the stern.
  { size: [0.04, 0.04, 2.6], at: [0.45, 1.3, 1.3], color: '#222222', rotX: 0.7 },
];

const ARM_PARTS: BoxPart[] = [{ size: [0.13, 0.6, 0.13], at: [0, -0.3, 0], color: '#f2c14e' }];

const SPARK_PARTS: BoxPart[] = [
  { size: [SPARK_SIZE_M, SPARK_SIZE_M, SPARK_SIZE_M], at: [0, 0, 0], color: '#ffc23a' },
];
const DROP_PARTS: BoxPart[] = [{ size: [0.16, 0.16, 0.16], at: [0, 0, 0], color: '#ffffff' }];
/** A sheet of letter paper with a ruled line or two (the receipts were inside the briefcase). */
const PAPER_PARTS: BoxPart[] = [
  { size: [0.22, 0.012, 0.28], at: [0, 0, 0], color: '#f6f3ea', rotY: 0.4 },
  { size: [0.16, 0.014, 0.012], at: [0, 0.001, -0.06], color: '#8a96a8', rotY: 0.4 },
];

/** A flat quad with a vignette: faint in the middle, full at the edges (per-vertex alpha). */
function vignetteQuad(): BufferGeometry {
  const g = new PlaneGeometry(1, 1, 2, 2);
  const n = g.getAttribute('position').count;
  const colors: number[] = [];
  for (let i = 0; i < n; i++) colors.push(1, 1, 1, i === 4 ? 0.35 : 1); // vertex 4 is the centre
  g.setAttribute('color', new Float32BufferAttribute(colors, 4));
  return g;
}

export interface FeelCounts {
  sparks: number;
  drops: number;
  /** Sheets of paper in the air (W-T, a burst briefcase). */
  paper: number;
  rings: number;
  reactors: number;
  tint: number;
}

export class FeelEffects {
  /** World-space effects: add to the scene. */
  readonly root = new Group();
  /** The screen tint: add to the camera (it sits just in front of the near plane). */
  readonly tint: Mesh;
  private readonly sparks: Particles;
  private readonly drops: Particles;
  private readonly paper: Particles;
  private readonly rings: Ring[] = [];
  private readonly gator: Reactor;
  private readonly fisher: Reactor;
  private readonly fisherArms: [Group, Group];
  private tintLevel = 0;
  private now = 0;
  /** The camera's place (fitTint refreshes it each frame); `eyeKnown` once it has been told. */
  private readonly eye = new Vector3();
  private eyeKnown = false;
  private readonly params: RenderParams;

  constructor(look: LookStyle, params: RenderParams) {
    this.params = params;
    this.root.name = 'feel-effects';
    this.sparks = new Particles(
      'feel-sparks',
      mergeBoxes(SPARK_PARTS),
      look.material('spark', { vertexColors: true }),
      SPARK_CAP,
      14,
      null,
      this.eye,
      SPARK_NEAR_M,
      SPARK_NEAR_FLOOR,
    );
    this.drops = new Particles(
      'feel-splash-drops',
      mergeBoxes(DROP_PARTS),
      look.material('splash', { vertexColors: true }),
      DROP_CAP,
      GRAVITY,
      WATER_Y,
    );
    // A draw call only while sheets are in the air (Particles hides an empty pool).
    this.paper = new Particles(
      'feel-paperwork',
      mergeBoxes(PAPER_PARTS),
      look.material('prop', { vertexColors: true }),
      PAPER_CAP,
      PAPER_GRAVITY,
      null,
    );
    this.root.add(this.sparks.mesh, this.drops.mesh, this.paper.mesh);
    const ringGeometry = new RingGeometry(0.8, 1.05, 24).rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_CAP; i++) {
      const mesh = new Mesh(ringGeometry, look.material('splash', { doubleSided: true }));
      mesh.name = 'feel-splash-ring';
      mesh.visible = false;
      this.rings.push({ mesh, t: -1 });
      this.root.add(mesh);
    }
    const gatorRoot = new Group();
    gatorRoot.name = 'feel-gator';
    gatorRoot.rotation.order = 'YXZ';
    gatorRoot.add(new Mesh(mergeBoxes(GATOR_PARTS), look.material('prop', { vertexColors: true })));
    gatorRoot.visible = false;
    this.gator = { root: gatorRoot, t: -1, lookX: 0, lookZ: 0, baseY: WATER_Y };
    const fisherRoot = new Group();
    fisherRoot.name = 'feel-fisherman';
    fisherRoot.rotation.order = 'YXZ';
    fisherRoot.add(new Mesh(mergeBoxes(SKIFF_PARTS), look.material('prop', { vertexColors: true })));
    const armGeometry = mergeBoxes(ARM_PARTS);
    const arm = (x: number): Group => {
      const pivot = new Group();
      pivot.position.set(x, 1.7, 0.4);
      pivot.add(new Mesh(armGeometry, look.material('prop', { vertexColors: true })));
      fisherRoot.add(pivot);
      return pivot;
    };
    this.fisherArms = [arm(-0.3), arm(0.3)];
    fisherRoot.visible = false;
    this.fisher = { root: fisherRoot, t: -1, lookX: 0, lookZ: 0, baseY: WATER_Y };
    this.root.add(gatorRoot, fisherRoot);

    this.tint = new Mesh(vignetteQuad(), look.material('tint', { vertexColors: true, overlay: true }));
    this.tint.name = 'feel-slowmo-tint';
    this.tint.renderOrder = 1000;
    this.tint.frustumCulled = false;
    this.tint.visible = false;
  }

  /**
   * A spark burst at a contact point. `strength` scales the count (1 = a punch); `dirX, dirZ` is
   * the way the hit pushed (sparks fly mostly that way), or 0, 0 for all round.
   */
  burst(at: Point, strength: number, dirX = 0, dirZ = 0): void {
    const n = Math.round(this.params.sparkCount * strength);
    const speed = this.params.sparkSpeedMps;
    // The way from the lens to the burst: a spark never flies back along it, at the camera (G7:
    // sparks thrown at the lens filled the lower left of the screen).
    let ax = 0;
    let ay = 0;
    let az = 0;
    if (this.eyeKnown) {
      ax = at.x - this.eye.x;
      ay = at.y - this.eye.y;
      az = at.z - this.eye.z;
      const len = Math.hypot(ax, ay, az);
      if (len > 1e-6) {
        ax /= len;
        ay /= len;
        az /= len;
      } else ax = ay = az = 0;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + 0.8 * Math.random());
      let vx = Math.cos(a) * sp * 0.6 + dirX * sp;
      let vy = speed * (0.3 + 0.7 * Math.random());
      let vz = Math.sin(a) * sp * 0.6 + dirZ * sp;
      const toward = vx * ax + vy * ay + vz * az;
      if (toward < 0) {
        vx -= toward * ax;
        vy -= toward * ay;
        vz -= toward * az;
      }
      this.sparks.spawn(at, vx, vy, vz, 0.25 + 0.3 * Math.random());
    }
  }

  /**
   * Paperwork (W-T): a burst briefcase's sheets thrown up and out from `at`, drifting down over a
   * second or two.
   */
  paperwork(at: Point): void {
    for (let i = 0; i < PAPER_SHEETS; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = 1.2 + 2.8 * Math.random();
      this.paper.spawn(
        at,
        Math.cos(a) * out,
        1.5 + 2.5 * Math.random(),
        Math.sin(a) * out,
        1.2 + 0.8 * Math.random(),
      );
    }
  }

  /**
   * A splash at the water: a column of droplets, a ring, and a reactor (a gator surfacing, or a
   * fisherman in his skiff throwing his arms up) placed a few metres away along `awayX, awayZ`
   * (away from the bridge), facing the splash.
   */
  splash(at: Point, reactor: ReactorKind, awayX: number, awayZ: number): void {
    const water = { x: at.x, y: WATER_Y + 0.05, z: at.z };
    const up = Math.sqrt(2 * GRAVITY * this.params.splashHeightM);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = 0.8 + 2.2 * Math.random();
      this.drops.spawn(water, Math.cos(a) * out, up * (0.45 + 0.55 * Math.random()), Math.sin(a) * out, 3);
    }
    const ring = this.rings.find((r) => r.t < 0) ?? this.rings[0];
    if (ring) {
      ring.t = 0;
      ring.mesh.position.set(water.x, water.y, water.z);
      ring.mesh.scale.setScalar(1);
      ring.mesh.visible = true;
    }
    const len = Math.hypot(awayX, awayZ);
    const ux = len > 1e-6 ? awayX / len : 1;
    const uz = len > 1e-6 ? awayZ / len : 0;
    const r = reactor === 'gator' ? this.gator : this.fisher;
    const dist = reactor === 'gator' ? 4 : 8;
    r.t = 0;
    r.lookX = water.x;
    r.lookZ = water.z;
    r.root.position.set(water.x + ux * dist, WATER_Y - 1, water.z + uz * dist);
    // Face the splash: a model facing -z turned by h looks along (-sin h, -cos h).
    r.root.rotation.set(0, Math.atan2(-(water.x - r.root.position.x), -(water.z - r.root.position.z)), 0);
    r.root.visible = true;
  }

  /**
   * Advances the effects. `dt` is world-scaled seconds (slower in slow motion), `dtReal` real
   * seconds; `slowmo` says whether a takedown's slow motion runs.
   */
  update(dt: number, dtReal: number, slowmo: boolean): void {
    this.now += dtReal;
    this.sparks.update(dt);
    this.drops.update(dt);
    this.paper.update(dt);
    for (const ring of this.rings) {
      if (ring.t < 0) continue;
      ring.t += dt;
      const k = ring.t / RING_S;
      if (k >= 1) {
        ring.t = -1;
        ring.mesh.visible = false;
      } else ring.mesh.scale.setScalar(1 + 6 * k);
    }
    this.updateReactor(this.gator, dtReal, (r, k) => {
      // Surfaces, then snaps its jaws twice at the splash.
      r.root.rotation.x = -0.35 * Math.max(0, Math.sin(k * Math.PI * 4));
    });
    this.updateReactor(this.fisher, dtReal, (_r, k) => {
      const wave = Math.sin(this.now * 14) * 0.35;
      const up = k < 0.85 ? 2.7 : 0.3;
      this.fisherArms[0].rotation.set(0, 0, -(up + wave));
      this.fisherArms[1].rotation.set(0, 0, up - wave);
    });
    // The tint fades in and out over a few frames.
    const target = slowmo ? this.params.slowmoTint * (this.params.reduceMotion ? CALM_SHARE : 1) : 0;
    const step = dtReal / TINT_FADE_S;
    this.tintLevel =
      this.tintLevel < target
        ? Math.min(target, this.tintLevel + step * Math.max(target, 0.01))
        : Math.max(target, this.tintLevel - step * Math.max(this.params.slowmoTint, 0.01));
    this.tint.visible = this.tintLevel > 0.001;
    (this.tint.material as MeshBasicMaterial).opacity = this.tintLevel;
  }

  /** Sizes the tint to fill the camera's view just beyond its near plane. */
  fitTint(camera: Camera): void {
    camera.getWorldPosition(this.eye);
    this.eyeKnown = true;
    const cam = camera as PerspectiveCamera;
    const dist = Math.max(0.05, (cam.near ?? 0.1) * 1.5);
    const h = 2 * dist * Math.tan(((cam.fov ?? 60) * Math.PI) / 360);
    this.tint.position.set(0, 0, -dist);
    this.tint.scale.set(h * (cam.aspect ?? 1) * 1.1, h * 1.1, 1);
  }

  counts(): FeelCounts {
    return {
      sparks: this.sparks.count,
      drops: this.drops.count,
      paper: this.paper.count,
      rings: this.rings.filter((r) => r.t >= 0).length,
      reactors: (this.gator.t >= 0 ? 1 : 0) + (this.fisher.t >= 0 ? 1 : 0),
      tint: this.tint.visible ? this.tintLevel : 0,
    };
  }

  private updateReactor(r: Reactor, dtReal: number, animate: (r: Reactor, k: number) => void): void {
    if (r.t < 0) return;
    r.t += dtReal;
    const stay = this.params.reactorS;
    if (r.t >= stay) {
      r.t = -1;
      r.root.visible = false;
      return;
    }
    // Rise over 0.4 s, bob, sink over the last 0.5 s.
    const rise = Math.min(1, r.t / 0.4);
    const sink = Math.min(1, Math.max(0, (stay - r.t) / 0.5));
    r.root.position.y = r.baseY - 1 + Math.min(rise, sink) + Math.sin(this.now * 3) * 0.05;
    animate(r, r.t / stay);
  }
}
