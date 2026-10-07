// The riding model: the system's step (sim/riders), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import { clamp, sin, type VergeEdge, cos, atan2, atan } from '../../core';
import {
  type FurnitureShape,
  type StructurePlan,
  type Structure,
  sRateFactor,
  rampTruckShape,
} from '../../road';
import type { TrafficState } from '../traffic';
import { trafficContactCrashes } from '../traffic/contact-rule';
import type { TumbleState } from '../tumble';
import { type SimSteerAssist, type SimConfig, type SimRiderDef, type SimInput, InputFlag } from '../types';
import { startFlight, slopeAt, groundPitch, timeToGround, stepAttitude, touchdown } from './air';
import { RIDER_CONTACT_HALF_WIDTH_M, applyShove, riderContacts, RIDER_BODY_HEIGHT_M } from './contact';
import { leaveCourse, courseEdgesOn, courseSpotOf } from './course';
import { driftTakeoff, driftStep, driftDown } from './drift';
import { ridingLimitsAt, funnelLimits } from './funnel';
import {
  type FurnitureHit,
  closingMps,
  slideAlong,
  BIKE_SPINE_HALF_M,
  SOLID_GRAZE_M,
  spineGap,
  spineAt,
  BIKE_RADIUS_M,
  LIGHT_SCRUB,
  LIGHT_KICK,
  firstTouch,
  furnitureOn,
  piecesNear,
  PARKED_BIKE_HALF_LENGTH_M,
  PARKED_BIKE_HALF_WIDTH_M,
  pileUpsOn,
  PARKED_BIKE_TOP_M,
} from './furniture';
import {
  HAZARD_REACH_D_M,
  type MovingDecks,
  rampTruckAt,
  KERB_M,
  deckHeight,
  solidHazardsNear,
  hazardTop,
  isLightHazard,
  hazardObject,
  boxShape,
  boostPadAt,
  boostOf,
  movingDecks,
  BOOST_ACCEL_MPS2,
  truckDeckTop,
  trucksNear,
  truckVelocityS,
  truckDeckBox,
} from './features';
import { carrierParts, onCarrierPart, type CarrierPart } from './carrier-shape';
import { overMarkOf, gapUnder, overBarrier, gapFall, overFall, clearOver } from './gap';
import {
  supportKeyOf,
  holdsBike,
  type Support,
  inRiderFrame,
  supportMotion,
  leaveSupport,
  supportsOn,
  structureSupportAt,
  supportAt,
  JOLT_WOBBLE_MPS,
  standOn,
  SUPPORT_GRIP,
} from './supports';
import {
  type StructurePiece,
  structuresNear,
  localShape,
  racePlanOf,
  noteTouch,
  touchedOf,
  topNear,
  topGrade,
} from './structures';
import { uturnTurning, uturnStep, uturnSettle } from './uturn';
import {
  vergeState,
  FENCE_PLOUGH_DRAG,
  EDGE_DRAG,
  limitsAt,
  ploughYard,
  behindFence,
  breakFence,
  FENCE_SMASH_LOSS,
  EDGE_WOBBLE_MPS,
  groundFeel,
} from './verge';
import { type World, type Mover, slotAssists, emit, riderHitbox, speedMultiplierOf } from '../world';
import { hazardLaunch, wheelieTakeoff, wheelieStep } from './wheelie';
import {
  offCourse,
  riderLimits,
  BIKE_HALF_WIDTH_M,
  barrierLimits,
  accelMultiplierOf,
  edgeHold,
  frontStructure,
  WOBBLE_TICKS,
  GRAVITY,
  wallTo,
  topSpeedOf,
  smokeScaleOf,
  COAST_DECEL,
  maxYawAt,
  YAW_RESPONSE,
  TAKEOFF_CLEARANCE_M,
  crestCurvature,
  CREST_MARGIN,
  CREST_SPAN_M,
  edgeTopOf,
  LANDING_WOBBLE_FRACTION,
  riderState,
  outPastEdge,
  type RiderState,
} from './index';

/**
 * The launch punch (riders.launchGain) fades out linearly by this share of top speed [default], so
 * cruising (the shoulder's and a wobble's slower top speeds, gentle hills) is exactly as before.
 */
export const LAUNCH_FADE_SHARE = 0.75;

/**
 * An AI rider's punch comes in as its throttle opens from this to full [default]. Below it the AI's
 * model is exactly the M1/M2 one, so its feed-forward throttle (which holds a speed with a partial
 * throttle) is unchanged, while an AI accelerating flat out gets the whole punch. A player has no
 * gate (the integration skeptic, playtest 1c: the phone's scaled stick sits below full, and a 90 %
 * gate left an 85 % thumb on the old 7.9 s 0-60), so the punch scales smoothly with the thumb.
 */
export const AI_LAUNCH_THROTTLE = 0.9;

/**
 * How far beside a ramp truck a rider put down inside it steps out, m: clear of its side by the
 * rider's reach (truckSideContact), so stepping out is not a scrape (it was 0.3, the bike's middle).
 */
const TRUCK_STEP_OUT_M = HAZARD_REACH_D_M + 0.05;

/**
 * How far under a carrier's top deck a rider in the air must be to have flown into the truck, m, and how
 * far under it one may come down onto it from: a rider who leaves the lip platform is on the deck's
 * level, and a few millimetres of the first tick's fall and the rounding of its height are no hit.
 */
const TRUCK_DECK_TOLERANCE_M = 0.05;

const GEAR_TOP_MPS = [9, 16, 23, 30, 1000];

/** Extra drag on the rougher shoulder, m/s². */
const SHOULDER_DRAG = 1.5;

/** Scrape friction while touching a barrier, m/s². */
const SCRAPE_DRAG = 4;

/** Steering authority while wobbling. */
const WOBBLE_STEER = 0.5;

/** Extra drag while wobbling, m/s². */
const WOBBLE_DRAG = 1;

/** Peak lean shake while wobbling, radians. */
const WOBBLE_LEAN = 0.18;

/** While already wobbling, a contact this fraction of the crash speed crashes you. */
const UNSTABLE_CRASH_FRACTION = 0.4;

/** Lean follows its target at this rate, 1/s (the "weighty" part). */
const LEAN_RESPONSE = 8;

const MAX_LEAN = 0.8;

/** Heading change steering can make in the air, rad/s at full lock. */
const AIR_TURN_RATE = 0.6;

/**
 * From this fraction of the landing crash sideways speed the bike slides straight instead (playtest
 * 2): the rider wrestles it in line, its heading kept LANDING_SLIDE_YAW of what it was, and it loses
 * the speed it carried sideways plus LANDING_SLIDE_LOSS of the rest. [default]
 */
const LANDING_SLIDE_FRACTION = 0.6;

const LANDING_SLIDE_YAW = 0.3;

const LANDING_SLIDE_LOSS = 0.1;

/** A wobbly landing (but no slide) keeps this share of its heading off the road. [default] */
const LANDING_WOBBLE_YAW = 0.6;

/** Coming down harder than this into the surface wobbles, and much harder crashes, m/s. */
const LANDING_WOBBLE_VERTICAL = 14;

const LANDING_CRASH_VERTICAL = 22;

/**
 * Steering assist strength: the heading nudge at the edge of the travel lanes, as a share of the
 * steering's full heading offset. Even strong stays below full lock, so a rider who means it still gets onto the shoulder.
 */
const ASSIST_GAIN: Readonly<Record<SimSteerAssist, number>> = { off: 0, light: 0.45, strong: 0.9 };

/** The assist acts within this distance of the travel lanes' edge (a bike's half-width inside it). */
const ASSIST_MARGIN_M = 1;

/** It judges where the rider will be this far ahead, so riding away from the edge is left alone. */
const ASSIST_LOOKAHEAD_S = 0.4;

/**
 * Keeps where a riding rider left the course (gap.ts `left`) while it is off it, and forgets it once it is back on
 * a road's band: the over-the-barrier mark's crossing when it flew over the edge, else (up on a top it rode onto)
 * its riding limit where it is. Writes only when that changes, so a race where nobody leaves the course hashes as
 * before.
 */
function noteLeft(world: World, config: SimConfig, st: RiderState, m: Mover): void {
  const off = offCourse(world, config, m);
  if (!off) {
    if (st.left && Object.hasOwn(st.left, m.id)) delete st.left[m.id];
    return;
  }
  if (st.left && Object.hasOwn(st.left, m.id)) return;
  const mark = overMarkOf(st, m.id);
  const pos = m.pos;
  const lim = riderLimits(world, config, pos.edge, pos.s, pos.d, true);
  const at = mark
    ? { edge: mark.edge, s: mark.s, d: mark.d }
    : { edge: pos.edge, s: pos.s, d: pos.d > lim.hi ? lim.hi : pos.d < lim.lo ? lim.lo : pos.d };
  (st.left ??= {})[m.id] = at;
}

/** The human slot a rider is driven from, or -1 (AI and cop riders have none). */
function slotOf(def: SimRiderDef): number {
  return def.controller.kind === 'player' ? def.controller.slot : -1;
}

/** The throttle the model applies: the input's, or full gas less the brake under auto-throttle. */
function throttleOf(config: SimConfig, def: SimRiderDef, input: SimInput): number {
  if (slotAssists(config, slotOf(def)).autoThrottle) return 1 - clamp(input.brake / 255, 0, 1);
  return clamp(input.throttle / 255, 0, 1);
}

/** The outer edges of the travel lanes (every lane but the shoulders) at (edge, s), or null. */
export function travelLimits(config: SimConfig, edge: number, s: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const lane of config.road.lanesAt(edge, s)) {
    if (lane.kind === 'shoulder') continue;
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return lo < hi ? { lo, hi } : null;
}

/**
 * The steering assist's heading nudge, rad: zero in the middle of the road, growing as the rider's
 * position a moment ahead nears the travel lanes' edge, and always pointing back onto the road. It
 * never picks a line; it only pushes back from the edges, and a rider steering hard enough still
 * gets onto the shoulder.
 */
function assistYaw(config: SimConfig, m: Mover, level: SimSteerAssist, maxYaw: number): number {
  const gain = ASSIST_GAIN[level];
  if (gain === 0) return 0;
  const pos = m.pos;
  const limits = travelLimits(config, pos.edge, pos.s);
  if (!limits) return 0;
  const ahead = pos.d + pos.dir * m.speed * sin(m.yaw) * ASSIST_LOOKAHEAD_S;
  const hi = limits.hi - BIKE_HALF_WIDTH_M;
  const lo = limits.lo + BIKE_HALF_WIDTH_M;
  // Never push a rider away from a branch it may be taking (playtest 1b): inside a split zone, and
  // where a sibling branch overlaps this edge, the edge on that side is a way on, not a wall.
  const branch = config.road.branchSideAt(pos.edge, pos.s);
  const towardPlus = branch > 0 ? 0 : clamp((ahead - (hi - ASSIST_MARGIN_M)) / ASSIST_MARGIN_M, 0, 1);
  const towardMinus = branch < 0 ? 0 : clamp((lo + ASSIST_MARGIN_M - ahead) / ASSIST_MARGIN_M, 0, 1);
  // A heading that moves toward -d is -dir: dd/dt = dir * v * sin(yaw).
  return (towardMinus - towardPlus) * pos.dir * gain * maxYaw;
}

function onShoulder(config: SimConfig, m: Mover): boolean {
  for (const lane of config.road.lanesAt(m.pos.edge, m.pos.s)) {
    if (lane.kind !== 'shoulder') continue;
    if (Math.abs(m.pos.d - lane.dCenterM) <= lane.widthM / 2) return true;
  }
  return false;
}

/**
 * Playtest 1b ([decided] 2026-09-30, "you get forced away like it's a barrier"): past its own edge's
 * drivable band where a sibling branch is drawn overlapping (just past a split or before a merge), a
 * rider moves onto that branch, keeping its world position and heading, and no barrier event fires.
 * Only onto the race's allowed edges. Traffic never does this: it only calls road.advance. True when
 * it handed the rider over.
 */
function crossToBranch(config: SimConfig, m: Mover): boolean {
  const pos = m.pos;
  const { lo, hi } = barrierLimits(config, pos.edge, pos.s);
  if (pos.d >= lo && pos.d <= hi) return false;
  const turn = config.road.handover(pos, BIKE_HALF_WIDTH_M, (e) => config.route.allows(e));
  if (turn !== null) m.yaw += turn;
  return turn !== null;
}

/**
 * Lane drops (W-R; sim/riders/funnel.ts): where the road narrows within `riders.laneDropTaperM`
 * ahead, a rider outside the funnelled edge is eased in to it, with no barrier event and no scrape,
 * and its heading's push toward that edge is dropped. Returns true when it guided the rider (the
 * barrier rule is then done for this tick). Off everywhere the width does not change.
 */
function laneDropGuide(world: World, config: SimConfig, st: RiderState, m: Mover): boolean {
  const pos = m.pos;
  const taper = world.params['riders.laneDropTaperM'] ?? 0;
  const limits = ridingLimitsAt(config.road, world.params, BIKE_HALF_WIDTH_M);
  const f = funnelLimits(config.road, taper, pos, limits);
  if (!f || (pos.d >= f.lo && pos.d <= f.hi)) return false;
  const side = pos.d > f.hi ? 1 : -1;
  pos.d = side > 0 ? f.hi : f.lo;
  // dd/dt = dir · v · sin(yaw): a heading that pushes toward this edge is straightened.
  if (pos.dir * m.yaw * side > 0) m.yaw = 0;
  st.touching[m.id] = 0;
  return true;
}

/**
 * The barrier rule. Past the outer edge the rider is held inside, loses the speed it carried into
 * the wall and scrapes. A new contact emits one event: a crash when the speed into the wall is at
 * least the crash speed (or 40 % of it while already wobbling), otherwise a wobble. At a split
 * zone's outer edge (splitGuideAt), and along a staging road's edges (stagingGuideAt), the rider is
 * only turned along the edge instead. Where the road
 * narrows ahead (a lane that ends, W-R), the edge funnels in first (laneDropGuide).
 */
