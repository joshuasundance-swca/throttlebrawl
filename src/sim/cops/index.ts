// sim/cops: one cop who chases, can be hit like any rider, and busts a downed player
// (docs/milestones/M1.md, cops-1). The cop is an ordinary rider with the `law` faction and a `cop`
// controller: this system is his AIController. It runs in the cops phase, after riders and
// combat, so the command it writes takes effect on the next tick; the controllers phase skips him.
//
// - Parked: he waits at the route's first `copSpawn` feature (the lot beside the road), on the
//   shoulder at the lot's road edge, until `cops.spawnDelayS` (÷ difficulty.copFrequency) has
//   passed, then pulls out after you. "Slow to start a chase, then relentless." A route with no
//   `copSpawn` leaves him on sim/race's grid slot behind the field.
// - Difficulty (M2, cops-2): whether he comes out at all is rolled once per race from the `cops`
//   stream, with chance `cops.spawnChance` × difficulty.copFrequency (at most 1, so Normal always
//   fields him and Easy about half the time); one who stays in the lot stays parked and silent.
//   His siren sounds `cops.sirenLeadS` before he pulls out, and he cannot bust anyone during that
//   lead, so you hear him before he can reach you (the lead holds even when the delay is shorter).
// - Chase: he targets the nearest player, or whoever caused chaos (a hit or kick) near him in the
//   last 10 s. While the target rides he closes to `cops.followGapM` behind and holds there, so
//   he does not shadow every crash; after 8 s on station he moves in alongside for 6 s (inside
//   punch and kick reach, so he can be knocked down), then drops back. Once the target is down he
//   pulls up beside him.
// - He never stands still in a travel lane except beside his target (pulled up by a downed one,
//   or alongside one who has stopped) or with the man he busted:
//   traffic follows riders in its lane and never passes one, so a cop parked in the lane jams the
//   road (the M1 skeptic's seed 37). Ahead of his target, or with nobody to chase, he eases onto
//   his side's shoulder, holding at least CRAWL_MPS until he is clear of the lane, and waits there.
// - Bust: a player who is down (Tumble or OnFoot) within `law.bustRadiusM` × `cops.bustRadiusScale`
//   of an upright, spawned cop for `law.bustDwellS` × `cops.bustDwellScale` of scaled time is
//   busted: a `bust` event with the fine, once per player. Race end on a bust is sim/race's.
//
// The law (docs/milestones/M4.md, cops-3; a head start, crude first):
// - The spawn mix, from the event's `cops` block (SimEventDef.cops). With none, every fielded cop
//   rolls to come out as above (the M2 rule, unchanged). With one, the mode says how many of the
//   fielded cops leave the lot at the start of the chase: `every-race` brings `baseCount`,
//   `tier-rising` brings `baseCount` + `tierScale` × (tier − 1), `chaos-summoned` brings
//   `baseCount` (usually 0) and leans on chaos, and `none` brings nobody, chaos or not. Each one
//   still rolls the spawn chance. They pull out `cops.waveGapS` apart, and `randomness` jitters
//   the count and the gaps (all drawn from the `cops` stream at the start).
// - The hidden chaos meter (with `chaosSummon`, or in `chaos-summoned`): hits involving a player
//   add 1 (2 more on a cop), a player's takedown adds 3, and it drains `cops.chaosDecayPerS` a
//   second. At `cops.chaosSummonAt` (jittered by `randomness`) the next cop still in the lot is
//   summoned: his siren sounds at once and he pulls out after the siren lead. The siren event
//   carries `cause` (`every-race`, `tier-rising` or `chaos`) when the event has a `cops` block.
// - At most `cops.maxActive` cops chase at once (the plan's "at most 2 on screen"); the next one
//   waits in the lot, siren off, until a chase ends.
// - Fines: a bust's `fineCash` is the cop's fineCash × (1 + (tier − 1) × cops.fineTierScale),
//   rounded; the event also carries `tier` and `fineBaseCash`. There is no career cash yet: the
//   amount travels in the event (and so in the debug report) for career-1 to charge.
// - A cop holding a weapon (his startingWeapon: Pruitt's baton, a trooper's taser) swings it at
//   the man he chases when he is within its reach, at most every `cops.swingEveryS`, so the M1
//   steal can take it off him mid-swing. An unarmed cop never attacks, as before. He keeps his
//   weapon through a wreck (sim/combat), and moving in alongside he stays level with a target who
//   dabs the brakes (ALONGSIDE_BRAKE_SHARE), so his swings, and your steal chances, come in a
//   normal race (the cops polish round, 2026-10-01).
//
// Every timer advances by world.timeScale per tick (M1 cross-lane rule), so a hit-stop freezes
// them and M2's slow motion stretches them. All state is plain data keyed by entity id.
import { clamp, nextFloat, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadPos } from '../../road';
import { combatState, relative } from '../combat';
import { barrierLimits, maxYawAt } from '../riders';
import { InputFlag, type SimConfig, type SimRiderDef } from '../types';
import { emit, speedMultiplierOf, systemState, type Mover, type SimSystem, type World } from '../world';

