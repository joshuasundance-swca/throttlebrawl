// Entity views (M1 render-1; docs/architecture.md, "Rendering, Structure"): one pooled view per sim
// entity id, updated from the interpolated snapshot. Riders are merged primitive boxes with a lean,
// an attack pose from the attack phase, a wobble, a held weapon with the steal glint, and (for the
// law) a flashing light bar. Cars, trucks and pedestrians are instanced, one draw call per shape.
// Everything here is presentation: it may use wall-clock time and Math freely.
import {
  BufferGeometry,
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import type { EntitySnapshot, SimEvent, SimSnapshot, SimTrafficTypeDef } from '../sim/api';
import { mergeBoxes, type BoxPart } from './geometry';
import type { LookStyle } from './look';

/** Body proportions from rider data (a later look test compares exaggerated against realistic). */
export interface RiderProportions {
  height: number;
  bulk: number;
  head: number;
}
export const DEFAULT_PROPORTIONS: RiderProportions = { height: 1, bulk: 1, head: 1 };

export interface EntityViewOptions {
  proportions?: (contentId: string) => RiderProportions;
}

/** Interpolated pose fields, written into a caller-owned object (no allocation per frame). */
export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  lean: number;
}

export function lerpPose(a: EntitySnapshot, b: EntitySnapshot, t: number, out: Pose): Pose {
  let dh = b.heading - a.heading;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.heading = a.heading + dh * t;
  out.lean = a.lean + (b.lean - a.lean) * t;
  return out;
}

/** The entity with this id: by index first (ids are dense for riders), then by search. */
export function entityById(snap: SimSnapshot, id: number): EntitySnapshot | undefined {
  const direct = snap.entities[id];
  if (direct && direct.id === id) return direct;
  return snap.entities.find((e) => e.id === id);
}

// ---- Colours -----------------------------------------------------------------------------

const PLAYER = { bike: '#b8322a', rider: '#f2c14e', helmet: '#fff3c4' };
const LAW = { bike: '#f4f4f4', rider: '#1d2a55', helmet: '#f4f4f4' };
const RIVAL_RIDERS = ['#e0543a', '#7fd1c7', '#b98ce0', '#9cc56b', '#f28f8f', '#5a8fd6'];
const RIVAL_BIKES = ['#2b2b2b', '#3b4a3a', '#4a2f3a', '#2f3b52', '#5a4a2a', '#3a3a3a'];
const CAR_COLORS = ['#d94f3d', '#3d7dd9', '#e8e8e8', '#3a3a3a', '#8fbf4f', '#e0b040', '#6a4fb0', '#40b0a0'];
const TRUCK_COLORS = ['#f0f0f0', '#e0a040', '#6f95b5', '#c9c2b0'];
const LIGHT_RED = '#ff2a2a';
const LIGHT_BLUE = '#2a6bff';

interface Scheme {
  bike: string;
  rider: string;
  helmet: string;
  law: boolean;
}

function schemeFor(e: EntitySnapshot): Scheme {
  if (e.faction === 'law') return { ...LAW, law: true };
  if (e.slot >= 0) return { ...PLAYER, law: false };
  return {
    bike: RIVAL_BIKES[e.id % RIVAL_BIKES.length] ?? '#2b2b2b',
    rider: RIVAL_RIDERS[e.id % RIVAL_RIDERS.length] ?? '#ffffff',
    helmet: '#e8e8e8',
    law: false,
  };
}

// ---- Rider geometry ----------------------------------------------------------------------

/** The bike alone: wheels, frame, tank, seat, fork, headlight and bars. */
function bikeParts(c: Pick<Scheme, 'bike'>): BoxPart[] {
  return [
    { size: [0.18, 0.62, 0.62], at: [0, 0.31, 0.62], color: '#161616' },
    { size: [0.18, 0.62, 0.62], at: [0, 0.31, -0.66], color: '#161616' },
    { size: [0.34, 0.36, 1.2], at: [0, 0.58, 0], color: c.bike },
    { size: [0.42, 0.22, 0.5], at: [0, 0.84, -0.22], color: c.bike },
    { size: [0.32, 0.1, 0.5], at: [0, 0.8, 0.32], color: '#222222' },
    { size: [0.1, 0.55, 0.1], at: [0, 0.72, -0.62], color: '#9a9a9a' },
    { size: [0.22, 0.16, 0.08], at: [0, 0.94, -0.72], color: '#fff4c0' },
    { size: [0.7, 0.06, 0.06], at: [0, 1.04, -0.52], color: '#333333' },
  ];
}