function barrierContact(world: World, config: SimConfig, st: RiderState, m: Mover, dt: number): void {
  if (laneDropGuide(world, config, st, m)) return;
  const pos = m.pos;
  // Out in a broken fence's yard (off-road): the gap follows the rider along the fence line, and
  // ploughing through it is slow going.
  if (vergeState(world).brokenFences.length > 0 && yardAt(world, config, m)) {
    m.speed = Math.max(0, m.speed - FENCE_PLOUGH_DRAG * accelMultiplierOf(config) * dt);
  }
  const lim = riderLimits(world, config, pos.edge, pos.s, pos.d);
  const { lo, hi } = lim;
  if (pos.d >= lo && pos.d <= hi) {
    st.touching[m.id] = 0;
    return;
  }
  const side: 1 | -1 = pos.d > hi ? 1 : -1; // road-frame side of the wall
  const limit = side > 0 ? hi : lo;
  const feet = config.road.surfaceHeight(pos.edge, pos.s, pos.d) + m.h;
  const holds = edgeHold(world, config, pos, side, lim, feet);
  if (holds === 'guide') {
    pos.d = limit;
    m.yaw = 0;
    st.touching[m.id] = 0;
    return;
  }
  if (holds === 'taper') {
    // A bridge taper (road/bridge-taper.ts; playtest 4, "the rider clips from open air onto the
    // bridge"): the verge narrows into the bridge's end, and its edge eases a rider out on it onto
    // the deck with no event. The edge coming in costs nothing; a rider whose own heading pushes
    // into it (carried wide by a bend, or steering out) scrapes along it with the edge's own drag
    // (the ferns, the sand), as anywhere along the band, and stays in touch with it, so the rail
    // where the deck begins carries the same scrape on.
    pos.d = limit;
    const pushing = pos.dir * m.yaw * side > 0;
    if (pushing) scrapeAlong(config, m, side, dt, EDGE_DRAG[side > 0 ? lim.hiEdge : lim.loEdge]);
    st.touching[m.id] = pushing ? 1 : 0;
    return;
  }
  // The course's honest edges (the maintainer, 2026-10-06; sim/riders/course.ts): where nothing is drawn at the
  // band's edge (soft ground running on, a gap in a row of planned buildings, a hard edge nothing names) it
  // holds nothing. Across its line the rider is on another road the race allows, or out of bounds.
  if (holds === 'open') {
    st.touching[m.id] = 0;
    if ((pos.d - (limit + side * BIKE_HALF_WIDTH_M)) * side > 0)
      leaveCourse(world, config, m, side, limit, feet);
    return;
  }
  if (uturnTurning(st, m.id)) {
    // Mid U-turn (sim/riders/uturn.ts) the kerb holds the bike in and scrapes speed off while it
    // pivots on round; it never crashes it, and the heading is left to the turn. Off-road, the edge
    // that holds it is the verge's (run W-R): a fence or the ferns hold it the same way.
    pos.d = limit;
    m.speed = Math.max(0, m.speed - SCRAPE_DRAG * accelMultiplierOf(config) * dt);
    st.touching[m.id] = 1;
    return;
  }
  const kind = side > 0 ? lim.hiEdge : lim.loEdge;
  const v = m.speed;
  const yawBefore = m.yaw;
  const newContact = st.touching[m.id] !== 1;
  if (kind === 'fence' && smashFence(world, st, m, { side, limit, v, yawBefore, newContact })) return;
  const impact = scrapeAlong(config, m, side, dt, EDGE_DRAG[kind]);
  pos.d = limit;
  st.touching[m.id] = 1;
  // A drift is slid on purpose along the edge, so the wall forgives it more (drift room); so is a
  // rider the bend carries onto its outer edge while it holds the bars into the bend (bend room).
  const sliding = (st.driftSide[m.id] ?? 0) !== 0 || (st.driftBeta[m.id] ?? 0) !== 0;
  const crashScale = Math.max(
    sliding ? Math.max(1, world.params['riders.driftEdgeForgive'] ?? 1) : 1,
    bendCarried(world, config, m, side) ? Math.max(1, world.params['riders.bendEdgeForgive'] ?? 1) : 1,
  );
  const hit = { impact, v, yawBefore, side, newContact, crashScale };
  // A building front whose building is in the structures plan (sim/riders/structures.ts): where it stands at
  // the edge, the edge is that building, met by the one rule for heavy fixed things, not the barrier's.
  const front = kind === 'hard' ? frontStructure(world, config, pos, feet, side, limit) : null;
  if (front) {
    const extra = { object: front.cls, structure: String(front.id), hit: 'side' };
    wallOutcome(world, st, m, { ...hit, extra, vehicle: true });
  } else if (kind === 'hard' || kind === 'rail') wallOutcome(world, st, m, hit);
  else if (kind === 'fence') wallOutcome(world, st, m, { ...hit, extra: { object: 'fence' }, noCrash: true });
  else groundEdge(world, st, m, kind, hit);
}

/** The bars held this far into a bend count as holding it (bend room). [default] */
const BEND_HOLD_STEER = 0.5;

/** A bend at least this tight (1/m, a 400 m radius) can carry a rider onto its outer edge (bend room). */
const BEND_ROOM_KAPPA = 1 / 400;

/**
 * Bend room (playtest 4, the maintainer on the Gorge: "the first couple turns are very very prone
 * to crashing"): the rider meets the edge on the outside of a bend while holding the bars into it
 * (at least BEND_HOLD_STEER of lock toward the bend's inside). Faster than full lock can hold the
 * bend, the riding model carries the bike wide at a steady rate whatever the rider does, so the
 * speed into the edge is the bend's doing, not a swerve into it; `riders.bendEdgeForgive` raises
 * the crash speed for it, as drift room does for a slide. Off the edge's outside, or steering
 * straight or away from the bend, the barrier rule is as before.
 */
function bendCarried(world: World, config: SimConfig, m: Mover, side: 1 | -1): boolean {
  const k = config.road.kappaAt(m.pos.edge, m.pos.s);
  // The bend's outside in the road frame is −sign(κ), whichever way the rider travels.
  if (k * k < BEND_ROOM_KAPPA * BEND_ROOM_KAPPA || side * k > 0) return false;
  const input = world.inputs[m.id];
  if (!input) return false;
  // The rider's right is +steer; the bend turns to the rider's right when κ·dir > 0.
  const into = (input.steer / 127) * m.pos.dir * (k > 0 ? 1 : -1);
  return into >= BEND_HOLD_STEER;
}

/** Whether a rider is out past a fence line in a broken fence's yard (and keeps the gap open). */
function yardAt(world: World, config: SimConfig, m: Mover): boolean {
  const pos = m.pos;
  const raw = limitsAt(config, world.params, [], pos.edge, pos.s, BIKE_HALF_WIDTH_M);
  if (raw.loEdge !== 'fence' && raw.hiEdge !== 'fence') return false;
  const lo = raw.loEdge === 'fence' ? raw.lo : null;
  const hi = raw.hiEdge === 'fence' ? raw.hi : null;
  return ploughYard(vergeState(world).brokenFences, pos.edge, pos.s, pos.d, lo, hi);
}

/**
 * A rider at a fence (off-road, interview 2026-10-02: "some fences can be smashed"). A new contact
 * at `riders.fenceSmashMps` or more across it smashes a stretch open: the rider bursts through into
 * the yard behind, loses FENCE_SMASH_LOSS of its speed and wobbles, with one `wobble` event (`cause`
 * and `object` `fence`, `smashed: true`, the side and the broken stretch's s0 and s1, for render's
 * flying boards). A rider already well past the line came at it from behind (a yard carried over a
 * junction): it breaks quietly where it is. Returns false when the fence holds.
 */
function smashFence(
  world: World,
  st: RiderState,
  m: Mover,
  at: { side: 1 | -1; limit: number; v: number; yawBefore: number; newContact: boolean },
): boolean {
  const pos = m.pos;
  const impact = Math.max(0, pos.dir * at.v * sin(m.yaw) * at.side);
  const fromBehind = behindFence((pos.d - at.limit) * at.side);
  const smash = at.newContact && impact >= (world.params['riders.fenceSmashMps'] ?? 3);
  if (!fromBehind && !smash) return false;
  const gap = breakFence(vergeState(world).brokenFences, pos.edge, at.side, pos.s);
  st.touching[m.id] = 0;
  if (!smash) return true;
  m.speed = at.v * (1 - FENCE_SMASH_LOSS);
  st.wobble[m.id] = WOBBLE_TICKS;
  emit(world, 'wobble', m.id, {
    cause: 'fence',
    object: 'fence',
    smashed: true,
    speed: at.v,
    impactMps: impact,
    yaw: at.yawBefore,
    side: at.side,
    s0: gap.s0,
    s1: gap.s1,
  });
  return true;
}

/**
 * A rider held at a band's soft, brush or water edge (off-road): no crash, ever. The ground running
 * out is silent; a new contact with the ferns or the water at EDGE_WOBBLE_MPS or more wobbles, with
 * one `wobble` event whose `cause` is the edge (`brush`, `water`: render's leaves and splash).
 */
function groundEdge(
  world: World,
  st: RiderState,
  m: Mover,
  kind: VergeEdge,
  hit: { impact: number; v: number; yawBefore: number; side: 1 | -1; newContact: boolean },
): void {
  const at = EDGE_WOBBLE_MPS[kind];
  if (at === undefined || !hit.newContact || hit.impact < at) return;
  st.wobble[m.id] = WOBBLE_TICKS;
  emit(world, 'wobble', m.id, {
    cause: kind,
    speed: hit.v,
    impactMps: hit.impact,
    yaw: hit.yawBefore,
    side: hit.side,
  });
}

/**
 * A rider meeting a wall on its `side` (road frame): the wall takes the speed across the road and
 * turns the bike along it, so the rider scrapes along. Returns the speed it hit the wall with.
 * `drag` is the scrape's, m/s² (the M1 wall's by default; off-road edges have their own).
 */
function scrapeAlong(config: SimConfig, m: Mover, side: 1 | -1, dt: number, drag = SCRAPE_DRAG): number {
  const v = m.speed;
  // Speed across the road toward the wall (the rider's right is -d when riding toward -s).
  const vAcross = m.pos.dir * v * sin(m.yaw);
  const m2 = accelMultiplierOf(config);
  m.speed = Math.max(0, v * cos(m.yaw) - drag * m2 * dt);
  m.yaw = 0;
  return vAcross * side > 0 ? vAcross * side : 0;
}

/** A wall contact's outcome: a crash, a wobble, or (still wobbling) a longer wobble. */
function wallOutcome(
  world: World,
  st: RiderState,
  m: Mover,
  hit: {
    impact: number;
    v: number;
    yawBefore: number;
    side: 1 | -1;
    newContact: boolean;
    extra?: Record<string, string>;
    /** A caller can explicitly require a crash independently of the impact threshold. */
    crash?: boolean;
    /** Never a crash, only a wobble (a fence that held: off-road, run W-R). */
    noCrash?: boolean;
    /**
     * A vehicle (a ramp truck, a parked pickup): playtest 4's one rule for meeting a vehicle
     * (sim/traffic/contact-rule.ts) decides by the closing speed alone, not the barrier's line.
     */
    vehicle?: boolean;
    /** Multiplies the crash speed (1 when left out): a drift's edge room. */
    crashScale?: number;
  },
): void {
  const { impact, v, yawBefore, side } = hit;
  const crashAt = (world.params['riders.crashImpactMps'] ?? 6) * (hit.crashScale ?? 1);
  const unstable = (st.wobble[m.id] ?? 0) > 0;
  const byImpact =
    hit.vehicle === true
      ? trafficContactCrashes(world.params, impact)
      : impact >= crashAt || (unstable && impact >= crashAt * UNSTABLE_CRASH_FRACTION);
  const crashes = hit.noCrash !== true && (hit.crash === true || byImpact);
  const data = { cause: 'barrier', speed: v, impactMps: impact, yaw: yawBefore, side, ...hit.extra };
  if (crashes) {
    st.wobble[m.id] = 0;
    emit(world, 'crash', m.id, data);
  } else if (unstable) {
    st.wobble[m.id] = WOBBLE_TICKS; // still shaky from the last one: the wobble goes on
  } else if (hit.newContact) {
    st.wobble[m.id] = WOBBLE_TICKS;
    emit(world, 'wobble', m.id, data);
  }
}

/**
 * Meet the carrier's individual drawn body parts, in its end-of-tick frame. A flight genuinely
 * above a part clears it; a large top is landed on by supportAt; a small top is met at the fall
 * speed. Other contacts use the closing speed along their normal, including motion inherited
 * from a support. Wobble or crash follows the ordinary vehicle rule, with no speed immunity or
 * forced slow crash. The ramp/deck's remaining side and front contacts follow in truckContact.
 */
function carrierContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
  dt: number,
  decks: MovingDecks,
  height: number,
  clearance = 0,
  hBefore?: number,
): boolean {
  const pos = m.pos;
  let chosen: { hit: FurnitureHit<CarrierPart>; move: ReturnType<typeof moveOf>; vertical: boolean } | null =
    null;
  for (const f of trucksNear(config, pos.edge, pos.s, CONTACT_REACH_M, decks.next)) {
    const move = moveOf(m, before);
    // Translate the start into the carrier's end-of-tick frame; a carried rider has zero relative move.
    if (before.edge === pos.edge) move.s0 += truckVelocityS(f) * dt;
    const parts = [...carrierParts(f)];
    if (m.mode === 'Airborne' && f.params?.['moving'] !== true) {
      const deck = truckDeckBox(f);
      const shape = boxShape(deck.s0, deck.s1, deck.d0, deck.d1);
      parts.push({
        feature: f,
        shape,
        maxTop: truckDeckTop(f),
        topAt: () => truckDeckTop(f),
        support: shape,
      });
    }
    for (const part of parts) {
      if (height + clearance >= part.maxTop) continue;
      const hit = firstTouch([part], move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw);
      if (!hit) continue;
      const s = move.s0 + (move.s1 - move.s0) * hit.t;
      const d = move.d0 + (move.d1 - move.d0) * hit.t;
      const shape = part.shape;
      const top = part.topAt(
        clamp(s, shape.s - shape.hu, shape.s + shape.hu),
        clamp(d, shape.d - shape.hv, shape.d + shape.hv),
      );
      let h = hBefore === undefined ? height : hBefore + (height - hBefore) * hit.t;
      // A bike following the ramp is pitched along it: its front wheel meets the lip at the lip's
      // height, before its middle gets there. A level horizontal capsule must not block that climb.
      if (
        clearance > 0 &&
        supportKeyOf(world, m.id) === '' &&
        deckHeight(config, before.edge, before.s, before.d, { bodies: false, moving: decks.now }) > 0
      ) {
        h = Math.max(
          h,
          deckHeight(config, pos.edge, s, d, { bodies: false, moving: decks.next }),
          deckHeight(
            config,
            pos.edge,
            clamp(s, shape.s - shape.hu, shape.s + shape.hu),
            clamp(d, shape.d - shape.hv, shape.d + shape.hv),
            { bodies: false, moving: decks.next },
          ),
        );
      }
      // A support's top is caught by supportAt; smaller tops are obstacles met at the fall speed.
      const fromAbove = hBefore !== undefined && hBefore >= top - 1e-6;
      if ((!fromAbove && h + clearance >= top) || height + clearance >= top || top <= 0) continue;
      if (
        fromAbove &&
        supportsOn(world) &&
        part.support &&
        onCarrierPart(part, pos.s, pos.d) &&
        (hBefore ?? 0) >= part.topAt(pos.s, pos.d) - clearance &&
        holdsBike(2 * part.support.hu, 2 * part.support.hv, riderHitbox(config, m.riderIndex))
      )
        continue;
      if (!chosen || hit.t < chosen.hit.t) chosen = { hit, move, vertical: fromAbove };
    }
  }
  if (!chosen) return false;
  const { hit, move, vertical } = chosen;
  const part = hit.piece;
  const axis = contactAxis(move, hit);
  // A height change can make a previously clear capsule meet the cab while its nose already
  // overlaps the footprint. If its middle is still beyond the end face, this is an end contact.
  if (
    (move.s0 < part.shape.s - part.shape.hu || move.s0 > part.shape.s + part.shape.hu) &&
    Math.abs(pos.d - part.shape.d) < part.shape.hv
  ) {
    axis.endOn = true;
    axis.ns = move.s0 < part.shape.s ? -1 : 1;
    axis.nd = 0;
  }
  const yawBefore = m.yaw;
  const v = m.speed;
  const motion = supportMotion(world, m.id);
  const carryAlong = motion?.va ?? 0;
  const carryAcross = motion?.vc ?? 0;
  const factor = sRateFactor(config.road.kappaAt(pos.edge, pos.s), pos.d);
  const truckV = truckVelocityS(part.feature) / factor;
  const own = motion && motion.vr < 0 ? -v : v;
  let vs = pos.dir * (own * cos(m.yaw) + carryAlong) - truckV;
  let vd = pos.dir * (own * sin(m.yaw) + carryAcross);
  const impact = vertical ? Math.max(0, -(st.vy[m.id] ?? 0)) : Math.max(0, -(vs * axis.ns + vd * axis.nd));
  if (axis.endOn && !hit.held) {
    pos.s = move.s0 + (move.s1 - move.s0) * hit.t;
    pos.d = move.d0 + (move.d1 - move.d0) * hit.t;
  }
  keepOff(part.shape, pos, m.yaw, axis.ns, axis.nd);
  // Clearing one small part must not push the bike into a neighbouring cab/visor/stack. Resolve
  // the overlapping parts along the same outward normal, rather than alternating between them.
  for (const other of carrierParts(part.feature)) {
    if (height + clearance >= other.maxTop) continue;
    const c = other.shape;
    const top = other.topAt(clamp(pos.s, c.s - c.hu, c.s + c.hu), clamp(pos.d, c.d - c.hv, c.d + c.hv));
    if (height + clearance < top) keepOff(c, pos, m.yaw, axis.ns, axis.nd);
  }
  if (!vertical) {
    const normal = vs * axis.ns + vd * axis.nd;
    if (normal < 0) {
      vs -= normal * axis.ns;
      vd -= normal * axis.nd;
    }
    const along = pos.dir * (vs + truckV) - carryAlong;
    const across = pos.dir * vd - carryAcross;
    m.speed = Math.sqrt(along * along + across * across);
    m.yaw = m.speed > 1e-6 ? clamp(atan2(across, along), -1.2, 1.2) : m.yaw;
  }
  const newContact = st.truckTouch[m.id] !== 1;
  st.truckTouch[m.id] = 1;
  if (hit.held && impact <= 0) return true;
  wallOutcome(world, st, m, {
    impact,
    v,
    yawBefore,
    side: axis.endOn ? 1 : axis.nd > 0 ? -1 : 1,
    newContact,
    vehicle: true,
    extra: {
      object: 'rampTruck',
      feature: part.feature.id,
      hit: vertical ? 'top' : axis.endOn ? 'end' : 'side',
    },
  });
  return true;
}

function truckContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number; deck: number },
  dt: number,
  decks: MovingDecks,
): void {
  const pos = m.pos;
  if (carrierContact(world, config, st, m, before, dt, decks, Math.max(m.h, before.deck), KERB_M)) return;
  const truck = rampTruckAt(config, pos.edge, pos.s, pos.d, decks.next);
  const facing = truck?.params?.['facing'] === -1 ? -1 : 1;
  const foot = truck ? (facing === 1 ? truck.s0 : truck.s1) : 0;
  const beforeS = before.s + (truck ? truckVelocityS(truck) * dt : 0);
  // A continuous ramp entered from its rear is rideable even if its rise this tick exceeds a
  // kerb. This exemption does not cover a side entry or a vertical step beyond the ramp.
  const onRamp =
    !!truck &&
    before.edge === pos.edge &&
    before.d >= truck.d0 &&
    before.d <= truck.d1 &&
    (beforeS - foot) * facing <= rampTruckShape(truck).run &&
    deckHeight(config, pos.edge, pos.s, pos.d, { moving: decks.next }) <=
      rampTruckShape(truck).lip + KERB_M &&
    (pos.s - beforeS) * facing >= 0;
  if (
    !truck ||
    onRamp ||
    deckHeight(config, pos.edge, pos.s, pos.d, { moving: decks.next }) - before.deck <= KERB_M
  ) {
    if (!onRamp && truckSideContact(world, config, st, m, before, dt, decks)) return;
    st.truckTouch[m.id] = 0;
    return;
  }
  const v = Math.max(0, m.speed - pos.dir * truckVelocityS(truck));
  const yawBefore = m.yaw;
  const newContact = st.truckTouch[m.id] !== 1;
  st.truckTouch[m.id] = 1;
  const extra = { object: 'rampTruck', feature: truck.id };
  const outside = before.d < truck.d0 || before.d > truck.d1;
  if (before.edge === pos.edge && outside) {
    const side = before.d < truck.d0 ? 1 : -1; // the truck is on this side of the rider
    const impact = scrapeAlong(config, m, side, dt);
    pos.d = side > 0 ? truck.d0 - 0.01 : truck.d1 + 0.01;
    wallOutcome(world, st, m, { impact, v, yawBefore, side, newContact, extra, vehicle: true });
    return;
  }
  pos.edge = before.edge;
  pos.s = before.s;
  pos.d = before.d;
  m.speed = 0;
  wallOutcome(world, st, m, { impact: v, v, yawBefore, side: 1, newContact, extra, vehicle: true });
}

/**
 * A rider on the road beside a ramp truck meets its side with the side of its bike, not its middle
 * (playtest 4 hitbox audit: the middle rule let the bike ride half a bike's width into the drawn
 * truck before it scraped). Where the truck stands higher than a kerb within the rider's reach
 * across (HAZARD_REACH_D_M, as for a solid hazard), the rider is held that far off its side and
 * scrapes, by truckContact's side rule. The low foot of a ramp is no side. Returns true on contact.
 */
function truckSideContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number; deck: number },
  dt: number,
  decks: MovingDecks,
): boolean {
  const pos = m.pos;
  if (before.deck > KERB_M || before.edge !== pos.edge) return false;
  for (const side of [1, -1] as const) {
    const d = pos.d + side * HAZARD_REACH_D_M;
    const truck = rampTruckAt(config, pos.edge, pos.s, d, decks.next);
    if (!truck) continue;
    if (deckHeight(config, pos.edge, pos.s, d, { moving: decks.next }) - before.deck <= KERB_M) continue;
    const v = Math.max(0, m.speed - pos.dir * truckVelocityS(truck));
    const yawBefore = m.yaw;
    const newContact = st.truckTouch[m.id] !== 1;
    st.truckTouch[m.id] = 1;
    const impact = scrapeAlong(config, m, side, dt);
    pos.d = side > 0 ? truck.d0 - HAZARD_REACH_D_M - 0.01 : truck.d1 + HAZARD_REACH_D_M + 0.01;
    const extra = { object: 'rampTruck', feature: truck.id };
    wallOutcome(world, st, m, { impact, v, yawBefore, side, newContact, extra });
    return true;
  }
  return false;
}

/**
 * How far round a bike its contacts look for a piece, m: its own reach (half its length) and one tick's
 * travel at the fastest a racer goes (53 m/s), with room.
 */
const CONTACT_REACH_M = 2.5;

/** What a heavy thing a rider meets is, for the contact's events. */
interface SolidMet {
  extra: Record<string, string>;
  newContact: boolean;
  /** Never a crash, only a wobble (a dropped bike put down where the rider already was). */
  noCrash?: boolean;
}

/**
 * A grounded rider meeting something heavy and fixed (playtest 4, "solid but forgiving": a solid road
 * hazard, or a solid piece of street furniture), classed and decided exactly as a rider meeting a vehicle
 * is (sim/traffic, #552's one rule): the contact is the first moment the bike's capsule touches it along
 * the tick's move (sim/riders/furniture.ts); it is **end on** when the two were not side by side as the
 * move began (the bike's front met it), unless they overlap sideways by less than `SOLID_GRAZE_M` (a **graze**:
 * the corner); otherwise it is a **side** contact. End on, the closing speed is the bike's speed along the
 * road; a graze or a side contact, its speed across it. At `traffic.solidHitMps` or more it is a crash;
 * under it a wobble. Either way the rider is kept off it along that axis and slides on (a square hit
 * stops it; a graze or a side brush only loses its speed across, and the bike is eased past). Held
 * against it (already touching), the rider is kept off it and slides on with no new event.
 */
function meetSolid(
  world: World,
  st: RiderState,
  m: Mover,
  move: { s0: number; d0: number; s1: number; d1: number },
  hit: FurnitureHit<{ shape: FurnitureShape }>,
  met: SolidMet,
): void {
  const pos = m.pos;
  const v = m.speed;
  const yawBefore = m.yaw;
  const c = hit.piece.shape;
  const { endOn, alongside, ns, nd } = contactAxis(move, hit);
  // End on, the bike stops where it met it; a graze or a side contact goes on along it this tick and is
  // eased off it across the road.
  if (endOn && !hit.held) {
    pos.s = move.s0 + (move.s1 - move.s0) * hit.t;
    pos.d = move.d0 + (move.d1 - move.d0) * hit.t;
  }
  keepOff(c, pos, m.yaw, ns, nd);
  const closing = closingMps(v, pos.dir, m.yaw, ns, nd);
  const slid = slideAlong(v, pos.dir, m.yaw, ns, nd);
  m.speed = slid.speed;
  m.yaw = clamp(slid.yaw, -1.2, 1.2);
  // Resting against it, or put down in it (a remount): kept off it, and nothing to tell.
  if (hit.held && closing <= 0) return;
  // The piece is on this side of the rider, in the road frame.
  const side: 1 | -1 = endOn ? 1 : nd > 0 ? -1 : 1;
  wallOutcome(world, st, m, {
    impact: closing,
    v,
    yawBefore,
    side,
    newContact: met.newContact,
    extra: { ...met.extra, hit: endOn ? 'end' : alongside ? 'side' : 'graze' },
    vehicle: true,
    ...(met.noCrash === true ? { noCrash: true } : {}),
  });
}

/**
 * How a contact met (`meetSolid`): `alongside` when the two were side by side as the move began (the
 * piece beside the straight of the bike's capsule, not ahead of its round front), `endOn` when the bike's
 * front met it squarely (not alongside, and overlapping sideways by `SOLID_GRAZE_M` or more), and the axis its
 * closing speed is taken along, pointing from the piece to the bike.
 */
function contactAxis(
  move: { s0: number; d0: number; s1: number; d1: number },
  hit: FurnitureHit<{ shape: FurnitureShape }>,
): { endOn: boolean; alongside: boolean; ns: number; nd: number } {
  const c = hit.piece.shape;
  const s = hit.held ? move.s1 : move.s0 + (move.s1 - move.s0) * hit.t;
  const d = hit.held ? move.d1 : move.d0 + (move.d1 - move.d0) * hit.t;
  const alongside = Math.abs(move.s0 - c.s) < c.reachS + BIKE_SPINE_HALF_M;
  const overD = c.reachD + RIDER_CONTACT_HALF_WIDTH_M - Math.abs(d - c.d);
  const endOn = !alongside && overD >= SOLID_GRAZE_M;
  return { endOn, alongside, ns: endOn ? (s >= c.s ? 1 : -1) : 0, nd: endOn ? 0 : d >= c.d ? 1 : -1 };
}

/** Moves the bike along (ns, nd) until its capsule clears a footprint (or 3 m, which never happens). */
function keepOff(shape: FurnitureShape, pos: Mover['pos'], yaw: number, ns: number, nd: number): void {
  if (spineGap(shape, spineAt(pos.s, pos.d, pos.dir, yaw)).dist >= BIKE_RADIUS_M) return;
  let lo = 0;
  let hi = 3;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const g = spineGap(shape, spineAt(pos.s + ns * mid, pos.d + nd * mid, pos.dir, yaw));
    if (g.dist >= BIKE_RADIUS_M) hi = mid;
    else lo = mid;
  }
  pos.s += ns * (hi + 0.005);
  pos.d += nd * (hi + 0.005);
}

