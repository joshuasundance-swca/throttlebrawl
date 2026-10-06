// Supports: landing on, and riding, the solid things beside and on the road (the maintainer, playing on
// the phone, 2026-10-06: "landing on vehicles shouldn't necessarily be a crash. I flipped up onto a truck
// and crashed. It would have been much more satisfying to land on it and ride on it with real physics";
// "consistent physics and gameplay is important here so players know what to expect"; [decided] the
// same day: "include landing on big solid things beyond vehicles"). The one rule players learn:
// - light things you ride through; solid things stop you below their top;
// - a solid thing whose top is big enough to hold the bike is ground: you land on it and ride it. "Big
//   enough" is the rider's own box (riderHitbox: 2.0 m by 0.8 m for nearly every rider) fitting on the
//   top, its long side along the top's long side (`holdsBike`). A smaller top (a hydrant, a bollard, a
//   lamp, a post, a stump, a carved bear) is an obstacle you meet from above by the closing-speed rule;
// - what lies beyond the edge decides what happens next: riding off it is a take-off like any other.
// What holds a bike, each with its top and its velocity (`supportAt`):
// - every traffic vehicle (its type's box, vehicleHeightM tall, measured as its rigid drawn box, as
//   traffic's own contacts measure it) but a live moving deck, and none for a rider who is a ghost to
//   traffic (back on the bike moments ago: he passes through traffic, so he cannot stand on it);
// - a ramp truck's body (the car on its top deck and the cab, parked or the moving carrier's), its top
//   `truckBodyTop`;
// - a solid road hazard that is not light (the parked pickup, the coffee cart, the stair tower, the log
//   pile), its top `hazardTop`;
// - a solid piece of street furniture whose footprint is its own top (drawn no taller than a rider's
//   head, FURNITURE_TOP_KNOWN_M: road/furniture.ts measures a footprint only up to there, so a lamp's,
//   a tree's or a palm's top is not known to be flat) and holds the bike: the waterfront's parked cars.
// Riding one is the riding model in the support's own frame (sim/riders/index.ts): the bike's speed is
// its speed over the top (`vr`, signed: a support that outruns the bike rolls it backward), the throttle,
// the brake and the coasting drag act on it with a little less grip than asphalt (SUPPORT_GRIP), the air
// drag acts on the speed through the air (so on a moving truck the wind pushes a rider who lets go
// slowly back off its tail), and the support carries the bike at its own velocity. When the support's
// velocity changes under the bike (a truck braking, the overlap snap, a lane's end), the bike rolls on
// at its own: a jolt of JOLT_WOBBLE_MPS or more in one tick wobbles it, and one at `traffic.solidHitMps`
// or more throws the rider (the one rule's line).
// All state is plain data in the system state SUPPORT_STATE_KEY, created the first time a rider lands
// on a support, so a race where nobody does hashes as before; `riders.supports` absent or 0 (every
// recording made before) keeps the old rules (a roof is a contact; the rest are passed over).
// Leaf module: it reads traffic's state by name (as traffic reads the riders'), so traffic may import it.
import { cos, sin, type Hitbox, type TuningParamDecl } from '../../core';
import type { BakedFeature, FurnitureShape } from '../../road';
import { MOVING_DECKS_KEY, type SimConfig, type SimMovingDecks } from '../types';
import { riderHitbox, systemState, vehicleHeightM, type Mover, type World } from '../world';
import {
  hazardObject,
  hazardTop,
  isLightHazard,
  solidHazardsNear,
  truckBodyAt,
  truckBodyBox,
  truckBodyTop,
  truckVelocityS,
  type MovingDecks,
} from './features';
import { furnitureOn, piecesNear } from './furniture';

/** The switch: solid tops are ground a rider lands on and rides (1), or the old rules (0). */
export const SUPPORTS_KEY = 'riders.supports';

export const SUPPORTS_TUNING: readonly TuningParamDecl[] = [
  {
    // The maintainer, 2026-10-06 ([decided]): "landing on vehicles shouldn't necessarily be a crash";
    // "include landing on big solid things beyond vehicles". On by default; a race whose tuning leaves
    // it out (every recording made before) rides the old rules: a roof is a contact by the fall speed.
    id: SUPPORTS_KEY,
    group: 'crashes',
    label: 'Land on and ride solid tops (0 off, 1 on)',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
    system: true,
  },
];

