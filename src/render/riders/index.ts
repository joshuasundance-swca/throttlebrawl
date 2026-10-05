// Real riders on real bikes (interview, 2026-10-02: "Real models now"; "Real proportions, loud
// costumes"; bikes with real silhouettes per rival). A lazy chunk: the renderer loads it when a race
// names its riders (`setRiderLooks`), and the box riders (views.ts) draw until a rider's two models
// have arrived, or for good if one fails.
//
// Each rider entity draws as ONE SkinnedMesh: its rider model (tools/blender/riders, from the
// dataset repo) and its bike model (PR #300) baked together, each vertex rigidly skinned to the bone
// its part hangs from (bake.ts). Bones move every frame:
//   - riding: the hips on the bike's seat anchor, hands on the bars, feet on the pegs (pose.ts IK);
//     wheels spin with speed, the fork steers with the turn; a wheelie on launch, a stoppie on hard
//     braking, a squat on landing, punches, weapon swings and kicks toward the target, a whip in the
//     air, each rival's signature move while it shows; coat tails, ties and braids stream in the wind;
//     playtest 3's moves (T2.4): the wheelie drawn from the sim's own angle (`EntitySnapshot.wheelie`)
//     with the rider sitting back, the drift's slide (the bike drawn at heading minus the slip, the
//     inside knee down, rubber and smoke under the tyre: skids.ts), a backflip's and a front flip's
//     own postures;
//   - tumbling: the rider flails where views.ts throws the body and the bike cartwheels on its own;
//   - on foot: running back, the get-up and the fist shake; the bike stands on its stand;
//   - hurt (under half health) a rider sheds their prop, and under a third the bike trails smoke;
//   - Dial-Up in his Bad Connection grudge (run W-U): a see-through, flickering ghost while his
//     connection is dropped (ghost.ts).
// views.ts still places each rider in the world (its box rider's root, parked bike and tumbling bike
// are the inputs here); everything in this folder is presentation and may use wall-clock time.
import {
  Bone,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Material,
} from 'three';
import type { AssetManifest } from '../../assets';
import { SMOKE_HEALTH, type EntitySnapshot, type SimEvent, type SimSnapshot } from '../../sim/api';
import { mergeBoxes } from '../geometry';
import { readGlb } from '../glb';
import type { LookStyle } from '../look';
import { FALLBACK_BIKE_MODEL, withPlayerPaint, type RiderLook } from '../rider-looks';
import { Skids } from '../skids';
import type { RenderParams } from '../tuning';
import { bakePart, paintedColors, RIDER_BONES, type BakedPart, type PartKind, type RiderBone } from './bake';
import { Ghosts } from './ghost';
import {
  bikeFrame,
  follow,
  freshPose,
  leanForward,
  limbRoot,
  ridingPole,
  riderFrame,
  seating,
  setLimb,
  sideSign,
  SIDES,
  twoBoneIk,
  type BikeFrame,
  type RiderFrame,
  type RiderPose,
  type Seating,
  type Side,
} from './pose';

export { bakePart } from './bake';

/** Beyond this distance from the camera a rider draws without its detail parts (faces, prints). */
export const RIDER_LOD_M = 60;
/**
 * A rider sheds its prop below this share of its health, and its bike smokes at or under
 * `SMOKE_HEALTH` (the sim's: a smoking bike is also a little slower, playtest 4's P4-14).
 */
export const SHED_HEALTH = 0.5;
export { SMOKE_HEALTH };
const SQUAT_S = 0.35;
const SMOKE_CAP = 96;
/** A wheelie this far up (rad) has the rider sat all the way back; below it, part of the way. */
const WHEELIE_SEATBACK = 0.6;
/** The drift's knee comes down past this slip (rad) and this lean (see moves.md section 4.4). */
const KNEE_MIN_SLIP = 0.2;
const KNEE_MIN_LEAN = 0.6;
/** A tyre lays rubber past this slip (rad), or in a stoppie past this much nose-down and speed. */
const MARK_MIN_SLIP = 0.15;
const MARK_MAX_SLIP = 0.6;
const STOPPIE_MARK = -0.1;
const STOPPIE_MARK_MPS = 15;
const SMOKE_EVERY_S = 0.07;
const SMOKE_LIFE_S = 1.3;
/** The ghost's tint (a dead screen's blue) and its faint glow (run W-U, Bad Connection). */
const GHOST_TINT = '#9fe8ff';
const GHOST_GLOW = '#1d4fd8';

/** What views.ts hands over for one rider each frame. */
export interface RigFrame {
  /** Its box rider's root, as views placed it this frame (riding, tumbling or on foot). */
  root: Object3D;
  /** Its parked bike (visible while the rider runs back to it). */
  parked: Object3D;
  /** Its tumbling bike's pivot (visible while the rider tumbles). */
  tumbleBike: Object3D;
  /** The held weapon views drew (its geometry is the weapon's shape; visible while held). */
  weapon: Mesh;
  glint: Mesh;
  flashing: boolean;
  /** Wall-clock seconds, and this frame's world seconds (0 in a hit-stop). */
  time: number;
  dt: number;
}

export interface RiderRigCounts {
  /** Rigs built (one per rider entity drawn with models). */
  rigs: number;
  /** Rigs drawn in the last frame. */
  drawn: number;
  /** Triangles those rigs drew (the far ones without their detail). */
  triangles: number;
  /** Models loaded and failed (by asset id), for the debug overlay and tests. */
  loaded: string[];
  failed: { id: string; error: string }[];
  smoke: number;
  /** Skid-mark quads laid, and tyre-smoke puffs up (skids.ts; playtest 3's drift and stoppie). */
  skids: number;
  tyreSmoke: number;
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const qa = new Quaternion();
const qb = new Quaternion();
const qc = new Quaternion();
const va = new Vector3();
const vb = new Vector3();
const m4 = new Matrix4();
const m4b = new Matrix4();

const rot = (axis: Vector3, a: number, out: Quaternion) => out.setFromAxisAngle(axis, a);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Frame-rate-independent easing toward a target. */
const easeK = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, dt));

/** Which side (+1 right, -1 left) of a rider at (x, z) facing `heading` a point is. */
function sideOf(x: number, z: number, heading: number, tx: number, tz: number): number {
  const dot = (tx - x) * Math.cos(heading) - (tz - z) * Math.sin(heading);
  return dot < 0 ? -1 : 1;
}

function byId(snap: SimSnapshot, id: number): EntitySnapshot | undefined {
  const direct = snap.entities[id];
  return direct && direct.id === id ? direct : snap.entities.find((e) => e.id === id);
}

/** How much a class lifts its front wheel on a launch (radians). */
function wheelieMax(cls: string, model: string): number {
  if (/dirt/.test(model)) return 0.5;
  if (/sport|super|street/.test(model)) return 0.42;
  if (/chopper|bagger|touring|cop/.test(model)) return 0.26;
  if (/trike|golf|mower|mobility/.test(model)) return 0.08;
  if (cls === 'scooter' || /moped|step|ebike/.test(model)) return 0.18;
  return 0.34;
}

interface ShedProp {
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  spin: Vector3;
  ground: number;
  restS: number;
  hidden: boolean;
}

interface Puff {
  pos: Vector3;
  vel: Vector3;
  age: number;
}