/** The tick's move on one edge, from where the bike was to where it is (a move over an edge's end starts where it is). */
function moveOf(m: Mover, before: { edge: number; s: number; d: number }) {
  const same = before.edge === m.pos.edge;
  return {
    s0: same ? before.s : m.pos.s,
    d0: same ? before.d : m.pos.d,
    s1: m.pos.s,
    d1: m.pos.d,
  };
}

/**
 * A solid road hazard (run W-U: a parked pickup, a stump, a chainsaw bear, a log pile; sim/riders/features.ts)
 * is a box met by `meetSolid`: the closing speed along the contact's normal decides (playtest 4: one rule for
 * every heavy fixed thing, with the street furniture; it was the barrier's 6 m/s for all but the pickup, and a
 * head-on stop at the whole speed). Events carry `object` (what it is) and the hazard's `feature` id.
 * Returns true when a wheelie launched the rider off it instead (playtest 3): the rider is in the air.
 */
function hazardContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
): boolean {
  const pos = m.pos;
  // Met below its top only (a rider on a support stands above most of them), and never the hazard the
  // rider stands on (supports: the parked pickup, the stair tower).
  const own = supportKeyOf(world, m.id);
  const all = solidHazardsNear(config, pos.edge, pos.s, CONTACT_REACH_M, world).filter(
    (p) => m.h < hazardTop(p.feature) && own !== `h:${p.key}`,
  );
  // A light hazard (a festival barricade: boards on legs) is knocked aside as a light street piece is:
  // ridden through once, a little speed and a heading kick, a `smash` wobble, never a crash.
  let light = 0;
  for (const p of all) {
    if (!isLightHazard(p.feature)) continue;
    if (spineGap(p.shape, spineAt(pos.s, pos.d, pos.dir, m.yaw)).dist >= BIKE_RADIUS_M) continue;
    light = -p.key;
    if (st.lightTouch[m.id] === light) break;
    const toward = p.shape.d >= pos.d ? 1 : -1;
    m.speed *= LIGHT_SCRUB;
    m.yaw = clamp(m.yaw - toward * pos.dir * LIGHT_KICK, -1.2, 1.2);
    const object = hazardObject(p.feature);
    emit(world, 'wobble', m.id, { cause: 'smash', object, feature: p.feature.id, speed: m.speed });
    break;
  }
  if (light !== 0 || (st.lightTouch[m.id] ?? 0) < 0) st.lightTouch[m.id] = light;
  const near = all.filter((p) => !isLightHazard(p.feature));
  const move = moveOf(m, before);
  const hit = near.length > 0 ? firstTouch(near, move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw) : null;
  if (!hit) {
    st.hazardTouch[m.id] = 0;
    return false;
  }
  const hazard = hit.piece.feature;
  const newContact = st.hazardTouch[m.id] !== 1;
  st.hazardTouch[m.id] = 1;
  // Square on (the normal more along the road than across it) in a wheelie (playtest 3; the critic's S2:
  // a parked pickup is a car too): the wheelie may launch the rider off it instead (sim/riders/wheelie.ts).
  const axis = contactAxis(moveOf(m, before), hit);
  if (!hit.held && axis.endOn) {
    const closing = closingMps(m.speed, pos.dir, m.yaw, axis.ns, axis.nd);
    if (hazardLaunch(world, config, st, m, hazard, closing)) return true;
  }
  meetSolid(world, st, m, move, hit, {
    extra: { object: hazardObject(hazard), feature: hazard.id },
    newContact,
  });
  return false;
}

/**
 * The street furniture a riding rider meets (playtest 4, the maintainer: street furniture is "solid but
 * maybe forgiving to sides, brushes, etc"; road/furniture.ts plans it, render draws the same plan). A
 * `solid` piece (a hydrant, a lamp or signal post, a tree's trunk, a bench, a planter, a parked car) is met
 * by `meetSolid`, by the closing speed along the contact's normal. A `light` one (a meter, a bin, a board,
 * a scooter) is ridden through as a smashable is (sim/smash): a little speed and a heading kick away
 * from it, and a `wobble` whose `cause` is `smash`, once per piece, never a crash. Events carry
 * `object` (the piece's kind) and `furniture` (its id in the plan). Off when `riders.furniture` is.
 */
function furnitureContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
): void {
  if (!furnitureOn(world.params)) return;
  const pos = m.pos;
  const near = piecesNear(config, pos.edge, pos.s, CONTACT_REACH_M);
  if (near.length === 0) {
    st.furnTouch[m.id] = 0;
    // (A light hazard's key is negative, and hazardContact keeps it.)
    if ((st.lightTouch[m.id] ?? 0) > 0) st.lightTouch[m.id] = 0;
    return;
  }
  // Light pieces first: ridden through where the bike ends the tick on one.
  let light = 0;
  for (const it of near) {
    if (it.cls !== 'light' || m.h > it.heightM) continue;
    if (spineGap(it.shape, spineAt(pos.s, pos.d, pos.dir, m.yaw)).dist >= BIKE_RADIUS_M) continue;
    light = it.id + 1;
    if (st.lightTouch[m.id] === light) break;
    const toward = it.shape.d >= pos.d ? 1 : -1;
    m.speed *= LIGHT_SCRUB;
    m.yaw = clamp(m.yaw - toward * pos.dir * LIGHT_KICK, -1.2, 1.2);
    emit(world, 'wobble', m.id, {
      cause: 'smash',
      object: it.kind,
      furniture: String(it.id),
      speed: m.speed,
    });
    break;
  }
  if (light !== 0 || (st.lightTouch[m.id] ?? 0) > 0) st.lightTouch[m.id] = light;
  // A rider standing on a piece (supports: the waterfront's parked cars) is not riding into it.
  const own = supportKeyOf(world, m.id);
  const solid = near.filter((it) => it.cls === 'solid' && m.h <= it.heightM && own !== `f:${it.id}`);
  const move = moveOf(m, before);
  const hit = solid.length > 0 ? firstTouch(solid, move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw) : null;
  if (!hit) {
    st.furnTouch[m.id] = 0;
    return;
  }
  const newContact = st.furnTouch[m.id] !== hit.piece.id + 1;
  st.furnTouch[m.id] = hit.piece.id + 1;
  meetSolid(world, st, m, move, hit, {
    extra: { object: hit.piece.kind, furniture: String(hit.piece.id) },
    newContact,
  });
}

/** A dropped bike as the contact sees it: its footprint, and whose bike it is. */
interface DroppedBike {
  shape: FurnitureShape;
  owner: number;
}

/**
 * The bikes standing on `edge` near s while their riders run back to them (sim/tumble parks each at its
 * crash's hand-back and clears it at the remount), other than rider `self`'s own: each a footprint
 * along the road, the rider box the bike models are fitted to. Read from tumble's state, never imported
 * (tumble imports this module); none without the tumble system.
 */
function droppedBikesNear(world: World, edge: number, s: number, self: number): DroppedBike[] {
  const records = (world.systems['tumble'] as Pick<TumbleState, 'records'> | undefined)?.records;
  if (!records) return [];
  const out: DroppedBike[] = [];
  const reach = CONTACT_REACH_M + PARKED_BIKE_HALF_LENGTH_M;
  for (let id = 0; id < records.length; id++) {
    const bike = records[id]?.parked;
    if (id === self || !bike || bike.edge !== edge || Math.abs(bike.s - s) > reach) continue;
    const shape = boxShape(
      bike.s - PARKED_BIKE_HALF_LENGTH_M,
      bike.s + PARKED_BIKE_HALF_LENGTH_M,
      bike.d - PARKED_BIKE_HALF_WIDTH_M,
      bike.d + PARKED_BIKE_HALF_WIDTH_M,
    );
    out.push({ shape, owner: id });
  }
  return out;
}

/** Limits that hold nothing (a rider up on a structure's top, or out past the edge in the air). */
const UNHELD = { lo: -Infinity, hi: Infinity } as const;

/**
 * The structures whose walls reach a rider (feet at world height `feet`) within a contact's reach, each as a
 * footprint in his road frame, the one he stands on (`own`, a support key) aside.
 */
function structureWalls(
  config: SimConfig,
  plan: StructurePlan,
  m: Mover,
  feet: number,
  own: string,
): StructurePiece[] {
  const road = config.road;
  const pos = m.pos;
  const p = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const out: StructurePiece[] = [];
  for (const s of structuresNear(plan, p.x, p.z, CONTACT_REACH_M)) {
    if (own === `s:${s.id}` || !wallTo(s, p.x, p.z, feet)) continue;
    out.push({ st: s, shape: localShape(road, pos.edge, pos.s, pos.d, s) });
  }
  return out;
}

/** Whether a rider is a ghost to traffic now (sim/traffic `trafficGhost`, read without importing it). */
function respawnGhost(world: World, id: number): boolean {
  const traffic = world.systems['traffic'] as Pick<TrafficState, 'ghostCapT'> | undefined;
  return (traffic?.ghostCapT[id] ?? 0) > 0;
}

/**
 * A riding rider meeting a bike left on the road after a crash (pile-ups; the maintainer, 2026-10-06:
 * "Pile ups are fun lol"). The bike is solid under the one rule for heavy things (docs/content-packs.md,
 * "Contact outcomes"): its footprint met by `meetSolid`, the closing speed along the contact's normal
 * deciding, so a square-on hit at `traffic.solidHitMps` or more brings the rider down (a pile-up) and a
 * crawl, a graze or a side brush wobbles him past it. A rider higher than its top (`h`, above the road)
 * passes over it. Two fair-restart rules: while a rider's respawn ghost lasts (sim/traffic, started at a
 * remount or a splash respawn) he passes through dropped bikes as through traffic, so a bike beside the
 * one he got back on never brings him straight down again; and a bike put down where a rider already is
 * (a hand-back beside him) only ever wobbles him. Events carry `object` `parked-bike` and `bikeOf`, the
 * owner's id; no `target`, so the rider on foot is never blamed for it. Off with `riders.pileUps` (then
 * sim/tumble rides it through as before). Returns true when it crashed the rider.
 */
function droppedBikeContact(
  world: World,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
  h: number,
): boolean {
  if (!pileUpsOn(world.params)) return false;
  const pos = m.pos;
  const near =
    h <= PARKED_BIKE_TOP_M && !respawnGhost(world, m.id)
      ? droppedBikesNear(world, pos.edge, pos.s, m.id)
      : [];
  const move = moveOf(m, before);
  const hit = near.length > 0 ? firstTouch(near, move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw) : null;
  if (!hit) {
    if (st.bikeTouch) st.bikeTouch[m.id] = 0;
    return false;
  }
  const touch = (st.bikeTouch ??= []);
  const owner = hit.piece.owner;
  const newContact = touch[m.id] !== owner + 1;
  touch[m.id] = owner + 1;
  const from = world.events.length;
  meetSolid(world, st, m, move, hit, {
    extra: { object: 'parked-bike', bikeOf: String(owner) },
    newContact,
    noCrash: hit.held,
  });
  for (let i = from; i < world.events.length; i++) {
    const e = world.events[i];
    if (e && e.type === 'crash' && e.actor === m.id) return true;
  }
  return false;
}

/** A structure's events' fields: what it is (its class) and its id in the plan. */
const structureExtra = (s: Structure): Record<string, string> => ({ object: s.cls, structure: String(s.id) });

/**
 * Runs a structure contact in the rider's own frame measured in metres: along the road, s is scaled to the
 * metres it covers where he rides (`sRateFactor`: off the middle of a bend a metre of s is more or less than a
 * metre), so the structure's footprint (`localShape`, laid out in metres) and the bike's capsule and move meet
 * as they do in the world. His s is put back in the road's units after. `move` is the tick's move in that frame.
 */
function inMetres<T>(
  config: SimConfig,
  m: Mover,
  before: { edge: number; s: number; d: number },
  run: (move: { s0: number; d0: number; s1: number; d1: number }) => T,
): T {
  const pos = m.pos;
  const at = pos.s;
  const k = sRateFactor(config.road.kappaAt(pos.edge, at), pos.d);
  const raw = moveOf(m, before);
  const move = { s0: at + (raw.s0 - at) / k, d0: raw.d0, s1: at, d1: raw.d1 };
  try {
    return run(move);
  } finally {
    pos.s = at + (pos.s - at) * k;
  }
}

/**
 * A riding rider meeting a structure's wall (the maintainer, 2026-10-06: buildings are walls up to the roofline;
 * sim/riders/structures.ts): below its top and above its underside, met by `meetSolid`, the one rule for heavy
 * fixed things (the closing speed along the contact's normal: square on at speed a crash, a glance a wobble and
 * a slide along it). On a top, its own structure is ground, not a wall, and a neighbour is a wall only where it
 * stands more than a kerb above him. Events carry `object` (the structure's class) and `structure` (its id).
 */
function structureContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
): void {
  const plan = racePlanOf(world, config);
  if (!plan) return;
  const pos = m.pos;
  const feet = config.road.surfaceHeight(pos.edge, pos.s, pos.d) + m.h;
  const walls = structureWalls(config, plan, m, feet, supportKeyOf(world, m.id));
  if (walls.length === 0) {
    noteTouch(world, m.id, 0);
    return;
  }
  inMetres(config, m, before, (move) => {
    const hit = firstTouch(walls, move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw);
    if (!hit) {
      noteTouch(world, m.id, 0);
      return;
    }
    const id = hit.piece.st.id;
    const newContact = touchedOf(world, m.id) !== id + 1;
    noteTouch(world, m.id, id + 1);
    meetSolid(world, st, m, move, hit, { extra: structureExtra(hit.piece.st), newContact });
  });
}

/**
 * A rider in the air meeting a structure (sim/riders/structures.ts), the ground's rule: a wall below its top is
 * met by `meetSolid`; a top too small to hold the bike (a post, a rail, a café table) that the rider comes down
 * onto from above (`yBefore`, his feet's world height as the tick began, at or over it) is met by the fall
 * speed (`hit: 'top'`) and he is pushed off it. A top that holds the bike is a support (`structureSupportAt`),
 * landed on before this is asked. Returns true when he crashed (the flight ends there).
 */
