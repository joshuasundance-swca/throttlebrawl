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
import { atan2, clamp, cos, sin, type TuningParamDecl, type VergeEdge } from '../../core';
import { courseEdgeTopAt, edgeTopAt, sRateFactor, type Structure } from '../../road';
import type { RideLimits } from '../ground';
import type { TumbleState } from '../tumble';
import type { MovesSnapshot, SimConfig, SimRiderDef, TouchdownSnapshot } from '../types';
import { AIR_TUNING, holdingPaper, slopeAt, startFlight, touchdown, type AirState } from './air';
import { RIDER_BODY_HEIGHT_M } from './contact';
import { COURSE_TUNING, courseEdgesOn, groundEdgeOpen, roadPastLine } from './course';
import { driftMoves, DRIFT_TUNING, newDriftState, type DriftState } from './drift';
import { FUNNEL_TUNING } from './funnel';
import { FURNITURE_TUNING } from './furniture';
import { smokeTopScale, SMOKE_TUNING } from './smoke';
import { deckHeight, KERB_M, movingDecks, NO_DECKS, stagingGuideAt } from './features';
import {
  GAP_TUNING,
  handYaw,
  newGapState,
  overFalls,
  overMarkOf,
  overStep,
  roadUnder,
  type GapState,
  type OverMark,
} from './gap';
import { supportAt, supportKindOf, supportsOn, SUPPORTS_TUNING } from './supports';
import { plannedFrontAt, racePlanOf, structuresOver, STRUCTURES_TUNING, topNear } from './structures';
import { uturnForget, UTURN_TUNING, type UturnState } from './uturn';
import { limitsAt, brokenFencesOf, vergeState } from './verge';
import { speedMultiplierOf, systemState, type Mover, type SimSystem, type World } from '../world';
import { newWheelieState, wheelieMoves, WHEELIE_TUNING, type WheelieState } from './wheelie';
import { lateSteps } from '../late';

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
  // Landing on and riding solid tops (the maintainer, 2026-10-06; sim/riders/supports.ts).
  ...SUPPORTS_TUNING,
  // The structures plan is solid, its roofs ground (the maintainer, 2026-10-06; sim/riders/structures.ts).
  ...STRUCTURES_TUNING,
  // The course's honest edges: past it is a reset, never an invisible wall (2026-10-06; sim/riders/course.ts).
  ...COURSE_TUNING,
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
   * Whose dropped bike the rider touched last tick, that rider's id + 1 (0 for none; pile-ups, the
   * maintainer, 2026-10-06), so one contact emits one event. Made at the first contact, so a race with
   * no pile-up rule hashes as before.
   */
  bikeTouch?: number[];
  /**
   * 1 from a landing until the rider rides clear of a crest that would launch him, so one crest is
   * one jump: coming down on the same crest's far side never bounces him straight back up.
   */
  crestHold: number[];
}
/** m/s² when off the throttle, before air drag. */
export const COAST_DECEL = 0.6;
export const GRAVITY = 9.81;
/**
 * 1/s: how fast the bike reaches the steered heading (Arcade). The Free steering style turns the
 * bike at this same first rate, the stick's heading × YAW_RESPONSE, with nothing turning it back.
 */
export const YAW_RESPONSE = 4;
/** rad: the largest heading offset steering can ask for. */
const MAX_YAW = 0.5;
/** Half the bike's width: the rider's centre stays this far inside the barrier. */
export const BIKE_HALF_WIDTH_M = 0.5;
/** How long a wobble lasts, in ticks at timeScale 1 (0.6 s). */
export const WOBBLE_TICKS = 36;
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
/** A landing wobbles from this fraction of the landing crash sideways speed. [default] */
export const LANDING_WOBBLE_FRACTION = 0.3;
/**
 * The lowest overall-speed multiplier the settings offer [default]. The sim accepts anything in
 * (0, 1]; this is the value the ramp shortcut and jumps are tested at.
 */