export const COPS_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'cops.spawnDelayS',
    group: 'cops',
    label: 'Cop spawn delay',
    default: 20,
    min: 0,
    max: 120,
    step: 1,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'cops.spawnChance',
    group: 'cops',
    label: 'Cop spawn chance (× cop frequency)',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: true,
  },
  {
    id: 'cops.sirenLeadS',
    group: 'cops',
    label: 'Siren before the cop pulls out',
    default: 3,
    min: 0,
    max: 10,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'cops.followGapM',
    group: 'cops',
    label: 'Cop follow gap',
    default: 40,
    min: 15,
    max: 150,
    step: 5,
    unit: 'm',
    affectsSim: true,
  },
  {
    // Playtest 1c: how much of the racers' launch punch (riders.launchGain) the cop gets. 0 keeps
    // his old launch (playtest 1 item 7: cop difficulty stays as it is); 1 is the racers' punch,
    // safe since his follow keeps a stopping distance (the integration round). [default] 0.
    id: 'cops.launchShare',
    group: 'cops',
    label: 'Cop launch punch',
    default: 0,
    min: 0,
    max: 1,
    step: 0.25,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'cops.bustRadiusScale',
    group: 'cops',
    label: 'Bust radius',
    default: 1,
    min: 0.25,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'cops.bustDwellScale',
    group: 'cops',
    label: 'Bust dwell',
    default: 1,
    min: 0.25,
    max: 4,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'cops.waveGapS',
    group: 'cops',
    label: 'Gap between cops pulling out',
    default: 8,
    min: 0,
    max: 60,
    step: 1,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'cops.maxActive',
    group: 'cops',
    label: 'Most cops chasing at once',
    default: 2,
    min: 1,
    max: 6,
    step: 1,
    unit: '',
    affectsSim: true,
  },
  {
    id: 'cops.chaosSummonAt',
    group: 'cops',
    label: 'Chaos to summon a cop',
    default: 10,
    min: 1,
    max: 50,
    step: 1,
    unit: 'pts',
    affectsSim: true,
  },
  {
    id: 'cops.chaosDecayPerS',
    group: 'cops',
    label: 'Chaos cool-off',
    default: 0.1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'pts/s',
    affectsSim: true,
  },
  {
    id: 'cops.fineTierScale',
    group: 'cops',
    label: 'Fine growth per tier',
    default: 0.5,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'cops.swingEveryS',
    group: 'cops',
    label: 'Cop swings at most every',
    default: 6,
    min: 0.5,
    max: 15,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
];

/** Chaos points (cops-3's hidden meter): a hit with a player in it, one on a cop, a player's takedown. */
export const CHAOS_HIT = 1;
export const CHAOS_HIT_COP = 2;
export const CHAOS_TAKEDOWN = 3;
/** How far behind the lot each further cop parks, m (so the lot does not stack them). */
const PARK_GAP_M = 8;

/** Cop phases, stored as numbers so the state stays plain data. */
export const COP_PARKED = 0;
export const COP_CHASING = 1;
/** The chase is over: he busted someone, or nobody is left to chase. */
export const COP_DONE = 2;

/** A hit or kick within this distance of a cop makes its attacker his target. */
export const CHAOS_RADIUS_M = 60;
/** How long he keeps after a chaos-maker, in ticks at timeScale 1. */
export const CHAOS_MEMORY_TICKS = 600;
/** Where he pulls up behind a downed target (well inside the bust radius). */
const PULL_UP_GAP_M = 6;
/**
 * He never rides faster than lets him stop this far behind where his target could stop if it braked
 * as hard as its bike can, braking at STOP_BRAKE_SHARE of his own bike's brakes [default] (the
 * integration skeptic and the road lane's launch report, playtest 1c: with the launch punch he caught
 * up from the lot, and a player who braked hard had him sail past at every brake time from 8 to
 * 25 s, then crawl on along the shoulder).
 */
const STOP_BEHIND_M = 8;
const STOP_BRAKE_SHARE = 0.8;
/**
 * Moving in alongside, he keeps braking room for his full brakes, so beside a target who dabs the
 * brakes (riding in traffic) he stays level, inside his weapon's reach, where his swing (and your
 * steal) can happen. At STOP_BRAKE_SHARE he dropped about a stopping distance back at every dab
 * (some 6 m at 25 m/s, out of the baton's 1.5 m reach), so an armed cop hardly ever swung: the
 * integration skeptic's F2, "steal chances are rare". Carried past a hard stop, he still ends the
 * move-in and waits on the shoulder (below). [default] (the cops polish round, 2026-10-01)
 */