function airStructures(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
  y: number,
  yBefore: number,
): boolean {
  const plan = racePlanOf(world, config);
  if (!plan) return false;
  const road = config.road;
  const pos = m.pos;
  const p = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const box = riderHitbox(config, m.riderIndex);
  const spine = spineAt(pos.s, pos.d, pos.dir, m.yaw);
  const eventsBefore = world.events.length;
  const crashed = () => {
    for (let i = eventsBefore; i < world.events.length; i++) {
      const e = world.events[i];
      if (e && e.type === 'crash' && e.actor === m.id) return true;
    }
    return false;
  };
  // From above, onto a top too small to hold the bike: the fall speed closes.
  for (const s of structuresNear(plan, p.x, p.z, CONTACT_REACH_M)) {
    if (holdsBike(2 * s.foot.hu, 2 * s.foot.hv, box)) continue;
    const top = topNear(s, p.x, p.z);
    if (yBefore < top - 1e-6 || y >= top) continue;
    const shape = localShape(road, pos.edge, pos.s, pos.d, s);
    if (spineGap(shape, spine).dist >= BIKE_RADIUS_M) continue;
    const newContact = touchedOf(world, m.id) !== s.id + 1;
    noteTouch(world, m.id, s.id + 1);
    wallOutcome(world, st, m, {
      impact: Math.max(0, -(st.vy[m.id] ?? 0)),
      v: m.speed,
      yawBefore: m.yaw,
      side: 1,
      newContact,
      extra: { ...structureExtra(s), hit: 'top' },
      vehicle: true,
    });
    keepOff(shape, pos, m.yaw, 0, pos.d >= shape.d ? 1 : -1);
    return crashed();
  }
  const walls = structureWalls(config, plan, m, y, '');
  if (walls.length === 0) {
    noteTouch(world, m.id, 0);
    return false;
  }
  return inMetres(config, m, before, (move) => {
    const hit = firstTouch(walls, move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw);
    if (!hit) {
      noteTouch(world, m.id, 0);
      return false;
    }
    const id = hit.piece.st.id;
    const newContact = touchedOf(world, m.id) !== id + 1;
    noteTouch(world, m.id, id + 1);
    meetSolid(world, st, m, move, hit, { extra: structureExtra(hit.piece.st), newContact });
    return crashed();
  });
}

/**
 * A structure top's rise per metre along the bike's heading where it is (sim/riders/structures.ts
 * `topGrade`): 0 on a flat roof, the slope on a pitched one.
 */
function structureGradeOf(world: World, config: SimConfig, m: Mover, on: Support): number {
  const plan = racePlanOf(world, config);
  const s = plan?.items[Number(on.key.slice(2))];
  if (!s) return 0;
  const road = config.road;
  const pos = m.pos;
  const f = road.frameAt(pos.edge, pos.s);
  const hx = pos.dir * (cos(m.yaw) * f.tx - sin(m.yaw) * f.tz);
  const hz = pos.dir * (cos(m.yaw) * f.tz + sin(m.yaw) * f.tx);
  const p = road.toWorld(pos.edge, pos.s, pos.d, 0);
  return topGrade(s, p.x, p.z, hx, hz);
}

/**
 * A rider in the air meeting a solid hazard or a solid street piece below its top (`h` above the road):
 * the ground's rule (`meetSolid`), the closing speed along the contact's normal deciding. Returns true
 * when it crashed (the flight ends there); a glance pushes the rider off it and the flight goes on.
 * Supports (`hBefore`, the flight's height as the tick began; absent with `riders.supports` off): a top
 * too small to hold the bike (a hydrant, a post, a stump) that the rider comes down onto from above is
 * met by the same rule with the closing speed straight down, the fall speed (`topContact`).
 */
function airSolids(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
  h: number,
  hBefore?: number,
): boolean {
  const pos = m.pos;
  const move = moveOf(m, before);
  const fromAbove = (top: number) => hBefore !== undefined && hBefore >= top - 1e-6;
  const eventsBefore = world.events.length;
  if (hBefore !== undefined && topContact(world, config, st, m, h, fromAbove)) {
    for (let i = eventsBefore; i < world.events.length; i++) {
      const e = world.events[i];
      if (e && e.type === 'crash' && e.actor === m.id) return true;
    }
    return false;
  }
  const hazards = solidHazardsNear(config, pos.edge, pos.s, CONTACT_REACH_M, world).filter(
    (p) => h < hazardTop(p.feature) && !isLightHazard(p.feature) && !fromAbove(hazardTop(p.feature)),
  );
  const pieces = furnitureOn(world.params)
    ? piecesNear(config, pos.edge, pos.s, CONTACT_REACH_M).filter(
        (it) => it.cls === 'solid' && h < it.heightM && !fromAbove(it.heightM),
      )
    : [];
  const hh =
    hazards.length > 0 ? firstTouch(hazards, move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw) : null;
  const hp =
    pieces.length > 0 ? firstTouch(pieces, move.s0, move.d0, move.s1, move.d1, pos.dir, m.yaw) : null;
  if (!hh && !hp) return false;
  const crashesBefore = world.events.length;
  if (hp && (!hh || hp.t <= hh.t)) {
    const newContact = st.furnTouch[m.id] !== hp.piece.id + 1;
    st.furnTouch[m.id] = hp.piece.id + 1;
    meetSolid(world, st, m, move, hp, {
      extra: { object: hp.piece.kind, furniture: String(hp.piece.id) },
      newContact,
    });
  } else if (hh) {
    const newContact = st.hazardTouch[m.id] !== 1;
    st.hazardTouch[m.id] = 1;
    meetSolid(world, st, m, move, hh, {
      extra: { object: hazardObject(hh.piece.feature), feature: hh.piece.feature.id },
      newContact,
    });
  }
  for (let i = crashesBefore; i < world.events.length; i++) {
    const e = world.events[i];
    if (e && e.type === 'crash' && e.actor === m.id) return true;
  }
  return false;
}

/**
 * Supports (the maintainer, 2026-10-06): a rider in the air coming down onto a solid top too small to
 * hold the bike (`fromAbove` its top as the tick began, under it now, the bike's capsule on it): an
 * obstacle met from above by the one rule for heavy things, the closing speed straight down (how fast
 * it falls) against `traffic.solidHitMps`, `hit: 'top'`. A crash ends the flight there; under the line
 * it wobbles and is pushed off it across the road, and the flight goes on. Returns true on a contact.
 */
function topContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  h: number,
  fromAbove: (top: number) => boolean,
): boolean {
  const pos = m.pos;
  const spine = spineAt(pos.s, pos.d, pos.dir, m.yaw);
  const touching = (shape: FurnitureShape) => spineGap(shape, spine).dist < BIKE_RADIUS_M;
  const fall = Math.max(0, -(st.vy[m.id] ?? 0));
  const meet = (shape: FurnitureShape, extra: Record<string, string>, newContact: boolean) => {
    wallOutcome(world, st, m, {
      impact: fall,
      v: m.speed,
      yawBefore: m.yaw,
      side: 1,
      newContact,
      extra: { ...extra, hit: 'top' },
      vehicle: true,
    });
    keepOff(shape, pos, m.yaw, 0, pos.d >= shape.d ? 1 : -1);
  };
  if (furnitureOn(world.params)) {
    for (const it of piecesNear(config, pos.edge, pos.s, CONTACT_REACH_M)) {
      if (it.cls !== 'solid' || h >= it.heightM || !fromAbove(it.heightM) || !touching(it.shape)) continue;
      const newContact = st.furnTouch[m.id] !== it.id + 1;
      st.furnTouch[m.id] = it.id + 1;
      meet(it.shape, { object: it.kind, furniture: String(it.id) }, newContact);
      return true;
    }
  }
  for (const p of solidHazardsNear(config, pos.edge, pos.s, CONTACT_REACH_M, world)) {
    const top = hazardTop(p.feature);
    if (isLightHazard(p.feature) || h >= top || !fromAbove(top) || !touching(p.shape)) continue;
    const newContact = st.hazardTouch[m.id] !== 1;
    st.hazardTouch[m.id] = 1;
    meet(p.shape, { object: hazardObject(p.feature), feature: p.feature.id }, newContact);
    return true;
  }
  return false;
}

/** A grounded rider riding onto a boost pad gets its boost, once per crossing, and one `boost` event. */
function touchPads(world: World, config: SimConfig, st: RiderState, m: Mover): void {
  const pad = boostPadAt(config, m.pos.edge, m.pos.s, m.pos.d);
  if (!pad) {
    st.onPad[m.id] = 0;
    return;
  }
  if (st.onPad[m.id] === 1) return;
  st.onPad[m.id] = 1;
  const { mps, holdS } = boostOf(pad);
  st.boost[m.id] = holdS * 60;
  st.boostMps[m.id] = mps;
  emit(world, 'boost', m.id, { feature: pad.id, speed: m.speed, holdS });
}

/**
 * Supports (sim/riders/supports.ts): puts a rider coming down on a support into its frame. Its speed
 * and heading become its motion over the top; returns true when that motion is backward (the support
 * outruns the bike: it rolls backward over it, heading on the way it faces).
 */
function toSupportFrame(config: SimConfig, m: Mover, on: Support): boolean {
  const v = inRiderFrame(config, m, on.vx, on.vz);
  const along = m.speed * cos(m.yaw) - v.along;
  const across = m.speed * sin(m.yaw) - v.across;
  const back = along < 0;
  m.speed = Math.sqrt(along * along + across * across);
  m.yaw = m.speed > 1e-9 ? (back ? atan2(-across, -along) : atan2(across, along)) : 0;
  return back;
}

/**
 * Takes a supported rider off its support into the world's frame: its speed and heading become its
 * motion through the world (the support's velocity added), its travel turned round when that motion
 * runs back along the road. Nothing to do for a rider on no support.
 */
function toWorldFrame(world: World, config: SimConfig, m: Mover): void {
  const mo = supportMotion(world, m.id);
  if (!mo) return;
  let along = mo.vr * cos(m.yaw) + mo.va;
  let across = mo.vr * sin(m.yaw) + mo.vc;
  if (along < 0) {
    m.pos.dir = m.pos.dir === 1 ? -1 : 1;
    along = -along;
    across = -across;
  }
  m.speed = Math.sqrt(along * along + across * across);
  m.yaw = m.speed > 1e-9 ? clamp(atan2(across, along), -1.2, 1.2) : 0;
  // Off a vehicle's top it is solid to him again at once (the maintainer's rule, 2026-10-06: nothing is a
  // ghost): its box still under his as he drops past its edge is traffic's to resolve, by its one rule at
  // a top's edge (sim/traffic `contacts`: clear of it the short way, or met by the closing speed).
  leaveSupport(world, m.id);
}

/**
 * The support a grounded rider stands on as this tick starts, or null. Put down by another system
 * (`fresh`: a remount, a respawn) it stands on none; a support that has gone (a vehicle recycled, the
 * switch turned off) hands the rider back to the world's frame.
 */
function groundSupport(
  world: World,
  config: SimConfig,
  m: Mover,
  decks: MovingDecks,
  fresh: boolean,
): Support | null {
  const key = supportKeyOf(world, m.id);
  if (key === '') return null;
  if (fresh) {
    leaveSupport(world, m.id);
    return null;
  }
  const at = { edge: m.pos.edge, s: m.pos.s, d: m.pos.d, ahead: 0 };
  // On a structure's top (sim/riders/structures.ts), the top under the bike now: the one it rode onto, or a
  // neighbour it rode across to (a row of roofs), never one more than a kerb above it.
  const on = !supportsOn(world)
    ? null
    : key.startsWith('s:')
      ? structureSupportAt(world, config, m, at, (t) => t <= m.h + KERB_M)
      : supportAt(world, config, m, at, decks, () => true, key);
  if (!on) toWorldFrame(world, config, m);
  return on;
}

/**
 * A grounded rider above whatever is under it (pushed off a top, or its top gone): it falls, a take-off
 * from where it is, as riding off an edge is.
 */
function fallFrom(world: World, config: SimConfig, st: RiderState, m: Mover, input: SimInput): void {
  const pos = m.pos;
  m.mode = 'Airborne';
  st.yAbs[m.id] = config.road.surfaceHeight(pos.edge, pos.s, pos.d) + m.h;
  st.vy[m.id] = 0;
  st.airTicks[m.id] = 0;
  startFlight(st, m, input, slopeAt(config, m));
  wheelieTakeoff(world, st, m);
  driftTakeoff(world, st, m);
  emit(world, 'jump', m.id, { speed: m.speed, vyMps: 0, drop: true });
}

/**
 * The support's velocity changed under the rider by `jolt` m/s in one tick (a truck braking, traffic's
 * no-overlap snap, a lane's end): the one rule's line (`traffic.solidHitMps`) throws him off, a crash;
 * from JOLT_WOBBLE_MPS it wobbles. Returns true when it threw him.
 */
function joltOutcome(world: World, st: RiderState, m: Mover, on: Support, jolt: number): boolean {
  const crash = trafficContactCrashes(world.params, jolt);
  const data = {
    cause: on.vehicle >= 0 ? 'traffic' : 'barrier',
    hit: 'jolt',
    contact: crash ? 'crash' : 'wobble',
    impactMps: jolt,
    speed: m.speed,
    object: on.object,
    ...(on.kind === 'vehicle' ? { vehicle: on.object } : {}),
  };
  const target = on.vehicle >= 0 ? { target: on.vehicle } : {};
  if (crash) {
    st.wobble[m.id] = 0;
    emit(world, 'crash', m.id, data, target);
    return true;
  }
  st.wobble[m.id] = WOBBLE_TICKS;
  emit(world, 'wobble', m.id, data, target);
  return false;
}

