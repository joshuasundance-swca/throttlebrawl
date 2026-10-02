// sim/riders: the riding model (M1 riders-1, riders-2). Kinematics follow docs/architecture.md,
// "Coordinates": ds/dt = v·cos(yaw)/(1 − kappa·d), dd/dt = v·sin(yaw), d(yaw)/dt = own turn rate −
// kappa·ds/dt, with the signs of ds/dt and the yaw coupling flipped for dir −1. The longitudinal
// model is scaled throttle against a drag that makes full throttle converge to top speed, plus a
// coasting drag, the brake and gravity along the grade. The barrier rule (docs/architecture.md,
// "Movers on the network") turns a contact into a wobble or a crash by the speed into the wall.
// Airtime (riders-2) follows "Jumps, ramps and airtime": a grounded rider tracks its vertical speed
// along the surface; when its ballistic height next tick clears the surface it goes Airborne with an
// absolute height and vertical speed, reports h above the road, and lands clean, wobbling or crashing
// by its sideways speed (and, far less, how hard it comes down).
// Assists and the lower overall speed (M2 riders-4, docs/milestones/M2.md): a human slot's steering
// assist nudges the heading away from the shoulder and barriers, auto-throttle holds the gas, and
// the speed multiplier m scales every speed by m and every acceleration (gravity too) by m², so the
// ride traces the same paths and arcs, 1/m slower. Time constants (steering and lean response, the
// wobble) and the crash thresholds are not scaled: timers are unaffected, and landings and barrier
// contacts only get gentler.
import { atan, clamp, cos, sin, type TuningParamDecl } from '../../core';
import { sRateFactor } from '../../road';
import type { SimConfig, SimInput, SimRiderDef, SimSteerAssist } from '../types';
import {
  AIR_TUNING,
  groundPitch,
  slopeAt,
  startFlight,
  stepAttitude,
  timeToGround,
  touchdown,
  type AirState,
} from './air';
import { applyShove, riderContacts } from './contact';
import { funnelLimits, FUNNEL_TUNING } from './funnel';
import {
  BOOST_ACCEL_MPS2,
  boostOf,
  boostPadAt,
  deckHeight,
  KERB_M,
  rampTruckAt,
  truckBodyAt,
  truckBodyTop,
  truckClearMps,
} from './features';
import { uturnSettle, uturnStep, uturnTurning, UTURN_TUNING, type UturnState } from './uturn';
import {
  emit,
  slotAssists,
  speedMultiplierOf,
  systemState,
  type Mover,
  type SimSystem,
  type World,
} from '../world';

export { trickOf } from './air';

