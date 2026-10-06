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
// The ground beside the road (run W-R; interview, 2026-10-02: "Anywhere with ground", off-road as
// "a ground band beside most roads ... water, ferns and kerbs are the real edges; some fences
// smash"): with `ground.offRoad` on, a rider rides past the lanes onto each verge band (sim/ground's
// `rideLimits`), each surface scales the steering and the top speed (`surfaceFeel`), and the band's
// outer edge decides what happens there (sim/riders/verge.ts).
// Air that pays (the pitch deck's #13, run W-T): a clean landing after real air gives a short surge,
// rivals included, on the rider's boost; a player who lands within a bike length of another rider
// lands a heavy hit on him, which knocks him off only if he is already hurt; and the snapshot gets
// the forecast touch-down point (`touchdownOf`) for render's chalk mark. Each is off when its tuning
// key is left out, so every recording made before rides as it did.
// Playtest 3's moves (the K0a contract): the wheelie (sim/riders/wheelie.ts), the drift
// (sim/riders/drift.ts) and road gaps and jumpable walls (sim/riders/gap.ts) plug in through hooks
// below, each neutral while its move is off, so their lanes never edit this file.
import { atan, atan2, clamp, cos, sin, type TuningParamDecl, type VergeEdge } from '../../core';
import { sRateFactor, type FurnitureShape } from '../../road';
import type { RideLimits } from '../ground';
import { GRAZE_M, trafficContactCrashes } from '../traffic/contact-rule';
import type {
  MovesSnapshot,
  SimConfig,
  SimInput,
  SimRiderDef,
  SimSteerAssist,
  TouchdownSnapshot,
} from '../types';
import {
  AIR_TUNING,
  groundPitch,
  holdingPaper,
  slopeAt,
  startFlight,
  stepAttitude,
  timeToGround,
  touchdown,
  type AirState,
} from './air';
import { applyShove, RIDER_CONTACT_HALF_WIDTH_M, riderContacts } from './contact';
import {
  driftDown,
  driftMoves,
  driftStep,
  driftTakeoff,
  DRIFT_TUNING,
  newDriftState,
  type DriftState,
} from './drift';
import { funnelLimits, FUNNEL_TUNING, ridingLimitsAt } from './funnel';
import {
  BIKE_RADIUS_M,
  BIKE_SPINE_HALF_M,
  closingMps,
  firstTouch,
  furnitureOn,
  FURNITURE_TUNING,
  LIGHT_KICK,
  LIGHT_SCRUB,
  piecesNear,
  slideAlong,
  spineAt,
  spineGap,
  type FurnitureHit,
} from './furniture';
import { smokeTopScale, SMOKE_TUNING } from './smoke';
import {
  BOOST_ACCEL_MPS2,
  boostOf,
  boostPadAt,
  clearsBody,
  deckHeight,
  hazardObject,
  hazardTop,
  HAZARD_REACH_D_M,
  KERB_M,
  movingDecks,
  rampTruckAt,
  isLightHazard,
  solidHazardsNear,
  stagingGuideAt,
  truckBodyAt,
  truckBodyTop,
  truckClosingMps,
  type MovingDecks,
} from './features';
import {
  clearOver,
  gapFall,
  gapUnder,
  GAP_TUNING,
  newGapState,
  overBarrier,
  overFall,
  overMarkOf,
  type GapState,
} from './gap';
import { uturnForget, uturnSettle, uturnStep, uturnTurning, UTURN_TUNING, type UturnState } from './uturn';
import {
  behindFence,
  breakFence,
  EDGE_DRAG,
  EDGE_WOBBLE_MPS,
  FENCE_PLOUGH_DRAG,
  FENCE_SMASH_LOSS,
  groundFeel,
  limitsAt,
  ploughYard,
  vergeState,
} from './verge';
import {
  emit,
  slotAssists,
  speedMultiplierOf,
  systemState,
  type Mover,
  type SimSystem,
  type World,
} from '../world';
import {
  hazardLaunch,
  newWheelieState,
  wheelieMoves,
  wheelieStep,
  wheelieTakeoff,
  WHEELIE_TUNING,
  type WheelieState,
} from './wheelie';

