// Entity views (M1 render-1; docs/architecture.md, "Rendering, Structure"): one pooled view per sim
// entity id, updated from the interpolated snapshot. Riders are merged primitive boxes with a lean,
// an attack pose from the attack phase, a wobble, a held weapon with the steal glint, and (for the
// law) a flashing light bar. Cars, trucks and pedestrians are instanced, one draw call per shape.
// M2 render-2 adds the feel: a hit target flashes and throws sparks, a crashed rider ragdolls while
// the bike cartwheels clear on its own body (EntitySnapshot.tumble), a knocked-off rider gets up and
// shakes a fist, and a body over the rail makes a splash (the effects live in effects.ts).
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
import type {
  EntitySnapshot,
  SimEvent,
  SimSnapshot,
  SimTrafficTypeDef,
  TumbleBodySnapshot,
} from '../sim/api';
import type { FeelEffects, Point } from './effects';
import {
  critterHeightM,
  critterTint,
  FIGURE_DEFAULT_DIMS,
  FIGURE_HEIGHT_M,
  FIGURE_PARTS,
  oddityFigureFor,
  pedFigureFor,
  type OddityFigure,
  type PedFigure,
} from './figures';
import { mergeBoxes, type BoxPart } from './geometry';
import {
  DOG_HEIGHT_M,
  isTrafficFigure,
  PEOPLE_FIGURES,
  peopleFigureFor,
  TRAFFIC_FIGURE_DIMS,
  TRAFFIC_FIGURE_HEIGHT_M,
  TRAFFIC_FIGURE_PARTS,
  TRAFFIC_FIGURES,
  trafficFigureFor,
  trafficFigureTint,
} from './traffic-figures';
import type { LookStyle } from './look';
import {
  BlobShadows,
  DEFAULT_VEHICLE_SHADOW,
  groundYOf,
  ON_FOOT_SHADOW,
  RIDER_SHADOW,
  type ShadowSize,
} from './shadows';
import { defaultRenderParams, type RenderParams } from './tuning';
import { WEAPON_PARTS, weaponShapeOf, type WeaponShape } from './weapons';

/** Body proportions from rider data (a later look test compares exaggerated against realistic). */
export interface RiderProportions {
  height: number;
  bulk: number;
  head: number;
}
export const DEFAULT_PROPORTIONS: RiderProportions = { height: 1, bulk: 1, head: 1 };

export interface EntityViewOptions {
  proportions?: (contentId: string) => RiderProportions;
  /** Where sparks and splashes go (the renderer's effects); none in bare view tests. */
  effects?: FeelEffects;
  /** The feel numbers, shared with the renderer so a tuning change applies at once. */
  params?: RenderParams;
}

/** Interpolated pose fields, written into a caller-owned object (no allocation per frame). */
export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  lean: number;
  /** The bike's pitch (EntitySnapshot.pitch), when the snapshot carries it. */
  pitch?: number;
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
  // Playtest 2 flips: the pitch is unwrapped through a flip, so a plain lerp turns the right way.
  if (b.pitch === undefined) delete out.pitch;
  else out.pitch = (a.pitch ?? b.pitch) + (b.pitch - (a.pitch ?? b.pitch)) * t;
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
  /** Which shape `weapon` is drawn as (weapons.ts). */
  weaponShape: WeaponShape;
  glint: Mesh;
  lightBar: Mesh;
  /** The boost flame out of the back of the bike (a child of the body). */
  flame: Mesh;
  /** The bike standing apart while the rider runs back to it (EntitySnapshot.parkedBike). */
  parked: Mesh;
  /** The bike cartwheeling on its own while the rider tumbles (pivot at its middle). */
  tumbleBike: Group;
  tumbleBikeMesh: Mesh;
  spin: Spin;
  flashing: boolean;
  scheme: string;
  /** Off the bike: tumbling or on foot (the body is drawn without the bike). */
  detached: boolean;
}

/** Tumble angles, integrated per frame from the bodies' speeds (radians). */
interface Spin {
  pitch: number;
  heading: number;
  bikePitch: number;
  bikeRoll: number;
  bikeHeading: number;
}

function freshSpin(): Spin {
  return { pitch: 0, heading: 0, bikePitch: 0, bikeRoll: 0, bikeHeading: 0 };
}

/** Moves `a` toward `b` by a fraction (a frame-rate-light ease). */
function ease(a: number, b: number, k: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, k));
}

/** The angle equal to `target` modulo 2 pi that is nearest to `from`. */
function nearestTurn(from: number, target: number): number {
  const turns = Math.round((from - target) / (2 * Math.PI));
  return target + turns * 2 * Math.PI;
}

/** Interpolates a tumble body into `out` (no allocation per frame); null when there is none. */
function lerpBody(
  a: TumbleBodySnapshot | undefined,
  b: TumbleBodySnapshot | undefined,
  t: number,
  out: TumbleBodySnapshot,
): TumbleBodySnapshot | null {
  if (!b) return null;
  const from = a ?? b;
  out.x = from.x + (b.x - from.x) * t;
  out.y = from.y + (b.y - from.y) * t;
  out.z = from.z + (b.z - from.z) * t;
  out.vx = b.vx;
  out.vy = b.vy;
  out.vz = b.vz;
  return out;
}