/** Whether this race's riders land on and ride solid tops. */
export function supportsOn(world: World): boolean {
  return (world.params[SUPPORTS_KEY] ?? 0) >= 0.5;
}

/** The system state key of the supports (created only when a rider first stands on one). */
export const SUPPORT_STATE_KEY = 'supports';

/**
 * A street piece's footprint is measured up to a rider's head and no higher (road/furniture.ts,
 * `FURNITURE`): only a piece drawn no taller than this has its footprint as its top, m.
 */
export const FURNITURE_TOP_KNOWN_M = 1.95;
/** Grip on a top, as a share of asphalt's (steering authority and the brake). [default] */
export const SUPPORT_GRIP = 0.85;
/** A support's velocity changing by this much in one tick (m/s) wobbles the rider on it. [default] */
export const JOLT_WOBBLE_MPS = 3;

/** What a support is. */
export type SupportKind = 'vehicle' | 'truck' | 'hazard' | 'furniture';

/** A support found under a point: its top and how it moves. */
export interface Support {
  /** Its identity for the rider standing on it: `v:<vehicle id>`, `t:<feature id>`, `h:<key>`, `f:<id>`. */
  key: string;
  kind: SupportKind;
  /** Its top above the road, m. */
  top: number;
  /** Its velocity in the world, m/s (x, z). */
  vx: number;
  vz: number;
  /** The vehicle's entity id (a traffic vehicle, or a moving carrier's), else -1. */
  vehicle: number;
  /** What it is, for events: a vehicle's content id, `rampTruck`, a hazard's object, a piece's kind. */
  object: string;
}

/** The supports' plain state, by rider entity id. */
export interface SupportState {
  /** The support it stands on (Support.key), or ''. */
  on: string[];
  /** Its speed over the support along its heading, m/s, signed (negative: rolling backward). */
  vr: number[];
  /** The support's velocity in the world when last read, m/s. */
  vx: number[];
  vz: number[];
  /** What the support is (SupportKind), for the style pay and the events. */
  kind: string[];
}

/** The state, without creating it (undefined in a race where nobody has stood on a support). */
export function supportStateOf(world: World): SupportState | undefined {
  return world.systems[SUPPORT_STATE_KEY] as SupportState | undefined;
}

/** The support a rider stands on (its key), or ''. Never writes. */
export function supportKeyOf(world: World, id: number): string {
  return supportStateOf(world)?.on[id] ?? '';
}

/** The kind of support a rider stands on, or ''. Never writes. */
export function supportKindOf(world: World, id: number): string {
  const st = supportStateOf(world);
  return st && (st.on[id] ?? '') !== '' ? (st.kind[id] ?? '') : '';
}

/** Puts a rider on a support, moving over it at `vr` along its heading. */
export function standOn(world: World, id: number, s: Support, vr: number): void {
  const st = systemState<SupportState>(world, SUPPORT_STATE_KEY, () => ({
    on: [],
    vr: [],
    vx: [],
    vz: [],
    kind: [],
  }));
  st.on[id] = s.key;
  st.vr[id] = vr;
  st.vx[id] = s.vx;
  st.vz[id] = s.vz;
  st.kind[id] = s.kind;
}

/** Takes a rider off its support (nothing to do when it stands on none). */
export function leaveSupport(world: World, id: number): void {
  const st = supportStateOf(world);
  if (!st || (st.on[id] ?? '') === '') return;
  st.on[id] = '';
  st.vr[id] = 0;
  st.vx[id] = 0;
  st.vz[id] = 0;
  st.kind[id] = '';
}

/**
 * A supported rider's motion: its signed speed over the support along its heading and the support's
 * world velocity; null when it stands on none. Never writes.
 */
export function supportMotion(world: World, id: number): { vr: number; vx: number; vz: number } | null {
  const st = supportStateOf(world);
  if (!st || (st.on[id] ?? '') === '') return null;
  return { vr: st.vr[id] ?? 0, vx: st.vx[id] ?? 0, vz: st.vz[id] ?? 0 };
}