export { trickOf } from './air';
export { driftOf } from './drift';
export { highDrop } from './gap';
export { wheelieOf } from './wheelie';
export { LOOSE_GROUND, offRoadOf, vergeState, type BrokenFence } from './verge';

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
    // Bend room (playtest 4, the Gorge's first turns): a rider the bend carries onto its outer edge
    // while holding the bars into it crashes only from this many times the barrier crash speed;
    // under it, a scrape and a wobble. 1 (and a race whose tuning leaves it out) is the old rule.
    // [default]
    id: 'riders.bendEdgeForgive',
    group: 'crashes',
    label: 'Bend room: edge forgiveness',
    default: 3,
    min: 1,
    max: 4,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    // Off-road (run W-R; interview, 2026-10-02: "some fences can be smashed"): a rider who hits a
    // fence at the end of a verge band this fast or faster across it smashes through it; slower,
    // the fence holds it, with a scrape and a wobble but never a crash. [default]
    id: 'riders.fenceSmashMps',
    group: 'crashes',
    label: 'Fence smash speed',
    default: 3,
    min: 0.5,
    max: 12,
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
  {
    // Air that pays (the pitch deck's #13): a clean landing after at least this much air, s, gives
    // the surge. 0.5 s is the airtime style cash's own minimum ("real air"). [default]
    id: 'riders.surgeMinAirS',
    group: 'crashes',
    label: 'Landing surge: air at least',
    default: 0.5,
    min: 0.1,
    max: 2,
    step: 0.05,
    unit: 's',
    affectsSim: true,
  },
  {
    // ...how long the surge lasts, s; 0 turns it off. It rides on the boost-pad machinery (a raised
    // top speed and a push toward it), shorter and gentler than a pad (8 m/s for 1.5 s). [default]
    id: 'riders.surgeS',
    group: 'crashes',
    label: 'Landing surge: time',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: 's',
    affectsSim: true,
  },
  {
    // ...and how much it raises the top speed by, m/s, before the overall-speed multiplier. [default]
    id: 'riders.surgeMps',
    group: 'crashes',
    label: 'Landing surge: speed',
    default: 5,
    min: 0,
    max: 12,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Air that pays (the pitch deck's #13): "Land within a bike length of a rival for a heavy hit;
    // it only knocks him off if he's already hurt." The hit's damage; 0 turns it off. A kick does
    // about a third of a fresh rival (3 kicks drop one). [default]
    id: 'riders.landingHitDamage',
    group: 'crashes',
    label: 'Landing hit: damage',
    default: 35,
    min: 0,
    max: 100,
    step: 5,
    unit: 'hp',
    affectsSim: true,
  },
  {
    // ...a rider below this share of his health is "already hurt", and the landing hit knocks him
    // off; above it, it never takes his last point. [default] 0.8: one landed punch is enough.
    id: 'riders.landingHitHurtShare',
    group: 'crashes',
    label: 'Landing hit: hurt below',
    default: 0.8,
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
  // Playtest 3's moves: each lane declares its own keys in its own file.
  ...WHEELIE_TUNING,
  ...DRIFT_TUNING,
  ...GAP_TUNING,
  ...FURNITURE_TUNING,
  // Playtest 4: a smoking bike loses a little top speed (sim/riders/smoke.ts).
  ...SMOKE_TUNING,
];

/**
 * Per-rider plain state, by entity id (the air's attitude and tricks: sim/riders/air.ts; U-turns:
 * sim/riders/uturn.ts; playtest 3's wheelie, drift and gaps: wheelie.ts, drift.ts and gap.ts, whose
 * `new...State()` give their empty arrays).
 */
export interface RiderState extends AirState, UturnState, WheelieState, DriftState, GapState {
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
  /** 1 while the rider is held against a solid hazard (run W-U), so one contact emits one event. */
  hazardTouch: number[];
  /**
   * The street piece the rider touched last tick, its id + 1 (0 for none; playtest 4, "solid but
   * forgiving"), so one contact emits one event; and the light one it last rode through, so it is
   * ridden through once.
   */
  furnTouch: number[];
  lightTouch: number[];
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
/**
 * How far beside a ramp truck a rider put down inside it steps out, m: clear of its side by the
 * rider's reach (truckSideContact), so stepping out is not a scrape (it was 0.3, the bike's middle).
 */
const TRUCK_STEP_OUT_M = HAZARD_REACH_D_M + 0.05;
const GRAVITY = 9.81;
/**
 * 1/s: how fast the bike reaches the steered heading (Arcade). The Free steering style turns the
 * bike at this same first rate, the stick's heading × YAW_RESPONSE, with nothing turning it back.
 */
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
    hazardTouch: [],
    furnTouch: [],
    lightTouch: [],
    pitch: [],
    pitchRate: [],
    airBlock: [],
    noseUpTicks: [],
    whipTicks: [],
    trick: [],
    paperArm: [],
    paper: [],
    paperFold: [],
    paperRead: [],
    uturn: [],
    uturnTap: [],
    uturnClock: [],
    uturnDown: [],
    ...newWheelieState(),
    ...newDriftState(),
    ...newGapState(),
  }));
}