function stepGrounded(world: World, config: SimConfig, st: RiderState, m: Mover): void {
  const def = config.riders[m.riderIndex];
  const input = world.inputs[m.id];
  if (!def || !input) return;
  const dt = world.timeScale / 60;
  const steerScale = world.params['riders.steerScale'] ?? 1;
  const accelScale = world.params['riders.accelScale'] ?? 1;
  const road = config.road;
  const bike = def.bike;
  const m2 = accelMultiplierOf(config);
  const gravity = GRAVITY * m2;
  const throttle = throttleOf(config, def, input);
  const brake = clamp(input.brake / 255, 0, 1);
  const steer = clamp(input.steer / 127, -1, 1);
  const pos = m.pos;
  const frameKappa = road.kappaAt(pos.edge, pos.s);
  const grade = road.frameAt(pos.edge, pos.s).grade * pos.dir;
  const wobble = st.wobble[m.id] ?? 0;
  if (wobble > 0) st.wobble[m.id] = Math.max(0, wobble - world.timeScale);
  // Vertical: where the bike is now (a ramp truck's deck included), and how fast it was rising if it
  // was riding last tick too.
  const fresh = st.lastTick[m.id] !== world.tick - 1;
  // Put down inside a ramp truck (a remount where the bike came to rest, by tumble's hand-back):
  // step out beside it on the road's side, so the rider is never stood on or in the truck.
  // Playtest 3's moving decks: the trucks as this tick starts (`now`) for where the bike is, and one
  // step on (`next`) for where it goes, so the deck under it moves too.
  const decks = movingDecks(world, dt);
  const inside = fresh && m.h === 0 ? rampTruckAt(config, pos.edge, pos.s, pos.d, decks.now) : null;
  if (inside && deckHeight(config, pos.edge, pos.s, pos.d, { moving: decks.now }) > 0) {
    const out = Math.sign(inside.d1 - inside.d0) * TRUCK_STEP_OUT_M;
    pos.d = Math.abs(inside.d0) <= Math.abs(inside.d1) ? inside.d0 - out : inside.d1 + out;
  }
  // Supports (the maintainer, 2026-10-06; sim/riders/supports.ts): the top the rider stands on, its
  // ground as a deck is. Null for a rider on the road or a ramp truck's deck.
  const sup = groundSupport(world, config, m, decks, fresh);
  const ramps = deckHeight(config, pos.edge, pos.s, pos.d, { moving: decks.now });
  const deckBefore = sup ? Math.max(ramps, sup.top) : ramps;
  // Above whatever is under it now (pushed off a top, or its top gone): it falls from where it is.
  if (!fresh && m.h > deckBefore + KERB_M && supportsOn(world)) {
    st.lastTick[m.id] = world.tick;
    fallFrom(world, config, st, m, input);
    st.throttle[m.id] = throttle;
    st.brake[m.id] = brake;
    gearAndRpm(st, m);
    return;
  }
  const before = { edge: pos.edge, s: pos.s, d: pos.d, deck: deckBefore };
  const yBefore = road.surfaceHeight(pos.edge, pos.s, pos.d) + deckBefore;
  const vyBefore = fresh ? 0 : (st.vy[m.id] ?? 0);
  st.lastTick[m.id] = world.tick;
  // On a structure's top (sim/riders/structures.ts) the grade is the roof's along the bike's heading (0 on
  // a flat roof, the pitch on a pitched one), not the road's below it; and the band's edge does not hold it.
  const onStructure = sup !== null && sup.kind === 'structure';
  const slopeGrade = sup && onStructure ? structureGradeOf(world, config, m, sup) : grade;
  // On a support the bike moves over it (its signed speed over it, `vr`), carried at its velocity
  // (`carry`, along and across the rider's travel). When that velocity changed since last tick (a truck
  // braking, traffic's no-overlap snap), the bike rolls on at its own: what the support lost along the
  // bike's heading adds to its speed over it, and a big enough change in one tick wobbles or throws it.
  let vr = 0;
  let carry = { along: 0, across: 0 };
  if (sup) {
    const mo = supportMotion(world, m.id);
    carry = inRiderFrame(config, m, sup.vx, sup.vz);
    // What the support's own speed (along its own heading) lost since last tick: a road that turns
    // under both of them at a junction turns its heading, and is no jolt.
    const lost = (mo?.sv ?? sup.speed) - sup.speed;
    // The bike's heading in the world, and how much of that loss lies along it.
    const f = road.frameAt(pos.edge, pos.s);
    const bx = pos.dir * (cos(m.yaw) * f.tx - sin(m.yaw) * f.tz);
    const bz = pos.dir * (cos(m.yaw) * f.tz + sin(m.yaw) * f.tx);
    vr = (mo?.vr ?? m.speed) + lost * (sup.hx * bx + sup.hz * bz);
    m.speed = Math.abs(vr);
    const jolt = Math.abs(lost);
    if (jolt >= JOLT_WOBBLE_MPS && joltOutcome(world, st, m, sup, jolt)) {
      // Thrown off it: the tumble takes the rider from here, at its speed through the world.
      standOn(world, m.id, sup, vr, carry);
      st.throttle[m.id] = throttle;
      st.brake[m.id] = brake;
      gearAndRpm(st, m);
      return;
    }
  }
  // Rolling backward over a support, no wheelie, drift or U-turn starts.
  const back = sup !== null && vr < 0;
  // A U-turn (interview, 2026-10-02; playtest 4's own gesture, P4-9): a slow player who double-taps
  // the brake and then holds it with full lock pivots round (sim/riders/uturn.ts); null while riding
  // normally. On a stable top the same gesture lets a stopped rider turn and ride back off it.
  const uturn = back
    ? uturnStep(world, st, def, m, 0, 0, fresh, dt)
    : uturnStep(world, st, def, m, steer, brake, fresh, dt);
  // Playtest 3's moves: the wheelie (steering × steerScale, the front's pitch) and the drift
  // (steering × maxYawScale, a drag, the knee-down lean). Neutral while each is off.
  const wh = wheelieStep(
    world,
    config,
    st,
    m,
    back ? { ...input, flags: input.flags & ~InputFlag.wheelie } : input,
    brake,
    dt,
  );
  const dr = back
    ? driftStep(world, config, st, m, input, 0, throttle, 0, dt)
    : driftStep(world, config, st, m, input, steer, throttle, brake, dt);

  // Longitudinal: full throttle on the flat converges to top speed. A boost pad's boost raises the
  // top speed for a while and pushes the bike toward it. The launch punch (playtest 1c) multiplies
  // the engine's push at a standstill, fading linearly to 1× at LAUNCH_FADE_SHARE of the bike's own
  // top speed, so top speed, the drag (engine braking when you let go) and cruising are as before.
  // For a player it multiplies the throttle's push at any throttle, so it scales smoothly with the
  // thumb; an AI rider gets it only as its throttle opens past AI_LAUNCH_THROTTLE, so the AI's speed
  // holds are unchanged; at full throttle the two are identical. It is the racers' (the player's and
  // the rivals'); the cop gets `cops.launchShare` of it, 0 by default, so he rides as before
  // (playtest 1 item 7 keeps cop difficulty). His follow keeps a stopping distance (sim/cops), so
  // with the slider up a player who brakes hard no longer has him sail past.
  const v = m.speed;
  const boostLeft = st.boost[m.id] ?? 0;
  const boostTop = boostLeft > 0 ? (st.boostMps[m.id] ?? 0) * speedMultiplierOf(config) : 0;
  // The ground under the wheels (off-road, run W-R): its speed scales the top speed and the push,
  // its grip the steering; 1 and 1 on the road, and with the off-road switch off. On a support, its
  // top: a little less grip than asphalt.
  const feel = sup ? { speed: 1, grip: SUPPORT_GRIP } : groundFeel(config, world.params, m);
  const ownTop = topSpeedOf(world, config, bike.topSpeedMps) * feel.speed * smokeScaleOf(world, st, m, def);
  const top = ownTop + boostTop;
  const a = bike.accelMps2 * accelScale * m2 * feel.speed;
  const fade = clamp(1 - v / (ownTop * LAUNCH_FADE_SHARE), 0, 1);
  const open =
    def.controller.kind === 'player'
      ? 1
      : clamp((throttle - AI_LAUNCH_THROTTLE) / (1 - AI_LAUNCH_THROTTLE), 0, 1);
  const share = def.faction === 'law' ? (world.params['cops.launchShare'] ?? 0) : 1;
  const launch = 1 + ((world.params['riders.launchGain'] ?? 1) - 1) * fade * open * share;
  if (sup) {
    // On a support (sim/riders/supports.ts): the engine, the brake, the coasting drag and the drags of a
    // wobble or a drift act on the bike's speed over the top; the air drag (the model's pull toward top
    // speed) acts on its speed through the air, the support's along its heading added, so on a moving
    // truck the wind rolls a rider who lets go slowly back. Friction stops the bike over the top and
    // never turns it round; the engine, the wind and the slope may.
    const air = vr + carry.along * cos(m.yaw) + carry.across * sin(m.yaw);
    let drive = throttle * a * launch - (a * air * Math.abs(air)) / (top * top) - gravity * slopeGrade;
    if (boostLeft > 0) {
      // A held brake holds the boost's push back on a top (the live check of 2026-10-07: a landing
      // surge's 12 m/s² beat the brake's 7.65 and ran a braking rider off a truck's front): the push
      // and the brake act on his speed over the top, and the brake wins, so braking on landing rides it.
      const push = BOOST_ACCEL_MPS2 * m2 * (1 - brake);
      if (air < top) drive = Math.max(drive, Math.min(drive + push, (top - air) / dt));
      st.boost[m.id] = Math.max(0, boostLeft - world.timeScale);
    }
    let friction = ((1 - throttle) * COAST_DECEL + brake * bike.brakeMps2 * SUPPORT_GRIP) * m2;
    if (wobble > 0) friction += WOBBLE_DRAG * m2;
    if (dr.dragMps2 !== 0) friction += dr.dragMps2 * m2;
    const free = vr + drive * dt;
    vr = free > 0 ? Math.max(0, free - friction * dt) : Math.min(0, free + friction * dt);
    if (uturn) vr = Math.min(vr, uturn.capMps);
    m.speed = Math.abs(vr);
  } else {
    let accel = throttle * a * launch - (a * v * v) / (top * top);
    accel -= ((1 - throttle) * COAST_DECEL + brake * bike.brakeMps2) * m2 + gravity * grade;
    if (boostLeft > 0) {
      // The push stops at the raised top speed; it never carries the bike past it.
      if (v < top) accel = Math.max(accel, Math.min(accel + BOOST_ACCEL_MPS2 * m2, (top - v) / dt));
      st.boost[m.id] = Math.max(0, boostLeft - world.timeScale);
    }
    if (onShoulder(config, m)) accel -= SHOULDER_DRAG * m2;
    if (wobble > 0) accel -= WOBBLE_DRAG * m2;
    if (dr.dragMps2 !== 0) accel -= dr.dragMps2 * m2;
    // Gassing round a U-turn never takes the bike past the turn's speed.
    if (uturn && dt > 0 && v + accel * dt > uturn.capMps) accel = Math.min(accel, (uturn.capMps - v) / dt);
    m.speed = Math.max(0, v + accel * dt);
  }

  // Lateral: steering asks for a heading offset; the road turning under the bike pulls it.
  const authority = (wobble > 0 ? WOBBLE_STEER : 1) * feel.grip;
  const maxYaw = maxYawAt(bike.steerRateMps, m.speed, steerScale) * dr.maxYawScale * wh.steerScale;
  const slot = slotAssists(config, slotOf(def));
  // The steering assist pushes back from the road's edges; on a top they are not the edges.
  const assist = sup ? 0 : assistYaw(config, m, slot.steer, maxYaw);
  const asked = steer * authority * maxYaw;
  // Without a nudge the heading asked for is untouched (no clamp, no +0), exactly as before M2.
  const yawTarget = assist === 0 ? asked : clamp(asked + assist, -maxYaw, maxYaw);
  // In a U-turn the bike turns at the turn's own rate, past the usual limit; a turn given up midway
  // comes back from wherever it got to (with no U-turn, |yaw| is never past 1.2 here). Arcade (the
  // default, and every AI rider) eases the heading to the one asked for, so letting go lines the
  // bike up with the road. Free (playtest 4, P4-8: "true assist off", with no hidden pull toward the
  // road [decided]) turns at the same first rate, so a full-lock turn holds the same bends, but
  // nothing turns it back: held lock keeps turning past Arcade's cap, and hands off the bike keeps
  // its heading in the world, going where it points.
  const ownTurn = uturn
    ? uturn.rate
    : slot.steerStyle === 'free'
      ? yawTarget * YAW_RESPONSE
      : (yawTarget - m.yaw) * YAW_RESPONSE;
  // On a support the bike moves at its signed speed over it, and the support carries it on.
  const moving = sup ? vr : m.speed;
  const along = moving * cos(m.yaw) * sRateFactor(frameKappa, pos.d);
  const yawLimit = uturn ? Infinity : Math.max(1.2, Math.abs(m.yaw));
  m.yaw = clamp(m.yaw + (ownTurn - pos.dir * frameKappa * along) * dt, -yawLimit, yawLimit);
  pos.s += pos.dir * along * dt;
  pos.d += pos.dir * moving * sin(m.yaw) * dt;
  if (sup) {
    pos.s += pos.dir * carry.along * sRateFactor(frameKappa, pos.d) * dt;
    pos.d += pos.dir * carry.across * dt;
  }
  if (uturn) {
    uturnSettle(st, m);
    if (sup) carry = inRiderFrame(config, m, sup.vx, sup.vz);
  }
  // Contacts meet a rider on a support at its top (the road's and a ramp deck's riders at 0, as ever).
  m.h = sup ? sup.top : 0;
  applyShove(config, st, m, dt);
  if (road.advance(pos) === 'deadEnd') m.speed = 0;
  const handed = crossToBranch(config, m);
  // Up on a structure's top its band's edge does not hold it: it rides to the top's edge, and off it.
  if (!onStructure) barrierContact(world, config, st, m, dt);
  truckContact(world, config, st, m, before, dt, decks);
  furnitureContact(world, config, st, m, before);
  droppedBikeContact(world, st, m, before, m.h);
  if (hazardContact(world, config, st, m, before)) {
    // Launched off a parked car by a wheelie (playtest 3): its flight is already set up.
    st.throttle[m.id] = throttle;
    st.brake[m.id] = brake;
    gearAndRpm(st, m);
    return;
  }
  structureContact(world, config, st, m, before);
  // On a support: its speed over it after the contacts (a scrape, a brush with a lamp beside it), and
  // the support's velocity as read this tick (the next tick's jolt is measured from it).
  if (sup) {
    vr = vr < 0 ? -m.speed : m.speed;
    standOn(world, m.id, sup, vr, carry);
  }

  // Take-off: the surface fell away faster than gravity can follow (the ballistic height clears it).
  // The ground is the road, or a ramp truck's ramp or lip platform (never its body, which a grounded
  // rider is kept out of above): h is always the height above the road.
  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  const ramp = deckHeight(config, pos.edge, pos.s, pos.d, { bodies: false, moving: decks.next });
  // Still over its support as the tick ends (a moving one where its velocity takes it)? Off its edge,
  // the ground under the bike fell away: a take-off by the same lip rule as a ramp's.
  // A structure's top (sim/riders/structures.ts): the top under the bike where it is now, its own (a pitched
  // roof's slope rises and falls under it) or a neighbour's no more than a kerb above or below it (a row of
  // roofs is ridden along; a lower one is a drop off the edge, a higher one a wall).
  const here = { edge: pos.edge, s: pos.s, d: pos.d, ahead: dt };
  const still = !sup
    ? null
    : onStructure
      ? structureSupportAt(
          world,
          config,
          m,
          here,
          (t, key) => key === sup.key || (t <= sup.top + KERB_M && t >= sup.top - KERB_M),
        )
      : supportAt(world, config, m, here, decks, () => true, sup.key);
  const deck = still ? Math.max(ramp, still.top) : ramp;
  const ground = surface + deck;
  const ballistic = yBefore + vyBefore * dt - 0.5 * gravity * dt * dt;
  // Over a gap (playtest 3, sim/riders/gap.ts) there is no surface: the ground fell away.
  const overGap = !still && gapUnder(world, config, m);
  // Across from one structure's top to a neighbour's no more than a kerb up or down (a row of roofs, sim/
  // riders/structures.ts): the bike rolls on over the step, as over a kerb, with no launch off it.
  const stepped = onStructure && still !== null && sup !== null && still.key !== sup.key;
  const lip = overGap || (!stepped && ballistic > ground + TAKEOFF_CLEARANCE_M);
  // Off its support (or onto a ramp deck), the rider moves in the world's frame again.
  if (sup && (!still || lip)) toWorldFrame(world, config, m);
  // Across onto a neighbour's top: that one holds it now.
  else if (sup && still && still.key !== sup.key) standOn(world, m.id, still, vr, carry);
  // Over a crest, the pull needed to follow the road (speed along it² × its downward curvature)
  // can beat gravity well before one tick's ballistic gap reaches the lip threshold: then the bike
  // floats off the top. Only on the road itself (a truck deck has its own lip).
  const crestScale = world.params['riders.crestLaunch'] ?? 1;
  const overCrest =
    crestScale > 0 &&
    deck === 0 &&
    deckBefore === 0 &&
    !nearRamp(config, pos.edge, pos.s) &&
    along * along * -crestCurvature(config, pos.edge, pos.s) * crestScale > gravity * (1 + CREST_MARGIN);
  if (!overCrest) st.crestHold[m.id] = 0;
  const crest = !lip && overCrest && (st.crestHold[m.id] ?? 0) === 0;
  if (dt > 0 && !fresh && (lip || crest)) {
    // Off a crest the bike leaves the smooth hilltop the samples stand for: along its tangent (the
    // grade here) and from its height, which over a crest is above the straight chord between two
    // samples by ½·curvature·a·b (a, b: the distances to them). From the chord itself, on its own
    // slope, it would come straight back down on that chord: a hop, not air.
    const vy0 = crest ? road.frameAt(pos.edge, pos.s).grade * pos.dir * along : vyBefore;
    const y = crest ? ground + crestSag(config, pos.edge, pos.s) : Math.max(ballistic, ground);
    m.mode = 'Airborne';
    m.h = y - surface;
    st.yAbs[m.id] = y;
    // A lip's ballistic height is already this tick's end; a crest's start is the hilltop now.
    st.vy[m.id] = crest ? vy0 : vy0 - gravity * dt;
    st.airTicks[m.id] = 0;
    // The flight starts at the slope the bike rode off (last tick's ground pitch, a wheelie's
    // angle included); the wheelie and the drift end.
    startFlight(st, m, input, st.pitch[m.id] ?? slopeAt(config, m));
    wheelieTakeoff(world, st, m);
    driftTakeoff(world, st, m);
    const data = crest ? { speed: m.speed, vyMps: vy0, crest: 1 } : { speed: m.speed, vyMps: vy0 };
    emit(world, 'jump', m.id, overGap ? { ...data, gap: true } : data);
  } else {
    m.h = deck;
    st.yAbs[m.id] = ground;
    // A handover onto a sibling branch (crossToBranch) moves the rider between two drawn surfaces,
    // which can stand apart where real branches climb and fall (playtest 3, T9.4: 0.6 m on Bridge
    // City). That step is no vertical speed, or the next tick launches the bike off flat road.
    if (dt > 0) st.vy[m.id] = handed || stepped ? vyBefore : (ground - yBefore) / dt;
    // A boost pad lies on the road below a support, not on its top.
    if (!(sup && still)) touchPads(world, config, st, m);
    // On a structure's top, the bike lies on its roof's slope (a pitched roof's pitch along its heading).
    groundPitch(
      st,
      m,
      still?.kind === 'structure' ? atan(structureGradeOf(world, config, m, still)) : slopeAt(config, m),
    );
    // A wheelie's front is up this far above the slope (playtest 3).
    if (wh.pitchAdd !== 0) st.pitch[m.id] = (st.pitch[m.id] ?? 0) + wh.pitchAdd;
  }

  // Lean from sideways acceleration (the heading's world turn rate is the rider's own turn rate),
  // or the drift's knee-down lean while it slides (playtest 3).
  settle(world, st, m, dr.leanTarget ?? atan((m.speed * ownTurn) / GRAVITY), dt);
  st.throttle[m.id] = throttle;
  st.brake[m.id] = brake;
  gearAndRpm(st, m);
}