export const RIDERS_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'riders.steerScale',
    group: 'steering',
    label: 'Steering',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'riders.speedScale',
    group: 'speed',
    label: 'Top speed',
    default: 1,
    min: 0.5,
    max: 1.5,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'riders.accelScale',
    group: 'speed',
    label: 'Acceleration',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    // Playtest 1c ("It also feels like the bikes accelerate slowly"): the engine's push at a
    // standstill, as a multiple of the bike's acceleration, fading to 1× at LAUNCH_FADE_SHARE of
    // top speed. 1 is the M1/M2 model. [default] 3: the starter does 0-60 mph in about 2.9 s, not 6.3 s.
    id: 'riders.launchGain',
    group: 'speed',
    label: 'Launch punch',
    default: 3,
    min: 1,
    max: 4,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'riders.crashImpactMps',
    group: 'crashes',
    label: 'Barrier crash speed',
    default: 6,
    min: 2,
    max: 15,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Forgiving landings (playtest 2, 2026-10-02: "It's too easy to crash after a jump"; the
    // maintainer picked "Forgiving landings"): a landing crashes only from this sideways speed. Below
    // it a crooked landing wobbles, and past LANDING_SLIDE_FRACTION of it the bike slides straight,
    // losing speed. Was 4 m/s (M1). [default]
    id: 'riders.landingCrashMps',
    group: 'crashes',
    label: 'Landing crash sideways speed',
    default: 11,
    min: 1.5,
    max: 20,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Forgiving landings (playtest 2): the share of the road's bend the bike follows in the air. 0
    // is M1's straight flight, which off a jump on a bend flew the bike across the road into the
    // barrier before it came down; 1 bends the flight exactly with the road. [default]
    id: 'riders.airCarve',
    group: 'crashes',
    label: 'Air: follow the bend',
    default: 0.85,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    // Forgiving landings (playtest 2): how fast the bike's heading settles back along the road in
    // the air, 1/s, so a jab of steering mid-air does not land it sideways. 0 is M1 (it keeps
    // whatever heading it has). [default]
    id: 'riders.airAlign',
    group: 'crashes',
    label: 'Air: line up with the road',
    default: 2,
    min: 0,
    max: 6,
    step: 0.25,
    unit: '/s',
    affectsSim: true,
  },
  {
    // Crest launch (the W-O polish run): a bike leaves the ground over a crest when following it
    // would take more downward pull than gravity gives, speed² × the crest's vertical curvature ×
    // this scale > g (× 1 + CREST_MARGIN). 1 is plain physics; lower needs more speed for the same crest; 0 turns it
    // off (only ramp lips launch, as before). It stops at 1: above it the launch would outrun the
    // flight's own gravity, and the bike would hop and land every tick. [default]
    id: 'riders.crestLaunch',
    group: 'speed',
    label: 'Crest launch',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  // Lane drops (W-R): where the road narrows ahead, the edge funnels in (sim/riders/funnel.ts).
  ...FUNNEL_TUNING,
  ...AIR_TUNING,
  ...UTURN_TUNING,
];

/**
 * Per-rider plain state, by entity id (the air's attitude and tricks: sim/riders/air.ts; U-turns:
 * sim/riders/uturn.ts).
 */
export interface RiderState extends AirState, UturnState {
  throttle: number[];
  brake: number[];
  rpm: number[];
  gear: number[];
  /** Lean angle in radians, positive leaning right; smoothed, plus the wobble shake. */
  lean: number[];
  /** Lean before the wobble shake is added (smoothed toward the lateral-acceleration lean). */
  leanBase: number[];
  health: number[];
  /** Scaled ticks of wobble left: steering authority is reduced and the bike shakes. */
  wobble: number[];
  /** 1 while the rider is in contact with a barrier, so one contact emits one event. */
  touching: number[];
  /** Absolute height of the rider while airborne, metres (the surface height while grounded). */
  yAbs: number[];
  /** Vertical speed, m/s: along the surface while grounded, ballistic while airborne. */
  vy: number[];
  /** Scaled ticks in the air in the current jump. */
  airTicks: number[];
  /** Tick of this rider's last riders step, so a rider put down by another system starts fresh. */
  lastTick: number[];
  /** Sideways shove from bumping another rider, m/s along +d (sim/riders/contact). */
  shove: number[];
  /** Last tick each pair of riders ("lowId-highId") touched, so one contact emits one event. */
  contactTick: Record<string, number>;
  /** Scaled ticks of speed boost left from a `boostPad` (playtest 1b quick wins); the snapshot's boostS. */
  boost: number[];
  /** The speed the current boost adds to top speed, m/s (before the speed multiplier). */
  boostMps: number[];
  /** 1 while the rider is on a boost pad, so one crossing gives one boost. */
  onPad: number[];
  /** 1 while the rider is held against a ramp truck's side, so one contact emits one event. */
  truckTouch: number[];
  /**
   * 1 from a landing until the rider rides clear of a crest that would launch him, so one crest is
   * one jump: coming down on the same crest's far side never bounces him straight back up.
   */
  crestHold: number[];
}

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
/** m/s² when off the throttle, before air drag. */
export const COAST_DECEL = 0.6;
/** How far beside a ramp truck a rider put down inside it steps out, m. */
const TRUCK_STEP_OUT_M = 0.3;
const GRAVITY = 9.81;
/** 1/s: how fast the bike reaches the steered heading. */
const YAW_RESPONSE = 4;
/** rad: the largest heading offset steering can ask for. */
const MAX_YAW = 0.5;
const GEAR_TOP_MPS = [9, 16, 23, 30, 1000];
/** Half the bike's width: the rider's centre stays this far inside the barrier. */
export const BIKE_HALF_WIDTH_M = 0.5;
/** Extra drag on the rougher shoulder, m/s². */
const SHOULDER_DRAG = 1.5;
/** Scrape friction while touching a barrier, m/s². */
const SCRAPE_DRAG = 4;
/** How long a wobble lasts, in ticks at timeScale 1 (0.6 s). */
export const WOBBLE_TICKS = 36;
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
/** The ballistic height must clear the surface by this much to take off (ignores sample kinks). */
export const TAKEOFF_CLEARANCE_M = 0.02;
/**
 * A crest's vertical curvature is read from the road's grade this far either side of the bike, m:
 * wide enough to smooth the 2 m road samples, narrow enough for a sharp hilltop. [default]
 */