/**
 * Whether a rider is out past its road's edge in the air (over the barrier, sim/riders/gap.ts): no
 * edge holds it there, so combat's shove does not snap it back onto the road.
 */
export function outPastEdge(world: World, id: number): boolean {
  const st = world.systems['riders'] as RiderState | undefined;
  return st !== undefined && overMarkOf(st, id) !== null;
}

/**
 * Whether a rider was handed over through the air onto another road past its edge this tick (over
 * the barrier, sim/riders/gap.ts): sim/race's shortcut stamp gives up a run that leaves that way.
 * Reads the state without creating it.
 */
export function hoppedRoads(world: World, id: number): boolean {
  const st = world.systems['riders'] as RiderState | undefined;
  return st?.hop?.[id] === world.tick;
}

/**
 * The player in slot 0's wheelie and drift for the HUD (SimSnapshot.moves; playtest 3), or null
 * when no player rides. Reads the state without creating it.
 */
export function movesOf(world: World, config: SimConfig): MovesSnapshot | null {
  const i = config.riders.findIndex((r) => r.controller.kind === 'player' && r.controller.slot === 0);
  const m = i < 0 ? undefined : world.movers.find((o) => o.kind === 'rider' && o.riderIndex === i);
  if (!m) return null;
  return { ...wheelieMoves(world, m.id), ...driftMoves(world, m.id) };
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

/**
 * The scale a smoking bike puts on its own top speed (playtest 4, P4-14; sim/riders/smoke.ts): 1
 * while its rider has more than the smoking line of his health, `1 - riders.smokeSlowdown` at or
 * under it. A missing key (a config built without the tuning defaults) is no slowdown.
 */
function smokeScaleOf(world: World, st: RiderState, m: Mover, def: SimRiderDef): number {
  return smokeTopScale(
    world.params['riders.smokeSlowdown'] ?? 0,
    st.health[m.id] ?? def.healthMax,
    def.healthMax,
  );
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

/**
 * A rider this far past the lanes' edge is out on the verge: a split's guide span leaves it there
 * (one tick of riding moves a bike across the road by well under this). [default]
 */
const ON_VERGE_M = 0.5;

/**
 * Where a riding rider's centre may go at (edge, s) in this race, and what stops it at each side
 * (run W-R): the lanes' edges and a wall with `ground.offRoad` off (exactly barrierLimits), each
 * verge band's outer edge and its kind with it on, a broken fence's yard included. Combat's shove
 * and the riders' contacts stop here too, so nothing puts a rider on the verge back on the road.
 * Over a split's guide span (the zone and its lead-in) the zone's side keeps the lanes' edge for a
 * rider on the road, where the split guide slides one who commits early onto the branch with no
 * wall (playtest 1b, 1c): riding out onto the verge there would carry it past the zone and miss the
 * branch. A rider already out on the verge there (`d` past the lanes by ON_VERGE_M) stays out.
 */
export function riderLimits(
  world: World,
  config: SimConfig,
  edge: number,
  s: number,
  d?: number,
): RideLimits {
  const lim = limitsAt(config, world.params, vergeState(world).brokenFences, edge, s, BIKE_HALF_WIDTH_M);
  if (lim.loEdge === 'hard' && lim.hiEdge === 'hard' && lim.loBandM === 0 && lim.hiBandM === 0) return lim;
  const lanes = barrierLimits(config, edge, s);
  const outRight = d !== undefined && d > lanes.hi + ON_VERGE_M;
  const outLeft = d !== undefined && d < lanes.lo - ON_VERGE_M;
  if (!outRight && lim.hi > lanes.hi && splitGuideAt(config, edge, s, 1, lanes.hi)) {
    lim.hi = lanes.hi;
    lim.hiEdge = 'hard';
    lim.hiBandM = 0;
    lim.hiTaper = false;
  }
  if (!outLeft && lim.lo < lanes.lo && splitGuideAt(config, edge, s, -1, lanes.lo)) {
    lim.lo = lanes.lo;
    lim.loEdge = 'hard';
    lim.loBandM = 0;
    lim.loTaper = false;
  }
  return lim;
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
  if (splitGuideAt(config, pos.edge, pos.s, side, limit) || stagingGuideAt(config, pos.edge)) {
    pos.d = limit;
    m.yaw = 0;
    st.touching[m.id] = 0;
    return;
  }
  if (side > 0 ? lim.hiTaper === true : lim.loTaper === true) {
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
  if (kind === 'hard' || kind === 'rail') wallOutcome(world, st, m, hit);
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
    /** A crash whatever the speed (a rider up on a ramp truck riding into its body). */
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
 * The ramp truck is solid (playtest 1b quick wins): a grounded rider whose deck height would jump by
 * more than a kerb in one tick rode into its side or front, not up its ramp. From the side it is
 * held beside the truck and scrapes, like the barrier rule; head on, it stops where it was and
 * takes the whole speed as the impact. Events carry `object: 'rampTruck'` and the truck's id.
 * Playtest 3: a moving deck (`decks`, sim/riders/features.ts) is a truck like any other, met where it
 * stands as this tick ends (`decks.next`); what a head-on hit carries is the speed relative to it.
 * Playtest 4: wobble or crash is the one rule for meeting a vehicle (sim/traffic/contact-rule.ts: that
 * closing speed against `traffic.solidHitMps`), except up on the deck into its body (always thrown).
 */
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
  const truck = rampTruckAt(config, pos.edge, pos.s, pos.d, decks.next);
  // Off the lip fast enough to clear the body, in the tick that crosses into it: a launch, not a
  // contact (the take-off rule below sends it airborne over the truck).
  const launch =
    !!truck &&
    before.deck > KERB_M &&
    truckBodyAt(config, pos.edge, pos.s, pos.d, decks.next) === truck &&
    clearsBody(truck, m.speed, pos.dir, GRAVITY * accelMultiplierOf(config));
  if (
    !truck ||
    launch ||
    deckHeight(config, pos.edge, pos.s, pos.d, { moving: decks.next }) - before.deck <= KERB_M
  ) {
    if (!launch && truckSideContact(world, config, st, m, before, dt, decks)) return;
    st.truckTouch[m.id] = 0;
    return;
  }
  const v = truckClosingMps(truck, m.speed, pos.dir);
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
  // Up on the truck (its ramp or lip platform) and into its body, the parked car: thrown off the
  // truck, a crash at any speed (the integration skeptic's F2: never stuck against it on the deck).
  const crash = before.deck > KERB_M;
  wallOutcome(world, st, m, { impact: v, v, yawBefore, side: 1, newContact, extra, crash, vehicle: true });
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
    const v = truckClosingMps(truck, m.speed, pos.dir);
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
}

/**
 * A grounded rider meeting something heavy and fixed (playtest 4, "solid but forgiving": a solid road
 * hazard, or a solid piece of street furniture), classed and decided exactly as a rider meeting a vehicle
 * is (sim/traffic, #552's one rule): the contact is the first moment the bike's capsule touches it along
 * the tick's move (sim/riders/furniture.ts); it is **end on** when the two were not side by side as the
 * move began (the bike's front met it), unless they overlap sideways by less than `GRAZE_M` (a **graze**:
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
  });
}

/**
 * How a contact met (`meetSolid`): `alongside` when the two were side by side as the move began (the
 * piece beside the straight of the bike's capsule, not ahead of its round front), `endOn` when the bike's
 * front met it squarely (not alongside, and overlapping sideways by `GRAZE_M` or more), and the axis its
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
  const endOn = !alongside && overD >= GRAZE_M;
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
  const all = solidHazardsNear(config, pos.edge, pos.s, CONTACT_REACH_M);
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
  const solid = near.filter((it) => it.cls === 'solid' && m.h <= it.heightM);
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
/**
 * A rider in the air meeting a solid hazard or a solid street piece below its top (`h` above the road):
 * the ground's rule (`meetSolid`), the closing speed along the contact's normal deciding. Returns true
 * when it crashed (the flight ends there); a glance pushes the rider off it and the flight goes on.
 */
function airSolids(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  before: { edge: number; s: number; d: number },
  h: number,
): boolean {
  const pos = m.pos;
  const move = moveOf(m, before);
  const hazards = solidHazardsNear(config, pos.edge, pos.s, CONTACT_REACH_M).filter(
    (p) => h < hazardTop(p.feature) && !isLightHazard(p.feature),
  );
  const pieces = furnitureOn(world.params)
    ? piecesNear(config, pos.edge, pos.s, CONTACT_REACH_M).filter(
        (it) => it.cls === 'solid' && h < it.heightM,
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
  // Playtest 3's moving decks: the trucks as this tick starts (`now`) for where the bike is, and one
  // step on (`next`) for where it goes, so the deck under it moves too.
  const decks = movingDecks(world, dt);
  const inside = fresh && m.h === 0 ? rampTruckAt(config, pos.edge, pos.s, pos.d, decks.now) : null;
  if (inside && deckHeight(config, pos.edge, pos.s, pos.d, { moving: decks.now }) > 0) {
    const out = Math.sign(inside.d1 - inside.d0) * TRUCK_STEP_OUT_M;
    pos.d = Math.abs(inside.d0) <= Math.abs(inside.d1) ? inside.d0 - out : inside.d1 + out;
  }
  const deckBefore = deckHeight(config, pos.edge, pos.s, pos.d, { moving: decks.now });
  const before = { edge: pos.edge, s: pos.s, d: pos.d, deck: deckBefore };
  const yBefore = road.surfaceHeight(pos.edge, pos.s, pos.d) + deckBefore;
  const vyBefore = fresh ? 0 : (st.vy[m.id] ?? 0);
  st.lastTick[m.id] = world.tick;
  // A U-turn (interview, 2026-10-02; playtest 4's own gesture, P4-9): a slow player who double-taps
  // the brake and then holds it with full lock pivots round (sim/riders/uturn.ts); null while riding
  // normally.
  const uturn = uturnStep(world, st, def, m, steer, brake, fresh, dt);
  // Playtest 3's moves: the wheelie (steering × steerScale, the front's pitch) and the drift
  // (steering × maxYawScale, a drag, the knee-down lean). Neutral while each is off.
  const wh = wheelieStep(world, config, st, m, input, brake, dt);
  const dr = driftStep(world, config, st, m, input, steer, throttle, brake, dt);

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
  // its grip the steering; 1 and 1 on the road, and with the off-road switch off.
  const feel = groundFeel(config, world.params, m);
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

  // Lateral: steering asks for a heading offset; the road turning under the bike pulls it.
  const authority = (wobble > 0 ? WOBBLE_STEER : 1) * feel.grip;
  const maxYaw = maxYawAt(bike.steerRateMps, m.speed, steerScale) * dr.maxYawScale * wh.steerScale;
  const slot = slotAssists(config, slotOf(def));
  const assist = assistYaw(config, m, slot.steer, maxYaw);
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
  const along = m.speed * cos(m.yaw) * sRateFactor(frameKappa, pos.d);
  const yawLimit = uturn ? Infinity : Math.max(1.2, Math.abs(m.yaw));
  m.yaw = clamp(m.yaw + (ownTurn - pos.dir * frameKappa * along) * dt, -yawLimit, yawLimit);
  pos.s += pos.dir * along * dt;
  pos.d += pos.dir * m.speed * sin(m.yaw) * dt;
  if (uturn) uturnSettle(st, m);
  m.h = 0;
  applyShove(config, st, m, dt);
  if (road.advance(pos) === 'deadEnd') m.speed = 0;
  const handed = crossToBranch(config, m);
  barrierContact(world, config, st, m, dt);
  truckContact(world, config, st, m, before, dt, decks);
  furnitureContact(world, config, st, m, before);
  if (hazardContact(world, config, st, m, before)) {
    // Launched off a parked car by a wheelie (playtest 3): its flight is already set up.
    st.throttle[m.id] = throttle;
    st.brake[m.id] = brake;
    gearAndRpm(st, m);
    return;
  }

  // Take-off: the surface fell away faster than gravity can follow (the ballistic height clears it).
  // The ground is the road, or a ramp truck's ramp or lip platform (never its body, which a grounded
  // rider is kept out of above): h is always the height above the road.
  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  const deck = deckHeight(config, pos.edge, pos.s, pos.d, { bodies: false, moving: decks.next });
  const ground = surface + deck;
  const ballistic = yBefore + vyBefore * dt - 0.5 * gravity * dt * dt;
  // Over a gap (playtest 3, sim/riders/gap.ts) there is no surface: the ground fell away.
  const overGap = gapUnder(world, config, m);
  const lip = overGap || ballistic > ground + TAKEOFF_CLEARANCE_M;
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
    if (dt > 0) st.vy[m.id] = handed ? vyBefore : (ground - yBefore) / dt;
    touchPads(world, config, st, m);
    groundPitch(st, m, slopeAt(config, m));
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
  const top = topSpeedOf(world, config, bike.topSpeedMps) * smokeScaleOf(world, st, m, def) + boostTop;
  const a = bike.accelMps2 * (world.params['riders.accelScale'] ?? 1) * m2;
  m.speed = Math.max(0, m.speed - ((a * m.speed * m.speed) / (top * top)) * dt);
  const kappa = road.kappaAt(pos.edge, pos.s);
  const ownTurn = steer * AIR_TURN_RATE;
  const along = m.speed * cos(m.yaw) * sRateFactor(kappa, pos.d);
  const airFrom = { edge: pos.edge, s: pos.s, d: pos.d };
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
  const over = overBarrier(world, config, st, m, y, limits, BIKE_HALF_WIDTH_M);
  if (over === 'barrier') barrierContact(world, config, st, m, dt);
  st.airTicks[m.id] = (st.airTicks[m.id] ?? 0) + world.timeScale;

  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  // A rider never lands on a ramp truck's body (the car on its top deck, the cab): fast enough off
  // the lip, it clears the truck; too slow, and below the body's top, it hits it (the integration
  // skeptic's F2: it used to land on a level deck inside that car).
  // Playtest 3: a moving deck is where its truck stands as the tick ends (`next`), and the speed to
  // clear its body is over the truck, not over the road.
  const decks = movingDecks(world, dt);
  const body = truckBodyAt(config, pos.edge, pos.s, pos.d, decks.next);
  if (body && y - surface < truckBodyTop(body) && !clearsBody(body, m.speed, pos.dir, gravity)) {
    m.h = Math.max(0, y - surface);
    st.yAbs[m.id] = y;
    st.wobble[m.id] = 0;
    const impact = truckClosingMps(body, m.speed, pos.dir);
    const data = { cause: 'barrier', speed: m.speed, impactMps: impact, yaw: m.yaw, side: 1 };
    emit(world, 'crash', m.id, { ...data, object: 'rampTruck', feature: body.id });
    return;
  }
  // A solid hazard (run W-U) or a solid piece of street furniture stands up from the road: flying into it
  // below its top is met by the same rule as on the ground (playtest 4: by the closing speed along the
  // contact's normal; it was a crash whatever the speed). A crash ends the flight here.
  if (airSolids(world, config, st, m, airFrom, y - surface)) {
    m.h = Math.max(0, y - surface);
    st.yAbs[m.id] = y;
    return;
  }
  const deck = deckHeight(config, pos.edge, pos.s, pos.d, { bodies: false, moving: decks.next });
  // Air control and flips (playtest 2): the bike's pitch, and the lean the steering asks for. The
  // time to the ground is forecast over the ground's current slope, so a held brake or kick never
  // turns the bike past where it can right itself before touch-down.
  const groundRate = road.frameAt(pos.edge, pos.s).grade * pos.dir * along;
  const tGround = timeToGround(y - (surface + deck), (st.vy[m.id] ?? 0) - groundRate, gravity);
  const airS = (st.airTicks[m.id] ?? 0) / 60;
  const leanTarget = stepAttitude(world, config, st, m, def, input, steer, dt, tGround, airS);
  // Over a gap (playtest 3, sim/riders/gap.ts) there is nothing to land on: the rider falls on, and
  // past the gap's kill depth it goes overboard. So out past the road's edge (over the barrier): its
  // road's plane does not go on out there, and the gap's own rule wins over one (its respawn).
  const overGap = gapUnder(world, config, m);
  const pastEdge = over !== 'barrier' && overMarkOf(st, m.id) !== null;
  if (!overGap && !pastEdge && y - (surface + deck) <= 0) land(world, config, st, m, surface, deck);
  else {
    m.h = y - surface;
    st.yAbs[m.id] = y;
    if (overGap) gapFall(world, config, st, m, y - (surface + deck));
    else if (over === 'past') overFall(world, config, st, m, y);
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
    // Off a hood launch (playtest 3): sim/race scores its trick × race.styleHoodScale.
    ...(td.hood ? { hood: true } : {}),
  };
  // Air that pays: a clean landing after real air spits the bike forward (rivals too).
  const surge = quality === 'clean' ? landingSurge(world, config, st, m, airTicks) : 0;
  const cause = emit(world, 'land', m.id, surge > 0 ? { ...data, surge: true, surgeS: surge } : data);
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
  for (const o of world.movers) {
    if (o.id === m.id || o.kind !== 'rider' || o.mode !== 'Road' || o.pos.edge !== m.pos.edge) continue;
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

/** The touch-down forecast marches the flight in steps this long, s, for at most FORECAST_MAX_S. */
const FORECAST_STEP_S = 1 / 30;
const FORECAST_MAX_S = 4;

/**
 * Where a player's rider in the air will touch down (the pitch deck's #13: the chalk mark), for the
 * snapshot: the flight marched on at its speed and heading under gravity, over the road's real
 * surface (a ramp's far side, a dip), until it meets the ground; its sideways drift eased as
 * `riders.airAlign` lines the bike up. `crooked` when landing as the bike is now would wobble or
 * worse: sideways, off the slope, leaned over, or still holding the newspaper. Null on the ground
 * and for riders no player drives. Presentation only: it reads the state, it never writes it.
 */
export function touchdownOf(world: World, config: SimConfig, m: Mover): TouchdownSnapshot | null {
  const def = config.riders[m.riderIndex];
  if (m.kind !== 'rider' || m.mode !== 'Airborne' || !def || def.controller.kind !== 'player') return null;
  const st = riderState(world);
  const road = config.road;
  const pos = m.pos;
  const gravity = GRAVITY * accelMultiplierOf(config);
  const align = world.params['riders.airAlign'] ?? 0;
  const at = { edge: pos.edge, s: pos.s, d: pos.d, dir: pos.dir };
  let y = st.yAbs[m.id] ?? road.surfaceHeight(pos.edge, pos.s, pos.d);
  let vy = st.vy[m.id] ?? 0;
  let yaw = m.yaw;
  let v = m.speed;
  // The air drag the flight itself feels (stepAirborne): the bike slows toward its top speed's drag.
  const boostTop = (st.boost[m.id] ?? 0) > 0 ? (st.boostMps[m.id] ?? 0) * speedMultiplierOf(config) : 0;
  const top = topSpeedOf(world, config, def.bike.topSpeedMps) * smokeScaleOf(world, st, m, def) + boostTop;
  const drag =
    top > 0
      ? (def.bike.accelMps2 * (world.params['riders.accelScale'] ?? 1) * accelMultiplierOf(config)) /
        (top * top)
      : 0;
  let t = 0;
  const dt = FORECAST_STEP_S;
  for (; t < FORECAST_MAX_S; t += dt) {
    v = Math.max(0, v - drag * v * v * dt);
    const along = v * cos(yaw) * sRateFactor(road.kappaAt(at.edge, at.s), at.d);
    const prev = { edge: at.edge, s: at.s, d: at.d, gap: y - road.surfaceHeight(at.edge, at.s, at.d) };
    at.s += at.dir * along * dt;
    at.d += at.dir * v * sin(yaw) * dt;
    yaw -= align * yaw * dt;
    y += vy * dt - 0.5 * gravity * dt * dt;
    vy -= gravity * dt;
    if (road.advance(at) === 'deadEnd') break;
    const gap = y - road.surfaceHeight(at.edge, at.s, at.d);
    if (gap <= 0) {
      // Back to where the flight crossed the ground, between the two steps.
      const k = prev.gap > 0 ? prev.gap / (prev.gap - gap) : 1;
      if (prev.edge === at.edge) {
        at.s = prev.s + (at.s - prev.s) * k;
        at.d = prev.d + (at.d - prev.d) * k;
      }
      t += dt * k;
      break;
    }
  }
  const p = road.toWorld(at.edge, at.s, at.d, 0);
  const f = road.frameAt(at.edge, at.s);
  const tx = f.tx * at.dir;
  const tz = f.tz * at.dir;
  const fx = cos(yaw) * tx - sin(yaw) * tz;
  const fz = cos(yaw) * tz + sin(yaw) * tx;
  const lateral = Math.abs(v * sin(yaw));
  const crashAt = world.params['riders.landingCrashMps'] ?? 4;
  const td = touchdown(st, m, slopeAt(config, m));
  const crooked =
    holdingPaper(st, m.id) || td.crashes || td.wobbles || lateral >= crashAt * LANDING_WOBBLE_FRACTION;
  return { x: p.x, y: p.y, z: p.z, heading: atan2(-fx, -fz), inS: t, crooked };
}

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
      st.hazardTouch[m.id] = 0;
      st.furnTouch[m.id] = 0;
      st.lightTouch[m.id] = 0;
      st.uturn[m.id] = 0;
      uturnForget(st, m.id);
      startFlight(st, m, undefined, slopeAt(config, m));
    }
  },
  step(world: World, config: SimConfig) {
    const st = riderState(world);
    for (const m of world.movers) {
      if (m.kind !== 'rider' || m.riderIndex < 0) continue;
      if (m.mode === 'Road') stepGrounded(world, config, st, m);
      else {
        if (m.mode === 'Airborne') stepAirborne(world, config, st, m);
        // Not riding: a crash last tick loses the drift chain now (it is stepped only on the road).
        driftDown(world, st, m);
      }
      // Out of the air (down in a crash, back on a road), it is no longer out past an edge.
      if (m.mode !== 'Airborne') clearOver(st, m.id);
    }
    // Bumps stop where riding does (the verge's edge with off-road on), never back on the road.
    riderContacts(world, config, st, {
      wobbleTicks: WOBBLE_TICKS,
      limits: (c, edge, s, d) => riderLimits(world, c, edge, s, d),
    });
  },
};