/** One rider entity's rig: its skinned mesh, its bones and its body-language state. */
class Rig {
  readonly mesh: SkinnedMesh;
  readonly riderGroup = new Group();
  readonly bikeGroup = new Group();
  readonly bones: Record<RiderBone, Bone>;
  readonly bikeBones: Bone[];
  readonly rider: RiderFrame;
  readonly bike: BikeFrame;
  readonly seat: Seating;
  readonly pose: RiderPose;
  readonly weapon: Mesh;
  readonly glint: Mesh;
  readonly flame: Mesh;
  readonly lightBar: Mesh | null;
  private readonly bikePart: BakedPart;
  private readonly fullCount: number;
  private readonly farCount: number;
  private readonly lights: { red: [number, number][]; blue: [number, number][]; base: Float32Array } | null;
  private lightPhase = -1;
  private readonly arm: Record<Side, Vector3>;
  private readonly leg: Record<Side, Vector3>;
  private steer = 0;
  private accel = 0;
  private wheelie = 0;
  /** Whether the front's angle this frame came from the sim (so the air takes it back at once). */
  private simWheelie = false;
  /** The drawn drift slip (rad, positive: the nose to the right of the travel), eased. */
  private slip = 0;
  /** How far the inside knee is down (0 to 1), and which side it is (1 right, -1 left). */
  private knee = 0;
  private kneeSide = 1;
  private whip = 0;
  private spinFront = 0;
  private spinRear = 0;
  private runPhase = 0;
  squatAt = -10;
  getUpUntil = -1;
  fistUntil = -1;
  flinchUntil = -1;
  flinchSide = 1;
  kicking = false;
  private shed: ShedProp | null = null;
  /** The material the mesh wears now: its look's own, a hit's flash, or the ghost. */
  private wearing: 'rider' | 'flash' | 'ghost' = 'rider';
  /** Dial-Up's ghost material, made the first time he drops (one rig in a race needs it). */
  private ghostMat: MeshLambertMaterial | null = null;
  /** This frame's see-through level (1 solid; below 1 the Bad Connection ghost), set by RiderRigs. */
  ghost = 1;
  private lastSmoke = 0;
  private lastTime = 0;
  private lagSeed = 0;
  private propToHand = false;
  private bellSwing = 0;
  readonly id: number;
  readonly look: RiderLook;

  constructor(
    id: number,
    look: RiderLook,
    riderPart: BakedPart,
    bikePart: BakedPart,
    private readonly lookStyle: LookStyle,
    world: Group,
  ) {
    this.id = id;
    this.look = look;
    this.bikePart = bikePart;
    this.rider = riderFrame(riderPart);
    this.bike = bikeFrame(bikePart);
    this.seat = seating(this.rider, this.bike);
    this.pose = freshPose(this.rider);
    this.riderGroup.matrixAutoUpdate = false;
    this.bikeGroup.matrixAutoUpdate = false;
    this.riderGroup.name = 'rig-rider';
    this.bikeGroup.name = 'rig-bike';

    // Bones: the rider's flat under its group; the bike's nested as its nodes were.
    const nR = RIDER_BONES.length;
    const bones = {} as Record<RiderBone, Bone>;
    const inverses: Matrix4[] = [];
    const all: Bone[] = [];
    for (const name of RIDER_BONES) {
      const b = new Bone();
      b.name = `rig-${name}`;
      bones[name] = b;
      all.push(b);
      inverses.push(new Matrix4().makeTranslation(this.rider.rest[name].clone().negate()));
      this.riderGroup.add(b);
    }
    this.bones = bones;
    this.bikeBones = bikePart.bones.map((bb) => {
      const b = new Bone();
      b.name = `rig-${bb.name}`;
      return b;
    });
    bikePart.bones.forEach((bb, i) => {
      const b = this.bikeBones[i] as Bone;
      const parent = bb.parent >= 0 ? this.bikeBones[bb.parent] : undefined;
      const parentRest = parent ? (bikePart.bones[bb.parent]?.rest ?? new Vector3()) : new Vector3();
      b.position.copy(bb.rest).sub(parentRest);
      (parent ?? this.bikeGroup).add(b);
      all.push(b);
      inverses.push(new Matrix4().makeTranslation(bb.rest.clone().negate()));
    });
    // A prop strapped behind the seat rides on the bike, not the rider.
    if (this.rider.propMount === 'seat') {
      const frame = this.bikeBones[0] as Bone;
      frame.add(bones.prop);
      bones.prop.position.copy(this.bike.seat).sub(bikePart.bones[0]?.rest ?? new Vector3());
    }

    // One geometry: the rider's core, the bike, then the rider's detail (dropped far away).
    const core = riderPart.coreCount;
    const nRider = riderPart.positions.length / 3;
    const nBike = bikePart.positions.length / 3;
    const n = nRider + nBike;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const skin = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    const bikeCols = paintedColors(bikePart, look.paint);
    const put = (
      src: BakedPart,
      colors: Float32Array,
      from: number,
      count: number,
      to: number,
      boneBase: number,
    ) => {
      pos.set(src.positions.subarray(from * 3, (from + count) * 3), to * 3);
      nrm.set(src.normals.subarray(from * 3, (from + count) * 3), to * 3);
      col.set(colors.subarray(from * 3, (from + count) * 3), to * 3);
      for (let i = 0; i < count; i++) {
        skin[(to + i) * 4] = boneBase + (src.boneOf[from + i] ?? 0);
        weight[(to + i) * 4] = 1;
      }
    };
    put(riderPart, riderPart.colors, 0, core, 0, 0);
    put(bikePart, bikeCols, 0, nBike, core, nR);
    put(riderPart, riderPart.colors, core, nRider - core, core + nBike, 0);
    this.fullCount = n;
    this.farCount = core + nBike;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(skin, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(weight, 4));
    this.mesh = new SkinnedMesh(geo, lookStyle.material('rider', { vertexColors: true }));
    this.mesh.name = 'rig-mesh';
    this.mesh.frustumCulled = false;
    this.mesh.bind(new Skeleton(all, inverses), new Matrix4());

    // The law's lenses flash red and blue (the police motorcycle's `light_red`/`light_blue` roles).
    const red: [number, number][] = [];
    const blue: [number, number][] = [];
    for (const run of bikePart.roles) {
      if (run.role === 'light_red') red.push([core + run.start, run.count]);
      if (run.role === 'light_blue') blue.push([core + run.start, run.count]);
    }
    this.lights = look.law && (red.length || blue.length) ? { red, blue, base: col.slice() } : null;

    this.weapon = new Mesh(new BufferGeometry(), lookStyle.material('weapon', { vertexColors: true }));
    this.weapon.name = 'rig-weapon';
    this.weapon.visible = false;
    this.glint = new Mesh(new BufferGeometry(), lookStyle.material('glint', { vertexColors: true }));
    this.glint.position.set(0, 0, -0.5);
    this.weapon.add(this.glint);
    const frame = this.bikeBones[0] as Bone;
    this.flame = new Mesh(
      mergeBoxes([{ size: [0.2, 0.2, 0.8], at: [0, 0, 0.4], color: '#ffffff' }]),
      lookStyle.material('boost'),
    );
    this.flame.name = 'rig-boost-flame';
    this.flame.visible = false;
    this.flame.position.copy(this.bike.lightTail).add(new Vector3(0, -0.22, 0.02));
    frame.add(this.flame);
    // A beacon for the law on a ride with no lenses of its own (the parking trike).
    if (look.law && !this.lights) {
      let top = 0;
      for (let i = 1; i < bikePart.positions.length; i += 3) top = Math.max(top, bikePart.positions[i] ?? 0);
      this.lightBar = new Mesh(
        mergeBoxes([{ size: [0.36, 0.1, 0.12], at: [0, 0, 0], color: '#ffffff' }]),
        lookStyle.material('lightbar', { color: '#ff2a2a' }),
      );
      this.lightBar.position.set(0, top + 0.05, 0);
      frame.add(this.lightBar);
    } else this.lightBar = null;

    this.arm = { l: this.bike.bars.l.clone(), r: this.bike.bars.r.clone() };
    this.leg = { l: this.bike.pegs.l.clone(), r: this.bike.pegs.r.clone() };
    this.lagSeed = (id * 7919) % 97;
    world.add(this.mesh, this.riderGroup, this.bikeGroup);
  }

  dispose(world: Group): void {
    world.remove(this.mesh, this.riderGroup, this.bikeGroup);
    if (this.bones.prop.parent && this.bones.prop.parent !== this.riderGroup)
      this.bones.prop.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
    this.weapon.geometry = new BufferGeometry();
    this.flame.geometry.dispose();
    this.lightBar?.geometry.dispose();
    this.ghostMat?.dispose();
  }

  /** The material this frame wears: a ghost while dropped, else a hit's flash, else its look's own. */
  wornMaterial(): 'rider' | 'flash' | 'ghost' {
    return this.wearing;
  }