function ridingParts(c: Scheme, p: RiderProportions): BoxPart[] {
  const h = p.height;
  const b = p.bulk;
  const parts: BoxPart[] = [
    ...bikeParts(c),
    // The rider, leaning into the bars.
    { size: [0.44 * b, 0.26, 0.5], at: [0, 0.98, 0.28], color: '#2d2f3a' },
    { size: [0.14 * b, 0.45, 0.14 * b], at: [-0.24, 0.72, 0.1], color: '#2d2f3a' },
    { size: [0.14 * b, 0.45, 0.14 * b], at: [0.24, 0.72, 0.1], color: '#2d2f3a' },
    { size: [0.46 * b, 0.62 * h, 0.34 * b], at: [0, 1.1 + 0.31 * h, 0.1], color: c.rider, rotX: -0.35 },
    { size: [0.3 * p.head, 0.3 * p.head, 0.32 * p.head], at: [0, 1.1 + 0.66 * h, -0.08], color: c.helmet },
    {
      size: [0.26 * p.head, 0.1 * p.head, 0.03],
      at: [0, 1.1 + 0.68 * h, -0.08 - 0.16 * p.head],
      color: '#111111',
    },
  ];
  if (c.law) parts.push({ size: [0.05, 0.5, 0.05], at: [0, 1.05, 0.72], color: '#333333' });
  return parts;
}

function onFootParts(c: Scheme, p: RiderProportions): BoxPart[] {
  const h = p.height;
  const b = p.bulk;
  return [
    { size: [0.16 * b, 0.85 * h, 0.16 * b], at: [-0.12, 0.43 * h, 0], color: '#2d2f3a' },
    { size: [0.16 * b, 0.85 * h, 0.16 * b], at: [0.12, 0.43 * h, 0], color: '#2d2f3a' },
    { size: [0.46 * b, 0.62 * h, 0.3 * b], at: [0, 0.85 * h + 0.31 * h, 0], color: c.rider },
    {
      size: [0.3 * p.head, 0.3 * p.head, 0.32 * p.head],
      at: [0, 1.47 * h + 0.15 * p.head, 0],
      color: c.helmet,
    },
  ];
}

const ARM_LEN = 0.62;
function armParts(c: Scheme): BoxPart[] {
  return [
    { size: [0.13, ARM_LEN, 0.13], at: [0, -ARM_LEN / 2, 0], color: c.rider },
    { size: [0.16, 0.16, 0.16], at: [0, -ARM_LEN - 0.04, 0], color: '#222222' },
  ];
}
const LEG_LEN = 0.85;
const LEG_PARTS: BoxPart[] = [
  { size: [0.16, LEG_LEN, 0.16], at: [0, -LEG_LEN / 2, 0], color: '#2d2f3a' },
  { size: [0.18, 0.14, 0.3], at: [0, -LEG_LEN, -0.06], color: '#111111' },
];

// ---- Vehicle and pedestrian geometry (unit boxes scaled per instance) --------------------

const CAR_PARTS: BoxPart[] = [
  { size: [1, 0.48, 1], at: [0, 0.34, 0], color: '#ffffff' },
  { size: [0.86, 0.4, 0.5], at: [0, 0.78, 0.06], color: '#3a4550' },
  { size: [1.04, 0.2, 0.2], at: [0, 0.1, -0.32], color: '#111111' },
  { size: [1.04, 0.2, 0.2], at: [0, 0.1, 0.32], color: '#111111' },
];
const TRUCK_PARTS: BoxPart[] = [
  { size: [1, 0.62, 0.2], at: [0, 0.38, -0.39], color: '#ffffff' },
  { size: [0.9, 0.16, 0.02], at: [0, 0.58, -0.495], color: '#2a3440' },
  { size: [1.02, 0.86, 0.74], at: [0, 0.52, 0.12], color: '#e6e6e6' },
  { size: [1.04, 0.14, 0.1], at: [0, 0.07, -0.36], color: '#111111' },
  { size: [1.04, 0.14, 0.1], at: [0, 0.07, 0.1], color: '#111111' },
  { size: [1.04, 0.14, 0.1], at: [0, 0.07, 0.38], color: '#111111' },
];
const PED_PARTS: BoxPart[] = [
  { size: [0.3, 0.8, 0.2], at: [0, 0.4, 0], color: '#3a6ea5' },
  { size: [0.44, 0.6, 0.26], at: [0, 1.1, 0], color: '#ff8c42' },
  { size: [0.24, 0.26, 0.24], at: [0, 1.55, 0], color: '#d9a27a' },
  { size: [0.4, 0.06, 0.4], at: [0, 1.7, 0], color: '#f2e6c8' },
];
const PIPE_PARTS: BoxPart[] = [{ size: [0.07, 0.07, 0.9], at: [0, 0, 0], color: '#9aa3ab' }];
const GLINT_PARTS: BoxPart[] = [
  { size: [0.16, 0.16, 0.16], at: [0, 0, 0], color: '#fffbe0', rotY: Math.PI / 4 },
];