/**
 * A world velocity (x, z, m/s) in a rider's road frame where it is: `along` its travel and `across` it
 * (so that dd/dt = dir · across, as the bike's own dd/dt = dir · speed · sin(yaw)).
 */
export function inRiderFrame(
  config: SimConfig,
  m: Mover,
  vx: number,
  vz: number,
): { along: number; across: number } {
  const f = config.road.frameAt(m.pos.edge, m.pos.s);
  return { along: m.pos.dir * (vx * f.tx + vz * f.tz), across: m.pos.dir * (-vx * f.tz + vz * f.tx) };
}

/**
 * Whether a top `long` by `short` m holds a rider's bike: the bike's box fits on it, long side along
 * long side (a 2.0 by 0.8 m box needs a top at least that big).
 */
export function holdsBike(long: number, short: number, box: Readonly<Hitbox>): boolean {
  const l = long >= short ? long : short;
  const s = long >= short ? short : long;
  return l >= box.lengthM && s >= box.widthM;
}

/** Whether a footprint (a circle or a box) holds the bike: a circle must hold the box's diagonal. */
export function footprintHoldsBike(shape: FurnitureShape, box: Readonly<Hitbox>): boolean {
  if (shape.r > 0) return 2 * shape.r >= Math.sqrt(box.lengthM * box.lengthM + box.widthM * box.widthM);
  return holdsBike(2 * shape.hu, 2 * shape.hv, box);
}

/** Whether (s, d) is on a footprint (a circle, or a box along its own axes). */
export function onFootprint(shape: FurnitureShape, s: number, d: number): boolean {
  const rs = s - shape.s;
  const rd = d - shape.d;
  if (shape.r > 0) return rs * rs + rd * rd <= shape.r * shape.r;
  const u = rs * shape.us + rd * shape.ud;
  const v = -rs * shape.ud + rd * shape.us;
  return Math.abs(u) <= shape.hu && Math.abs(v) <= shape.hv;
}

/** Traffic's state, read by name (the fields a support needs). */
interface TrafficView {
  id?: readonly number[];
  type?: readonly number[];
  ghostCapT?: readonly number[];
}

/** Where a point is, and when: `ahead` seconds on (0: as the tick starts; dt: as it ends). */
export interface SupportQuery {
  edge: number;
  s: number;
  d: number;
  ahead: number;
}

/**
 * The highest support whose top `accept`s and whose top holds the rider's bike at a point, `ahead`
 * seconds on (a moving support where its velocity takes it), or null; with `key`, only that support.
 * Vehicles in ascending slot order, then the ramp trucks, the hazards and the street furniture; a tie
 * keeps the first. Plain + - * / and core's trig.
 */
export function supportAt(
  world: World,
  config: SimConfig,
  m: Mover,
  at: SupportQuery,
  decks: MovingDecks,
  accept: (top: number) => boolean,
  key?: string,
): Support | null {
  const box = riderHitbox(config, m.riderIndex);
  let best: Support | null = null;
  const take = (s: Support) => {
    if ((key === undefined || s.key === key) && accept(s.top) && (!best || s.top > best.top)) best = s;
  };
  if (key === undefined || key.startsWith('v:')) vehicleSupports(world, config, m, at, box, take);
  if (key === undefined || key.startsWith('t:')) {
    const f = truckBodyAt(config, at.edge, at.s, at.d, at.ahead > 0 ? decks.next : decks.now);
    if (f) {
      const body = truckBodyBox(f);
      if (holdsBike(body.s1 - body.s0, body.d1 - body.d0, box)) {
        const v = truckVelocityS(f);
        const fr = config.road.frameAt(at.edge, at.s);
        const moving = f.params?.['moving'] === true;
        take({
          key: `t:${f.id}`,
          kind: 'truck',
          top: truckBodyTop(f),
          vx: fr.tx * v,
          vz: fr.tz * v,
          vehicle: moving ? vehicleOfDeck(f) : -1,
          object: 'rampTruck',
        });
      }
    }
  }
  if (key === undefined || key.startsWith('h:')) {
    for (const p of solidHazardsNear(config, at.edge, at.s, 1)) {
      if (isLightHazard(p.feature) || !footprintHoldsBike(p.shape, box)) continue;
      if (!onFootprint(p.shape, at.s, at.d)) continue;
      const object = hazardObject(p.feature);
      take({
        key: `h:${p.key}`,
        kind: 'hazard',
        top: hazardTop(p.feature),
        vx: 0,
        vz: 0,
        vehicle: -1,
        object,
      });
    }
  }
  if ((key === undefined || key.startsWith('f:')) && furnitureOn(world.params)) {
    for (const it of piecesNear(config, at.edge, at.s, 1)) {
      if (it.cls !== 'solid' || it.heightM > FURNITURE_TOP_KNOWN_M || !footprintHoldsBike(it.shape, box))
        continue;
      if (!onFootprint(it.shape, at.s, at.d)) continue;
      take({
        key: `f:${it.id}`,
        kind: 'furniture',
        top: it.heightM,
        vx: 0,
        vz: 0,
        vehicle: -1,
        object: it.kind,
      });
    }
  }
  return best;
}