const ALONGSIDE_BRAKE_SHARE = 1;
/** Hanging back: no further back than the follow gap plus this counts as on station. */
const STATION_M = 10;
/** Scaled ticks on station before he moves in (8 s), and how long he then stays alongside (6 s). */
export const HANG_BACK_TICKS = 480;
export const MOVE_IN_TICKS = 360;
/** Moving in, he rides this far to the side of his target: inside punch and kick reach. */
const ALONGSIDE_D_M = 1.2;
/** Within this along the road counts as alongside (the auto-target box is 4 m). */
const ALONGSIDE_S_M = 3;
const COAST_DECEL = 0.6; // m/s², the riding model's off-throttle deceleration
/** Slowest he rides while any part of him is still in a travel lane (unless his target is down). */
export const CRAWL_MPS = 4;
/** Clear of the lane: his centre at least this far outside the drive lane's edge. */
const CLEAR_OF_LANE_M = 0.3;

export interface CopsState {
  /** Scaled ticks stepped before the current one (0 on the first tick). */
  clock: number;
  /** Entity ids of the cops, ascending. */
  cops: EntityId[];
  /** By cop id: COP_PARKED, COP_CHASING or COP_DONE. */
  phase: number[];
  /** By cop id: 1 when this race's roll brings him out of the lot, 0 when he stays parked. */
  spawns: number[];
  /** By cop id: 1 once his siren has sounded for the pull-out. */
  sirenOn: number[];
  /** By cop id: whom he is chasing, or -1. */
  target: EntityId[];
  /** By cop id: the clock value when his chaos target expires (0 when none). */
  chaosUntil: number[];
  /** By cop id: 1 while he moves in alongside his target, 0 while he hangs back. */
  closing: number[];
  /** By cop id: scaled ticks on station while hanging back, or alongside while moving in. */
  closingFor: number[];
  /** By player id: scaled ticks spent down within a cop's bust radius, in a row. */
  dwell: number[];
  /** Players busted, in order. */
  busted: EntityId[];
  /** By cop id (cops-3): extra scaled ticks after the base pull-out, for the waves. */
  extraTicks: number[];
  /** By cop id: the clock value a chaos summon came in at (-1: not summoned). */
  summonAt: number[];
  /** By cop id: why he came out ('' for the M2 rule): every-race, tier-rising or chaos. */
  cause: string[];
  /** By cop id: the clock value from which he may swing again. */
  swingAt: number[];
  /** The hidden chaos meter, and the (jittered) level that summons the next cop. */
  chaos: number;
  chaosAt: number;
}

export function copsState(world: World): CopsState {
  return systemState<CopsState>(world, 'cops', () => ({
    clock: 0,
    cops: [],
    phase: [],
    spawns: [],
    sirenOn: [],
    target: [],
    chaosUntil: [],
    closing: [],
    closingFor: [],
    dwell: [],
    busted: [],
    extraTicks: [],
    summonAt: [],
    cause: [],
    swingAt: [],
    chaos: 0,
    chaosAt: 0,
  }));
}

/** The event's tier (1 for the first; absent is 1). */
function tierOf(config: SimConfig): number {
  return Math.max(1, Math.floor(config.event.tier ?? 1));
}

/** 1 ± randomness, from one draw of the cops stream. */
function jitter(world: World, randomness: number): number {
  return 1 + clamp(randomness, 0, 1) * (2 * nextFloat(world.rng.cops) - 1);
}

/** Whether mayhem can summon cops in this race. */
function chaosSummons(config: SimConfig): boolean {
  const c = config.event.cops;
  return !!c && c.mode !== 'none' && (c.chaosSummon || c.mode === 'chaos-summoned');
}

/**
 * How many cops leave the lot at the start of the chase under the event's `cops` block (before
 * each one's spawn-chance roll), jittered by `randomness`; the file header has the rule.
 */
function startingCopCount(world: World, config: SimConfig): number {
  const c = config.event.cops;
  if (!c) return Infinity;
  const base = Math.max(0, c.baseCount);
  const want =
    c.mode === 'none' ? 0 : c.mode === 'tier-rising' ? base + c.tierScale * (tierOf(config) - 1) : base;
  return Math.max(0, Math.round(want * jitter(world, c.randomness)));
}

function defOf(config: SimConfig, m: Mover | undefined): SimRiderDef | undefined {
  return m && m.kind === 'rider' ? config.riders[m.riderIndex] : undefined;
}