  /**
   * Bad Connection's ghost (run W-U): the rider's own material made see-through, tinted and faintly
   * glowing, with no depth written, so the ink look's outline pass (which reads depth) leaves him
   * unlined: he reads as a signal, not a body. Plain lit colours in every look. [default]
   */
  private ghostMaterial(): MeshLambertMaterial {
    if (this.ghostMat) return this.ghostMat;
    const m = new MeshLambertMaterial({
      color: new Color(GHOST_TINT),
      vertexColors: true,
      flatShading: true,
      emissive: new Color(GHOST_GLOW),
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    m.name = 'rider-ghost';
    this.ghostMat = m;
    return m;
  }

  get triangles(): number {
    return (
      (this.mesh.geometry.drawRange.count === Infinity
        ? this.fullCount
        : this.mesh.geometry.drawRange.count) / 3
    );
  }

  lod(): { far: number; full: number; now: number } {
    const now = this.mesh.geometry.drawRange.count;
    return { far: this.farCount, full: this.fullCount, now: now === Infinity ? this.fullCount : now };
  }

  /** Poses the rig for this frame. */
  update(
    e: EntitySnapshot,
    prev: EntitySnapshot,
    curr: SimSnapshot,
    f: RigFrame,
    cam: Vector3,
    world: Group,
  ): void {
    const t = f.time;
    const dt = f.dt;
    this.lastTime = t;
    const tumbling = e.mode === 'Tumble';
    const onFoot = e.mode === 'OnFoot';
    const riding = !tumbling && !onFoot;
    f.root.updateMatrix();

    // Estimates from the last two ticks: acceleration (wheelie, stoppie) and yaw rate (steering).
    let dh = e.heading - prev.heading;
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    const k = easeK(10, dt);
    if (e !== prev) {
      this.accel += ((e.speed - prev.speed) * 60 - this.accel) * k;
      const yawRate = dh * 60;
      const want = clamp(Math.atan((this.bike.wheelbase * yawRate) / Math.max(3, e.speed)), -0.45, 0.45);
      this.steer += ((riding ? want : 0) - this.steer) * k;
    }

    // ---- where the bike and the rider are ----
    let wheelSpeed = 0;
    if (riding) {
      const grounded = e.mode === 'Road' || e.grounded;
      const max = wheelieMax(this.bike.bikeClass, this.look.bikeModel);
      const launching = grounded && e.throttle > 0.6 && e.speed > 0.3 && e.speed < 16 && this.accel > 1.5;
      const braking = grounded && e.speed > 5 && this.accel < -7;
      // A wheelie the sim is balancing (playtest 3) is drawn at its own angle; the guess from the
      // acceleration (a launch's lift, a stoppie) stays for everyone else.
      const simUp = e.mode === 'Road' && (e.wheelie ?? 0) > 0;
      const wantWheelie = simUp
        ? (e.wheelie ?? 0)
        : launching
          ? max * (1 - e.speed / 16) * (0.85 + 0.15 * Math.sin(t * 3 + this.id))
          : braking
            ? -0.2 * clamp((-this.accel - 7) / 4 + 0.5, 0, 1)
            : 0;
      if (this.simWheelie && !simUp && e.mode !== 'Road')
        this.wheelie = 0; // a launch carries the angle in its pitch
      else this.wheelie += (wantWheelie - this.wheelie) * easeK(simUp ? 18 : wantWheelie !== 0 ? 5 : 4, dt);
      this.simWheelie = simUp;
      // The slide: drawn only on the road (the sim's slip is 0 elsewhere), eased a little.
      const slipWant = e.mode === 'Road' ? (e.drift ?? 0) : 0;
      this.slip += (slipWant - this.slip) * easeK(24, dt);
      const kneeWant =
        e.mode === 'Road' && Math.abs(e.drift ?? 0) > KNEE_MIN_SLIP && Math.abs(e.lean) >= KNEE_MIN_LEAN;
      if (kneeWant) this.kneeSide = e.lean >= 0 ? 1 : -1;
      this.knee += ((kneeWant ? 1 : 0) - this.knee) * easeK(10, dt);
      const whipWant = e.mode === 'Airborne' && e.trick === 'whip' ? (e.lean >= 0 ? -1.05 : 1.05) : 0;
      this.whip += (whipWant - this.whip) * easeK(6, dt);
      const m = this.bikeGroup.matrix.copy(f.root.matrix);
      if (Math.abs(this.slip) > 1e-4) {
        // Heading minus the slip, about the middle of the wheelbase and the road's vertical: the
        // body's lean (the root's roll) is applied first, so the yaw is taken out around it.
        const zc = (this.bike.frontContact.z + this.bike.rearContact.z) / 2;
        const rz = f.root.rotation.z;
        qa.setFromAxisAngle(Z, -rz);
        qb.setFromAxisAngle(Y, -this.slip);
        qc.setFromAxisAngle(Z, rz);
        qa.multiply(qb).multiply(qc);
        m.multiply(m4.makeTranslation(0, 0, zc))
          .multiply(m4b.makeRotationFromQuaternion(qa))
          .multiply(m4.makeTranslation(0, 0, -zc));
      }
      if (Math.abs(this.wheelie) > 1e-4) {
        const pivot = this.wheelie > 0 ? this.bike.rearContact : this.bike.frontContact;
        m.multiply(m4.makeTranslation(pivot.x, pivot.y, pivot.z))
          .multiply(m4b.makeRotationAxis(X, this.wheelie))
          .multiply(m4.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      }
      if (Math.abs(this.whip) > 1e-4) {
        m.multiply(m4.makeTranslation(0, 0.5, 0))
          .multiply(m4b.makeRotationAxis(Z, this.whip))
          .multiply(m4.makeTranslation(0, -0.5, 0));
      }
      this.riderGroup.matrix.copy(m);
      wheelSpeed = e.speed;
    } else {
      this.wheelie = 0;
      this.simWheelie = false;
      this.slip = 0;
      this.knee = 0;
      this.whip = 0;
      this.riderGroup.matrix.copy(f.root.matrix);
      if (tumbling && f.tumbleBike.visible) {
        f.tumbleBike.updateMatrix();
        this.bikeGroup.matrix.copy(f.tumbleBike.matrix).multiply(m4.makeTranslation(0, -0.45, 0));
        const b = e.tumble?.bike;
        wheelSpeed = b ? Math.hypot(b.vx, b.vz) : 0;
      } else if (onFoot && f.parked.visible) {
        f.parked.updateMatrix();
        // On its stand: leaning a little to its left.
        this.bikeGroup.matrix.copy(f.parked.matrix).multiply(m4.makeRotationAxis(Z, 0.12));
      } else this.bikeGroup.matrix.makeScale(1e-4, 1e-4, 1e-4);
    }
    this.riderGroup.matrixWorldNeedsUpdate = true;
    this.bikeGroup.matrixWorldNeedsUpdate = true;

    // ---- the bike's moving parts ----
    const squatK = clamp((t - this.squatAt) / SQUAT_S, 0, 1);
    const squat = riding && squatK < 1 ? Math.sin(Math.PI * squatK) : 0;
    const drop = -0.07 * squat;
    this.spinFront -= (wheelSpeed / this.bike.radius.front) * dt;
    this.spinRear -= (wheelSpeed / this.bike.radius.rear) * dt;
    const parts = this.bikePart.bones;
    parts.forEach((bb, i) => {
      const b = this.bikeBones[i] as Bone;
      const parentRest = bb.parent >= 0 ? (parts[bb.parent]?.rest ?? va.set(0, 0, 0)) : va.set(0, 0, 0);
      b.position.copy(bb.rest).sub(parentRest);
      if (i === 0) b.position.y += drop;
      if (bb.name === 'fork') b.quaternion.setFromAxisAngle(this.bike.steerAxis, this.steer);
      else if (bb.name.startsWith('wheel')) {
        b.position.y -= drop;
        b.quaternion.setFromAxisAngle(X, bb.name.startsWith('wheel_front') ? this.spinFront : this.spinRear);
      } else b.quaternion.identity();
    });

    // ---- the rider ----
    if (riding) this.poseRiding(e, curr, t, dt, drop, squat);
    else if (tumbling) this.poseTumble(e, t);
    else this.poseOnFoot(e, t, dt);
    const flapSpeed = riding
      ? e.speed
      : tumbling
        ? Math.hypot(e.tumble?.rider.vx ?? 0, e.tumble?.rider.vz ?? 0)
        : e.speed;
    this.poseFlaps(t, flapSpeed, riding);
    this.poseProp(e, dt, world);
    for (const name of RIDER_BONES) {
      if (name === 'prop') continue;
      const b = this.bones[name];
      const p = this.pose[name];
      b.position.copy(p.p);
      b.quaternion.copy(p.q);
    }

    // ---- the weapon, the flash, the lights, the boost, the level of detail ----
    const side = this.attackSide(e, curr);
    const holder = this.bones[side > 0 ? 'forearm_r' : 'forearm_l'];
    const held = f.weapon.visible && !tumbling;
    this.weapon.visible = held;
    if (held) {
      if (this.weapon.parent !== holder) holder.add(this.weapon);
      this.weapon.geometry = f.weapon.geometry;
      const grip = this.rider.arms[side > 0 ? 'r' : 'l'];
      this.weapon.position
        .copy(grip.end)
        .sub(grip.mid)
        .add(va.set(0, 0, -0.3));
      this.glint.geometry = f.glint.geometry;
      this.glint.visible = f.glint.visible;
      this.glint.scale.copy(f.glint.scale);
      this.glint.rotation.z = f.glint.rotation.z;
    }
    const wear = this.ghost < 1 ? 'ghost' : f.flashing ? 'flash' : 'rider';
    if (wear !== this.wearing) {
      const mat: Material =
        wear === 'ghost' ? this.ghostMaterial() : this.lookStyle.material(wear, { vertexColors: true });
      this.mesh.material = mat;
      this.wearing = wear;
    }
    if (wear === 'ghost' && this.ghostMat) this.ghostMat.opacity = this.ghost;
    const boostS = e.boostS ?? 0;
    this.flame.visible = riding && boostS > 0;
    if (this.flame.visible) this.flame.scale.set(1, 1, 0.7 + 0.5 * Math.abs(Math.sin(t * 31)));
    this.flashLights(t, riding);
    va.setFromMatrixPosition(this.riderGroup.matrix);
    const far = va.distanceTo(cam) > RIDER_LOD_M;
    this.mesh.geometry.setDrawRange(0, far ? this.farCount : this.fullCount);
    this.setVisible(true);
  }

  setVisible(on: boolean): void {
    this.mesh.visible = on;
    this.riderGroup.visible = on;
    this.bikeGroup.visible = on;
  }

  /** Smoke from the exhaust of a badly hurt rider's bike, every few hundredths of a second. */
  smoke(e: EntitySnapshot, t: number, emit: (at: Vector3, vel: Vector3) => void): void {
    if (e.healthMax <= 0 || e.health / e.healthMax > SMOKE_HEALTH || e.mode === 'OnFoot') return;
    if (t - this.lastSmoke < SMOKE_EVERY_S) return;
    this.lastSmoke = t;
    va.copy(this.bike.lightTail)
      .add(vb.set(0, -0.15, 0.1))
      .applyMatrix4(this.bikeGroup.matrix);
    vb.set((Math.random() - 0.5) * 0.6, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6);
    emit(va, vb);
  }

  /**
   * Whether a tyre is laying rubber this frame, and where: the rear tyre while the bike slides (its
   * slip past MARK_MIN_SLIP), the front one in a hard stoppie. Writes the tyre's world point into
   * `out` and returns the strength (0 to 1, the smoke's), or 0 when none is marking (in the air, on
   * foot, tumbling, or rolling normally).
   */
  tyreMark(e: EntitySnapshot, out: Vector3): number {
    if (e.mode !== 'Road') return 0;
    const slide = Math.abs(this.slip);
    if (slide > MARK_MIN_SLIP) {
      out.copy(this.bike.rearContact).applyMatrix4(this.bikeGroup.matrix);
      return clamp(slide / MARK_MAX_SLIP, 0.3, 1);
    }
    if (this.wheelie < STOPPIE_MARK && e.speed > STOPPIE_MARK_MPS) {
      out.copy(this.bike.frontContact).applyMatrix4(this.bikeGroup.matrix);
      return 0.5;
    }
    return 0;
  }

  private attackSide(e: EntitySnapshot, curr: SimSnapshot): number {
    if (e.targetId < 0) return 1;
    const target = byId(curr, e.targetId);
    return target ? sideOf(e.x, e.z, e.heading, target.x, target.z) : 1;
  }

  private poseRiding(
    e: EntitySnapshot,
    curr: SimSnapshot,
    t: number,
    dt: number,
    drop: number,
    squat: number,
  ): void {
    const R = this.rider;
    const P = this.pose;
    const s = this.attackSide(e, curr);
    const sig = e.signature ?? null;
    const sigTarget = sig && sig.targetId >= 0 ? byId(curr, sig.targetId) : undefined;
    const sigSide = sigTarget ? sideOf(e.x, e.z, e.heading, sigTarget.x, sigTarget.z) : s;
    const phase = e.attackPhase;
    const attacking = phase === 'windup' || phase === 'active' || phase === 'recovery';
    if (phase === 'idle' || phase === 'cooldown') this.kicking = false;
    const air = e.mode === 'Airborne';
    const backflip = air && e.trick === 'backflip';
    const flip = backflip || (air && e.trick === 'frontflip');
    const seatBack = this.seat.stretchLean - this.seat.chestLean;

    // Hips on the seat (squatting on a landing, standing a little on the pegs in the air).
    let lean = this.seat.chestLean;
    let roll = 0;
    let twist = 0;
    let headYaw = 0;
    let headPitch = -0.12 * lean;
    let headRoll = 0;
    const hips = new Vector3().copy(this.seat.hips);
    hips.y += drop - 0.05 * squat;
    if (air && !flip) hips.add(new Vector3(0, 0.07, -0.02));
    if (flip) hips.y -= 0.04;
    if (backflip) {
      // Sat right back with the arms nearly straight and the head thrown back, holding on.
      lean += 0.85 * seatBack;
      headPitch -= 0.4;
    } else if (flip) {
      // A front flip: tucked over the bars, chin down.
      lean += 0.5;
      headPitch += 0.55;
    }
    // A wheelie (the sim's angle, or a launch's lift): sat back as far as the arms allow, the head
    // brought level so he looks where he is going, not at the sky. Riding, not in a flip.
    if (!air && this.wheelie > 0) {
      lean += seatBack * clamp(this.wheelie / WHEELIE_SEATBACK, 0, 1);
      headPitch += 0.7 * this.wheelie;
    }
    // The drift: the inside knee comes down, the hips slide to the inside.
    const knee = this.knee;
    if (knee > 0.001) hips.x += this.kneeSide * 0.1 * knee;
    if (air && e.trick === 'wheelie') lean -= 0.25;
    // The newspaper (the pitch deck's #13): sat back as if in a lawn chair, reading (air-pays.ts
    // holds the paper up in front of him; the arms reach for it below).
    const reading = air && e.trick === 'newspaper';
    if (reading) {
      lean -= 0.55;
      headPitch += 0.3;
    }
    lean += 0.25 * squat;
    // The body leans into the turn a little more than the bike.
    roll -= e.lean * 0.25;
    // A hit: the body jerks away from it.
    if (t < this.flinchUntil) roll += this.flinchSide * 0.35 * ((this.flinchUntil - t) / 0.3);

    // Attack overlays: twist toward the target, lean away from a kick.
    if (attacking && !this.kicking) {
      twist = -s * (phase === 'active' ? 0.45 : 0.25);
      headYaw = -s * 0.5;
    }
    if (this.kicking && attacking) {
      roll += s * 0.28;
      headYaw = -s * 0.6;
    }

    // Each rival's signature move while it shows (interview 2026-10-02: "Visible personalities").
    const wantArm: Record<Side, Vector3 | null> = { l: null, r: null };
    let propToHand = false;
    let bellSwing = 0;
    if (reading) {
      wantArm.r = this.shoulder('r', new Vector3())
        .add(new Vector3(0.1, 0.12, -0.42))
        .clone();
      wantArm.l = this.shoulder('l', new Vector3())
        .add(new Vector3(-0.1, 0.12, -0.42))
        .clone();
    }
    if (sig) {
      const ph = sig.phase;
      switch (sig.move) {
        case 'selfie':
          // No hands, filming himself: the phone up in his right hand, a peace sign in his left.
          propToHand = true;
          wantArm.r = this.shoulder('r', new Vector3())
            .add(new Vector3(0.12, 0.28, -0.45))
            .clone();
          wantArm.l = this.shoulder('l', new Vector3())
            .add(new Vector3(-0.22, 0.48, -0.08))
            .clone();
          headPitch += 0.15;
          headYaw = -0.25;
          lean -= 0.2;
          break;
        case 'wave':
          // Waving at the traffic he is drifting toward.
          wantArm.l = this.shoulder('l', new Vector3())
            .add(new Vector3(-0.35 + 0.16 * Math.sin(t * 9), 0.5, -0.05))
            .clone();
          headYaw = 0.55;
          lean -= 0.15;
          break;
        case 'bell':
          bellSwing = ph === 'tell' ? Math.sin(t * 14) : 0;
          headPitch += ph === 'tell' ? 0.15 : 0;
          break;
        case 'counter':
          if (ph === 'tell') headYaw = -sigSide * 1.3;
          break;
        case 'lag': {
          // Twitches at a choppy rate, then freezes.
          const step = Math.floor(t * 8 + this.lagSeed);
          if (ph !== 'open') {
            twist += (((step * 37) % 11) / 11 - 0.5) * 0.5;
            headRoll += (((step * 53) % 13) / 13 - 0.5) * 0.8;
          }
          break;
        }
        case 'ram':
          roll += sigSide * (ph === 'act' ? 0.5 : 0.3);
          lean += 0.15;
          headYaw = -sigSide * 0.4;
          break;
        case 'slow-burn':
          if (ph === 'tell') headPitch += 0.55;
          else {
            headYaw = -sigSide * 0.5;
            lean += 0.2;
          }
          break;
        case 'sweet-talk': {
          const arm: Side = sigSide > 0 ? 'r' : 'l';
          if (ph === 'tell') {
            wantArm[arm] = this.shoulder(arm, new Vector3())
              .add(new Vector3(sigSide * 0.38, 0.22 + 0.06 * Math.sin(t * 7), -0.18))
              .clone();
            headRoll += sigSide * 0.25;
            headYaw = -sigSide * 0.6;
          } else if (ph === 'act')
            wantArm[arm] = this.shoulder(arm, new Vector3())
              .add(new Vector3(sigSide * 0.75, 0, -0.02))
              .clone();
          break;
        }
        case 'cut-in':
          if (ph === 'tell') headYaw = -sigSide * 1.1;
          else lean += 0.3;
          break;
        case 'timber':
          if (ph === 'tell') headYaw = Math.sin(t * 10) * 0.4;
          else {
            lean += 0.4;
            headPitch += 0.3;
          }
          break;
        case 'pivot': {
          const arm: Side = sigSide > 0 ? 'r' : 'l';
          if (ph === 'tell')
            wantArm[arm] = this.shoulder(arm, new Vector3())
              .add(new Vector3(sigSide * 0.72, 0.02, 0))
              .clone();
          else if (ph === 'act') lean += 0.35;
          else {
            lean -= 0.18;
            headPitch += 0.45;
          }
          break;
        }
        default:
          break;
      }
    }

    // Hips, chest and head.
    P.hips.p.copy(hips);
    leanForward(this.seat.hipsLean, P.hips.q);
    leanForward(lean, qa);
    rot(Z, roll, qb);
    rot(Y, twist, qc);
    P.chest.q.copy(qc).multiply(qb).multiply(qa);
    follow(R, P, 'chest', 'hips', P.chest.q);
    rot(Y, headYaw, qa);
    rot(X, -headPitch, qb);
    rot(Z, headRoll, qc);
    follow(R, P, 'head', 'chest', qa.multiply(qc).multiply(qb));

    // Hands: on the bars (they turn with the fork), or punching, swinging, waving.
    const k = easeK(22, dt);
    for (const side of SIDES) {
      const m = R.arms[side];
      const sh = limbRoot(R, P, 'chest', m, new Vector3());
      const bar = this.barPoint(side, drop, new Vector3());
      let want: Vector3 = bar;
      const sg = sideSign(side);
      const own = wantArm[side];
      if (own) want = own;
      else if (attacking && !this.kicking && sg === s) {
        const armed = e.heldWeapon !== null;
        const off =
          phase === 'windup'
            ? armed
              ? new Vector3(s * 0.22, 0.42, 0.22)
              : new Vector3(s * 0.3, 0.02, 0.28)
            : phase === 'active'
              ? armed
                ? new Vector3(s * 0.7, -0.3, -0.15)
                : new Vector3(s * 0.72, -0.02, -0.12)
              : new Vector3(s * 0.42, -0.18, 0);
        want = sh.clone().add(off);
      } else if (this.kicking && attacking && sg !== s) {
        // Kicking: the other hand keeps the bike.
        want = bar;
      }
      const cur = this.arm[side];
      cur.lerp(want, k);
      const mid = new Vector3();
      const end = new Vector3();
      twoBoneIk(sh, cur, m.upper, m.lower, ridingPole('arm', side, new Vector3()), mid, end);
      setLimb(
        P,
        side === 'l' ? 'upper_arm_l' : 'upper_arm_r',
        side === 'l' ? 'forearm_l' : 'forearm_r',
        m,
        sh.clone(),
        mid,
        end,
      );
    }

    // Feet: on the pegs, or the kick out to the side.
    for (const side of SIDES) {
      const m = R.legs[side];
      const hip = limbRoot(R, P, 'hips', m, new Vector3());
      const peg = new Vector3().copy(this.bike.pegs[side]).add(new Vector3(0, 0.075 + drop, 0.035));
      let want: Vector3 = peg;
      const pole = ridingPole('leg', side, new Vector3());
      if (knee > 0.001 && sideSign(side) === this.kneeSide) {
        // Knee down: the foot stays by its peg, the knee swings out and down toward the road.
        want = peg.clone().add(new Vector3(this.kneeSide * 0.03 * knee, -0.03 * knee, 0));
        pole.lerp(new Vector3(this.kneeSide * 0.7, -0.55, -1).normalize(), knee).normalize();
      }
      if (this.kicking && attacking && sideSign(side) === s) {
        const off =
          phase === 'windup'
            ? new Vector3(s * 0.32, -0.3, -0.25)
            : phase === 'active'
              ? new Vector3(s * 0.9, -0.22, -0.05)
              : new Vector3(s * 0.45, -0.5, -0.1);
        want = hip.clone().add(off);
      }
      const cur = this.leg[side];
      cur.lerp(want, easeK(18, dt));
      const mid = new Vector3();
      const end = new Vector3();
      twoBoneIk(hip, cur, m.upper, m.lower, pole, mid, end);
      setLimb(
        P,
        side === 'l' ? 'thigh_l' : 'thigh_r',
        side === 'l' ? 'shin_l' : 'shin_r',
        m,
        hip.clone(),
        mid,
        end,
      );
    }
    this.propToHand = propToHand;
    this.bellSwing = bellSwing;
  }

  /** A shoulder joint where the pose puts it now. */
  private shoulder(side: Side, out: Vector3): Vector3 {
    return limbRoot(this.rider, this.pose, 'chest', this.rider.arms[side], out);
  }

  /** A grip on the bars, turned with the fork, in the bike's frame. */
  private barPoint(side: Side, drop: number, out: Vector3): Vector3 {
    const b = this.bike;
    rot(b.steerAxis, this.steer, qa);
    return out
      .copy(b.bars[side])
      .sub(b.fork)
      .applyQuaternion(qa)
      .add(b.fork)
      .add(vb.set(0, drop, 0));
  }

  private poseTumble(e: EntitySnapshot, t: number): void {
    const R = this.rider;
    const P = this.pose;
    const v = e.tumble?.rider;
    const fast = v ? Math.hypot(v.vx, v.vy, v.vz) > 1.2 : e.speed > 1.2;
    const flail = fast ? 1 : 0.15;
    P.hips.p.copy(R.rest.hips);
    P.hips.q.identity();
    leanForward(0.3 * Math.sin(t * 6) * flail, qa);
    follow(R, P, 'chest', 'hips', qa);
    follow(R, P, 'head', 'chest', rot(X, 0.3 * Math.sin(t * 8) * flail, qb).premultiply(qa));
    for (const side of SIDES) {
      const sg = sideSign(side);
      const ua = side === 'l' ? 'upper_arm_l' : 'upper_arm_r';
      const fa = side === 'l' ? 'forearm_l' : 'forearm_r';
      const th = side === 'l' ? 'thigh_l' : 'thigh_r';
      const sn = side === 'l' ? 'shin_l' : 'shin_r';
      const phase = sg * 1.7;
      rot(Z, sg * (1.35 + Math.sin(t * 9 + phase) * 0.35 * flail), qa).multiply(
        rot(X, Math.sin(t * 13 + phase) * 0.6 * flail, qb),
      );
      this.fk(ua, 'chest', qa);
      this.fk(fa, ua, qc.copy(qa).multiply(rot(X, 0.6 + 0.4 * Math.sin(t * 11 + phase) * flail, qb)));
      rot(Z, sg * (0.35 + 0.25 * Math.sin(t * 7 + phase) * flail), qa).multiply(
        rot(X, 0.5 * Math.sin(t * 5 + phase) * flail, qb),
      );
      this.fk(th, 'hips', qa);
      this.fk(
        sn,
        th,
        qc.copy(qa).multiply(rot(X, -0.6 - 0.4 * Math.abs(Math.sin(t * 6 + phase)) * flail, qb)),
      );
    }
  }

  private poseOnFoot(e: EntitySnapshot, t: number, dt: number): void {
    const R = this.rider;
    const P = this.pose;
    P.hips.p.copy(R.rest.hips);
    P.hips.q.identity();
    if (t < this.getUpUntil) {
      // Pushing up off the road with both arms.
      follow(R, P, 'chest', 'hips', leanForward(0.2, qa));
      follow(R, P, 'head', 'chest', rot(X, 0.4, qb));
      for (const side of SIDES) {
        const sg = sideSign(side);
        const ua = side === 'l' ? 'upper_arm_l' : 'upper_arm_r';
        const fa = side === 'l' ? 'forearm_l' : 'forearm_r';
        this.fk(ua, 'chest', rot(X, 1.3, qa).multiply(rot(Z, sg * 0.2, qb)));
        this.fk(fa, ua, qa);
        this.fk(side === 'l' ? 'thigh_l' : 'thigh_r', 'hips', qc.identity());
        this.fk(side === 'l' ? 'shin_l' : 'shin_r', side === 'l' ? 'thigh_l' : 'thigh_r', qc);
      }
      return;
    }
    const fist = t < this.fistUntil;
    // Running back: the legs and arms swing, the body leans into it.
    const run = clamp(e.speed / 7, 0, 1.3);
    this.runPhase += dt * (5 + 9 * run);
    const ph = this.runPhase;
    follow(
      R,
      P,
      'chest',
      'hips',
      leanForward(0.18 * run, qa).premultiply(rot(Y, Math.sin(ph) * 0.15 * run, qb)),
    );
    follow(R, P, 'head', 'chest', leanForward(-0.12 * run, qc));
    for (const side of SIDES) {
      const sg = sideSign(side);
      const swing = Math.sin(ph + (side === 'l' ? 0 : Math.PI)) * 0.75 * run;
      const ua = side === 'l' ? 'upper_arm_l' : 'upper_arm_r';
      const fa = side === 'l' ? 'forearm_l' : 'forearm_r';
      const th = side === 'l' ? 'thigh_l' : 'thigh_r';
      const sn = side === 'l' ? 'shin_l' : 'shin_r';
      if (fist && side === 'r') {
        // A fist shaken overhead at whoever knocked them off.
        this.fk(ua, 'chest', rot(Z, 2.85 + Math.sin(t * 22) * 0.2, qa));
        this.fk(fa, ua, qc.copy(qa).multiply(rot(X, 0.5, qb)));
      } else {
        this.fk(ua, 'chest', rot(X, -swing, qa).multiply(rot(Z, sg * 0.12, qb)));
        this.fk(fa, ua, qc.copy(qa).multiply(rot(X, 0.4 + 0.6 * run, qb)));
      }
      this.fk(th, 'hips', rot(X, swing, qa));
      this.fk(
        sn,
        th,
        qc
          .copy(qa)
          .multiply(rot(X, -0.9 * run * Math.max(0, -Math.cos(ph + (side === 'l' ? 0 : Math.PI))), qb)),
      );
    }
  }

  /** Forward kinematics: `child` hangs from `parent` at its rest offset, with absolute rotation `q`. */
  private fk(child: RiderBone, parent: RiderBone, q: Quaternion): void {
    follow(this.rider, this.pose, child, parent, q);
  }

  /** Coat tails, ties, braids and hoods stream back with speed and flutter. */
  private poseFlaps(t: number, speed: number, riding: boolean): void {
    const R = this.rider;
    const P = this.pose;
    const wind = clamp(speed / 30, 0, 1);
    const flutter = Math.sin(t * (9 + 10 * wind) + this.id) * (0.06 + 0.18 * wind);
    const coatBase = riding ? -(0.85 + 0.55 * wind) : -(0.1 + 0.8 * wind);
    for (const [bone, sg] of [
      ['coat_l', -1],
      ['coat_r', 1],
    ] as const) {
      const flap = coatBase + flutter * (sg > 0 ? 1 : 0.8);
      const q = qa
        .copy(P.hips.q)
        .multiply(rot(X, flap, qb))
        .multiply(rot(Z, sg * (0.12 + 0.12 * wind), qc));
      follow(R, P, bone, 'hips', q);
    }
    const tie = -(0.25 + 2.35 * wind) - flutter;
    follow(
      R,
      P,
      'tie',
      'chest',
      qa
        .copy(P.chest.q)
        .multiply(rot(Z, 0.55 * wind, qb))
        .multiply(rot(X, tie, qc)),
    );
    const hair = -(0.15 + 1.1 * wind) + flutter * 0.7;
    follow(R, P, 'hair', 'head', qa.copy(P.head.q).multiply(rot(X, hair, qb)));
  }

  /** The prop on its mount (or in the hand for a selfie), or shed and tumbling down the road. */
  private poseProp(e: EntitySnapshot, dt: number, world: Group): void {
    const prop = this.bones.prop;
    const R = this.rider;
    const share = e.healthMax > 0 ? e.health / e.healthMax : 1;
    if (!this.shed && share < SHED_HEALTH) {
      // Off it comes: from wherever it is now, with the rider's speed and a hop.
      prop.updateWorldMatrix(true, false);
      const pos = new Vector3();
      const quat = new Quaternion();
      prop.matrixWorld.decompose(pos, quat, vb);
      const fwdX = -Math.sin(e.heading);
      const fwdZ = -Math.cos(e.heading);
      const sp = e.mode === 'Tumble' ? 0.3 * e.speed : 0.65 * e.speed;
      this.shed = {
        pos,
        vel: new Vector3(
          fwdX * sp + (Math.random() - 0.5) * 3,
          3 + Math.random() * 2,
          fwdZ * sp + (Math.random() - 0.5) * 3,
        ),
        quat,
        spin: new Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
        ground: e.y,
        restS: 0,
        hidden: false,
      };
      world.add(prop);
    }
    if (this.shed && share >= 0.98) {
      // Back to full health (a new race on the same rig): the prop is back on.
      this.shed = null;
      prop.scale.setScalar(1);
      if (R.propMount === 'seat') {
        const frame = this.bikeBones[0] as Bone;
        frame.add(prop);
        prop.position.copy(this.bike.seat).sub(this.bikePart.bones[0]?.rest ?? new Vector3());
        prop.quaternion.identity();
      } else this.riderGroup.add(prop);
    }
    const sh = this.shed;
    if (sh) {
      if (!sh.hidden) {
        sh.vel.y -= 9.8 * dt;
        sh.pos.addScaledVector(sh.vel, dt);
        qa.setFromAxisAngle(va.copy(sh.spin).normalize(), sh.spin.length() * dt);
        sh.quat.premultiply(qa);
        if (sh.pos.y < sh.ground + 0.08) {
          sh.pos.y = sh.ground + 0.08;
          sh.vel.multiplyScalar(0.55);
          sh.vel.y = Math.abs(sh.vel.y) * 0.3;
          sh.spin.multiplyScalar(0.6);
          sh.restS += dt;
        }
        if (sh.restS > 2.5) sh.hidden = true;
      }
      prop.position.copy(sh.pos);
      prop.quaternion.copy(sh.quat);
      prop.scale.setScalar(sh.hidden ? 0 : 1);
      return;
    }
    if (R.propMount === 'seat') return; // rides on the bike frame as built
    const P = this.pose;
    if (this.propToHand && e.mode !== 'Tumble' && e.mode !== 'OnFoot') {
      // Held up in the right hand, the phone turned to film him.
      const hand = va
        .copy(R.arms.r.end)
        .sub(R.rest.forearm_r)
        .applyQuaternion(P.forearm_r.q)
        .add(P.forearm_r.p);
      prop.position.copy(hand);
      prop.quaternion.copy(P.chest.q).multiply(rot(Y, Math.PI, qa));
      return;
    }
    const mount = R.propMount;
    const base = P[mount];
    const off = va.copy(R.rest.prop).sub(R.rest[mount]).applyQuaternion(base.q);
    prop.position.copy(base.p).add(off);
    prop.quaternion.copy(base.q);
    if (this.bellSwing) prop.quaternion.multiply(rot(X, 0.9 * this.bellSwing, qa));
  }

  private flashLights(t: number, riding: boolean): void {
    const L = this.lights;
    const phase = riding ? Math.floor(t * 8) % 2 : -1;
    if (this.lightBar) {
      this.lightBar.visible = riding;
      if (riding)
        this.lightBar.material = this.lookStyle.material('lightbar', {
          color: phase === 0 ? '#ff2a2a' : '#2a6bff',
        });
    }
    if (!L || phase === this.lightPhase) return;
    this.lightPhase = phase;
    const col = this.mesh.geometry.getAttribute('color') as Float32BufferAttribute;
    const arr = col.array as Float32Array;
    const paint = (runs: [number, number][], on: boolean) => {
      for (const [start, count] of runs) {
        for (let i = start; i < start + count; i++) {
          for (let c = 0; c < 3; c++) {
            const base = L.base[i * 3 + c] ?? 0;
            arr[i * 3 + c] = on ? Math.min(1, base * 1.6 + 0.25) : base * 0.3;
          }
        }
      }
    };
    paint(L.red, phase !== 1);
    paint(L.blue, phase !== 0);
    col.needsUpdate = true;
  }
}

type PartLoad = { part: BakedPart | null; error: string | null };

/**
 * Every rider entity's rig, the models they need (loaded once per asset id through the manifest)
 * and the smoke from hurt bikes. views.ts calls `update` for each rider it draws; a `false` return
 * means "keep drawing the box rider".
 */
export class RiderRigs {
  readonly root = new Group();
  /** Skid marks and tyre smoke: two meshes, hidden while empty (skids.ts). */
  private readonly skids = new Skids();
  private readonly markAt = new Vector3();
  /** The race's looks as app/ named them, and as drawn (the player's with the career paint). */
  private readonly baseLooks = new Map<string, RiderLook>();
  private readonly looks = new Map<string, RiderLook>();
  private playerPaint: string | null = null;
  private readonly parts = new Map<string, PartLoad>();
  private readonly loading = new Set<string>();
  private readonly rigs = new Map<number, Rig>();
  private readonly cam = new Vector3();
  private readonly puffs: Puff[] = [];
  /** Dial-Up's Bad Connection ghost, by rider (run W-U). */
  private readonly ghosts = new Ghosts();
  private readonly smokeMesh: InstancedMesh;
  private drawn = new Set<number>();
  private now = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();

  constructor(
    private readonly look: LookStyle,
    private readonly manifest: AssetManifest | null,
    private readonly params: RenderParams,
  ) {
    this.root.name = 'rider-rigs';
    this.smokeMesh = new InstancedMesh(
      mergeBoxes([{ size: [1, 1, 1], at: [0, 0, 0], color: '#8a8a8a', rotY: Math.PI / 4 }]),
      look.material('prop', { vertexColors: true }),
      SMOKE_CAP,
    );
    this.smokeMesh.name = 'rig-smoke';
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    this.root.add(this.smokeMesh, this.skids.root);
  }

  /** The race's riders and their models; loading starts now (only the models this race needs). */
  setLooks(looks: readonly RiderLook[]): void {
    this.skids.clear(); // a new race starts on clean tarmac
    for (const l of looks) {
      // A rig built from an older look is rebuilt on its next update (rigFor compares looks).
      this.baseLooks.set(l.contentId, l);
      this.looks.set(l.contentId, withPlayerPaint(l, this.playerPaint));
      this.request(l.riderModel, 'rider');
      this.request(l.bikeModel, 'bike');
    }
  }

  /**
   * The career's paint on the player's bike (`#rrggbb`), or null for the look's own colours. The
   * player's rig is rebuilt with it on its next update.
   */
  setPlayerPaint(hex: string | null): void {
    if (hex === this.playerPaint) return;
    this.playerPaint = hex;
    for (const [id, l] of this.baseLooks) if (l.player) this.looks.set(id, withPlayerPaint(l, hex));
  }

  private request(id: string, kind: PartKind): void {
    if (this.parts.has(id) || this.loading.has(id) || !this.manifest) return;
    this.loading.add(id);
    void this.manifest
      .load<BakedPart | null>(id, () => null, { decode: (data) => bakePart(readGlb(data), kind) })
      .then((res) => {
        this.parts.set(id, { part: res.value, error: res.value ? null : (res.error ?? 'no model') });
      })
      .catch((err: unknown) => {
        this.parts.set(id, { part: null, error: String(err) });
      })
      .finally(() => this.loading.delete(id));
  }

  /** Bakes a part directly (tests and tools: no manifest). */
  addPart(id: string, part: BakedPart): void {
    this.parts.set(id, { part, error: null });
  }

  setCamera(x: number, y: number, z: number): void {
    this.cam.set(x, y, z);
  }

  pushEvents(events: readonly SimEvent[]): void {
    this.ghosts.push(events, this.now);
    for (const ev of events) {
      const actor = this.rigs.get(ev.actor);
      if (ev.type === 'land' && actor) actor.squatAt = this.now;
      if (ev.type === 'getUp' && actor) actor.getUpUntil = this.now + this.params.getUpS;
      if (ev.type === 'fistShake' && actor) {
        actor.getUpUntil = -1;
        actor.fistUntil = this.now + this.params.fistShakeS;
      }
      if (ev.type === 'attackStart' && actor) {
        const what = `${String(ev.data['kind'] ?? '')} ${String(ev.data['weapon'] ?? '')}`;
        actor.kicking = /kick/i.test(what);
      }
      if (ev.type === 'kick' && actor) actor.kicking = true;
      if ((ev.type === 'hit' || ev.type === 'kick') && ev.target !== undefined) {
        const target = this.rigs.get(ev.target);
        if (target) {
          target.flinchUntil = this.now + 0.3;
          const side = typeof ev.data['side'] === 'number' ? Math.sign(ev.data['side']) || 1 : 1;
          target.flinchSide = side;
        }
      }
    }
  }

  /** The rig for a rider entity, built once both its models are in; null until then. */
  private rigFor(e: EntitySnapshot): Rig | null {
    const look = this.looks.get(e.contentId);
    const existing = this.rigs.get(e.id);
    if (existing && existing.look === look) return existing;
    if (existing) this.release(e.id);
    if (!look) return null;
    const rider = this.parts.get(look.riderModel)?.part;
    // A bike model that is missing or failed (a garage bike with no model yet) falls back to the
    // starter bike's, so the rider still draws as a real rider.
    const own = this.parts.get(look.bikeModel);
    let bike = own?.part;
    if (own && !own.part && look.bikeModel !== FALLBACK_BIKE_MODEL) {
      this.request(FALLBACK_BIKE_MODEL, 'bike');
      bike = this.parts.get(FALLBACK_BIKE_MODEL)?.part;
    }
    if (!rider || !bike) return null;
    const rig = new Rig(e.id, look, rider, bike, this.look, this.root);
    this.rigs.set(e.id, rig);
    return rig;
  }

  /** Poses a rider's rig; false when it has none yet (views keeps its box rider). */
  update(e: EntitySnapshot, prev: EntitySnapshot, curr: SimSnapshot, f: RigFrame): boolean {
    this.now = f.time;
    const rig = this.rigFor(e);
    if (!rig) return false;
    rig.ghost = this.ghosts.opacity(e, f.time);
    rig.update(e, prev, curr, f, this.cam, this.root);
    const rubber = rig.tyreMark(e, this.markAt);
    this.skids.lay(e.id, rubber > 0 ? this.markAt : null, rubber, f.dt);
    rig.smoke(e, f.time, (at, vel) => {
      if (this.puffs.length >= SMOKE_CAP) this.puffs.shift();
      this.puffs.push({ pos: at.clone(), vel: vel.clone(), age: 0 });
    });
    this.drawn.add(e.id);
    return true;
  }

  /** Drops a rider's rig (its entity is gone). */
  release(id: number): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    rig.dispose(this.root);
    this.rigs.delete(id);
    this.skids.forget(id);
  }

  /**
   * Once a frame, after every rider's update: hides rigs no rider drew (a rider out of the
   * snapshot), and moves the smoke on. `dt` is the world's seconds this frame.
   */
  endFrame(dt: number): void {
    for (const [id, rig] of this.rigs) if (!this.drawn.has(id)) rig.setVisible(false);
    this.lastDrawn = this.drawn;
    this.drawn = new Set();
    let n = 0;
    for (const p of this.puffs) {
      p.age += dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-1.5 * dt));
    }
    while (this.puffs.length && (this.puffs[0]?.age ?? 0) > SMOKE_LIFE_S) this.puffs.shift();
    for (const p of this.puffs) {
      const k = p.age / SMOKE_LIFE_S;
      this.s.setScalar(0.15 + 0.55 * k);
      this.m.compose(p.pos, this.q.setFromAxisAngle(Y, p.age * 2), this.s);
      this.smokeMesh.setMatrixAt(n++, this.m);
    }
    this.smokeMesh.count = n;
    this.smokeMesh.visible = n > 0;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.skids.endFrame(dt);
  }