export const CREST_SPAN_M = 4;
/**
 * A crest launches once its pull beats gravity by this share. Just over 1 g the bike only gets light:
 * the road between two 2 m samples is straight, so it would come down on the same chord after a
 * tick or two (a hop, not air). [default]
 */
export const CREST_MARGIN = 0.2;
/** Heading change steering can make in the air, rad/s at full lock. */
const AIR_TURN_RATE = 0.6;
/** A landing wobbles from this fraction of the landing crash sideways speed. [default] */
const LANDING_WOBBLE_FRACTION = 0.3;
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
 * The lowest overall-speed multiplier the settings offer [default]. The sim accepts anything in
 * (0, 1]; this is the value the ramp shortcut and jumps are tested at.
 */
export const SPEED_MULTIPLIER_MIN = 0.6;
/**
 * Steering assist strength: the heading nudge at the edge of the travel lanes, as a share of the
 * steering's full heading offset. Even strong stays below full lock, so a rider who means it still gets onto the shoulder.
 */
const ASSIST_GAIN: Readonly<Record<SimSteerAssist, number>> = { off: 0, light: 0.45, strong: 0.9 };
/** The assist acts within this distance of the travel lanes' edge (a bike's half-width inside it). */
const ASSIST_MARGIN_M = 1;
/** It judges where the rider will be this far ahead, so riding away from the edge is left alone. */
const ASSIST_LOOKAHEAD_S = 0.4;

export function riderState(world: World): RiderState {
  return systemState<RiderState>(world, 'riders', () => ({
    throttle: [],
    brake: [],
    rpm: [],
    gear: [],
    lean: [],
    leanBase: [],
    health: [],
    wobble: [],
    touching: [],
    yAbs: [],
    vy: [],
    airTicks: [],
    lastTick: [],
    shove: [],
    contactTick: {},
    boost: [],
    boostMps: [],
    onPad: [],
    crestHold: [],
    truckTouch: [],
    pitch: [],
    pitchRate: [],
    airBlock: [],
    noseUpTicks: [],
    whipTicks: [],
    trick: [],
    uturn: [],
  }));
}

/**
 * The largest heading offset steering can ask for at a speed (reaches the bike's steer rate), times
 * the tuning panel's steering scale. The scale applies after the clamp so the slider also changes
 * low-speed steering, where the clamp would otherwise swallow it.
 */
export function maxYawAt(steerRateMps: number, speed: number, steerScale: number): number {
  return clamp(steerRateMps / (speed < 6 ? 6 : speed), 0.05, MAX_YAW) * steerScale;
}