type Shape = 'car' | 'truck';
const SHAPE_HEIGHT: Record<Shape, number> = { car: 1.45, truck: 3.3 };
const DEFAULT_DIMS: Record<Shape, { lengthM: number; widthM: number }> = {
  car: { lengthM: 4.4, widthM: 1.8 },
  truck: { lengthM: 10, widthM: 2.5 },
};

/** The traffic shape for a type: big categories draw as trucks. Unknown ids guess from the name. */
export function shapeFor(def: SimTrafficTypeDef | undefined, contentId: string): Shape {
  if (def) return def.category === 'truck' || def.category === 'rv' || def.hazard === 'big' ? 'truck' : 'car';
  return /truck|semi|rv|bus|trailer|rig/i.test(contentId) ? 'truck' : 'car';
}

// ---- Views -------------------------------------------------------------------------------

interface RiderView {
  root: Group;
  body: Mesh;
  arms: [Group, Group];
  armMeshes: [Mesh, Mesh];
  kickLeg: Group;
  kickMesh: Mesh;
  weapon: Mesh;
  glint: Mesh;
  lightBar: Mesh;
  /** The bike standing apart while the rider runs back to it (EntitySnapshot.parkedBike). */
  parked: Mesh;
  scheme: string;
  onFoot: boolean;
}

interface PickupView {
  root: Group;
  glint: Mesh;
}

interface Timer {
  until: number;
  /** +1 right, -1 left; null when the event did not say. */
  side: number | null;
}

const WOBBLE_S = 0.6;
const DIVE_S = 0.8;

export interface EntityViewCounts {
  riders: number;
  vehicles: number;
  peds: number;
  pickups: number;
  /** Rider and pickup views built so far, live or parked in the pool. */
  pooled: number;
}

export class EntityViews {
  readonly root = new Group();
  private readonly look: LookStyle;
  private readonly proportions: (contentId: string) => RiderProportions;
  private readonly riders = new Map<number, RiderView>();
  private readonly freeRiders: RiderView[] = [];
  private readonly pickups = new Map<number, PickupView>();
  private readonly freePickups: PickupView[] = [];
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly instanced: Record<Shape | 'ped', InstancedMesh>;
  private readonly trafficTypes = new Map<string, SimTrafficTypeDef>();
  private readonly prevById = new Map<number, EntitySnapshot>();
  private readonly seen = new Set<number>();
  private readonly wobbles = new Map<number, Timer>();
  private readonly dives = new Map<number, Timer>();
  private readonly kicks = new Set<number>();
  private readonly pose: Pose = { x: 0, y: 0, z: 0, heading: 0, lean: 0 };
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly v = new Vector3();
  private readonly scale = new Vector3();
  private readonly color = new Color();
  private now = 0;
  private counts: EntityViewCounts = { riders: 0, vehicles: 0, peds: 0, pickups: 0, pooled: 0 };

  constructor(look: LookStyle, opts: EntityViewOptions = {}) {
    this.look = look;
    this.proportions = opts.proportions ?? (() => DEFAULT_PROPORTIONS);
    this.root.name = 'entities';
    this.instanced = {
      car: this.makeInstanced('car', CAR_PARTS, 'vehicle', 32),
      truck: this.makeInstanced('truck', TRUCK_PARTS, 'vehicle', 8),
      ped: this.makeInstanced('ped', PED_PARTS, 'ped', 16),
    };
  }