  private lastDrawn = new Set<number>();

  counts(): RiderRigCounts {
    let triangles = 0;
    for (const id of this.lastDrawn) triangles += this.rigs.get(id)?.triangles ?? 0;
    return {
      rigs: this.rigs.size,
      drawn: this.lastDrawn.size,
      triangles: Math.round(triangles),
      loaded: [...this.parts]
        .filter(([, p]) => p.part)
        .map(([id]) => id)
        .sort(),
      failed: [...this.parts]
        .filter(([, p]) => !p.part)
        .map(([id, p]) => ({ id, error: p.error ?? '' }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      smoke: this.puffs.length,
      skids: this.skids.counts().quads,
      tyreSmoke: this.skids.counts().smoke,
    };
  }

  /** The skid marks' ribbon, the tyre smoke's instanced mesh and the group holding both (tests). */
  skidsMesh(): Mesh {
    return this.skids.ribbon;
  }
  tyreSmokeMesh(): InstancedMesh {
    return this.skids.smokeMesh;
  }
  skidsRoot(): Group {
    return this.skids.root;
  }

  /** A rig's bone's world rotation, for tests: which way a named part of the rider faces now. */
  boneRotation(entityId: number, bone: RiderBone, out = new Quaternion()): Quaternion | null {
    const rig = this.rigs.get(entityId);
    if (!rig) return null;
    this.root.updateMatrixWorld(true);
    return rig.bones[bone].getWorldQuaternion(out);
  }

  /** A rig's bones in world space, for tests: where a named point of the rider is now. */
  bonePosition(entityId: number, bone: RiderBone, out = new Vector3()): Vector3 | null {
    const rig = this.rigs.get(entityId);
    if (!rig) return null;
    this.root.updateMatrixWorld(true);
    return rig.bones[bone].getWorldPosition(out);
  }

  /** Where a rig's bike anchor is in world space now, on the bone it rides on (tests). */
  bikePoint(
    entityId: number,
    name: 'seat' | 'bar_l' | 'bar_r' | 'peg_l' | 'peg_r',
    out = new Vector3(),
  ): Vector3 | null {
    const rig = this.rigs.get(entityId);
    if (!rig) return null;
    this.root.updateMatrixWorld(true);
    const b = rig.bike;
    const onFork = name === 'bar_l' || name === 'bar_r';
    const local =
      name === 'seat'
        ? b.seat
        : name === 'bar_l'
          ? b.bars.l
          : name === 'bar_r'
            ? b.bars.r
            : name === 'peg_l'
              ? b.pegs.l
              : b.pegs.r;
    const bone = this.bikeBoneOf(entityId, onFork ? 'fork' : 'bike');
    if (!bone) return null;
    out.copy(local).sub(onFork ? b.fork : new Vector3());
    return out.applyMatrix4(bone.matrixWorld);
  }

  /** Where a rider's palm or ankle is in world space now (tests). */
  limbEnd(
    entityId: number,
    marker: 'grip_l' | 'grip_r' | 'ankle_l' | 'ankle_r',
    out = new Vector3(),
  ): Vector3 | null {
    const rig = this.rigs.get(entityId);
    if (!rig) return null;
    this.root.updateMatrixWorld(true);
    const side = marker.endsWith('_l') ? 'l' : 'r';
    const arm = marker.startsWith('grip');
    const m = arm ? rig.rider.arms[side] : rig.rider.legs[side];
    const bone =
      rig.bones[arm ? (side === 'l' ? 'forearm_l' : 'forearm_r') : side === 'l' ? 'shin_l' : 'shin_r'];
    return out.copy(m.end).sub(m.mid).applyMatrix4(bone.matrixWorld);
  }

  /** One of a rig's bike bones (`bike`, `fork`, `wheel_front`, ...), for tests. */
  bikeBoneOf(entityId: number, name: string): Bone | null {
    const rig = this.rigs.get(entityId);
    return rig?.bikeBones.find((b) => b.name === `rig-${name}`) ?? null;
  }

  /** The material a rig wears now, and its see-through level (tests: the Bad Connection ghost). */
  wearOf(entityId: number): { wearing: 'rider' | 'flash' | 'ghost'; opacity: number } | null {
    const rig = this.rigs.get(entityId);
    if (!rig) return null;
    const m = rig.mesh.material as Material;
    return { wearing: rig.wornMaterial(), opacity: m.transparent ? m.opacity : 1 };
  }

  /** A rig's skinned mesh (tests). */
  meshOf(entityId: number): SkinnedMesh | null {
    return this.rigs.get(entityId)?.mesh ?? null;
  }

  /** The vertex count a rig draws far away and close up (its level of detail), for tests. */
  lodOf(entityId: number): { far: number; full: number; now: number } | null {
    const rig = this.rigs.get(entityId);
    return rig ? rig.lod() : null;
  }
}

export type { RiderLook } from '../rider-looks';