/**
 * Whether s is on (or within CREST_SPAN_M of) an authored `ramp` feature: a ramp lip is a designed
 * kink that launches by the lip rule, so the crest rule leaves it alone (else it would launch a
 * second time off the ramp's back slope).
 */
function nearRamp(config: SimConfig, edge: number, s: number): boolean {
  for (const f of config.road.featuresOf(edge, 'ramp')) {
    if (s >= Math.min(f.s0, f.s1) - CREST_SPAN_M && s <= Math.max(f.s0, f.s1) + CREST_SPAN_M) return true;
  }
  return false;
}

/** How far a crest's smooth top stands above the sampled road's straight chord at s, m (0 off a crest). */
function crestSag(config: SimConfig, edge: number, s: number): number {
  const e = config.road.edges[edge];
  if (!e || e.spacing <= 0) return 0;
  const a = s - Math.floor(s / e.spacing) * e.spacing;
  return 0.5 * Math.max(0, -crestCurvature(config, edge, s)) * a * (e.spacing - a);
}

/** Smooths the lean toward its target and adds the wobble shake. */
function settle(world: World, st: RiderState, m: Mover, target: number, dt: number): void {
  const leanTarget = clamp(target, -MAX_LEAN, MAX_LEAN);
  const base = st.leanBase[m.id] ?? 0;
  const leanBase = base + (leanTarget - base) * Math.min(1, LEAN_RESPONSE * dt);
  st.leanBase[m.id] = leanBase;
  const shake = ((st.wobble[m.id] ?? 0) / WOBBLE_TICKS) * WOBBLE_LEAN * sin(world.tick * 0.9);
  st.lean[m.id] = clamp(leanBase + shake, -MAX_LEAN, MAX_LEAN);
}

function gearAndRpm(st: RiderState, m: Mover): void {
  let gear = 1;
  let low = 0;
  for (const topOfGear of GEAR_TOP_MPS) {
    if (m.speed <= topOfGear) break;
    low = topOfGear;
    gear++;
  }
  const high = GEAR_TOP_MPS[gear - 1] ?? 40;
  st.gear[m.id] = gear;
  st.rpm[m.id] = 1200 + 8800 * clamp((m.speed - low) / Math.min(high - low, 12), 0, 1);
}

/**
 * Airborne: s and d advance with the take-off velocity (air drag only), steering nudges the heading,
 * gravity acts on the absolute height, and h = yAbs - surface. It lands when h reaches 0.
 */
function stepAirborne(world: World, config: SimConfig, st: RiderState, m: Mover): void {
  const def = config.riders[m.riderIndex];
  const input = world.inputs[m.id];
  if (!def || !input) return;
  const dt = world.timeScale / 60;
  const road = config.road;
  const pos = m.pos;
  const bike = def.bike;
  st.lastTick[m.id] = world.tick;
  const wobble = st.wobble[m.id] ?? 0;
  if (wobble > 0) st.wobble[m.id] = Math.max(0, wobble - world.timeScale);
  const steer = clamp(input.steer / 127, -1, 1);
  const throttle = throttleOf(config, def, input);
  const m2 = accelMultiplierOf(config);
  const gravity = GRAVITY * m2;
  const boostLeft = st.boost[m.id] ?? 0;
  if (boostLeft > 0) st.boost[m.id] = Math.max(0, boostLeft - world.timeScale);

  const boostTop = boostLeft > 0 ? (st.boostMps[m.id] ?? 0) * speedMultiplierOf(config) : 0;
  const top = topSpeedOf(world, config, bike.topSpeedMps) * smokeScaleOf(world, st, m, def) + boostTop;
  const a = bike.accelMps2 * (world.params['riders.accelScale'] ?? 1) * m2;
  m.speed = Math.max(0, m.speed - ((a * m.speed * m.speed) / (top * top)) * dt);
  const kappa = road.kappaAt(pos.edge, pos.s);
  const ownTurn = steer * AIR_TURN_RATE;
  const along = m.speed * cos(m.yaw) * sRateFactor(kappa, pos.d);
  const airFrom = { edge: pos.edge, s: pos.s, d: pos.d };
  // Supports (sim/riders/supports.ts): how high above the road the flight was as the tick began, so a
  // top it comes down onto is met from above.
  const tops = supportsOn(world);
  const hBefore = (st.yAbs[m.id] ?? 0) - road.surfaceHeight(pos.edge, pos.s, pos.d);
  // Forgiving landings (playtest 2): the flight follows riders.airCarve of the road's bend, and the
  // heading settles back along the road at riders.airAlign, so the bike comes down lined up.
  const carve = world.params['riders.airCarve'] ?? 0;
  const align = world.params['riders.airAlign'] ?? 0;
  const roadTurn = (1 - carve) * pos.dir * kappa * along;
  m.yaw = clamp(m.yaw + (ownTurn - roadTurn - align * m.yaw) * dt, -1.2, 1.2);
  pos.s += pos.dir * along * dt;
  pos.d += pos.dir * m.speed * sin(m.yaw) * dt;
  const vy = st.vy[m.id] ?? 0;
  const y = (st.yAbs[m.id] ?? 0) + vy * dt - 0.5 * gravity * dt * dt;
  st.vy[m.id] = vy - gravity * dt;
  if (road.advance(pos) === 'deadEnd') m.speed = 0;
  crossToBranch(config, m);
  // Over the barrier (2026-10-06, sim/riders/gap.ts): higher than what stands at the edge, the rider
  // flies over it, and what lies past decides; below its top the barrier rule holds it as ever.
  const limits = (edge: number, s: number, d: number) => riderLimits(world, config, edge, s, d);
  // The course's honest edges (sim/riders/course.ts): ground past the edge is out of bounds, as water or a drop.
  const course = courseEdgesOn(world.params);
  const over = overBarrier(
    world,
    config,
    st,
    m,
    y,
    limits,
    BIKE_HALF_WIDTH_M,
    edgeTopOf(world, config),
    course,
  );
  if (over === 'barrier') barrierContact(world, config, st, m, dt);
  st.airTicks[m.id] = (st.airTicks[m.id] ?? 0) + world.timeScale;

  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  // A rider never lands on a ramp truck's body (the car on its top deck, the cab): fast enough off
  // the lip, it clears the truck; too slow, and below the body's top, it hits it (the integration
  // skeptic's F2: it used to land on a level deck inside that car).
  // Playtest 3: a moving deck is where its truck stands as the tick ends (`next`), and the speed to
  // clear its body is over the truck, not over the road.
  const decks = movingDecks(world, dt);
  // Supports (the maintainer, 2026-10-06: "land on it and ride on it"): coming down from above onto a
  // top that holds the bike (a vehicle's roof, a ramp truck's body, a parked pickup; sim/riders/
  // supports.ts), where it stands as the tick ends, the rider lands on it as on the road (land()).
  const hNow = y - surface;
  const here = { edge: pos.edge, s: pos.s, d: pos.d, ahead: dt };
  // A carrier's top deck is where a rider leaving its lip platform comes down: it left a hair under the
  // deck's level (its flat ground ended, and gravity took the first tick), and is on the deck's level
  // still (`TRUCK_DECK_TOLERANCE_M`).
  const fromAbove = tops
    ? supportAt(
        world,
        config,
        m,
        here,
        decks,
        (t, key) =>
          hBefore >=
            t - (key.startsWith('d:') ? TRUCK_DECK_TOLERANCE_M : key.startsWith('t:') ? KERB_M : 1e-6) &&
          hNow <= t,
      )
    : null;
  // A structure's top a rider meets no more than a kerb below its edge is stepped up onto, as a kerb is
  // on the ground (sim/riders/structures.ts): it is ground, not a wall.
  const caught = tops
    ? structureSupportAt(world, config, m, here, (t) => hBefore >= t - KERB_M && hNow <= t)
    : null;
  const onTop = caught && (!fromAbove || caught.top > fromAbove.top) ? caught : fromAbove;
  const truckEvents = world.events.length;
  carrierContact(
    world,
    config,
    st,
    m,
    airFrom,
    dt,
    decks,
    onTop ? Math.max(hNow, onTop.top) : hNow,
    0,
    hBefore,
  );
  if (world.events.slice(truckEvents).some((e) => e.type === 'crash' && e.actor === m.id)) {
    m.h = Math.max(0, y - surface);
    st.yAbs[m.id] = y;
    return;
  }
  // A solid hazard (run W-U) or a solid piece of street furniture stands up from the road: flying into it
  // below its top is met by the same rule as on the ground (playtest 4: by the closing speed along the
  // contact's normal; it was a crash whatever the speed). A crash ends the flight here.
  if (!onTop && airSolids(world, config, st, m, airFrom, y - surface, tops ? hBefore : undefined)) {
    m.h = Math.max(0, y - surface);
    st.yAbs[m.id] = y;
    return;
  }
  // A dropped bike (pile-ups) is met in the air below its top the same way.
  if (!onTop && droppedBikeContact(world, st, m, airFrom, y - surface)) {
    m.h = Math.max(0, y - surface);
    st.yAbs[m.id] = y;
    return;
  }
  // A structure (sim/riders/structures.ts): its wall below its top met by the same rule, a small top from
  // above by the fall speed. A crash ends the flight here.
  if (!onTop && airStructures(world, config, st, m, airFrom, y, st.yAbs[m.id] ?? y)) {
    m.h = Math.max(0, y - surface);
    st.yAbs[m.id] = y;
    return;
  }
  const deck = onTop
    ? onTop.top
    : deckHeight(config, pos.edge, pos.s, pos.d, { bodies: false, moving: decks.next });
  // Air control and flips (playtest 2): the bike's pitch, and the lean the steering asks for. The
  // time to the ground is forecast over the ground's current slope, so a held brake or kick never
  // turns the bike past where it can right itself before touch-down. Over a support's top, the top is
  // the ground the forecast meets.
  const under = tops && !onTop ? supportAt(world, config, m, here, decks, (t) => t < hNow) : null;
  const ahead = under ? Math.max(deck, under.top) : deck;
  const groundRate = road.frameAt(pos.edge, pos.s).grade * pos.dir * along;
  const tGround = timeToGround(y - (surface + ahead), (st.vy[m.id] ?? 0) - groundRate, gravity);
  const airS = (st.airTicks[m.id] ?? 0) / 60;
  const leanTarget = stepAttitude(world, config, st, m, def, input, steer, dt, tGround, airS);
  // Over a gap (playtest 3, sim/riders/gap.ts) there is nothing to land on: the rider falls on, and
  // past the gap's kill depth it goes overboard. So out past the road's edge (over the barrier): its
  // road's plane does not go on out there, and the gap's own rule wins over one (its respawn). A support
  // under the rider (a truck's roof) is ground either way.
  const overGap = !onTop && gapUnder(world, config, m);
  const pastEdge = !onTop && over !== 'barrier' && overMarkOf(st, m.id) !== null;
  if (!overGap && !pastEdge && y - (surface + deck) <= 0)
    land(world, config, st, m, surface, deck, onTop ?? undefined);
  else {
    m.h = y - surface;
    st.yAbs[m.id] = y;
    if (overGap) gapFall(world, config, st, m, y - (surface + deck));
    else if (over === 'past')
      overFall(
        world,
        config,
        st,
        m,
        y,
        course ? { out: (at) => courseSpotOf(world, config, pos, at).kind === 'out' } : undefined,
      );
  }
  settle(world, st, m, m.mode === 'Airborne' ? leanTarget : 0, dt);
  st.throttle[m.id] = throttle;
  st.brake[m.id] = 0;
  gearAndRpm(st, m);
  st.rpm[m.id] = Math.max(st.rpm[m.id] ?? 0, 1200 + 8800 * throttle); // the engine revs free in the air
}