/** A moving deck's carrier, from its feature id (`moving:<vehicle id>`), or -1. */
function vehicleOfDeck(f: BakedFeature): number {
  const n = Number(f.id.slice('moving:'.length));
  return Number.isInteger(n) ? n : -1;
}

/**
 * Every traffic vehicle (a live moving deck aside: its ramp truck's body is its support) whose rigid
 * box, `at.ahead` seconds on at its speed and heading, holds the point, and whose top holds the bike.
 */
function vehicleSupports(
  world: World,
  config: SimConfig,
  m: Mover,
  at: SupportQuery,
  box: Readonly<Hitbox>,
  take: (s: Support) => void,
): void {
  const tr = world.systems['traffic'] as TrafficView | undefined;
  const ids = tr?.id;
  if (!tr || !ids || ids.length === 0) return;
  // A ghost (back on the bike moments ago, sim/traffic startTrafficGhost) passes through traffic.
  if ((tr.ghostCapT?.[m.id] ?? 0) > 0) return;
  const decks = (world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined)?.live ?? [];
  const road = config.road;
  let p: { x: number; z: number } | null = null;
  for (let k = 0; k < ids.length; k++) {
    const vid = ids[k] ?? -1;
    const v = world.movers[vid];
    const t = config.trafficTypes[tr.type?.[k] ?? -1];
    if (!v || !t || v.kind !== 'vehicle') continue;
    if (!holdsBike(t.lengthM, t.widthM, box)) continue;
    if (decks.some((d) => d.vehicle === vid)) continue;
    // Far along the same road: nowhere near.
    const reach = (t.lengthM + t.widthM) / 2 + Math.abs(v.speed) * at.ahead + 4;
    if (v.pos.edge === at.edge && Math.abs(v.pos.s - at.s) > reach) continue;
    p ??= road.toWorld(at.edge, at.s, at.d, 0);
    const f = road.frameAt(v.pos.edge, v.pos.s);
    const tx = f.tx * v.pos.dir;
    const tz = f.tz * v.pos.dir;
    const c = cos(v.yaw);
    const sn = sin(v.yaw);
    // Its heading (as traffic's rigidOffset and the tumble's boxes build it), and its velocity along it.
    const hx = c * tx - sn * tz;
    const hz = c * tz + sn * tx;
    const centre = road.toWorld(v.pos.edge, v.pos.s, v.pos.d, 0);
    const ox = p.x - (centre.x + hx * v.speed * at.ahead);
    const oz = p.z - (centre.z + hz * v.speed * at.ahead);
    const du = ox * hx + oz * hz;
    const dc = -ox * hz + oz * hx;
    if (Math.abs(du) > t.lengthM / 2 || Math.abs(dc) > t.widthM / 2) continue;
    take({
      key: `v:${vid}`,
      kind: 'vehicle',
      top: vehicleHeightM(t),
      vx: hx * v.speed,
      vz: hz * v.speed,
      vehicle: vid,
      object: t.contentId,
    });
  }
}