/** Top speed after the tuning panel's speed scale and the lower-overall-speed multiplier. */
export function topSpeedOf(world: World, config: SimConfig, bikeTopMps: number): number {
  return bikeTopMps * (world.params['riders.speedScale'] ?? 1) * speedMultiplierOf(config);
}

/** What the lower overall speed does to accelerations and gravity: m², so paths keep their shape. */
function accelMultiplierOf(config: SimConfig): number {
  const m = speedMultiplierOf(config);
  return m * m;
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

/** The drivable limits for a rider's centre at (edge, s): the outer lane edges, less half a bike. */
export function barrierLimits(config: SimConfig, edge: number, s: number): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const lane of config.road.lanesAt(edge, s)) {
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return { lo: lo + BIKE_HALF_WIDTH_M, hi: hi - BIKE_HALF_WIDTH_M };
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
 * Only onto the race's allowed edges. Traffic never does this: it only calls road.advance.
 */
function crossToBranch(config: SimConfig, m: Mover): void {
  const pos = m.pos;
  const { lo, hi } = barrierLimits(config, pos.edge, pos.s);
  if (pos.d >= lo && pos.d <= hi) return;
  const turn = config.road.handover(pos, BIKE_HALF_WIDTH_M, (e) => config.route.allows(e));
  if (turn !== null) m.yaw += turn;
}

/**
 * How far before a split zone its outer edge already guides rather than walls, m [default]. 15 m
 * left a commit 45 to 80 m before the zone on the wall (the integration skeptic's F1: 8 of 28 early
 * commits on the Keys and the Pacific Northwest); 90 m covers a full-lock commit from 80 m out.
 */
export const SPLIT_GUIDE_LEAD_M = 90;

/**
 * Playtest 1c ([decided] 2026-09-30, the skeptic's mustFix from playtest 1b): a rider who commits
 * early and hard to a branch reaches the painted split zone's outer edge before the split, and that
 * edge is also the road's. There it guides instead of walling: inside a split zone that runs out to
 * the edge on its side (and a lead-in of SPLIT_GUIDE_LEAD_M before it), a rider at the edge slides along it to the
 * split with no barrier event, no scrape and no speed lost, and its d stays inside the zone, so it
 * takes the branch. Only where the zone leads onto an edge the race allows.
 */
function splitGuideAt(config: SimConfig, edge: number, s: number, side: 1 | -1, limit: number): boolean {
  for (const z of config.road.splitZones()) {
    if (z.edge !== edge || (z.d0 + z.d1 >= 0 ? 1 : -1) !== side) continue;
    const s0 = z.end === 'to' ? z.s0 - SPLIT_GUIDE_LEAD_M : z.s0;
    const s1 = z.end === 'to' ? z.s1 : z.s1 + SPLIT_GUIDE_LEAD_M;
    if (s < s0 || s > s1) continue;
    if (side > 0 ? z.d1 < limit || z.d0 > limit : z.d0 > limit || z.d1 < limit) continue;
    if (config.route.allows(z.toEdge)) return true;
  }
  return false;
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
  const f = funnelLimits(config.road, taper, pos, (edge, s) => barrierLimits(config, edge, s));
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
 * zone's outer edge (splitGuideAt) the rider is only turned along the edge instead. Where the road
 * narrows ahead (a lane that ends, W-R), the edge funnels in first (laneDropGuide).
 */
function barrierContact(world: World, config: SimConfig, st: RiderState, m: Mover, dt: number): void {
  if (laneDropGuide(world, config, st, m)) return;
  const pos = m.pos;
  const { lo, hi } = barrierLimits(config, pos.edge, pos.s);
  if (pos.d >= lo && pos.d <= hi) {
    st.touching[m.id] = 0;
    return;
  }
  const side = pos.d > hi ? 1 : -1; // road-frame side of the wall
  if (splitGuideAt(config, pos.edge, pos.s, side, side > 0 ? hi : lo)) {
    pos.d = side > 0 ? hi : lo;
    m.yaw = 0;
    st.touching[m.id] = 0;
    return;
  }
  if (uturnTurning(st, m.id)) {
    // Mid U-turn (sim/riders/uturn.ts) the kerb holds the bike in and scrapes speed off while it
    // pivots on round; it never crashes it, and the heading is left to the turn.
    pos.d = side > 0 ? hi : lo;
    m.speed = Math.max(0, m.speed - SCRAPE_DRAG * accelMultiplierOf(config) * dt);
    st.touching[m.id] = 1;
    return;
  }
  const v = m.speed;
  const yawBefore = m.yaw;
  const impact = scrapeAlong(config, m, side, dt);
  pos.d = side > 0 ? hi : lo;
  const newContact = st.touching[m.id] !== 1;
  st.touching[m.id] = 1;
  wallOutcome(world, st, m, { impact, v, yawBefore, side, newContact });
}

/**
 * A rider meeting a wall on its `side` (road frame): the wall takes the speed across the road and
 * turns the bike along it, so the rider scrapes along. Returns the speed it hit the wall with.
 */
function scrapeAlong(config: SimConfig, m: Mover, side: 1 | -1, dt: number): number {
  const v = m.speed;
  // Speed across the road toward the wall (the rider's right is -d when riding toward -s).
  const vAcross = m.pos.dir * v * sin(m.yaw);
  const m2 = accelMultiplierOf(config);
  m.speed = Math.max(0, v * cos(m.yaw) - SCRAPE_DRAG * m2 * dt);
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
    /** A crash whatever the speed (a rider up on a ramp truck riding into its body). */
    crash?: boolean;
  },
): void {
  const { impact, v, yawBefore, side } = hit;
  const crashAt = world.params['riders.crashImpactMps'] ?? 6;
  const unstable = (st.wobble[m.id] ?? 0) > 0;
  const crashes =
    hit.crash === true || impact >= crashAt || (unstable && impact >= crashAt * UNSTABLE_CRASH_FRACTION);
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
 * The ramp truck is solid (playtest 1b quick wins): a grounded rider whose deck height would jump by
 * more than a kerb in one tick rode into its side or front, not up its ramp. From the side it is
 * held beside the truck and scrapes, like the barrier rule; head on, it stops where it was and
 * takes the whole speed as the impact. Events carry `object: 'rampTruck'` and the truck's id.
 */
function truckContact(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number; deck: number },
  dt: number,
): void {
  const pos = m.pos;
  const truck = rampTruckAt(config, pos.edge, pos.s, pos.d);
  // Off the lip fast enough to clear the body, in the tick that crosses into it: a launch, not a
  // contact (the take-off rule below sends it airborne over the truck).
  const launch =
    !!truck &&
    before.deck > KERB_M &&
    truckBodyAt(config, pos.edge, pos.s, pos.d) === truck &&
    m.speed >= truckClearMps(truck, GRAVITY * accelMultiplierOf(config));
  if (!truck || launch || deckHeight(config, pos.edge, pos.s, pos.d) - before.deck <= KERB_M) {
    st.truckTouch[m.id] = 0;
    return;
  }
  const v = m.speed;
  const yawBefore = m.yaw;
  const newContact = st.truckTouch[m.id] !== 1;
  st.truckTouch[m.id] = 1;
  const extra = { object: 'rampTruck', feature: truck.id };
  const outside = before.d < truck.d0 || before.d > truck.d1;
  if (before.edge === pos.edge && outside) {
    const side = before.d < truck.d0 ? 1 : -1; // the truck is on this side of the rider
    const impact = scrapeAlong(config, m, side, dt);
    pos.d = side > 0 ? truck.d0 - 0.01 : truck.d1 + 0.01;
    wallOutcome(world, st, m, { impact, v, yawBefore, side, newContact, extra });
    return;
  }
  pos.edge = before.edge;
  pos.s = before.s;
  pos.d = before.d;
  m.speed = 0;
  // Up on the truck (its ramp or lip platform) and into its body, the parked car: thrown off the
  // truck, a crash at any speed (the integration skeptic's F2: never stuck against it on the deck).
  const crash = before.deck > KERB_M;
  wallOutcome(world, st, m, { impact: v, v, yawBefore, side: 1, newContact, extra, crash });
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
  const inside = fresh && m.h === 0 ? rampTruckAt(config, pos.edge, pos.s, pos.d) : null;
  if (inside && deckHeight(config, pos.edge, pos.s, pos.d) > 0) {
    const out = Math.sign(inside.d1 - inside.d0) * TRUCK_STEP_OUT_M;
    pos.d = Math.abs(inside.d0) <= Math.abs(inside.d1) ? inside.d0 - out : inside.d1 + out;
  }
  const deckBefore = deckHeight(config, pos.edge, pos.s, pos.d);
  const before = { edge: pos.edge, s: pos.s, d: pos.d, deck: deckBefore };
  const yBefore = road.surfaceHeight(pos.edge, pos.s, pos.d) + deckBefore;
  const vyBefore = fresh ? 0 : (st.vy[m.id] ?? 0);
  st.lastTick[m.id] = world.tick;
  // A U-turn (interview, 2026-10-02): a slow player holding the brake and full lock pivots round
  // (sim/riders/uturn.ts); null while riding normally.
  const uturn = uturnStep(world, st, def, m, steer, brake, fresh);

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
  const ownTop = topSpeedOf(world, config, bike.topSpeedMps);
  const top = ownTop + boostTop;
  const a = bike.accelMps2 * accelScale * m2;
  const fade = clamp(1 - v / (ownTop * LAUNCH_FADE_SHARE), 0, 1);
  const open =
    def.controller.kind === 'player'
      ? 1
      : clamp((throttle - AI_LAUNCH_THROTTLE) / (1 - AI_LAUNCH_THROTTLE), 0, 1);
  const share = def.faction === 'law' ? (world.params['cops.launchShare'] ?? 0) : 1;
  const launch = 1 + ((world.params['riders.launchGain'] ?? 1) - 1) * fade * open * share;
  let accel = throttle * a * launch - (a * v * v) / (top * top);
  accel -= ((1 - throttle) * COAST_DECEL + brake * bike.brakeMps2) * m2 + gravity * grade;
  if (boostLeft > 0) {
    // The push stops at the raised top speed; it never carries the bike past it.
    if (v < top) accel = Math.max(accel, Math.min(accel + BOOST_ACCEL_MPS2 * m2, (top - v) / dt));
    st.boost[m.id] = Math.max(0, boostLeft - world.timeScale);
  }
  if (onShoulder(config, m)) accel -= SHOULDER_DRAG * m2;
  if (wobble > 0) accel -= WOBBLE_DRAG * m2;
  // Gassing round a U-turn never takes the bike past the turn's speed.
  if (uturn && dt > 0 && v + accel * dt > uturn.capMps) accel = Math.min(accel, (uturn.capMps - v) / dt);
  m.speed = Math.max(0, v + accel * dt);

  // Lateral: steering asks for a heading offset; the road turning under the bike pulls it.
  const authority = wobble > 0 ? WOBBLE_STEER : 1;
  const maxYaw = maxYawAt(bike.steerRateMps, m.speed, steerScale);
  const assist = assistYaw(config, m, slotAssists(config, slotOf(def)).steer, maxYaw);
  const asked = steer * authority * maxYaw;
  // Without a nudge the heading asked for is untouched (no clamp, no +0), exactly as before M2.
  const yawTarget = assist === 0 ? asked : clamp(asked + assist, -maxYaw, maxYaw);
  // In a U-turn the bike turns at the turn's own rate, past the usual limit; a turn given up midway
  // comes back from wherever it got to (with no U-turn, |yaw| is never past 1.2 here).
  const ownTurn = uturn ? uturn.rate : (yawTarget - m.yaw) * YAW_RESPONSE;
  const along = m.speed * cos(m.yaw) * sRateFactor(frameKappa, pos.d);
  const yawLimit = uturn ? Infinity : Math.max(1.2, Math.abs(m.yaw));
  m.yaw = clamp(m.yaw + (ownTurn - pos.dir * frameKappa * along) * dt, -yawLimit, yawLimit);
  pos.s += pos.dir * along * dt;
  pos.d += pos.dir * m.speed * sin(m.yaw) * dt;
  if (uturn) uturnSettle(st, m);
  m.h = 0;
  applyShove(config, st, m, dt);
  if (road.advance(pos) === 'deadEnd') m.speed = 0;
  crossToBranch(config, m);
  barrierContact(world, config, st, m, dt);
  truckContact(world, config, st, m, before, dt);

  // Take-off: the surface fell away faster than gravity can follow (the ballistic height clears it).
  // The ground is the road, or a ramp truck's ramp or lip platform (never its body, which a grounded
  // rider is kept out of above): h is always the height above the road.
  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  const deck = deckHeight(config, pos.edge, pos.s, pos.d, { bodies: false });
  const ground = surface + deck;
  const ballistic = yBefore + vyBefore * dt - 0.5 * gravity * dt * dt;
  const lip = ballistic > ground + TAKEOFF_CLEARANCE_M;
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
    // The flight starts at the slope the bike rode off (last tick's ground pitch).
    startFlight(st, m, input, st.pitch[m.id] ?? slopeAt(config, m));
    emit(
      world,
      'jump',
      m.id,
      crest ? { speed: m.speed, vyMps: vy0, crest: 1 } : { speed: m.speed, vyMps: vy0 },
    );
  } else {
    m.h = deck;
    st.yAbs[m.id] = ground;
    if (dt > 0) st.vy[m.id] = (ground - yBefore) / dt;
    touchPads(world, config, st, m);
    groundPitch(st, m, slopeAt(config, m));
  }

  // Lean from sideways acceleration (the heading's world turn rate is the rider's own turn rate).
  settle(world, st, m, atan((m.speed * ownTurn) / GRAVITY), dt);
  st.throttle[m.id] = throttle;
  st.brake[m.id] = brake;
  gearAndRpm(st, m);
}