function isDown(m: Mover): boolean {
  return m.mode === 'Tumble' || m.mode === 'OnFoot';
}

function distance(config: SimConfig, a: Mover, b: Mover): number {
  const p = config.road.toWorld(a.pos.edge, a.pos.s, a.pos.d, a.h);
  const q = config.road.toWorld(b.pos.edge, b.pos.s, b.pos.d, b.h);
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const dz = p.z - q.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Metres the target is ahead of the cop along the route (negative when behind). */
function gapAlongRoute(config: SimConfig, cop: Mover, target: Mover): number {
  const a = config.route.progressAt(cop.pos.edge, cop.pos.s);
  const b = config.route.progressAt(target.pos.edge, target.pos.s);
  if (a === -Infinity || b === -Infinity) return distance(config, cop, target);
  return b - a;
}

function hasFinished(config: SimConfig, m: Mover): boolean {
  return config.route.distanceToFinish(m.pos.edge, m.pos.s) <= 0;
}

function isPlayer(config: SimConfig, m: Mover): boolean {
  return defOf(config, m)?.controller.kind === 'player';
}

/** Whether a rider can still be chased: on the course, not finished, not already busted. */
function chaseable(config: SimConfig, st: CopsState, m: Mover | undefined): m is Mover {
  return !!m && m.kind === 'rider' && !hasFinished(config, m) && !st.busted.includes(m.id);
}

function pickTarget(world: World, config: SimConfig, st: CopsState, cop: Mover): EntityId {
  // Chaos nearby this tick (combat ran earlier in the tick): the attacker becomes the target.
  for (const e of world.events) {
    if (e.type !== 'hit' && e.type !== 'kick') continue;
    const attacker = world.movers[e.actor];
    if (!attacker || attacker.id === cop.id || defOf(config, attacker)?.faction === 'law') continue;
    if (distance(config, cop, attacker) <= CHAOS_RADIUS_M) {
      st.target[cop.id] = attacker.id;
      st.chaosUntil[cop.id] = st.clock + CHAOS_MEMORY_TICKS;
    }
  }
  const current = world.movers[st.target[cop.id] ?? -1];
  if ((st.chaosUntil[cop.id] ?? 0) > st.clock && chaseable(config, st, current)) return current.id;
  st.chaosUntil[cop.id] = 0;
  // Otherwise the nearest player still in the race.
  let best: EntityId = -1;
  let bestGap = Infinity;
  for (const m of world.movers) {
    if (!isPlayer(config, m) || !chaseable(config, st, m)) continue;
    const gap = Math.abs(gapAlongRoute(config, cop, m));
    if (gap < bestGap) {
      bestGap = gap;
      best = m.id;
    }
  }
  return best;
}

/** Throttle that holds `v` on the flat in the riding model (the AI uses the same feed-forward). */
function holdThrottle(accel: number, top: number, v: number): number {
  return (accel * ((v * v) / (top * top)) + COAST_DECEL) / (accel + COAST_DECEL);
}

/** His side's drive lane and shoulder at his position (the lanes whose direction is his). */
function sideLanes(config: SimConfig, pos: RoadPos) {
  const lanes = config.road.lanesAt(pos.edge, pos.s);
  const drive =
    lanes.find((l) => l.kind === 'drive' && l.direction === pos.dir) ?? lanes.find((l) => l.kind === 'drive');
  const shoulder = lanes.find((l) => l.kind === 'shoulder' && l.direction === pos.dir);
  return { drive, shoulder };
}

/** Whether his centre is clear of every drive lane here (so traffic does not queue behind him). */
function clearOfLanes(config: SimConfig, pos: RoadPos): boolean {
  for (const l of config.road.lanesAt(pos.edge, pos.s)) {
    if (l.kind !== 'drive') continue;
    if (Math.abs(pos.d - l.dCenterM) < l.widthM / 2 + CLEAR_OF_LANE_M) return false;
  }
  return true;
}

/** The cop's command for the next tick: close on the target, hold the gap, or pull up beside him. */
function drive(world: World, config: SimConfig, st: CopsState, cop: Mover, def: SimRiderDef): void {
  const bike = def.bike;
  const pos = cop.pos;
  const v = cop.speed;
  const target = st.phase[cop.id] === COP_CHASING ? world.movers[st.target[cop.id] ?? -1] : undefined;
  const { drive: lane, shoulder } = sideLanes(config, pos);

  // Default line: the centre line, the inner edge of his own lane, where traffic in both
  // directions leaves him room to ride through (a cop splitting the lanes).
  let vWant = 0;
  let dWant = lane ? lane.dCenterM - lane.direction * (lane.widthM / 2) : pos.d;
  // He may stop in a lane only beside his target (a downed one he is busting, or one who has
  // stopped with him alongside) or with the man he busted; anywhere else, only off the lanes.
  let mayStop = false;
  let feedBrake = 0;
  if (target && isDown(target)) {
    const gap = gapAlongRoute(config, cop, target);
    const decel = bike.brakeMps2 * 0.6;
    // Pull up just behind him: the speed from which braking stops the bike in time, with the
    // braking that stopping distance needs fed forward (so he does not sail past).
    const room = gap - PULL_UP_GAP_M;
    vWant = room > 0 ? Math.sqrt(2 * decel * room) : 0;
    if (v > vWant) feedBrake = room > 0.5 ? (v * v - vWant * vWant) / (2 * room * bike.brakeMps2) : 1;
    dWant = target.pos.d;
    mayStop = true;
  } else if (target) {
    const gap = gapAlongRoute(config, cop, target);
    const decel = bike.brakeMps2 * 0.6;
    // Hang back at the follow gap; after a spell on station, move in alongside for a while
    // (so he can be hit, and is there if you fall), then drop back. Either way: close to the
    // goal gap, match his speed, and brake early enough not to overshoot.
    const id = cop.id;
    const followGap = world.params['cops.followGapM'] ?? 40;
    let spell = st.closingFor[id] ?? 0;
    if (st.closing[id] === 1) {
      if (Math.abs(gap) <= ALONGSIDE_S_M) spell += world.timeScale;
      // Carried past a target who braked hard while he moved in: the move-in is over, and he waits
      // on the shoulder as he does whenever he is ahead (below). Moving in, he steered back at the
      // target from there and never stood still, so he crawled on along the shoulder for good.
      if (spell >= MOVE_IN_TICKS || gap < -ALONGSIDE_S_M) {
        st.closing[id] = 0;
        spell = 0;
      }
    } else {
      if (gap <= followGap + STATION_M) spell += world.timeScale;
      if (spell >= HANG_BACK_TICKS) {
        st.closing[id] = 1;
        spell = 0;
      }
    }
    st.closingFor[id] = spell;
    const closing = st.closing[id] === 1;
    const room = gap - (closing ? 0 : followGap);
    vWant = room > 0 ? target.speed + Math.sqrt(2 * decel * room) : target.speed + 0.5 * room;
    // A stopping distance: never faster than he can stop where the target could stop, with that
    // braking fed forward (as the pull-up above), so he cannot sail past. Hanging back, always, and
    // STOP_BEHIND_M short of it; moving in alongside, once the target brakes, and no further than
    // alongside (he rides beside a cruising target, inside a stopping distance by design).
    const targetBraking = (world.inputs[target.id]?.brake ?? 0) > 0;
    if (!closing || targetBraking) {
      const m = speedMultiplierOf(config);
      const m2 = m * m;
      const targetBrake = (defOf(config, target)?.bike.brakeMps2 ?? bike.brakeMps2) * m2;
      const ownBrake = bike.brakeMps2 * m2;
      const short = closing ? -ALONGSIDE_S_M : STOP_BEHIND_M;
      const stopRoom = gap - short + (target.speed * target.speed) / (2 * targetBrake);
      const share = closing ? ALONGSIDE_BRAKE_SHARE : STOP_BRAKE_SHARE;
      const vSafe = stopRoom > 0 ? Math.sqrt(2 * ownBrake * share * stopRoom) : 0;
      if (vWant > vSafe) {
        vWant = vSafe;
        if (v > vSafe) feedBrake = (v * v) / (2 * Math.max(stopRoom, 0.5) * ownBrake);
      }
    }
    mayStop = Math.abs(gap) <= ALONGSIDE_S_M;
    if (closing) {
      const edge = config.road.edges[pos.edge];
      const centre = edge ? (edge.dMin + edge.dMax) / 2 : 0;
      dWant = target.pos.d + (target.pos.d > centre ? -ALONGSIDE_D_M : ALONGSIDE_D_M);
    } else if (gap < -ALONGSIDE_S_M && shoulder) {
      // Ahead of him: ease onto the shoulder and let him come past, then fall in behind.
      dWant = shoulder.dCenterM;
    } else if (gap < 30) dWant = target.pos.d;
  } else if (st.phase[cop.id] === COP_DONE && st.busted.length > 0) {
    // The chase ended in a bust: he stays with the man he busted.
    dWant = pos.d;
    mayStop = true;
  } else if (shoulder) {
    // Nothing to chase: pull onto the shoulder and stop there.
    dWant = shoulder.dCenterM;
  }
  vWant = clamp(vWant, 0, bike.topSpeedMps);
  // Never stand still in a travel lane: below the crawl, head for the shoulder and keep rolling
  // until he is clear of the lane (traffic never passes a stopped rider in its lane).
  if (!mayStop && vWant < CRAWL_MPS && !clearOfLanes(config, pos)) {
    vWant = Math.min(CRAWL_MPS, bike.topSpeedMps);
    if (shoulder) dWant = shoulder.dCenterM;
  }

  const err = vWant - v;
  let throttle = 0;
  let brake = 0;
  if (vWant <= 0.05 && v < 0.5) brake = 1;
  else if (err >= 0)
    throttle = clamp(holdThrottle(bike.accelMps2, bike.topSpeedMps, vWant) + 0.5 * err, 0, 1);
  else if (err < -0.5) brake = clamp(Math.max(-err * 0.3, feedBrake), 0, 1);

  // Steering: a lateral speed toward dWant, with the road's curvature fed forward (as sim/ai).
  const edge = config.road.edges[pos.edge];
  if (edge) dWant = clamp(dWant, edge.dMin + 0.8, edge.dMax - 0.8);
  const steerScale = world.params['riders.steerScale'] ?? 1;
  // Alongside he holds his line firmly, so a knockback does not keep him out of reach for long.
  const gain = st.closing[cop.id] === 1 ? 1.6 : 0.8;
  const vLat = clamp((dWant - pos.d) * gain, -3, 3) * pos.dir;
  const wantYaw = vLat / Math.max(v, 5);
  const turn = pos.dir * config.road.kappaAt(pos.edge, pos.s) * v + 3 * (wantYaw - cop.yaw);
  const yawTarget = cop.yaw + turn / 4;
  const steer = clamp(yawTarget / maxYawAt(bike.steerRateMps, v, steerScale), -1, 1);
  world.inputs[cop.id] = {
    steer: Math.round(steer * 127),
    throttle: Math.round(throttle * 255),
    brake: Math.round(brake * 255),
    flags: 0,
  };
}

/**
 * Where a cop waits before the chase: the route's first `copSpawn` feature (in route order), at
 * the middle of its range along the road, on the shoulder on the lot's side (or at the drivable
 * edge on that side when there is no shoulder), facing the route's direction of travel there.
 * Null when the route passes no `copSpawn`.
 */
export function copSpawnPos(config: SimConfig): RoadPos | null {
  const { road, route } = config;
  for (const edge of route.mainEdges) {
    for (const f of road.featuresOf(edge, 'copSpawn')) {
      const a = route.progressAt(edge, f.s0);
      const b = route.progressAt(edge, f.s1);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const s = (f.s0 + f.s1) / 2;
      const side = f.d0 + f.d1 >= 0 ? 1 : -1;
      const lanes = road.lanesAt(edge, s);
      const shoulder = lanes.find((l) => l.kind === 'shoulder' && Math.sign(l.dCenterM) === side);
      let d: number;
      if (shoulder) d = shoulder.dCenterM;
      else {
        const { lo, hi } = barrierLimits(config, edge, s);
        d = side > 0 ? hi : lo;
      }
      return { edge, s, d, dir: b >= a ? 1 : -1 };
    }
  }
  return null;
}

/**
 * When the siren sounds and when he pulls out, in scaled ticks of the cops clock. The time to the
 * pull-out is `cops.spawnDelayS` ÷ the difficulty's cop frequency (never, at frequency 0), but
 * never shorter than the siren lead; the siren sounds the lead before it.
 */
export function copTiming(world: World, config: SimConfig): { sirenTicks: number; pullOutTicks: number } {
  const frequency = config.difficulty.copFrequency;
  const delayTicks = frequency > 0 ? ((world.params['cops.spawnDelayS'] ?? 20) * 60) / frequency : Infinity;
  const leadTicks = Math.max(0, world.params['cops.sirenLeadS'] ?? 3) * 60;
  const pullOutTicks = Math.max(delayTicks, leadTicks);
  return { sirenTicks: pullOutTicks - leadTicks, pullOutTicks };
}

function endChase(world: World, st: CopsState, copId: EntityId): void {
  if (st.phase[copId] !== COP_CHASING) return;
  st.phase[copId] = COP_DONE;
  st.target[copId] = -1;
  emit(world, 'siren', copId, { on: false });
}

/** Players down near an upright, spawned cop build up dwell; a full dwell is a bust. */
function checkBusts(world: World, config: SimConfig, st: CopsState): void {
  const radiusScale = world.params['cops.bustRadiusScale'] ?? 1;
  const dwellScale = world.params['cops.bustDwellScale'] ?? 1;
  for (const m of world.movers) {
    if (!isPlayer(config, m) || st.busted.includes(m.id)) continue;
    let by: Mover | undefined;
    if (isDown(m)) {
      for (const id of st.cops) {
        const cop = world.movers[id];
        const law = defOf(config, cop)?.law;
        if (!cop || !law || cop.mode !== 'Road' || st.phase[id] !== COP_CHASING) continue;
        if (distance(config, cop, m) <= law.bustRadiusM * radiusScale) {
          by = cop;
          break;
        }
      }
    }
    if (!by) {
      st.dwell[m.id] = 0;
      continue;
    }
    const dwell = (st.dwell[m.id] ?? 0) + world.timeScale;
    st.dwell[m.id] = dwell;
    const law = defOf(config, by)?.law;
    if (!law || dwell < law.bustDwellS * dwellScale * 60 - 1e-9) continue;
    st.busted.push(m.id);
    // The fine grows with the tier (cops-3). An event seam only: career-1 charges it.
    const tier = tierOf(config);
    const fineCash = Math.round(
      law.fineCash * (1 + (tier - 1) * Math.max(0, world.params['cops.fineTierScale'] ?? 0.5)),
    );
    emit(
      world,
      'bust',
      by.id,
      { fineCash, tier, fineBaseCash: law.fineCash, dwellTicks: dwell },
      { target: m.id },
    );
    endChase(world, st, by.id);
  }
}

/**
 * The hidden chaos meter (cops-3): this tick's hits and takedowns with a player in them fill it,
 * it drains with time, and a full meter summons the next cop still in the lot.
 */
function stepChaos(world: World, config: SimConfig, st: CopsState): void {
  const player = (id: EntityId | undefined) => {
    const m = world.movers[id ?? -1];
    return !!m && isPlayer(config, m);
  };
  const law = (id: EntityId | undefined) => defOf(config, world.movers[id ?? -1])?.faction === 'law';
  let add = 0;
  for (const e of world.events) {
    if (e.type === 'hit' && !law(e.actor) && (player(e.actor) || player(e.target))) {
      add += CHAOS_HIT + (law(e.target) ? CHAOS_HIT_COP : 0);
    } else if (e.type === 'takedown' && player(e.actor)) add += CHAOS_TAKEDOWN;
  }
  const decay = Math.max(0, world.params['cops.chaosDecayPerS'] ?? 0.1) * (world.timeScale / 60);
  st.chaos = Math.max(0, st.chaos - decay) + add;
  if (st.chaos < st.chaosAt) return;
  const next = st.cops.find((id) => st.phase[id] === COP_PARKED && st.spawns[id] !== 1);
  if (next === undefined) {
    st.chaos = st.chaosAt; // nobody left to summon: the meter stays full
    return;
  }
  st.chaos -= st.chaosAt;
  st.spawns[next] = 1;
  st.summonAt[next] = st.clock;
  st.cause[next] = 'chaos';
  const mix = config.event.cops;
  st.chaosAt = Math.max(1, (world.params['cops.chaosSummonAt'] ?? 10) * jitter(world, mix?.randomness ?? 0));
}

/**
 * An armed cop's attack press for the next tick: within his weapon's reach of the rider he chases
 * (who is riding), idle, and not swung for cops.swingEveryS. Unarmed cops never press.
 */
function copSwing(world: World, config: SimConfig, st: CopsState, cop: Mover): boolean {
  const combat = combatState(world);
  const held = combat.held[cop.id];
  if (!held || st.phase[cop.id] !== COP_CHASING || combat.phase[cop.id] !== 'idle') return false;
  if (st.clock < (st.swingAt[cop.id] ?? 0)) return false;
  const target = world.movers[st.target[cop.id] ?? -1];
  const w = config.weapons.find((x) => x.contentId === held);
  if (!target || !w || target.mode !== 'Road') return false;
  const rel = relative(config.road, cop, target, w.reachSM + 2);
  if (!rel || Math.abs(rel.ds) > w.reachSM || Math.abs(rel.dd) > w.reachDM) return false;
  st.swingAt[cop.id] = st.clock + Math.max(0.5, world.params['cops.swingEveryS'] ?? 6) * 60;
  return true;
}

export const copsSystem: SimSystem = {
  name: 'cops',
  init(world: World, config: SimConfig) {
    const st = copsState(world);
    const spawn = copSpawnPos(config);
    const mix = config.event.cops;
    for (const m of world.movers) {
      if (defOf(config, m)?.controller.kind !== 'cop') continue;
      // From the lot, not the grid; each further cop waits PARK_GAP_M further back along the road.
      if (spawn) {
        const len = config.road.edges[spawn.edge]?.length ?? spawn.s;
        const back = st.cops.length * PARK_GAP_M * spawn.dir;
        m.pos = { ...spawn, s: clamp(spawn.s - back, 0, len) };
        m.yaw = 0;
        m.speed = 0;
      }
      st.cops.push(m.id);
      st.phase[m.id] = COP_PARKED;
      // One roll per cop per race, always drawn (so the stream advances the same on every preset).
      const chance = clamp((world.params['cops.spawnChance'] ?? 1) * config.difficulty.copFrequency, 0, 1);
      st.spawns[m.id] = nextFloat(world.rng.cops) < chance ? 1 : 0;
      st.sirenOn[m.id] = 0;
      st.target[m.id] = -1;
      st.chaosUntil[m.id] = 0;
      st.closing[m.id] = 0;
      st.closingFor[m.id] = 0;
      st.extraTicks[m.id] = 0;
      st.summonAt[m.id] = -1;
      st.cause[m.id] = '';
      st.swingAt[m.id] = 0;
      world.inputs[m.id] = { steer: 0, throttle: 0, brake: 255, flags: 0 };
    }
    if (!mix) return;
    // cops-3's spawn mix: the first `count` cops come out (each still on his roll), a wave gap
    // apart; the rest wait in the lot for a chaos summon.
    const count = startingCopCount(world, config);
    const gapTicks = Math.max(0, world.params['cops.waveGapS'] ?? 8) * 60;
    st.cops.forEach((id, k) => {
      const jittered = jitter(world, mix.randomness); // always drawn, so the stream stays aligned
      if (k >= count) st.spawns[id] = 0;
      else {
        st.extraTicks[id] = k * gapTicks * jittered;
        st.cause[id] = mix.mode === 'tier-rising' ? 'tier-rising' : 'every-race';
      }
    });
    st.chaosAt = Math.max(1, (world.params['cops.chaosSummonAt'] ?? 10) * jitter(world, mix.randomness));
  },
  step(world: World, config: SimConfig) {
    const st = copsState(world);
    if (st.cops.length === 0) return;
    const { sirenTicks, pullOutTicks } = copTiming(world, config);
    const leadTicks = pullOutTicks - sirenTicks;
    if (chaosSummons(config)) stepChaos(world, config, st);
    const maxActive = Math.max(1, Math.round(world.params['cops.maxActive'] ?? 2));
    // Chasing, or parked with the siren going: each holds one of the maxActive places.
    let active = st.cops.filter(
      (id) => st.phase[id] === COP_CHASING || (st.phase[id] === COP_PARKED && st.sirenOn[id] === 1),
    ).length;
    for (const id of st.cops) {
      const cop = world.movers[id];
      const def = defOf(config, cop);
      if (!cop || !def) continue;
      if (st.phase[id] === COP_PARKED && st.spawns[id] === 1) {
        // A summoned cop goes from his summons; the others at the base time plus their wave gap.
        const summoned = st.summonAt[id] ?? -1;
        const out = summoned >= 0 ? summoned + leadTicks : pullOutTicks + (st.extraTicks[id] ?? 0);
        if (st.sirenOn[id] !== 1 && st.clock >= out - leadTicks) {
          if (active >= maxActive) {
            // No place free: he waits in the lot, and his timing slides with the clock (the lead holds).
            if (summoned >= 0) st.summonAt[id] = summoned + world.timeScale;
            else st.extraTicks[id] = (st.extraTicks[id] ?? 0) + world.timeScale;
          } else {
            st.sirenOn[id] = 1;
            active++;
            const cause = st.cause[id] ?? '';
            emit(world, 'siren', id, cause ? { on: true, cause } : { on: true });
          }
        }
        if (st.sirenOn[id] === 1 && st.clock >= out) st.phase[id] = COP_CHASING;
      }
      if (st.phase[id] === COP_CHASING) {
        const before = st.target[id];
        st.target[id] = pickTarget(world, config, st, cop);
        if (st.target[id] !== before) {
          st.closing[id] = 0; // a new target: hang back first
          st.closingFor[id] = 0;
        }
        if (st.target[id] === -1) endChase(world, st, id);
      }
    }
    checkBusts(world, config, st);
    // Commands for the next tick. A cop who is down (knocked off) is left to sim/tumble.
    for (const id of st.cops) {
      const cop = world.movers[id];
      const def = defOf(config, cop);
      if (!cop || !def || cop.mode !== 'Road') continue;
      if (st.phase[id] === COP_PARKED) world.inputs[id] = { steer: 0, throttle: 0, brake: 255, flags: 0 };
      else {
        drive(world, config, st, cop, def);
        const input = world.inputs[id];
        if (input && copSwing(world, config, st, cop)) input.flags |= InputFlag.attack;
      }
    }
    st.clock += world.timeScale;
  },
};