const zeroBody = (): TumbleBodySnapshot => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });

/** A body's centre for effects: the tumble body when there is one, else the entity. */
function bodyPoint(e: EntitySnapshot, which: 'rider' | 'bike'): Point {
  const b = e.tumble?.[which];
  return b ? { x: b.x, y: b.y, z: b.z } : { x: e.x, y: e.y, z: e.z };
}

/** Rider body centre above its model origin, and a bike's (pivots for the tumble spin). */
const RIDER_CENTRE_M = 0.9;
const BIKE_CENTRE_M = 0.45;
const BIKE_SIDE_M = 0.22;
/** Pending effect events kept between frames (menus stop the render while the sim may run). */
const PENDING_CAP = 64;
/**
 * A roadside weapon farther than this from the camera is not drawn, m. The pipe is about 2 px tall
 * there on a phone in landscape, and each pickup costs two draw calls; with one every 500 m (run
 * W-R) the far ones pushed road-event frames over the 120 draw-call budget (main fix, 2026-10-02).
 * [default]
 */
export const PICKUP_DRAW_M = 200;

interface PickupView {
  root: Group;
  glint: Mesh;
  /** The weapon lying on the road, and which shape it is drawn as (weapons.ts). */
  mesh: Mesh;
  shape: WeaponShape;
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
  /** The blob shadows under riders and vehicles (shadows.ts): one instanced mesh. */
  private readonly shadows = new BlobShadows();
  private readonly look: LookStyle;
  private readonly proportions: (contentId: string) => RiderProportions;
  private readonly riders = new Map<number, RiderView>();
  private readonly freeRiders: RiderView[] = [];
  private readonly pickups = new Map<number, PickupView>();
  private readonly freePickups: PickupView[] = [];
  private readonly geometries = new Map<string, BufferGeometry>();
  /** One instanced mesh per shape or figure: car, truck and ped at once, the figures on first use. */
  private readonly instanced: Record<string, InstancedMesh>;
  private readonly trafficTypes = new Map<string, SimTrafficTypeDef>();
  /** Figures drawn from a loaded model (setFigureModel), by figure. */
  private readonly figureModels = new Map<string, BufferGeometry>();
  private readonly prevById = new Map<number, EntitySnapshot>();
  private readonly seen = new Set<number>();
  private readonly wobbles = new Map<number, Timer>();
  private readonly dives = new Map<number, Timer>();
  /** W-P: a person's fist or phone held up at a rider (`pedReact`), until a wall-clock time. */
  private readonly gestures = new Map<number, { until: number; kind: 'fist' | 'film' }>();
  private readonly kicks = new Set<number>();
  private readonly flashes = new Map<number, number>();
  private readonly getUps = new Map<number, number>();
  private readonly fists = new Map<number, { until: number; target: number }>();
  private readonly pending: SimEvent[] = [];
  private readonly effects: FeelEffects | null;
  private readonly params: RenderParams;
  private alpha = 1;
  private dt = 0;
  private readonly riderBody = zeroBody();
  private readonly bikeBody = zeroBody();
  private readonly pose: Pose = { x: 0, y: 0, z: 0, heading: 0, lean: 0 };
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly v = new Vector3();
  private readonly scale = new Vector3();
  private readonly color = new Color();
  private now = 0;
  /** The camera's ground position this frame (sync's `eye`), or null when not given. */
  private eye: { readonly x: number; readonly z: number } | null = null;
  private counts: EntityViewCounts = { riders: 0, vehicles: 0, peds: 0, pickups: 0, pooled: 0 };