/**
 * The road's vertical curvature at s, 1/m, from its grade CREST_SPAN_M either side (kept on the
 * edge): negative over a crest, positive in a dip. The same either way along the road.
 */
export function crestCurvature(config: SimConfig, edge: number, s: number): number {
  const len = config.road.edges[edge]?.length ?? 0;
  const s0 = Math.max(0, s - CREST_SPAN_M);
  const s1 = Math.min(len, s + CREST_SPAN_M);
  if (s1 - s0 < CREST_SPAN_M) return 0;
  return (config.road.frameAt(edge, s1).grade - config.road.frameAt(edge, s0).grade) / (s1 - s0);
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
  const top = topSpeedOf(world, config, bike.topSpeedMps) + boostTop;
  const a = bike.accelMps2 * (world.params['riders.accelScale'] ?? 1) * m2;
  m.speed = Math.max(0, m.speed - ((a * m.speed * m.speed) / (top * top)) * dt);
  const kappa = road.kappaAt(pos.edge, pos.s);
  const ownTurn = steer * AIR_TURN_RATE;
  const along = m.speed * cos(m.yaw) * sRateFactor(kappa, pos.d);
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
  barrierContact(world, config, st, m, dt);
  st.airTicks[m.id] = (st.airTicks[m.id] ?? 0) + world.timeScale;

  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  // A rider never lands on a ramp truck's body (the car on its top deck, the cab): fast enough off
  // the lip, it clears the truck; too slow, and below the body's top, it hits it (the integration
  // skeptic's F2: it used to land on a level deck inside that car).
  const body = truckBodyAt(config, pos.edge, pos.s, pos.d);
  if (body && y - surface < truckBodyTop(body) && m.speed < truckClearMps(body, gravity)) {
    m.h = Math.max(0, y - surface);
    st.yAbs[m.id] = y;
    st.wobble[m.id] = 0;
    const data = { cause: 'barrier', speed: m.speed, impactMps: m.speed, yaw: m.yaw, side: 1 };
    emit(world, 'crash', m.id, { ...data, object: 'rampTruck', feature: body.id });
    return;
  }
  const deck = deckHeight(config, pos.edge, pos.s, pos.d, { bodies: false });
  // Air control and flips (playtest 2): the bike's pitch, and the lean the steering asks for. The
  // time to the ground is forecast over the ground's current slope, so a held brake or kick never
  // turns the bike past where it can right itself before touch-down.
  const groundRate = road.frameAt(pos.edge, pos.s).grade * pos.dir * along;
  const tGround = timeToGround(y - (surface + deck), (st.vy[m.id] ?? 0) - groundRate, gravity);
  const leanTarget = stepAttitude(world, config, st, m, def, input, steer, dt, tGround);
  if (y - (surface + deck) <= 0) land(world, config, st, m, surface, deck);
  else {
    m.h = y - surface;
    st.yAbs[m.id] = y;
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
function land(world: World, config: SimConfig, st: RiderState, m: Mover, surface: number, deck = 0): void {
  const pos = m.pos;
  const grade = config.road.frameAt(pos.edge, pos.s).grade * pos.dir;
  const slopeVy = grade * m.speed * cos(m.yaw);
  const vertical = Math.max(0, slopeVy - (st.vy[m.id] ?? 0));
  const lateral = Math.abs(m.speed * sin(m.yaw));
  const crashAt = world.params['riders.landingCrashMps'] ?? 4;
  // The bike's attitude (sim/riders/air.ts): a trick landed, or nose first or looped out.
  const slope = slopeAt(config, m);
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
  };
  const cause = emit(world, 'land', m.id, data);
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

const CONTACT_RULES = { wobbleTicks: WOBBLE_TICKS, limits: barrierLimits };

export const ridersSystem: SimSystem = {
  name: 'riders',
  init(world: World, config: SimConfig) {
    const st = riderState(world);
    for (const m of world.movers) {
      const def = config.riders[m.riderIndex];
      if (m.kind !== 'rider' || !def) continue;
      st.throttle[m.id] = 0;
      st.brake[m.id] = 0;
      st.rpm[m.id] = 1200;
      st.gear[m.id] = 1;
      st.lean[m.id] = 0;
      st.leanBase[m.id] = 0;
      st.health[m.id] = def.healthMax;
      st.wobble[m.id] = 0;
      st.touching[m.id] = 0;
      st.yAbs[m.id] = config.road.surfaceHeight(m.pos.edge, m.pos.s, m.pos.d);
      st.vy[m.id] = 0;
      st.airTicks[m.id] = 0;
      st.lastTick[m.id] = -2;
      st.shove[m.id] = 0;
      st.boost[m.id] = 0;
      st.boostMps[m.id] = 0;
      st.onPad[m.id] = 0;
      st.truckTouch[m.id] = 0;
      st.uturn[m.id] = 0;
      startFlight(st, m, undefined, slopeAt(config, m));
    }
  },
  step(world: World, config: SimConfig) {
    const st = riderState(world);
    for (const m of world.movers) {
      if (m.kind !== 'rider' || m.riderIndex < 0) continue;
      if (m.mode === 'Road') stepGrounded(world, config, st, m);
      else if (m.mode === 'Airborne') stepAirborne(world, config, st, m);
    }
    riderContacts(world, config, st, CONTACT_RULES);
  },
};