  /** The traffic catalog (sizes and categories), from `SimConfig.trafficTypes`. */
  setTrafficTypes(defs: readonly SimTrafficTypeDef[]): void {
    this.trafficTypes.clear();
    for (const d of defs) this.trafficTypes.set(d.contentId, d);
  }

  /** Sim events that drive purely visual cues: hit wobble, the kick pose, the pedestrian dive. */
  pushEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      const side = typeof ev.data['side'] === 'number' ? Math.sign(ev.data['side']) || 1 : null;
      if ((ev.type === 'hit' || ev.type === 'kick') && ev.target !== undefined) {
        this.wobbles.set(ev.target, { until: this.now + WOBBLE_S, side });
      }
      if (ev.type === 'land' && (ev.data['wobble'] === true || ev.data['quality'] === 'wobble')) {
        this.wobbles.set(ev.actor, { until: this.now + WOBBLE_S, side });
      }
      if (ev.type === 'attackStart') {
        const what = `${String(ev.data['kind'] ?? '')} ${String(ev.data['weapon'] ?? '')}`;
        if (/kick/i.test(what)) this.kicks.add(ev.actor);
        else this.kicks.delete(ev.actor);
      }
      if (ev.type === 'kick') this.kicks.add(ev.actor);
      if (ev.type === 'pedDive') this.dives.set(ev.actor, { until: this.now + DIVE_S, side });
    }
  }

  /** Updates every view from the snapshots. `timeS` is wall-clock seconds, for visual cues only. */
  sync(prev: SimSnapshot | null, curr: SimSnapshot, alpha: number, timeS: number): void {
    this.now = timeS;
    const t = Math.min(1, Math.max(0, alpha));
    this.prevById.clear();
    if (prev) for (const e of prev.entities) this.prevById.set(e.id, e);
    this.seen.clear();
    const slots = { car: 0, truck: 0, ped: 0 };
    let riders = 0;
    let pickups = 0;
    for (const e of curr.entities) {
      const a = this.prevById.get(e.id) ?? e;
      const p = lerpPose(a, e, t, this.pose);
      if (e.kind === 'rider') {
        this.updateRider(this.riderView(e), e, p, curr);
        this.seen.add(e.id);
        riders++;
      } else if (e.kind === 'pickup') {
        const view = this.pickupView(e.id);
        view.root.visible = true;
        view.root.position.set(p.x, p.y + 0.35, p.z);
        view.root.rotation.y = timeS * 1.5;
        view.glint.scale.setScalar(0.6 + 0.6 * Math.abs(Math.sin(timeS * 6)));
        this.seen.add(e.id);
        pickups++;
      } else if (e.kind === 'vehicle') {
        const def = this.trafficTypes.get(e.contentId);
        const shape = shapeFor(def, e.contentId);
        const dims = def ?? DEFAULT_DIMS[shape];
        const i = slots[shape]++;
        const mesh = this.ensureCapacity(shape, i + 1);
        this.euler.set(0, p.heading, -p.lean);
        this.scale.set(dims.widthM, SHAPE_HEIGHT[shape], dims.lengthM);
        mesh.setMatrixAt(
          i,
          this.m.compose(this.v.set(p.x, p.y, p.z), this.q.setFromEuler(this.euler), this.scale),
        );
        const palette = shape === 'car' ? CAR_COLORS : TRUCK_COLORS;
        mesh.setColorAt(i, this.color.setStyle(palette[e.id % palette.length] ?? '#ffffff'));
      } else if (e.kind === 'ped') {
        const i = slots.ped++;
        const mesh = this.ensureCapacity('ped', i + 1);
        const dive = this.diveAmount(e, a);
        this.euler.set(0, p.heading, dive.side * 1.35 * dive.amount);
        const lift = Math.sin(Math.PI * dive.amount) * 0.6 * (dive.timed ? 1 : 0);
        mesh.setMatrixAt(
          i,
          this.m.compose(
            this.v.set(p.x, p.y + lift, p.z),
            this.q.setFromEuler(this.euler),
            this.scale.set(1, 1, 1),
          ),
        );
      }
    }
    for (const shape of ['car', 'truck', 'ped'] as const) {
      const mesh = this.instanced[shape];
      mesh.count = slots[shape];
      mesh.visible = slots[shape] > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const [id, view] of this.riders) if (!this.seen.has(id)) this.releaseRider(id, view);
    for (const [id, view] of this.pickups) if (!this.seen.has(id)) this.releasePickup(id, view);
    for (const [id, w] of this.wobbles) if (w.until < timeS) this.wobbles.delete(id);
    for (const [id, d] of this.dives) if (d.until < timeS) this.dives.delete(id);
    this.counts = {
      riders,
      vehicles: slots.car + slots.truck,
      peds: slots.ped,
      pickups,
      pooled: this.riders.size + this.freeRiders.length + this.pickups.size + this.freePickups.length,
    };
  }

  /** Entities drawn by the last sync, by kind. */
  viewCounts(): EntityViewCounts {
    return this.counts;
  }

  /** Every entity the last sync drew. The pool test holds this equal to the live entity count. */
  liveCount(): number {
    const c = this.counts;
    return c.riders + c.vehicles + c.peds + c.pickups;
  }

  // ---- internals ----

  private geometry(key: string, build: () => BoxPart[]): BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) {
      g = mergeBoxes(build());
      this.geometries.set(key, g);
    }
    return g;
  }

  private material(kind: 'rider' | 'vehicle' | 'ped' | 'weapon'): Material {
    return this.look.material(kind, { vertexColors: true });
  }

  private makeInstanced(
    name: string,
    parts: BoxPart[],
    kind: 'vehicle' | 'ped',
    capacity: number,
  ): InstancedMesh {
    const mesh = new InstancedMesh(
      this.geometry(`inst:${name}`, () => parts),
      this.material(kind),
      capacity,
    );
    mesh.name = `views-${name}`;
    mesh.count = 0;
    mesh.visible = false;
    // Instances move every frame; the geometry's own bounds would cull them wrongly.
    mesh.frustumCulled = false;
    mesh.setColorAt(0, this.color.set('#ffffff'));
    this.root.add(mesh);
    return mesh;
  }

  /** Grows an instanced mesh (doubling) when more entities of a shape are live than it holds. */
  private ensureCapacity(shape: Shape | 'ped', needed: number): InstancedMesh {
    const mesh = this.instanced[shape];
    if (needed <= mesh.instanceMatrix.count) return mesh;
    let capacity = mesh.instanceMatrix.count;
    while (capacity < needed) capacity *= 2;
    const bigger = new InstancedMesh(mesh.geometry, mesh.material, capacity);
    bigger.name = mesh.name;
    bigger.frustumCulled = false;
    bigger.setColorAt(0, this.color.set('#ffffff'));
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, this.m);
      bigger.setMatrixAt(i, this.m);
      if (mesh.instanceColor) {
        mesh.getColorAt(i, this.color);
        bigger.setColorAt(i, this.color);
      }
    }
    this.root.remove(mesh);
    mesh.dispose();
    this.root.add(bigger);
    this.instanced[shape] = bigger;
    return bigger;
  }

  private riderView(e: EntitySnapshot): RiderView {
    let view = this.riders.get(e.id);
    if (!view) {
      view = this.freeRiders.pop() ?? this.buildRider();
      this.riders.set(e.id, view);
      this.root.add(view.root, view.parked);
      view.scheme = '';
    }
    return view;
  }

  private buildRider(): RiderView {
    const root = new Group();
    root.rotation.order = 'YXZ';
    const empty = new BufferGeometry();
    const body = new Mesh(empty, this.material('rider'));
    const makeArm = (x: number): [Group, Mesh] => {
      const pivot = new Group();
      pivot.position.set(x, 1.45, 0.05);
      const mesh = new Mesh(empty, this.material('rider'));
      pivot.add(mesh);
      return [pivot, mesh];
    };
    const [left, leftMesh] = makeArm(-0.28);
    const [right, rightMesh] = makeArm(0.28);
    const kickLeg = new Group();
    kickLeg.position.set(0.22, 1.0, 0.25);
    const kickMesh = new Mesh(
      this.geometry('leg', () => LEG_PARTS),
      this.material('rider'),
    );
    kickLeg.add(kickMesh);
    kickLeg.visible = false;
    const weapon = new Mesh(
      this.geometry('pipe', () => PIPE_PARTS),
      this.material('weapon'),
    );
    weapon.position.set(0, -ARM_LEN - 0.04, -0.3);
    const glint = new Mesh(
      this.geometry('glint', () => GLINT_PARTS),
      this.look.material('glint', { vertexColors: true }),
    );
    glint.position.set(0, 0, -0.5);
    weapon.add(glint);
    const lightBar = new Mesh(
      this.geometry('lightbar', () => [{ size: [0.5, 0.1, 0.12], at: [0, 0, 0], color: '#ffffff' }]),
      this.look.material('lightbar', { color: LIGHT_RED }),
    );
    lightBar.position.set(0, 1.32, 0.72);
    root.add(body, left, right, kickLeg, lightBar);
    // Its own mesh in the views root (not in the rider's group): it stands still where it was parked.
    const parked = new Mesh(empty, this.material('rider'));
    parked.name = 'views-parked-bike';
    parked.visible = false;
    return {
      root,
      body,
      arms: [left, right],
      armMeshes: [leftMesh, rightMesh],
      kickLeg,
      kickMesh,
      weapon,
      glint,
      lightBar,
      parked,
      scheme: '',
      onFoot: false,
    };
  }

  private releaseRider(id: number, view: RiderView): void {
    this.riders.delete(id);
    view.parked.visible = false;
    this.root.remove(view.root, view.parked);
    this.freeRiders.push(view);
    this.kicks.delete(id);
  }

  private pickupView(id: number): PickupView {
    let view = this.pickups.get(id);
    if (!view) {
      view = this.freePickups.pop();
      if (!view) {
        const root = new Group();
        const pipe = new Mesh(
          this.geometry('pipe', () => PIPE_PARTS),
          this.material('weapon'),
        );
        pipe.rotation.x = 0.3;
        const glint = new Mesh(
          this.geometry('glint', () => GLINT_PARTS),
          this.look.material('glint', { vertexColors: true }),
        );
        glint.position.set(0, 0.2, -0.45);
        root.add(pipe, glint);
        view = { root, glint };
      }
      this.pickups.set(id, view);
      this.root.add(view.root);
    }
    return view;
  }

  private releasePickup(id: number, view: PickupView): void {
    this.pickups.delete(id);
    this.root.remove(view.root);
    this.freePickups.push(view);
  }

  /** Which side (+1 right, -1 left) of the rider a target is on; right when there is none. */
  private sideOf(e: EntitySnapshot, p: Pose, curr: SimSnapshot): number {
    if (e.targetId < 0) return 1;
    const target = entityById(curr, e.targetId);
    if (!target) return 1;
    // A model facing -z turned by `heading`: its right is (cos h, 0, -sin h).
    const dot = (target.x - p.x) * Math.cos(p.heading) - (target.z - p.z) * Math.sin(p.heading);
    return dot < 0 ? -1 : 1;
  }

  private updateRider(view: RiderView, e: EntitySnapshot, p: Pose, curr: SimSnapshot): void {
    const time = this.now;
    const onFoot = e.mode === 'OnFoot';
    const scheme = schemeFor(e);
    const key = `${scheme.bike}|${scheme.rider}|${scheme.helmet}|${scheme.law ? 1 : 0}|${e.contentId}`;
    if (view.scheme !== key || view.onFoot !== onFoot) {
      const props = this.proportions(e.contentId);
      const pk = `${props.height},${props.bulk},${props.head}`;
      view.body.geometry = onFoot
        ? this.geometry(`foot:${scheme.rider}|${scheme.helmet}|${pk}`, () => onFootParts(scheme, props))
        : this.geometry(`ride:${key}|${pk}`, () => ridingParts(scheme, props));
      const arm = this.geometry(`arm:${scheme.rider}`, () => armParts(scheme));
      view.armMeshes[0].geometry = arm;
      view.armMeshes[1].geometry = arm;
      view.scheme = key;
      view.onFoot = onFoot;
    }
    const root = view.root;
    root.visible = true;
    root.position.set(p.x, p.y, p.z);
    root.rotation.y = p.heading;
    // The bike the rider is running back to (tumble-1 parks it at the hand-back).
    const bikeAt = onFoot ? e.parkedBike : null;
    view.parked.visible = !!bikeAt;
    if (bikeAt) {
      view.parked.geometry = this.geometry(`bike:${scheme.bike}`, () => bikeParts(scheme));
      view.parked.position.set(bikeAt.x, bikeAt.y, bikeAt.z);
      view.parked.rotation.set(0, bikeAt.heading, 0);
    }
    const wobble = this.wobbles.get(e.id);
    const wob = wobble ? Math.sin(time * 40) * 0.22 * Math.max(0, (wobble.until - time) / WOBBLE_S) : 0;
    root.rotation.x = e.mode === 'Airborne' ? 0.12 : 0; // nose up
    root.rotation.z = -p.lean + wob;
    if (e.mode === 'Tumble') {
      root.rotation.x = time * 7;
      root.rotation.z = time * 3;
    }
    if (onFoot) root.position.y += Math.abs(Math.sin(time * 10)) * 0.08;

    // Arms: the attack side takes the pose, the other holds the bars (or swings when running).
    const side = this.sideOf(e, p, curr);
    const [left, right] = view.arms;
    const attackArm = side < 0 ? left : right;
    const kicking = this.kicks.has(e.id) && e.attackPhase !== 'idle';
    if (e.attackPhase === 'idle' || e.attackPhase === 'cooldown') this.kicks.delete(e.id);
    for (const arm of view.arms) arm.rotation.set(1.1, 0, 0);
    if (onFoot) {
      left.rotation.set(Math.sin(time * 10) * 0.8, 0, -0.1);
      right.rotation.set(-Math.sin(time * 10) * 0.8, 0, 0.1);
    } else if (e.mode === 'Tumble') {
      left.rotation.set(0, 0, -1.4);
      right.rotation.set(0, 0, 1.4);
    } else if (!kicking) {
      switch (e.attackPhase) {
        case 'windup':
          attackArm.rotation.set(-0.6, 0, side * 0.5);
          break;
        case 'active':
          attackArm.rotation.set(0.25, 0, side * 1.45);
          break;
        case 'recovery':
          attackArm.rotation.set(0.7, 0, side * 0.7);
          break;
        default:
          break;
      }
    }
    // Kick: a leg swings out on the attack side.
    view.kickLeg.visible = kicking && !onFoot;
    if (kicking) {
      view.kickLeg.position.x = side * 0.22;
      const angle = e.attackPhase === 'windup' ? 0.5 : e.attackPhase === 'active' ? 1.35 : 0.7;
      view.kickLeg.rotation.set(0, 0, side * angle);
    }
    // A held weapon rides in the attack-side fist; it glints through the wind-up (the steal cue).
    const held = e.heldWeapon !== null && e.mode !== 'Tumble';
    if (held && view.weapon.parent !== attackArm) attackArm.add(view.weapon);
    view.weapon.visible = held;
    view.glint.visible = held && e.attackPhase === 'windup';
    if (view.glint.visible) {
      view.glint.scale.setScalar(0.8 + 0.7 * Math.abs(Math.sin(time * 18)));
      view.glint.rotation.z = time * 6;
    }
    // The law: a light bar flashing red and blue at 4 Hz.
    view.lightBar.visible = scheme.law && !onFoot && e.mode !== 'Tumble';
    if (view.lightBar.visible) {
      const red = Math.floor(time * 8) % 2 === 0;
      view.lightBar.material = this.look.material('lightbar', { color: red ? LIGHT_RED : LIGHT_BLUE });
    }
  }

  private diveAmount(
    e: EntitySnapshot,
    prev: EntitySnapshot,
  ): { amount: number; side: number; timed: boolean } {
    const timer = this.dives.get(e.id);
    // Right of heading: (cos h, 0, -sin h). The dive goes the way the pedestrian is moving.
    const moveSide = (e.x - prev.x) * Math.cos(e.heading) - (e.z - prev.z) * Math.sin(e.heading);
    const side = timer?.side ?? (moveSide < 0 ? -1 : 1);
    if (timer) {
      const k = 1 - Math.max(0, timer.until - this.now) / DIVE_S;
      return { amount: Math.min(1, k * 1.6), side, timed: true };
    }
    // No event wired: a pedestrian off the ground or out of road mode is mid-dive.
    const diving = e.mode !== 'Road' || e.road.h > 0.05;
    return { amount: diving ? 1 : 0, side, timed: false };
  }
}