/**
 * Landing quality: sideways speed decides it (a straight landing is clean), with a very hard drop
 * into the surface as a second way to wobble or crash. Forgiving (playtest 2, 2026-10-02): a crooked
 * landing wobbles and is pulled toward the road's line, a badly crooked one slides straight and loses
 * speed (`data.slide`), and only a really bad one crashes. A landing while still wobbling is judged
 * like any other. Emits `land`, plus `wobble` or `crash`.
 */
function land(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  surface: number,
  deck = 0,
  on?: Support,
): void {
  const pos = m.pos;
  const grade = config.road.frameAt(pos.edge, pos.s).grade * pos.dir;
  // Onto a structure's top (sim/riders/structures.ts), its roof's slope along the bike's heading is the
  // ground's (level on a flat roof, the pitch on a pitched one), not the road's below it.
  const roof = on && on.kind === 'structure' ? structureGradeOf(world, config, m, on) : null;
  const slopeVy = roof !== null ? roof * m.speed : grade * m.speed * cos(m.yaw);
  const vertical = Math.max(0, slopeVy - (st.vy[m.id] ?? 0));
  // Onto a support (sim/riders/supports.ts; the maintainer, 2026-10-06): the same judgement, made in the
  // support's frame, so the sideways speed is the bike's over the top (a truck changing lanes under
  // it adds its own), and the bike rides on at its speed over it.
  const back = on ? toSupportFrame(config, m, on) : false;
  const lateral = Math.abs(m.speed * sin(m.yaw));
  const crashAt = world.params['riders.landingCrashMps'] ?? 4;
  // The bike's attitude (sim/riders/air.ts): a trick landed, or nose first or looped out.
  const slope = roof !== null ? atan(roof) : slopeAt(config, m);
  const td = touchdown(st, m, slope);
  const crashes = lateral >= crashAt || vertical >= LANDING_CRASH_VERTICAL || td.crashes;
  const wobbles =
    lateral >= crashAt * LANDING_WOBBLE_FRACTION || vertical >= LANDING_WOBBLE_VERTICAL || td.wobbles;
  const quality = crashes ? 'crash' : wobbles ? 'wobble' : 'clean';
  const slide = !crashes && lateral >= crashAt * LANDING_SLIDE_FRACTION;
  const trick = crashes ? '' : td.trick;
  const flips = trick === 'backflip' || trick === 'frontflip' ? Math.abs(td.flips) : 0;
  const landYaw = m.yaw;
  if (slide) {
    m.speed = Math.max(0, m.speed * cos(m.yaw) * (1 - LANDING_SLIDE_LOSS));
    m.yaw *= LANDING_SLIDE_YAW;
  } else if (quality === 'wobble') {
    m.yaw *= LANDING_WOBBLE_YAW;
  }
  const airTicks = st.airTicks[m.id] ?? 0;
  m.mode = 'Road';
  m.h = deck; // on a ramp truck's deck, or 0 on the road
  st.yAbs[m.id] = surface + deck;
  st.vy[m.id] = slopeVy;
  st.airTicks[m.id] = 0;
  st.crestHold[m.id] = 1;
  groundPitch(st, m, slope);
  // On a support it stands on it now, moving over it at its speed (backward when the top outruns it).
  if (on) standOn(world, m.id, on, back ? -m.speed : m.speed, inRiderFrame(config, m, on.vx, on.vz));
  const data = {
    quality,
    airTicks,
    lateralMps: lateral,
    verticalMps: vertical,
    speed: m.speed,
    slide,
    trick,
    flips,
    pitchOff: td.pitchOff,
    // Off a hood launch (playtest 3): sim/race scores its trick × race.styleHoodScale.
    ...(td.hood ? { hood: true } : {}),
    // On a support: what kind it is and what it is (a vehicle's content id, `rampTruck`, a hazard's object).
    ...(on ? { on: on.kind, object: on.object } : {}),
  };
  // Air that pays: a clean landing after real air spits the bike forward (rivals too).
  const surge = quality === 'clean' ? landingSurge(world, config, st, m, airTicks) : 0;
  const landData = surge > 0 ? { ...data, surge: true, surgeS: surge } : data;
  const cause =
    on && on.vehicle >= 0
      ? emit(world, 'land', m.id, landData, { target: on.vehicle })
      : emit(world, 'land', m.id, landData);
  if (quality !== 'crash') landingHit(world, config, st, m, cause);
  if (quality === 'crash') {
    st.wobble[m.id] = 0;
    // A trick gone wrong is a big, funny wipeout: the rider thrown high (tumble reads upMps and sideMps).
    const botched = td.throw ? { botched: true, attempt: td.attempt, ...td.throw } : {};
    emit(world, 'crash', m.id, { ...data, cause: 'landing', yaw: landYaw, ...botched }, { causeId: cause });
  } else if (quality === 'wobble') {
    st.wobble[m.id] = WOBBLE_TICKS;
    emit(world, 'wobble', m.id, { ...data, cause: 'landing' }, { causeId: cause });
  }
}

/** A bike's length, m: the landing hit's reach from where the bike comes down (the pitch deck's #13). */
export const LANDING_HIT_REACH_M = 2.2;

/** The landing hit's sideways shove on a rider it does not knock off, m/s (a bump's is 1.5). */
const LANDING_HIT_SHOVE_MPS = 4;

/**
 * The landing surge (the pitch deck's #13): after at least `riders.surgeMinAirS` in the air, a
 * clean landing raises the rider's top speed by `riders.surgeMps` for `riders.surgeS` and pushes it
 * there, on the boost a pad gives (a pad's own bigger boost is kept). Returns the surge's seconds,
 * or 0 for none.
 */
function landingSurge(world: World, config: SimConfig, st: RiderState, m: Mover, airTicks: number): number {
  const secs = world.params['riders.surgeS'] ?? 0;
  const mps = world.params['riders.surgeMps'] ?? 0;
  const minAir = world.params['riders.surgeMinAirS'] ?? 0.5;
  if (secs <= 0 || mps <= 0 || airTicks < minAir * 60) return 0;
  const left = st.boost[m.id] ?? 0;
  st.boostMps[m.id] = left > 0 ? Math.max(st.boostMps[m.id] ?? 0, mps) : mps;
  st.boost[m.id] = Math.max(left, secs * 60);
  return secs;
}

/**
 * The landing hit (the pitch deck's #13): "Land within a bike length of a rival for a heavy hit; it
 * only knocks him off if he's already hurt." A player's bike that comes down (not crashing) within
 * LANDING_HIT_REACH_M of another rider on the road hits the nearest one: `riders.landingHitDamage`
 * off his health, one `hit` event (`weapon: 'landing'`, the landing's causeId). Below
 * `riders.landingHitHurtShare` of his health before it, he is knocked off (a `crash` with `reason:
 * 'knockedOff'` and the lander as its target, which combat credits as a takedown); otherwise he keeps
 * at least one point, wobbles and is shoved aside.
 */
function landingHit(world: World, config: SimConfig, st: RiderState, m: Mover, cause: number): void {
  const def = config.riders[m.riderIndex];
  const damage = world.params['riders.landingHitDamage'] ?? 0;
  if (!def || def.controller.kind !== 'player' || damage <= 0) return;
  let victim: Mover | null = null;
  let best = LANDING_HIT_REACH_M;
  // A hit reaches only a rider within combat's height gap (sim/combat, `combat.reachHeightM`): landing
  // on a truck's roof never hits the rider on the road below it. With the key left out, any height.
  const reachH = world.params['combat.reachHeightM'] ?? Infinity;
  for (const o of world.movers) {
    if (o.id === m.id || o.kind !== 'rider' || o.mode !== 'Road' || o.pos.edge !== m.pos.edge) continue;
    if (Math.abs(o.h - m.h) > reachH) continue;
    const ds = o.pos.s - m.pos.s;
    const dd = o.pos.d - m.pos.d;
    const gap = Math.sqrt(ds * ds + dd * dd);
    if (gap <= best) {
      best = gap;
      victim = o;
    }
  }
  const vdef = victim ? config.riders[victim.riderIndex] : undefined;
  if (!victim || !vdef) return;
  const before = st.health[victim.id] ?? vdef.healthMax;
  if (before <= 0) return;
  const hurt = before < vdef.healthMax * (world.params['riders.landingHitHurtShare'] ?? 0.8);
  const health = hurt ? Math.max(0, before - damage) : Math.max(1, before - damage);
  st.health[victim.id] = health;
  const side = victim.pos.d >= m.pos.d ? 1 : -1;
  emit(
    world,
    'hit',
    m.id,
    { weapon: 'landing', landing: true, damage: before - health, kick: false, health, hitImpulse: 1, side },
    { target: victim.id, causeId: cause },
  );
  if (hurt) {
    emit(
      world,
      'crash',
      victim.id,
      { reason: 'knockedOff', by: m.id, landing: true },
      {
        target: m.id,
        causeId: cause,
      },
    );
    return;
  }
  st.wobble[victim.id] = Math.max(st.wobble[victim.id] ?? 0, WOBBLE_TICKS);
  st.shove[victim.id] = side * LANDING_HIT_SHOVE_MPS;
}

export function ridersStep(world: World, config: SimConfig): void {
  const st = riderState(world);
  for (const m of world.movers) {
    if (m.kind !== 'rider' || m.riderIndex < 0) continue;
    // Taken off its support by another system (the tumble after a crash, a hood launch into the air):
    // it stands on none, and a rider in the air flies at its speed through the world.
    if (m.mode !== 'Road' && supportKeyOf(world, m.id) !== '') {
      if (m.mode === 'Airborne') toWorldFrame(world, config, m);
      else leaveSupport(world, m.id);
    }
    if (m.mode === 'Road') stepGrounded(world, config, st, m);
    else {
      if (m.mode === 'Airborne') stepAirborne(world, config, st, m);
      // Not riding: a crash last tick loses the drift chain now (it is stepped only on the road).
      driftDown(world, st, m);
    }
    // Out of the air (down in a crash, back on a road), it is no longer out past an edge.
    if (m.mode !== 'Airborne') clearOver(st, m.id);
    // Where it left the course, kept while it is off it (sim/riders/course.ts; gap.ts `left`).
    if (m.mode === 'Road' || m.mode === 'Airborne') noteLeft(world, config, st, m);
  }
  // Bumps stop where riding does (the verge's edge with off-road on), never back on the road. With
  // supports, two riders meet only within a rider's height of each other (one on a truck's roof
  // passes over one on the road).
  // A rider up on a structure's top past its band (or out past the edge in the air) is not held by
  // the band's edge, so a bump never snaps it back onto the road.
  riderContacts(world, config, st, {
    wobbleTicks: WOBBLE_TICKS,
    limits: (c, edge, s, d, who) =>
      who && outPastEdge(world, who.id) ? UNHELD : riderLimits(world, c, edge, s, d),
    ...(supportsOn(world) ? { heightGapM: RIDER_BODY_HEIGHT_M } : {}),
  });
}