  constructor(look: LookStyle, opts: EntityViewOptions = {}) {
    this.look = look;
    this.proportions = opts.proportions ?? (() => DEFAULT_PROPORTIONS);
    this.effects = opts.effects ?? null;
    this.params = opts.params ?? defaultRenderParams();
    this.root.name = 'entities';
    this.root.add(this.shadows.root);
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

  /**
   * Sim events that drive purely visual cues: hit wobble and flash, the kick pose, the pedestrian
   * dive, the get-up and the fist shake; and (at the next sync, where positions are known) sparks
   * on hits, crashes and rail scrapes, and the splash.
   */
  pushEvents(events: readonly SimEvent[]): void {
    const P = this.params;
    for (const ev of events) {
      const side = typeof ev.data['side'] === 'number' ? Math.sign(ev.data['side']) || 1 : null;
      if ((ev.type === 'hit' || ev.type === 'kick') && ev.target !== undefined) {
        this.wobbles.set(ev.target, { until: this.now + WOBBLE_S, side });
        this.flashes.set(ev.target, this.now + P.hitFlashS);
      }
      if (ev.type === 'takedown' && ev.target !== undefined) {
        this.flashes.set(ev.target, this.now + 2 * P.hitFlashS);
      }
      if (ev.type === 'getUp') this.getUps.set(ev.actor, this.now + P.getUpS);
      if (ev.type === 'fistShake') {
        this.getUps.delete(ev.actor);
        this.fists.set(ev.actor, { until: this.now + P.fistShakeS, target: ev.target ?? -1 });
      }
      if (
        ev.type === 'hit' ||
        ev.type === 'kick' ||
        ev.type === 'crash' ||
        ev.type === 'takedown' ||
        ev.type === 'railOver' ||
        ev.type === 'splash'
      ) {
        if (this.pending.length >= PENDING_CAP) this.pending.shift();
        this.pending.push(ev);
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
      if (ev.type === 'pedDive') {
        this.dives.set(ev.actor, { until: this.now + DIVE_S, side });
        this.gestures.delete(ev.actor);
      }
      if (ev.type === 'pedReact') {
        const kind = ev.data['kind'];
        const ticks = typeof ev.data['ticks'] === 'number' ? ev.data['ticks'] : 120;
        if (kind === 'fist' || kind === 'film')
          this.gestures.set(ev.actor, { until: this.now + ticks / 60, kind });
      }
    }
  }

  /**
   * Updates every view from the snapshots. `timeS` is wall-clock seconds, for visual cues only.
   * `eye` is the camera's ground position: weapons (on the road or in a rider's fist) farther than
   * PICKUP_DRAW_M from it are not drawn (without it, every one is).
   */
  sync(
    prev: SimSnapshot | null,
    curr: SimSnapshot,
    alpha: number,
    timeS: number,
    eye?: { readonly x: number; readonly z: number },
  ): void {
    // Real seconds since the last frame, and the world's share of them (0 in a hit-stop, 0.3 in
    // slow motion): spins and effects crawl with the world.
    const dtReal = Math.min(0.1, Math.max(0, timeS - this.now));
    const scale = Math.min(1, Math.max(0, curr.timeScale));
    this.dt = dtReal * scale;
    this.now = timeS;
    this.eye = eye ?? null;
    const t = Math.min(1, Math.max(0, alpha));
    this.alpha = t;
    this.prevById.clear();
    if (prev) for (const e of prev.entities) this.prevById.set(e.id, e);
    this.seen.clear();
    const slots: Record<string, number> = {};
    for (const key of Object.keys(this.instanced)) slots[key] = 0;
    let riders = 0;
    let pickups = 0;
    for (const e of curr.entities) {
      const a = this.prevById.get(e.id) ?? e;
      const p = lerpPose(a, e, t, this.pose);
      if (e.kind === 'rider') {
        this.updateRider(this.riderView(e), e, a, p, curr);
        this.seen.add(e.id);
        riders++;
      } else if (e.kind === 'pickup') {
        const view = this.pickupView(e.id);
        // A far pickup keeps its (pooled) view but is not drawn.
        view.root.visible = this.weaponInView(p);
        if (view.root.visible) {
          view.root.position.set(p.x, p.y + 0.35, p.z);
          view.root.rotation.y = timeS * 1.5;
          const shape = weaponShapeOf(e.contentId);
          if (shape !== view.shape) {
            view.mesh.geometry = this.weaponGeometry(shape);
            view.shape = shape;
          }
          view.glint.scale.setScalar(0.6 + 0.6 * Math.abs(Math.sin(timeS * 6)));
        }
        this.seen.add(e.id);
        pickups++;
      } else if (e.kind === 'vehicle' && trafficFigureFor(e.contentId)) {
        // W-P: each region's own traffic as itself (traffic-figures.ts).
        const fig = trafficFigureFor(e.contentId) as keyof typeof TRAFFIC_FIGURE_HEIGHT_M;
        const dims = this.trafficTypes.get(e.contentId) ?? TRAFFIC_FIGURE_DIMS[fig];
        const i = (slots[fig] = (slots[fig] ?? 0) + 1) - 1;
        const mesh = this.ensureCapacity(fig, i + 1);
        this.euler.set(0, p.heading, -p.lean);
        this.scale.set(dims.widthM, TRAFFIC_FIGURE_HEIGHT_M[fig], dims.lengthM);
        mesh.setMatrixAt(
          i,
          this.m.compose(this.v.set(p.x, p.y, p.z), this.q.setFromEuler(this.euler), this.scale),
        );
        mesh.setColorAt(i, this.color.setStyle(trafficFigureTint(fig, e.contentId, e.id)));
      } else if (e.kind === 'vehicle' && oddityFigureFor(e.contentId)) {
        // Traffic-4's oddities: the runaway mobile home and the parked boat on its trailer.
        const fig = oddityFigureFor(e.contentId) as OddityFigure;
        const dims = this.trafficTypes.get(e.contentId) ?? FIGURE_DEFAULT_DIMS[fig];
        const i = (slots[fig] = (slots[fig] ?? 0) + 1) - 1;
        const mesh = this.ensureCapacity(fig, i + 1);
        this.euler.set(0, p.heading, -p.lean);
        this.scale.set(dims.widthM, FIGURE_HEIGHT_M[fig], dims.lengthM);
        mesh.setMatrixAt(
          i,
          this.m.compose(this.v.set(p.x, p.y, p.z), this.q.setFromEuler(this.euler), this.scale),
        );
        mesh.setColorAt(i, this.color.set('#ffffff'));
      } else if (e.kind === 'vehicle') {
        const def = this.trafficTypes.get(e.contentId);
        const shape = shapeFor(def, e.contentId);
        const dims = def ?? DEFAULT_DIMS[shape];
        const i = (slots[shape] = (slots[shape] ?? 0) + 1) - 1;
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
        // People keep the pedestrian figure at its own size; animals get their own figure, scaled
        // to their type (traffic-4: the iguana, the pelican, the gator, the gator on a lawn chair).
        // W-P: joggers, hikers, dog walkers and dogs as themselves, and a person showing a
        // `pedReact` fist or phone in that pose (traffic-figures.ts).
        const def = this.trafficTypes.get(e.contentId);
        const held = this.gestures.get(e.id);
        const gesture = held && held.until >= timeS ? held.kind : null;
        const regional = peopleFigureFor(def, e.contentId, gesture);
        const fig: PedFigure = pedFigureFor(def, e.contentId);
        const key = regional ?? (fig === 'person' ? 'ped' : fig);
        const i = (slots[key] = (slots[key] ?? 0) + 1) - 1;
        const mesh = this.ensureCapacity(key, i + 1);
        const dive = this.diveAmount(e, a);
        this.euler.set(0, p.heading, dive.side * 1.35 * dive.amount);
        const lift = Math.sin(Math.PI * dive.amount) * 0.6 * (dive.timed ? 1 : 0);
        if (regional === 'dog') {
          const dims = def ?? TRAFFIC_FIGURE_DIMS.dog;
          this.scale.set(dims.widthM, DOG_HEIGHT_M, dims.lengthM);
          mesh.setColorAt(i, this.color.setStyle(trafficFigureTint('dog', e.contentId, e.id)));
        } else if (regional) {
          this.scale.set(1, 1, 1);
          mesh.setColorAt(i, this.color.setStyle(trafficFigureTint(regional, e.contentId, e.id)));
        } else if (fig === 'person') this.scale.set(1, 1, 1);
        else {
          const dims = def ?? FIGURE_DEFAULT_DIMS[fig];
          const h = fig === 'critter' ? critterHeightM(dims.lengthM) : FIGURE_HEIGHT_M[fig];
          this.scale.set(dims.widthM, h, dims.lengthM);
          mesh.setColorAt(i, this.color.set(fig === 'critter' ? critterTint(e.contentId) : '#ffffff'));
        }
        mesh.setMatrixAt(
          i,
          this.m.compose(this.v.set(p.x, p.y + lift, p.z), this.q.setFromEuler(this.euler), this.scale),
        );
      }
    }
    for (const [shape, mesh] of Object.entries(this.instanced)) {
      const n = slots[shape] ?? 0;
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.castShadows(curr);
    for (const [id, view] of this.riders) if (!this.seen.has(id)) this.releaseRider(id, view);
    for (const [id, view] of this.pickups) if (!this.seen.has(id)) this.releasePickup(id, view);
    for (const [id, w] of this.wobbles) if (w.until < timeS) this.wobbles.delete(id);
    for (const [id, d] of this.dives) if (d.until < timeS) this.dives.delete(id);
    for (const [id, g] of this.gestures) if (g.until < timeS) this.gestures.delete(id);
    for (const [id, f] of this.flashes) if (f < timeS) this.flashes.delete(id);
    for (const [id, g] of this.getUps) if (g < timeS) this.getUps.delete(id);
    for (const [id, f] of this.fists) if (f.until < timeS) this.fists.delete(id);
    this.resolveEffects(curr);
    const slowmo = curr.slowmo?.active === true || (curr.timeScale > 0 && curr.timeScale < 0.999);
    // In a hit-stop the world is frozen, but sparks keep drifting a little so the hit reads.
    this.effects?.update(scale > 0 ? this.dt : dtReal * 0.15, dtReal, slowmo);
    const sum = (keys: readonly string[]) => keys.reduce((acc, k) => acc + (slots[k] ?? 0), 0);
    this.counts = {
      riders,
      vehicles: sum(['car', 'truck', 'mobileHome', 'boatTrailer', 'cableCar', ...TRAFFIC_FIGURES]),
      peds: sum(['ped', 'iguana', 'pelican', 'gator', 'lawnGator', 'critter', ...PEOPLE_FIGURES]),
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

  /** Blob shadows for the riders, their parked or tumbling bikes, and the vehicles (shadows.ts). */
  private castShadows(curr: SimSnapshot): void {
    const sh = this.shadows;
    sh.begin();
    for (const e of curr.entities) {
      if (e.kind !== 'rider' && e.kind !== 'vehicle') continue;
      const p = lerpPose(this.prevById.get(e.id) ?? e, e, this.alpha, this.pose);
      const ground = groundYOf(e);
      if (e.kind === 'vehicle') {
        const def = this.trafficTypes.get(e.contentId);
        const fig = trafficFigureFor(e.contentId);
        const odd = oddityFigureFor(e.contentId);
        const dims = def ??
          (fig ? TRAFFIC_FIGURE_DIMS[fig as keyof typeof TRAFFIC_FIGURE_DIMS] : undefined) ??
          (odd ? FIGURE_DEFAULT_DIMS[odd] : undefined) ?? { widthM: 0, lengthM: 0 };
        const size: ShadowSize =
          dims.widthM > 0
            ? { widthM: dims.widthM * 1.1, lengthM: dims.lengthM * 1.05 }
            : DEFAULT_VEHICLE_SHADOW;
        sh.add(p.x, ground, p.z, p.heading, size, 0);
        continue;
      }
      const tumble = e.tumble;
      if (tumble) {
        // Down: the rider and the bike each throw their own, fainter the higher they fly.
        sh.add(tumble.rider.x, ground, tumble.rider.z, p.heading, ON_FOOT_SHADOW, tumble.rider.y - ground);
        sh.add(tumble.bike.x, ground, tumble.bike.z, p.heading, RIDER_SHADOW, tumble.bike.y - ground);
        continue;
      }
      if (e.parkedBike) {
        // Running back to the bike: the rider on foot, the bike standing apart.
        const b = e.parkedBike;
        sh.add(p.x, ground, p.z, p.heading, ON_FOOT_SHADOW, e.road.h);
        sh.add(b.x, b.y, b.z, b.heading, RIDER_SHADOW, 0);
        continue;
      }
      sh.add(p.x, ground, p.z, p.heading, RIDER_SHADOW, e.road.h);
    }
    sh.end();
  }

  private geometry(key: string, build: () => BoxPart[]): BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) {
      g = mergeBoxes(build());
      this.geometries.set(key, g);
    }
    return g;
  }

  private weaponGeometry(shape: WeaponShape): BufferGeometry {
    return this.geometry(`weapon-${shape}`, () => [...WEAPON_PARTS[shape]]);
  }

  private material(kind: 'rider' | 'vehicle' | 'ped' | 'weapon'): Material {
    return this.look.material(kind, { vertexColors: true });
  }

  /**
   * Draws a figure from a model instead of its boxes (W-O: San Francisco's cable car). The model
   * faces +Z with its origin on the ground at its middle; it is fitted into the figure's unit box
   * (facing -z), so it scales to each traffic type's size like the boxes do.
   */
  setFigureModel(figure: 'cableCar', model: BufferGeometry): void {
    const unit = model.clone();
    unit.computeBoundingBox();
    const box = unit.boundingBox;
    if (!box) return;
    unit.rotateY(Math.PI);
    unit.scale(
      1 / Math.max(0.01, box.max.x - box.min.x),
      1 / Math.max(0.01, box.max.y),
      1 / Math.max(0.01, box.max.z - box.min.z),
    );
    this.figureModels.get(figure)?.dispose();
    this.figureModels.set(figure, unit);
    const mesh = this.instanced[figure];
    if (mesh) mesh.geometry = unit;
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

  /**
   * Grows an instanced mesh (doubling) when more entities of a shape are live than it holds. A
   * figure's mesh is made on its first use, so a race without animals draws none of them.
   */
  private ensureCapacity(shape: string, needed: number): InstancedMesh {
    let mesh = this.instanced[shape];
    if (!mesh) {
      const fig = shape as keyof typeof FIGURE_PARTS;
      const regional = TRAFFIC_FIGURE_PARTS[shape as keyof typeof TRAFFIC_FIGURE_PARTS];
      const kind =
        fig === 'mobileHome' || fig === 'boatTrailer' || fig === 'cableCar' || isTrafficFigure(shape)
          ? 'vehicle'
          : 'ped';
      mesh = this.makeInstanced(shape, regional ?? FIGURE_PARTS[fig], kind, 4);
      const model = this.figureModels.get(fig);
      if (model) mesh.geometry = model;
      this.instanced[shape] = mesh;
    }
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
      this.root.add(view.root, view.parked, view.tumbleBike);
      view.spin = freshSpin();
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
    const weapon = new Mesh(this.weaponGeometry('pipe'), this.material('weapon'));
    weapon.position.set(0, -ARM_LEN - 0.04, -0.3);
    const glint = new Mesh(
      this.geometry('glint', () => GLINT_PARTS),
      this.look.material('glint', { vertexColors: true }),
    );
    glint.position.set(0, 0, -0.5);
    weapon.add(glint);
    weapon.name = 'views-weapon';
    glint.name = 'views-glint';
    const lightBar = new Mesh(
      this.geometry('lightbar', () => [{ size: [0.5, 0.1, 0.12], at: [0, 0, 0], color: '#ffffff' }]),
      this.look.material('lightbar', { color: LIGHT_RED }),
    );
    lightBar.position.set(0, 1.32, 0.72);
    root.add(body, left, right, kickLeg, lightBar);
    // The boost flame rides on the body (so the rider's group keeps its five children), pivoting
    // at the exhaust so its flicker stretches it backward.
    const flame = new Mesh(
      this.geometry('flame', () => [{ size: [0.22, 0.22, 0.9], at: [0, 0, 0.45], color: '#ffffff' }]),
      this.look.material('boost'),
    );
    flame.name = 'views-boost-flame';
    flame.position.set(0, 0.55, 1.05);
    flame.visible = false;
    body.add(flame);
    // Its own mesh in the views root (not in the rider's group): it stands still where it was parked.
    const parked = new Mesh(empty, this.material('rider'));
    parked.name = 'views-parked-bike';
    parked.visible = false;
    // The crashed bike, pivoting about its middle so it cartwheels end over end.
    const tumbleBike = new Group();
    tumbleBike.name = 'views-tumble-bike';
    tumbleBike.rotation.order = 'YXZ';
    const tumbleBikeMesh = new Mesh(empty, this.material('rider'));
    tumbleBikeMesh.position.y = -BIKE_CENTRE_M;
    tumbleBike.add(tumbleBikeMesh);
    tumbleBike.visible = false;
    return {
      root,
      body,
      arms: [left, right],
      armMeshes: [leftMesh, rightMesh],
      kickLeg,
      kickMesh,
      weapon,
      weaponShape: 'pipe',
      glint,
      lightBar,
      flame,
      parked,
      tumbleBike,
      tumbleBikeMesh,
      spin: freshSpin(),
      flashing: false,
      scheme: '',
      detached: false,
    };
  }

  private releaseRider(id: number, view: RiderView): void {
    this.riders.delete(id);
    view.parked.visible = false;
    view.tumbleBike.visible = false;
    this.root.remove(view.root, view.parked, view.tumbleBike);
    this.freeRiders.push(view);
    this.kicks.delete(id);
    this.flashes.delete(id);
    this.getUps.delete(id);
    this.fists.delete(id);
  }

  /** Whether a weapon at `p` is near enough to the camera to draw (PICKUP_DRAW_M). */
  private weaponInView(p: { readonly x: number; readonly z: number }): boolean {
    const eye = this.eye;
    return !eye || Math.hypot(p.x - eye.x, p.z - eye.z) <= PICKUP_DRAW_M;
  }

  private pickupView(id: number): PickupView {
    let view = this.pickups.get(id);
    if (!view) {
      view = this.freePickups.pop();
      if (!view) {
        const root = new Group();
        const pipe = new Mesh(this.weaponGeometry('pipe'), this.material('weapon'));
        pipe.rotation.x = 0.3;
        pipe.scale.setScalar(1.3);
        pipe.name = 'views-pickup-weapon';
        const glint = new Mesh(
          this.geometry('glint', () => GLINT_PARTS),
          this.look.material('glint', { vertexColors: true }),
        );
        glint.position.set(0, 0.2, -0.45);
        root.add(pipe, glint);
        view = { root, glint, mesh: pipe, shape: 'pipe' };
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

  private updateRider(
    view: RiderView,
    e: EntitySnapshot,
    prev: EntitySnapshot,
    p: Pose,
    curr: SimSnapshot,
  ): void {
    const time = this.now;
    const onFoot = e.mode === 'OnFoot';
    const tumbling = e.mode === 'Tumble';
    const detached = onFoot || tumbling;
    const scheme = schemeFor(e);
    const key = `${scheme.bike}|${scheme.rider}|${scheme.helmet}|${scheme.law ? 1 : 0}|${e.contentId}`;
    if (view.scheme !== key || view.detached !== detached) {
      const props = this.proportions(e.contentId);
      const pk = `${props.height},${props.bulk},${props.head}`;
      view.body.geometry = detached
        ? this.geometry(`foot:${scheme.rider}|${scheme.helmet}|${pk}`, () => onFootParts(scheme, props))
        : this.geometry(`ride:${key}|${pk}`, () => ridingParts(scheme, props));
      const arm = this.geometry(`arm:${scheme.rider}`, () => armParts(scheme));
      view.armMeshes[0].geometry = arm;
      view.armMeshes[1].geometry = arm;
      view.tumbleBikeMesh.geometry = this.geometry(`bike:${scheme.bike}`, () => bikeParts(scheme));
      view.scheme = key;
      view.detached = detached;
    }
    // A hit's flash: the body and arms wash toward white for a moment.
    const flashing = (this.flashes.get(e.id) ?? -1) >= time;
    if (flashing !== view.flashing) {
      const mat = this.look.material(flashing ? 'flash' : 'rider', { vertexColors: true });
      view.body.material = mat;
      view.armMeshes[0].material = mat;
      view.armMeshes[1].material = mat;
      view.kickMesh.material = mat;
      view.flashing = flashing;
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
    // In the air the bike takes the sim's pitch (playtest 2: air control and flips; nose up
    // positive), turning about its middle, not its wheels, so a flip spins in place; a snapshot
    // without a pitch keeps the old fixed nose-up. On the ground it stays level, as before.
    const airborne = e.mode === 'Airborne';
    root.rotation.x = airborne ? (p.pitch ?? 0.12) : 0;
    root.rotation.z = -p.lean + wob;
    if (airborne && p.pitch !== undefined) {
      this.v.set(0, RIDER_CENTRE_M, 0).applyEuler(root.rotation);
      root.position.x -= this.v.x;
      root.position.y += RIDER_CENTRE_M - this.v.y;
      root.position.z -= this.v.z;
    }

    // Arms: the attack side takes the pose, the other holds the bars (or swings when running).
    const side = this.sideOf(e, p, curr);
    const [left, right] = view.arms;
    const attackArm = side < 0 ? left : right;
    const kicking = this.kicks.has(e.id) && e.attackPhase !== 'idle';
    if (e.attackPhase === 'idle' || e.attackPhase === 'cooldown') this.kicks.delete(e.id);
    for (const arm of view.arms) arm.rotation.set(1.1, 0, 0);
    if (tumbling) {
      this.poseTumble(view, e, prev, p);
    } else {
      view.tumbleBike.visible = false;
      view.spin = freshSpin();
      view.spin.heading = p.heading;
    }
    if (onFoot) this.poseOnFoot(view, e, p, curr);
    else if (!tumbling && !kicking) {
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
    view.kickLeg.visible = kicking && !detached;
    if (kicking) {
      view.kickLeg.position.x = side * 0.22;
      const angle = e.attackPhase === 'windup' ? 0.5 : e.attackPhase === 'active' ? 1.35 : 0.7;
      view.kickLeg.rotation.set(0, 0, side * angle);
    }
    // A held weapon rides in the attack-side fist; it glints through the wind-up (the steal cue).
    const held = e.heldWeapon !== null && !tumbling;
    if (held && view.weapon.parent !== attackArm) attackArm.add(view.weapon);
    if (held) {
      const shape = weaponShapeOf(e.heldWeapon);
      if (shape !== view.weaponShape) {
        view.weapon.geometry = this.weaponGeometry(shape);
        view.weaponShape = shape;
      }
    }
    view.weapon.visible = held && this.weaponInView(p);
    view.glint.visible = view.weapon.visible && e.attackPhase === 'windup';
    if (view.glint.visible) {
      view.glint.scale.setScalar(0.8 + 0.7 * Math.abs(Math.sin(time * 18)));
      view.glint.rotation.z = time * 6;
    }
    // A boost (playtest 1b): a flickering flame out of the back of the bike while it lasts.
    const boostS = (e as EntitySnapshot & { boostS?: number }).boostS ?? 0;
    view.flame.visible = boostS > 0 && !detached;
    if (view.flame.visible) view.flame.scale.set(1, 1, 0.7 + 0.5 * Math.abs(Math.sin(time * 31)));
    // The law: a light bar flashing red and blue at 4 Hz.
    view.lightBar.visible = scheme.law && !detached;
    if (view.lightBar.visible) {
      const red = Math.floor(time * 8) % 2 === 0;
      view.lightBar.material = this.look.material('lightbar', { color: red ? LIGHT_RED : LIGHT_BLUE });
    }
  }

  /**
   * A crash: the rider ragdolls on the rider body and the bike cartwheels on its own body, each
   * spinning at a rate set by its speed, and both lie down once they slow. Without body data (a
   * hand-built snapshot), the bike is thrown a little to the side of the rider.
   */
  private poseTumble(view: RiderView, e: EntitySnapshot, prev: EntitySnapshot, p: Pose): void {
    const dt = this.dt;
    const rate = this.params.cartwheelRate;
    const s = view.spin;
    const rb = lerpBody(prev.tumble?.rider, e.tumble?.rider, this.alpha, this.riderBody);
    const bb = lerpBody(prev.tumble?.bike, e.tumble?.bike, this.alpha, this.bikeBody);
    const fwdX = -Math.sin(p.heading);
    const fwdZ = -Math.cos(p.heading);

    // The rider: tumbles head over heels about the body's middle, then lies face down.
    const rvx = rb ? rb.vx : fwdX * e.speed;
    const rvz = rb ? rb.vz : fwdZ * e.speed;
    const rSpeed = rb ? Math.hypot(rb.vx, rb.vy, rb.vz) : e.speed;
    if (Math.hypot(rvx, rvz) > 1) s.heading = Math.atan2(-rvx, -rvz);
    if (rSpeed > 1.2) s.pitch += Math.min(0.6, dt * (rSpeed / RIDER_CENTRE_M) * 0.6 * rate);
    else s.pitch = ease(s.pitch, nearestTurn(s.pitch, Math.PI / 2), dt * 6);
    const root = view.root;
    root.rotation.set(-s.pitch, s.heading, rSpeed > 1.2 ? Math.sin(s.pitch * 0.5) * 0.4 : 0);
    const cx = rb ? rb.x : p.x;
    const cy = (rb ? rb.y : p.y) + 0.25;
    const cz = rb ? rb.z : p.z;
    this.v.set(0, RIDER_CENTRE_M, 0).applyEuler(root.rotation);
    root.position.set(cx - this.v.x, cy - this.v.y, cz - this.v.z);
    const [left, right] = view.arms;
    const flail = rSpeed > 1.2 ? 1 : 0.15;
    left.rotation.set(Math.sin(this.now * 13) * 0.6 * flail, 0, -1.4 + Math.sin(this.now * 9) * 0.3 * flail);
    right.rotation.set(-Math.sin(this.now * 11) * 0.6 * flail, 0, 1.4 - Math.sin(this.now * 8) * 0.3 * flail);

    // The bike: end over end while it flies and skids, then down on its side.
    const bx = bb ? bb.x : cx + Math.cos(p.heading) * 1.2;
    const by = bb ? bb.y : p.y;
    const bz = bb ? bb.z : cz - Math.sin(p.heading) * 1.2;
    const bvx = bb ? bb.vx : rvx;
    const bvz = bb ? bb.vz : rvz;
    const bSpeed = bb ? Math.hypot(bb.vx, bb.vy, bb.vz) : e.speed;
    const bHoriz = Math.hypot(bvx, bvz);
    if (bHoriz > 1) s.bikeHeading = Math.atan2(-bvx, -bvz);
    if (bSpeed > 1) {
      s.bikePitch += Math.min(0.8, dt * (bHoriz / BIKE_CENTRE_M) * rate);
      s.bikeRoll = ease(s.bikeRoll, 0, dt * 4);
    } else {
      s.bikePitch = ease(s.bikePitch, nearestTurn(s.bikePitch, 0), dt * 6);
      s.bikeRoll = ease(s.bikeRoll, Math.PI / 2, dt * 6);
    }
    const bike = view.tumbleBike;
    bike.visible = true;
    bike.rotation.set(-s.bikePitch, s.bikeHeading, s.bikeRoll);
    const lying = Math.min(1, Math.abs(s.bikeRoll) / (Math.PI / 2));
    bike.position.set(bx, by + BIKE_CENTRE_M + (BIKE_SIDE_M - BIKE_CENTRE_M) * lying, bz);
  }

  /** On foot: the get-up, the fist shake at whoever knocked them off, or the run back. */
  private poseOnFoot(view: RiderView, e: EntitySnapshot, p: Pose, curr: SimSnapshot): void {
    const time = this.now;
    const root = view.root;
    const [left, right] = view.arms;
    const getUp = this.getUps.get(e.id);
    const fist = this.fists.get(e.id);
    if (getUp !== undefined && getUp >= time) {
      // From lying face down to standing, pivoting at the feet, pushing up with both arms.
      const k = 1 - Math.max(0, getUp - time) / Math.max(0.01, this.params.getUpS);
      const up = 1 - (1 - k) * (1 - k);
      root.rotation.set(-(Math.PI / 2) * (1 - up), p.heading, 0);
      left.rotation.set(1.3 * (1 - up), 0, -0.2);
      right.rotation.set(1.3 * (1 - up), 0, 0.2);
      return;
    }
    if (fist && fist.until >= time) {
      // Stand facing the rider they blame and shake a fist overhead.
      const target = fist.target >= 0 ? entityById(curr, fist.target) : undefined;
      const heading = target ? Math.atan2(-(target.x - p.x), -(target.z - p.z)) : p.heading;
      root.rotation.set(0, heading, 0);
      right.rotation.set(0, 0, 2.9 + Math.sin(time * 22) * 0.25);
      left.rotation.set(0, 0, -0.15);
      return;
    }
    root.position.y += Math.abs(Math.sin(time * 10)) * 0.08;
    left.rotation.set(Math.sin(time * 10) * 0.8, 0, -0.1);
    right.rotation.set(-Math.sin(time * 10) * 0.8, 0, 0.1);
  }

  /** Sparks and splashes for the events since the last frame, now that positions are known. */
  private resolveEffects(curr: SimSnapshot): void {
    const fx = this.effects;
    if (!fx) {
      this.pending.length = 0;
      return;
    }
    for (const ev of this.pending) {
      const actor = entityById(curr, ev.actor);
      const target = ev.target !== undefined ? entityById(curr, ev.target) : undefined;
      switch (ev.type) {
        case 'hit':
        case 'kick': {
          if (!target) break;
          let dx = actor ? target.x - actor.x : 0;
          let dz = actor ? target.z - actor.z : 0;
          const len = Math.hypot(dx, dz);
          dx = len > 1e-6 ? dx / len : 0;
          dz = len > 1e-6 ? dz / len : 0;
          const strength = (ev.type === 'kick' ? 1.5 : 1) * (ev.data['weapon'] ? 1.25 : 1);
          fx.burst({ x: target.x - dx * 0.3, y: target.y + 1.15, z: target.z - dz * 0.3 }, strength, dx, dz);
          break;
        }
        case 'crash':
          if (actor) {
            const at = bodyPoint(actor, 'rider');
            fx.burst({ x: at.x, y: at.y + 0.3, z: at.z }, 2);
          }
          break;
        case 'takedown':
          if (target) fx.burst({ x: target.x, y: target.y + 1, z: target.z }, 1.5);
          break;
        case 'railOver':
          if (actor) fx.burst(bodyPoint(actor, ev.data['body'] === 'bike' ? 'bike' : 'rider'), 0.8);
          break;
        case 'splash':
          if (actor) {
            const at = bodyPoint(actor, ev.data['body'] === 'bike' ? 'bike' : 'rider');
            // Away from the bridge: from the rider's spot on the road out to the splash.
            const reactor = (ev.actor + ev.tick) % 2 === 0 ? 'gator' : 'fisherman';
            fx.splash(at, reactor, at.x - actor.x, at.z - actor.z);
          }
          break;
        default:
          break;
      }
    }
    this.pending.length = 0;
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