export const SPEED_MULTIPLIER_MIN = 0.6;

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
 * Whether a racer is off the course's roads for the race's progress (the maintainer, 2026-10-06, [decided]: "a
 * corner cut across the roofs or a lot counts if the rider rejoins the course ahead"; sim/riders/course.ts):
 * out past its road's edge in the air, up on a structure's top past its band, or down past the edge (a fall
 * over the barrier or out of bounds, until the respawn). sim/race keeps its progress where it left, and takes
 * it again where it rejoins, so a cut counts by where it comes back (behind is no gain), and a respawn at the
 * crossing gains nothing. Off with the course's edges off. Reads only.
 */
export function offCourse(world: World, config: SimConfig, m: Mover): boolean {
  if (m.kind !== 'rider' || !courseEdgesOn(world.params)) return false;
  const st = world.systems['riders'] as RiderState | undefined;
  if (st !== undefined && overMarkOf(st, m.id) !== null) return true;
  const crash = (world.systems['tumble'] as Pick<TumbleState, 'records'> | undefined)?.records[m.id];
  if (crash && crash.over !== undefined && crash.overboard >= 0) return true;
  if (supportKindOf(world, m.id) !== 'structure') return false;
  const road = config.road;
  const pos = m.pos;
  return (
    pos.d < road.vergeAt(pos.edge, pos.s, 'left').dOuter ||
    pos.d > road.vergeAt(pos.edge, pos.s, 'right').dOuter
  );
}

/**
 * Whether a rider is out past its road's edge in the air (over the barrier, sim/riders/gap.ts), or up on
 * a structure's top (sim/riders/structures.ts), where its band's edge does not hold it: no edge holds it
 * there, so combat's shove and the riders' bumps do not snap it back onto the road.
 */
export function outPastEdge(world: World, id: number): boolean {
  const st = world.systems['riders'] as RiderState | undefined;
  if (st !== undefined && overMarkOf(st, id) !== null) return true;
  return supportKindOf(world, id) === 'structure';
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

/**
 * The fastest a bike holds a bend of curvature `kappa` (1/m) on its line, m/s: where the turn its
 * steering can ask for (maxYawAt, reached at YAW_RESPONSE) still matches the road turning under it
 * (`kappa` × speed). Faster, the bend carries it wide. Infinity on a straight.
 */
export function holdSpeedMps(steerRateMps: number, kappa: number, steerScale: number): number {
  const k = Math.abs(kappa);
  if (k < 1e-6) return Infinity;
  return Math.min(
    Math.sqrt((YAW_RESPONSE * steerRateMps * steerScale) / k),
    (YAW_RESPONSE * MAX_YAW * steerScale) / k,
  );
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
export function smokeScaleOf(world: World, st: RiderState, m: Mover, def: SimRiderDef): number {
  return smokeTopScale(
    world.params['riders.smokeSlowdown'] ?? 0,
    st.health[m.id] ?? def.healthMax,
    def.healthMax,
  );
}

/** What the lower overall speed does to accelerations and gravity: m², so paths keep their shape. */
export function accelMultiplierOf(config: SimConfig): number {
  const m = speedMultiplierOf(config);
  return m * m;
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
  reading = false,
): RideLimits {
  // A reader (the snapshot's forecasts) never creates the verge state: it may be absent, no fence broken.
  const fences = reading ? brokenFencesOf(world) : vergeState(world).brokenFences;
  const lim = limitsAt(config, world.params, fences, edge, s, BIKE_HALF_WIDTH_M);
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
 * What a band's edge does to a rider on the ground who reaches his riding limit there (`lim`, on his `side`,
 * his feet at world height `feet`): the barrier rule's one decision (`barrierContact`), and what the test that
 * holds every edge to what is drawn reads (`edgeHoldAt`):
 * - `guide`: a split's guide span or a staging road's edge turns him along it, no event, no speed lost;
 * - `taper`: a bridge's taper eases him in along it onto the deck;
 * - `open`: nothing is drawn there, under the course's honest edges (sim/riders/course.ts `groundEdgeOpen`): soft
 *   ground running on, a hard edge nothing names with ground past it, or a building front whose buildings are in
 *   the structures plan where none of them stands at him (a gap in the row: an alley, a lot);
 * - `held`: what is drawn there holds him (a barrier, the water, the ferns, a fence, a building, a deck's edge).
 */
type EdgeHold = 'guide' | 'taper' | 'open' | 'held';

export function edgeHold(
  world: World,
  config: SimConfig,
  at: { readonly edge: number; readonly s: number },
  side: 1 | -1,
  lim: RideLimits,
  feet: number,
): EdgeHold {
  const limit = side > 0 ? lim.hi : lim.lo;
  if (splitGuideAt(config, at.edge, at.s, side, limit) || stagingGuideAt(config, at.edge)) return 'guide';
  if (side > 0 ? lim.hiTaper === true : lim.loTaper === true) return 'taper';
  if (!courseEdgesOn(world.params)) return 'held';
  const kind = side > 0 ? lim.hiEdge : lim.loEdge;
  const vside = side > 0 ? 'right' : 'left';
  if (groundEdgeOpen(config.road, at.edge, at.s, vside, kind)) return 'open';
  // Another road's lanes just past the line (a junction, a split's branches): nothing stands in them.
  if (roadPastLine(config, at.edge, at.s, side, kind)) return 'open';
  const gap =
    kind === 'hard' &&
    racePlanOf(world, config) !== null &&
    plannedFrontAt(config.road, at.edge, at.s, vside) &&
    frontStructure(world, config, at, feet, side, limit) === null;
  return gap ? 'open' : 'held';
}

/**
 * What one side's band edge at (edge, s) does to a rider on the ground who rides out to it from the road, his
 * feet on the road there (`edgeHold`), with its kind and riding limit, and how high over the deck a rider in the
 * air must be to clear it there (`airTop`, the over-the-barrier rule's `edgeTopOf`; null where the band's own
 * rules hold, at any height, as under the old rules at a ground edge). Reads only (it never makes the verge
 * state): tests/sim/no-invisible-walls.test.ts walks every edge of every network with it.
 */
export function edgeHoldAt(
  world: World,
  config: SimConfig,
  edge: number,
  s: number,
  side: 1 | -1,
): { hold: EdgeHold; kind: VergeEdge; limit: number; airTop: number | null } {
  const lim = riderLimits(world, config, edge, s, undefined, true);
  const limit = side > 0 ? lim.hi : lim.lo;
  const feet = config.road.surfaceHeight(edge, s, limit);
  return {
    hold: edgeHold(world, config, { edge, s }, side, lim, feet),
    kind: side > 0 ? lim.hiEdge : lim.loEdge,
    limit,
    airTop: edgeTopOf(world, config)(edge, s, side > 0 ? 'right' : 'left'),
  };
}

/** How far past a building front's band edge its building is looked for, m (Old Town's fronts stand 0.3 m back). */
const FRONT_PROBE_M = [0.05, 0.3, 0.6] as const;

/**
 * Whether a structure is a wall to a rider whose feet are at world height `feet` near (x, z): its top there
 * is more than a kerb over his feet (less is a step he rides onto) and its underside is below his head (a
 * lintel, a balcony or a deck over him is passed under).
 */
export function wallTo(s: Structure, x: number, z: number, feet: number): boolean {
  return topNear(s, x, z) > feet + KERB_M && s.baseY < feet + RIDER_BODY_HEIGHT_M;
}

/**
 * The building standing at a building front's band edge where a rider is held at it (sim/riders/structures.ts):
 * a structure just past the edge's line whose walls reach the rider, on a front whose buildings are in the plan;
 * null where none stands (a gap in the frontage: the band's edge holds him as ever) or with the switch off.
 */
export function frontStructure(
  world: World,
  config: SimConfig,
  pos: { readonly edge: number; readonly s: number },
  feet: number,
  side: 1 | -1,
  limit: number,
): Structure | null {
  const plan = racePlanOf(world, config);
  if (!plan) return null;
  const road = config.road;
  if (!plannedFrontAt(road, pos.edge, pos.s, side > 0 ? 'right' : 'left')) return null;
  for (const k of FRONT_PROBE_M) {
    const p = road.toWorld(pos.edge, pos.s, limit + side * (BIKE_HALF_WIDTH_M + k), 0);
    for (const s of structuresOver(plan, p.x, p.z)) if (wallTo(s, p.x, p.z, feet)) return s;
  }
  return null;
}

/**
 * What stands at a band's edge, to the over-the-barrier rule (sim/riders/gap.ts `overStep`; road/beyond.ts
 * `edgeTopAt`), for the flight and its forecasts alike: a building front whose buildings are in the
 * structures plan is no wall at any height up here (0): the buildings themselves are (their walls to the
 * roofline, their roofs to land on), and a gap between them is open (sim/riders/structures.ts). Their roofs
 * are ground only with the supports on: without them, the old wall stands.
 */
export function edgeTopOf(
  world: World,
  config: SimConfig,
): (edge: number, s: number, side: 'left' | 'right') => number | null {
  const road = config.road;
  const fronts = racePlanOf(world, config) !== null && supportsOn(world);
  // The course's honest edges (sim/riders/course.ts): every edge is cleared above what is drawn there (the
  // ferns, a fence; nothing at a soft edge or a deck's bare edge), never held at any height by nothing.
  const course = courseEdgesOn(world.params);
  const top = course ? courseEdgeTopAt : edgeTopAt;
  return (edge, s, side) => {
    if (fronts && plannedFrontAt(road, edge, s, side)) return 0;
    // Another road's lanes just past the edge (sim/riders/course.ts `roadPastLine`): nothing stands there.
    const sign = side === 'right' ? 1 : -1;
    if (course && roadPastLine(config, edge, s, sign, road.vergeAt(edge, s, side).edge)) return 0;
    return top(road, edge, s, side);
  };
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
 * Supports (sim/riders/supports.ts): a top the flight comes down onto first (a truck's roof where its
 * velocity takes it by then, a parked pickup) is where the mark goes, at the top's height.
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
  let onTop = 0;
  const dt = FORECAST_STEP_S;
  const tops = supportsOn(world);
  const decks = tops ? movingDecks(world, world.timeScale / 60) : NO_DECKS;
  // Over the barrier (2026-10-06, sim/riders/gap.ts): the flight meets the edge by the same rule the
  // rider does (`overStep`, on its own copy of the mark), so a flight past a rail that ends in the water
  // has no mark (there is no landing to aim at), and one that comes down on another road, or at the
  // edge of ground past it, has its mark there.
  const limits = (edge: number, s: number, d: number) => riderLimits(world, config, edge, s, d, true);
  const edgeTop = edgeTopOf(world, config);
  const groundOut = courseEdgesOn(world.params);
  let mark: OverMark | null = overMarkOf(st, m.id);
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
    const step = overStep(config, at, y, mark, limits, BIKE_HALF_WIDTH_M, edgeTop, groundOut);
    mark = step.mark;
    if (step.setD !== undefined) at.d = step.setD;
    if (step.hand) {
      yaw = handYaw(road, at, step.hand, yaw);
      at.edge = step.hand.edge;
      at.s = step.hand.s;
      at.d = step.hand.d;
      at.dir = step.hand.dir;
    }
    const pastEdge = mark !== null && step.result === 'past';
    // Out past the edge over water or a drop (or ground, with the course's edges on), and it falls: out of
    // bounds, not a landing.
    if (pastEdge && mark && overFalls(mark, y, groundOut)) return null;
    // Below the barrier's top (or at a ground edge): it holds the flight at its limit.
    if (step.holdD !== undefined) at.d = step.holdD;
    const gap = y - road.surfaceHeight(at.edge, at.s, at.d);
    const here = { edge: at.edge, s: at.s, d: at.d, ahead: t + dt };
    const sup = tops
      ? supportAt(world, config, m, here, decks, (h) => prev.gap >= h - 1e-6 && gap <= h)
      : null;
    if (sup) {
      // Onto a top: back to where the flight came down through its height.
      const k = prev.gap > sup.top ? (prev.gap - sup.top) / (prev.gap - gap) : 1;
      if (prev.edge === at.edge) {
        at.s = prev.s + (at.s - prev.s) * k;
        at.d = prev.d + (at.d - prev.d) * k;
      }
      t += dt * k;
      onTop = sup.top;
      break;
    }
    // Out past the edge its road's plane does not go on: only a road under it, or the ground's
    // edge (put back at the limit above), ends the flight there.
    if (gap <= 0 && !pastEdge) {
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
  const p = road.toWorld(at.edge, at.s, at.d, onTop);
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

/**
 * What lies straight below a rider in the air, as a world height (`EntitySnapshot.floorY`; the maintainer,
 * 2026-10-06: "consistent physics and gameplay is important here so players know what to expect"): the
 * shadow falls there and the camera judges its height over it. The top of a support the rider is above
 * (a truck's roof, a parked pickup; sim/riders/supports.ts) or a ramp truck's deck, else the road's
 * surface; out past the edge of its road (over the barrier, sim/riders/gap.ts) another road under it
 * (the old Seven Mile Bridge), else the water or the drop's floor, or the band's edge where ground lies
 * past it. Null for anyone not in the air. Presentation only: it reads the state, it never writes it.
 */
export function floorOf(world: World, config: SimConfig, m: Mover): number | null {
  if (m.kind !== 'rider' || m.mode !== 'Airborne') return null;
  const st = riderState(world);
  const road = config.road;
  const pos = m.pos;
  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  const y = st.yAbs[m.id] ?? surface + m.h;
  const tops = supportsOn(world);
  const decks = tops ? movingDecks(world, world.timeScale / 60) : NO_DECKS;
  const up = y - surface;
  const on = tops
    ? supportAt(
        world,
        config,
        m,
        { edge: pos.edge, s: pos.s, d: pos.d, ahead: 0 },
        decks,
        (h) => h <= up + 1e-6,
      )
    : null;
  const mark = overMarkOf(st, m.id);
  if (mark) {
    // Out past the edge: a structure's top under it (a roof past the sidewalk) first.
    if (on) return surface + on.top;
    const limits = (edge: number, s: number, d: number) => riderLimits(world, config, edge, s, d, true);
    const to = roadUnder(config, pos, y, limits);
    if (to) return road.surfaceHeight(to.edge, to.s, to.d);
    // The ground the scene draws there (with the course's edges on), else the old rules' band edge.
    return mark.past === 'ground' && !courseEdgesOn(world.params)
      ? road.surfaceHeight(pos.edge, pos.s, mark.d)
      : mark.floorY;
  }
  const ramp = deckHeight(config, pos.edge, pos.s, pos.d, { bodies: false, moving: decks.now });
  return surface + Math.max(0, ramp, on ? on.top : 0);
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
  // The step is in ./step.ts, a lazy chunk the race waits for (src/sim/late.ts).
  step: (world, config) => lateSteps().ridersStep(world, config),
};
