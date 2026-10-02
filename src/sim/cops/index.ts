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
//   Only a cop who knocked you off can bust you (interview, 2026-10-02: "it should only be a bust
//   if the cop knocks you down (not just proximity and timing)"; revisit after a playtest): with
//   `cops.bustKnockdownOnly` on (the default) a player is eligible only once combat credits a
//   cop with taking him down (a `takedown` whose actor is that cop: his finishing hit, or his hit
//   that sent you into traffic or scenery within the takedown window), and only that cop's radius
//   and dwell count. Crashing on your own beside him is no bust. The collar ends when the player
//   is riding again. At 0 the M1 proximity rule (any chasing cop, any fall) comes back. [default]
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
// The patrol (playtest 2, 2026-10-02: "I think I've only ever encountered cops once even though
// I've played a lot"; the maintainer's COPS answer: "Mix of 2 and 1 (reliable but rich)"):
// - Why cops were rare: the lot (`copSpawn`) sits at the start of every route, and the cop pulled
//   out 20 s after the start at 1.05 x the starter bike's top speed, so a rider who kept going had a
//   twenty-second head start on a cop barely faster than him, and the cop then held 40 m behind,
//   out of the forward camera's view. The seeded batch over every region and route, before and
//   after, is in docs/milestones/M4.md (cops-3, "The patrol").
// - Now an event with `patrolMax` also sends 1 to `patrolMax` of the cops the mix leaves in the lot
//   up the road (the difficulty's cop frequency scales the roll); the mix's starters still leave
//   the lot as before. Each patrol cop waits on the shoulder ahead, at a route progress the field
//   reaches about PATROL.windowsS into the race (at PATROL.paceShare x the event's pace), clear of
//   ramps, pads, lots, split zones and sharp bends. A player coming within PATROL.wakeM (further
//   for a fast one, so the siren leads by the full lead) lights his siren (cause `patrol`); as the
//   player draws level he pulls out and chases as any cop does. The chase runs out after
//   PATROL.chaseS unless his man is down beside him. So a cop is met in view, ahead, every race.
//   The rest wait in the lot for a chaos summon or a speed trap. [default]
//
// The heat meter (playtest 2, the same COPS answer: "a heat meter: chaos raises heat, which brings
// more cops and then a roadblock; lose them by riding clean or going off-road"), on in an event
// whose `cops` block says `heat`:
// - Chaos raises the player's heat (HEAT points, out of HEAT_MAX, x `cops.heatScale`): a hit he
//   lands, more on a cop; a takedown, more of a cop; every second riding the wrong way in a travel
//   lane; smashing a set piece's sawhorse or bale; a speed trap he trips (the W-P speed trap calls
//   `addHeat`).
// - Riding clean cools it: after HEAT.calmS with no new heat it drains `cops.heatDecayPerS`,
//   slower (HEAT.nearScale) while a heat cop chasing him is within HEAT.nearM. Off the road (loose
//   ground under the wheels: dirt, sand, grass or gravel, from sim/ground) with no heat cop that
//   near, it cools HEAT.offRoadScale times as fast ("going off-road with no cop watching cools it").
// - The tiers (HEAT.tiers, falling back HEAT.hysteresis below each): 1 brings one more cop, 2 a
//   pursuit pair, 3 a roadblock. A heat cop comes from the lot, or is a cop whose chase ended, put
//   on the road HEAT.behindM behind the player (out of the forward view) at his speed, siren on
//   (cause `heat`), and closes with a pursuit burst (riders' boost) while he is well back. Heat cops
//   bypass `cops.maxActive`: the tiers bound them.
// - The roadblock: up to HEAT.roadblockCops cops (from the lot, a chase that ended, or a patrol cop
//   not yet woken, each out of sight, at least HEAT.roadblockHideM from the player) park across the
//   player's lanes HEAT.roadblockAheadM up the road (a clear stretch, as the patrol's spots), sirens
//   on (cause `roadblock`), one in each lane his way (a one-lane road: the lane and its shoulder).
//   The other way's lanes and the verge stay open: go round, or ride into the back of one (rider
//   contact merges the speeds, so it costs you). Once he is past, they chase him as heat cops; the
//   block lifts after HEAT.roadblockS anyway (they pull onto the shoulder), so traffic queued
//   behind it does not stand there all race.
// - Cooled to nothing with a heat cop on him, the player has lost them: every heat cop gives up
//   (siren off; a roadblock lifts), a `heat` event says `lost`, and SimSnapshot.law.lost holds until
//   heat rises again. The lot's cop and the patrol keep their own rules.
// Every change of tier is a `heat` event (data.tier, data.from, data.heat 0..1, data.lost).
//
// Every timer advances by world.timeScale per tick (M1 cross-lane rule), so a hit-stop freezes
// them and M2's slow motion stretches them. All state is plain data keyed by entity id.
import { clamp, nextFloat, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadPos } from '../../road';
import { combatState, relative } from '../combat';
import { barrierLimits, maxYawAt, riderState } from '../riders';
import { InputFlag, type LawSnapshot, type SimConfig, type SimRiderDef } from '../types';
import { groundUnder } from '../ground';
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
    // Playtest 2's heat meter: how much heat chaos adds (x HEAT's points). [default] 1.
    id: 'cops.heatScale',
    group: 'cops',
    label: 'Heat from chaos',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    // Playtest 2's heat meter: how fast riding clean cools it, once calm for HEAT.calmS. [default] 2.5.
    id: 'cops.heatDecayPerS',
    group: 'cops',
    label: 'Heat cool-off',
    default: 2.5,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'pts/s',
    affectsSim: true,
  },
  {
    // Playtest 2: scales how many patrol cops an event's `patrolMax` brings (0: no patrol). [default] 1.
    id: 'cops.patrolScale',
    group: 'cops',
    label: 'Patrol cops (× the event)',
    default: 1,
    min: 0,
    max: 2,
    step: 0.5,
    unit: '×',
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
    // Interview, 2026-10-02: a bust only when a cop's hit knocks you off. 0 restores the M1 rule
    // (down near a chasing cop for the dwell). [default] 1.
    id: 'cops.bustKnockdownOnly',
    group: 'cops',
    label: 'Bust only when a cop knocks you off',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
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
/** With a patrol (more cops in the race), the lot's cops park this close, about the middle. */
const LOT_GAP_M = 4;

/**
 * Playtest 2's patrol [default] (the file header has the rule). `windowsS` are the seconds into the
 * race at which the first and the second patrol cop are reached at `paceShare` x the event's pace;
 * a third or later takes the last window.
 */
export const PATROL = {
  windowsS: [
    [25, 45],
    [50, 75],
  ] as const,
  paceShare: 0.7,
  /** Patrol spots stay inside this share of the route. */
  minProgress: 0.08,
  maxProgress: 0.8,
  /** Two patrol cops wait at least this far apart, m. */
  spacingM: 250,
  /**
   * A player this far short of him lights his siren. He pulls out as the player draws level, or
   * when one slower than `stoppedMps` is within `pullOutM`; a player up to `pullOutM` past him (one
   * who arrived while every chasing place was taken) still brings him out.
   */
  wakeM: 220,
  pullOutM: 45,
  stoppedMps: 5,
  /**
   * A patrol chase ends this long after he pulls out (he pulls over, siren off), unless the man he
   * chases is down beside him: patrol cops come every race, on top of the lot's, so they must not
   * shadow a whole race. Long enough for a move-in or two alongside, where his swing (and your
   * steal) happens.
   */
  chaseS: 40,
  /** His first seconds out he holds his line (no swerve into the player who just went by). */
  holdLineS: 3,
  /** Looking for a clear spot: step forward this far, at most this many times. */
  stepM: 20,
  tries: 30,
  /** No patrol cop within this of a ramp, gap, pad, ramp truck or cop lot, m. */
  clearM: 30,
  /** Sharpest bend he waits on, 1/m. */
  maxKappa: 1 / 50,
};
const PATROL_AVOID = new Set(['ramp', 'gap', 'rampTruck', 'boostPad', 'copSpawn']);

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
  /** By player id: the cop who knocked him off this fall (-1: none), for the knockdown-only bust. */
  collar: EntityId[];
  /** By cop id (cops-3): extra scaled ticks after the base pull-out, for the waves. */
  extraTicks: number[];
  /** By cop id: the clock value a chaos summon came in at (-1: not summoned). */
  summonAt: number[];
  /** By cop id: why he came out ('' for the M2 rule): every-race, tier-rising or chaos. */
  cause: string[];
  /** By cop id: the clock value from which he may swing again. */
  swingAt: number[];
  /** By cop id (playtest 2): the route progress where he waits on patrol, m, or -1 for none. */
  patrolAt: number[];
  /** By cop id: the clock value at which his patrol chase ends (0 while he has not pulled out). */
  patrolUntil: number[];
  /** The hidden chaos meter, and the (jittered) level that summons the next cop. */
  chaos: number;
  chaosAt: number;
  /** By player id (playtest 2's heat meter): heat, 0..HEAT.max, and its tier, 0..3. */
  heat: number[];
  heatTier: number[];
  /** By player id: 1 once a chase was shaken off and the heat has not risen since. */
  heatLost: number[];
  /** By player id: the clock value of his last heat gain. */
  heatAt: number[];
  /** By player id: the highest tier whose cops have been sent this time (0 after he loses them). */
  heatSent: number[];
  /** By cop id: 1 while he chases for the heat meter (a heat cop). */
  heatCop: number[];
  /** By cop id: the route progress of the roadblock he stands in, m, or -1 for none. */
  blockAt: number[];
  /** By cop id: the clock value at which his roadblock lifts. */
  blockUntil: number[];
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
    collar: [],
    extraTicks: [],
    summonAt: [],
    cause: [],
    swingAt: [],
    patrolAt: [],
    patrolUntil: [],
    chaos: 0,
    chaosAt: 0,
    heat: [],
    heatTier: [],
    heatLost: [],
    heatAt: [],
    heatSent: [],
    heatCop: [],
    blockAt: [],
    blockUntil: [],
  }));
}

/** Playtest 2's heat meter [default]: the top of the meter (SimSnapshot.law.heat is heat / max). */
export const HEAT_MAX = 100;

/** Playtest 2's heat meter, [default] starting numbers (the file header has the rules). */
export const HEAT = {
  /** Points per hit a player lands, and more when it lands on a cop. */
  hit: 4,
  hitCop: 10,
  /** Points per takedown a player is credited with, and more when it is a cop's. */
  takedown: 12,
  takedownCop: 12,
  /** Points per second riding the wrong way in a travel lane, above this speed. */
  wrongWayPerS: 5,
  wrongWayMinMps: 10,
  /** Points per set-piece prop (a sawhorse, a bale) a player rides through. */
  smash: 3,
  /** Points for tripping a speed trap. */
  speedTrap: 30,
  /** The tiers: one more cop, the pursuit pair, the roadblock. */
  tiers: [25, 50, 80] as readonly number[],
  /** A tier falls back this far below its threshold. */
  hysteresis: 8,
  /** Seconds with no new heat before it cools. */
  calmS: 4,
  /** Cooling is this much slower while a heat cop chasing him is within nearM. */
  nearScale: 0.4,
  nearM: 60,
  /** A heat cop joins this far behind the player along the route (the pair's second this much more). */
  behindM: 90,
  pairGapM: 15,
  /** A heat cop's pursuit burst while he is more than burstM beyond his follow gap. */
  catchUpMps: 12,
  burstM: 15,
  /** Off the road with no heat cop within nearM, heat cools this many times as fast. */
  offRoadScale: 3,
  /** The roadblock: how many cops, how far up the road, and how long it stands (s). */
  roadblockCops: 2,
  roadblockAheadM: 300,
  roadblockS: 45,
  /** A cop is moved to the roadblock only from at least this far from the player (out of sight), m. */
  roadblockHideM: 120,
  /** The roadblock stands at least this far short of the finish, m. */
  roadblockFinishM: 80,
};

/** The loose ground off the road (sim/ground's surfaces): riding on it is riding off-road. */
const LOOSE_GROUND = new Set(['dirt', 'sand', 'grass', 'gravel']);

/**
 * Whether a rider is off the road (playtest 2's OFF-ROAD answer, "Anywhere with ground"): on the
 * ground, on loose ground (sim/ground's surface under his wheels). [default]
 */
function offRoad(config: SimConfig, m: Mover): boolean {
  const g = groundUnder(config.road, m.pos.edge, m.pos.s, m.pos.d, m.h);
  return g !== null && LOOSE_GROUND.has(g);
}

/** Whether the player's heat meter runs in this race (the event's `cops.heat`). */
function heatOn(config: SimConfig): boolean {
  const c = config.event.cops;
  return !!c && c.mode !== 'none' && c.heat === true;
}

/**
 * Adds heat to a player (the interface the W-P speed trap calls when it is tripped): `points` x
 * `cops.heatScale`, up to HEAT_MAX. A rider who is not a player, or a race without the meter, is
 * ignored. The tier follows on the cops phase.
 */
export function addHeat(world: World, config: SimConfig, playerId: EntityId, points: number): void {
  if (!heatOn(config) || points <= 0) return;
  const m = world.movers[playerId];
  if (!m || !isPlayer(config, m)) return;
  const st = copsState(world);
  const scale = Math.max(0, world.params['cops.heatScale'] ?? 1);
  st.heat[playerId] = Math.min(HEAT_MAX, (st.heat[playerId] ?? 0) + points * scale);
  st.heatAt[playerId] = st.clock;
  st.heatLost[playerId] = 0;
}

/** The heat meter for the player in slot 0 (SimSnapshot.law). */
export function lawSnapshot(world: World, config: SimConfig): LawSnapshot {
  const st = copsState(world);
  const player = config.riders.findIndex((r) => r.controller.kind === 'player' && r.controller.slot === 0);
  return {
    heat: clamp((st.heat[player] ?? 0) / HEAT_MAX, 0, 1),
    tier: st.heatTier[player] ?? 0,
    lost: (st.heatLost[player] ?? 0) === 1,
  };
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
  // A heat cop well back closes with a pursuit burst (riders' boost raises his top speed).
  let burst = 0;
  if (target && st.heatCop[cop.id] === 1) {
    const back = gapAlongRoute(config, cop, target) - (world.params['cops.followGapM'] ?? 40);
    if (back > HEAT.burstM) {
      burst = HEAT.catchUpMps;
      const rs = riderState(world);
      rs.boost[cop.id] = Math.max(rs.boost[cop.id] ?? 0, 2);
      rs.boostMps[cop.id] = HEAT.catchUpMps;
      vWant = Math.max(vWant, bike.topSpeedMps + burst);
    }
  }
  vWant = clamp(vWant, 0, bike.topSpeedMps + burst);
  // A patrol cop holds his line for his first seconds out, so he never swerves into the player
  // who has just gone by him (he falls in behind once the player is clear).
  const until = st.patrolUntil[cop.id] ?? 0;
  if (until > 0 && st.clock < until - (PATROL.chaseS - PATROL.holdLineS) * 60) dWant = pos.d;
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

/** The road position on the route's main path at a route progress (toward the finish), or null. */
export function routePosAt(config: SimConfig, progress: number): RoadPos | null {
  const { road, route } = config;
  for (const edge of route.mainEdges) {
    const len = road.edges[edge]?.length ?? 0;
    const a = route.progressAt(edge, 0);
    if (!Number.isFinite(a) || progress < a || progress > a + len) continue;
    return { edge, s: progress - a, d: 0, dir: 1 };
  }
  return null;
}

/**
 * Where a patrol cop can wait at `pos` (on the route's main path): its side's shoulder, or, with
 * `edgeOk`, the drivable edge on its side when there is no shoulder and that edge is clear of the
 * travel lanes. Null when the spot is not clear (a branch, a ramp, pad, ramp truck or lot nearby, a
 * split zone, a sharp bend, or nowhere off the lanes).
 */
/** The route progress spans of the route's allowed roads off its main path (its shortcuts). */
function branchSpans(config: SimConfig): [number, number][] {
  const { road, route } = config;
  const main = new Set(route.mainEdges);
  const out: [number, number][] = [];
  for (let e = 0; e < road.edges.length; e++) {
    if (main.has(e) || !route.allows(e)) continue;
    const a = route.progressAt(e, 0);
    const b = route.progressAt(e, road.edges[e]?.length ?? 0);
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

function patrolSpot(config: SimConfig, pos: RoadPos, edgeOk: boolean): RoadPos | null {
  const { road, route } = config;
  if (!road.edges[pos.edge] || !route.allows(pos.edge) || road.branchSideAt(pos.edge, pos.s) !== 0)
    return null;
  if (Math.abs(road.kappaAt(pos.edge, pos.s)) > PATROL.maxKappa) return null;
  for (const f of road.featuresOf(pos.edge)) {
    if (PATROL_AVOID.has(f.kind) && pos.s >= f.s0 - PATROL.clearM && pos.s <= f.s1 + PATROL.clearM)
      return null;
  }
  for (const z of route.shortcuts) {
    if (z.edge === pos.edge && pos.s >= z.s0 - 60 && pos.s <= z.s1 + 20) return null;
  }
  // Not beside a shortcut: a player who takes it would ride past him out of sight.
  const at = route.progressAt(pos.edge, pos.s);
  for (const [a, b] of branchSpans(config)) if (at >= a - 40 && at <= b + 40) return null;
  const { drive: lane, shoulder } = sideLanes(config, pos);
  if (shoulder) return { ...pos, d: shoulder.dCenterM };
  if (!edgeOk || !lane) return null;
  const { lo, hi } = barrierLimits(config, pos.edge, pos.s);
  const spot = { ...pos, d: lane.dCenterM >= 0 ? hi : lo };
  // Never parked in a travel lane: traffic queues behind a stopped rider (the M1 seed 37 jam).
  return clearOfLanes(config, spot) ? spot : null;
}

/**
 * Playtest 2's patrol spots, one per patrol cop (fewer when the route has no room): each a route
 * progress PATROL.windowsS into the race at PATROL.paceShare x the event's pace, drawn from the
 * cops stream (one draw per cop, always), then the first clear spot from there on.
 */
export function patrolSpots(world: World, config: SimConfig, count: number): { at: number; pos: RoadPos }[] {
  const out: { at: number; pos: RoadPos }[] = [];
  const length = config.route.length;
  const speed = Math.max(5, config.event.paceMps * PATROL.paceShare * speedMultiplierOf(config));
  for (let k = 0; k < count; k++) {
    const w = PATROL.windowsS[Math.min(k, PATROL.windowsS.length - 1)] ?? [30, 60];
    const t = w[0] + (w[1] - w[0]) * nextFloat(world.rng.cops);
    let want = clamp(t * speed, PATROL.minProgress * length, PATROL.maxProgress * length);
    const last = out[out.length - 1];
    if (last) want = Math.max(want, last.at + PATROL.spacingM);
    for (let i = 0; i < PATROL.tries; i++) {
      const at = want + i * PATROL.stepM;
      if (at > PATROL.maxProgress * length) break;
      const pos = routePosAt(config, at);
      const spot = pos && patrolSpot(config, pos, i >= PATROL.tries / 2);
      if (spot) {
        out.push({ at, pos: spot });
        break;
      }
    }
  }
  return out;
}

/**
 * The nearest player short of a parked patrol cop: how far short along the route (m; negative once
 * past him, and only down to -PATROL.pullOutM; Infinity when no player is that close) and how fast
 * he rides.
 */
function patrolGap(
  world: World,
  config: SimConfig,
  st: CopsState,
  cop: Mover,
): { gap: number; speed: number } {
  let gap = Infinity;
  let speed = 0;
  for (const m of world.movers) {
    if (!isPlayer(config, m) || !chaseable(config, st, m)) continue;
    const g = gapAlongRoute(config, m, cop);
    if (g >= -PATROL.pullOutM && g < gap) {
      gap = g;
      speed = m.speed;
    }
  }
  return { gap, speed };
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
  st.heatCop[copId] = 0;
  emit(world, 'siren', copId, { on: false });
}

/**
 * The knockdown-only bust's collar: this tick's takedowns (combat credits them before this phase)
 * whose actor is a cop and whose target is a player; riding again frees him.
 */
function noteCollars(world: World, config: SimConfig, st: CopsState): void {
  for (const e of world.events) {
    if (e.type !== 'takedown' || e.target === undefined || !st.cops.includes(e.actor)) continue;
    const m = world.movers[e.target];
    if (m && isPlayer(config, m) && isDown(m)) st.collar[m.id] = e.actor;
  }
  for (const m of world.movers) if (!isDown(m) && (st.collar[m.id] ?? -1) >= 0) st.collar[m.id] = -1;
}

/** Players down near an upright, spawned cop build up dwell; a full dwell is a bust. */
function checkBusts(world: World, config: SimConfig, st: CopsState): void {
  const radiusScale = world.params['cops.bustRadiusScale'] ?? 1;
  const dwellScale = world.params['cops.bustDwellScale'] ?? 1;
  const knockdownOnly = (world.params['cops.bustKnockdownOnly'] ?? 1) >= 0.5;
  noteCollars(world, config, st);
  for (const m of world.movers) {
    if (!isPlayer(config, m) || st.busted.includes(m.id)) continue;
    let by: Mover | undefined;
    const collar = st.collar[m.id] ?? -1;
    if (isDown(m) && (!knockdownOnly || collar >= 0)) {
      for (const id of st.cops) {
        if (knockdownOnly && id !== collar) continue;
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

/** Whether a player rides the wrong way in a travel lane (his centre in a lane of the other way). */
function wrongWay(config: SimConfig, m: Mover): boolean {
  if (m.mode !== 'Road' || m.h > 0.5 || m.speed < HEAT.wrongWayMinMps) return false;
  for (const l of config.road.lanesAt(m.pos.edge, m.pos.s)) {
    if (l.kind !== 'drive' || Math.abs(m.pos.d - l.dCenterM) > l.widthM / 2) continue;
    if (l.direction !== m.pos.dir) return true;
  }
  return false;
}

/**
 * Playtest 2's heat meter, each tick: this tick's chaos raises each player's heat, calm cools it,
 * and a new tier sends its cops (or, cooled to nothing, the heat cops give up).
 */
function stepHeat(world: World, config: SimConfig, st: CopsState): void {
  const law = (id: EntityId | undefined) => defOf(config, world.movers[id ?? -1])?.faction === 'law';
  const dt = world.timeScale / 60;
  for (const e of world.events) {
    const actor = world.movers[e.actor];
    if (!actor || !isPlayer(config, actor)) continue;
    if (e.type === 'hit') addHeat(world, config, e.actor, HEAT.hit + (law(e.target) ? HEAT.hitCop : 0));
    else if (e.type === 'takedown')
      addHeat(world, config, e.actor, HEAT.takedown + (law(e.target) ? HEAT.takedownCop : 0));
    else if (e.type === 'wobble' && e.data['cause'] === 'setPiece')
      addHeat(world, config, e.actor, HEAT.smash);
  }
  for (const m of world.movers) {
    if (!isPlayer(config, m)) continue;
    const id = m.id;
    if (wrongWay(config, m)) addHeat(world, config, id, HEAT.wrongWayPerS * dt);
    let heat = st.heat[id] ?? 0;
    if (heat > 0 && st.clock - (st.heatAt[id] ?? 0) >= HEAT.calmS * 60) {
      const near = st.cops.some((c) => {
        const cop = world.movers[c];
        return st.heatCop[c] === 1 && st.target[c] === id && !!cop && distance(config, cop, m) <= HEAT.nearM;
      });
      const rate =
        Math.max(0, world.params['cops.heatDecayPerS'] ?? 2.5) *
        (near ? HEAT.nearScale : offRoad(config, m) ? HEAT.offRoadScale : 1);
      heat = Math.max(0, heat - rate * dt);
      st.heat[id] = heat;
    }
    const from = st.heatTier[id] ?? 0;
    let tier = from;
    while (tier < HEAT.tiers.length && heat >= (HEAT.tiers[tier] ?? Infinity)) tier++;
    while (tier > 0 && heat < (HEAT.tiers[tier - 1] ?? 0) - HEAT.hysteresis) tier--;
    const chased = st.cops.some((c) => st.heatCop[c] === 1 && st.target[c] === id);
    const lost = heat <= 0 && (chased || (st.heatSent[id] ?? 0) > 0);
    if (lost) {
      tier = 0;
      st.heatSent[id] = 0;
      st.heatLost[id] = 1;
      for (const c of st.cops) {
        if (st.heatCop[c] !== 1) continue;
        if (liftBlock(world, st, c)) continue;
        st.heatCop[c] = 0;
        endChase(world, st, c);
      }
    }
    if (tier !== from || lost) {
      st.heatTier[id] = tier;
      emit(world, 'heat', id, { tier, from, heat: heat / HEAT_MAX, lost });
    }
    // A new tier sends its cops, once until he loses them: one, then a pair, then the roadblock.
    const sent = st.heatSent[id] ?? 0;
    if (tier > sent) {
      for (let t = sent + 1; t <= tier; t++) {
        if (t >= 3) {
          sendRoadblock(world, config, st, m);
          continue;
        }
        const want = t === 1 ? 1 : 2;
        for (let k = 0; k < want; k++) sendHeatCop(world, config, st, m, k, t);
      }
      st.heatSent[id] = tier;
    }
  }
}

/** Whether a cop can be sent for the heat: waiting in the lot, or done with an earlier chase. */
function heatReserve(world: World, st: CopsState, id: EntityId): boolean {
  const cop = world.movers[id];
  if (!cop || cop.mode !== 'Road' || st.heatCop[id] === 1) return false;
  if (st.phase[id] === COP_DONE) return true;
  return (
    st.phase[id] === COP_PARKED &&
    st.spawns[id] !== 1 &&
    st.sirenOn[id] !== 1 &&
    (st.patrolAt[id] ?? -1) < 0 &&
    (st.summonAt[id] ?? -1) < 0
  );
}

/**
 * Puts a heat cop on the road HEAT.behindM (and k x HEAT.pairGapM more) behind the player along
 * the route, in the route-forward lane at the player's speed, siren on, chasing him. None free, or
 * the player too near the start: nobody comes.
 */
function sendHeatCop(
  world: World,
  config: SimConfig,
  st: CopsState,
  player: Mover,
  k: number,
  tier: number,
): void {
  const id = st.cops.find((c) => heatReserve(world, st, c));
  const cop = id === undefined ? undefined : world.movers[id];
  if (id === undefined || !cop) return;
  const at = config.route.progressAt(player.pos.edge, player.pos.s) - HEAT.behindM - k * HEAT.pairGapM;
  const pos = at > 20 ? routePosAt(config, at) : null;
  if (!pos) return;
  const { drive: lane } = sideLanes(config, pos);
  cop.pos = { ...pos, d: lane ? lane.dCenterM : 0 };
  cop.speed = Math.min(player.speed, defOf(config, cop)?.bike.topSpeedMps ?? player.speed);
  cop.yaw = 0;
  cop.h = 0;
  st.phase[id] = COP_CHASING;
  st.spawns[id] = 1;
  st.sirenOn[id] = 1;
  st.heatCop[id] = 1;
  st.cause[id] = 'heat';
  st.patrolAt[id] = -1;
  st.patrolUntil[id] = 0;
  st.target[id] = player.id;
  st.closing[id] = 0;
  st.closingFor[id] = 0;
  emit(world, 'siren', id, { on: true, cause: 'heat', tier });
}

/**
 * Lifts a roadblock cop's block (he stands down: siren off, chase over, he pulls onto the shoulder).
 * False when he is not in a roadblock.
 */
function liftBlock(world: World, st: CopsState, id: EntityId): boolean {
  if ((st.blockAt[id] ?? -1) < 0) return false;
  st.blockAt[id] = -1;
  st.heatCop[id] = 0;
  st.target[id] = -1;
  if (st.phase[id] === COP_PARKED) {
    st.phase[id] = COP_DONE;
    emit(world, 'siren', id, { on: false });
  } else endChase(world, st, id);
  return true;
}

/**
 * Whether a cop can be moved to a roadblock: any heat reserve, or a patrol cop still waiting dark,
 * and either way out of the player's sight.
 */
function blockReserve(world: World, config: SimConfig, st: CopsState, id: EntityId, player: Mover): boolean {
  const cop = world.movers[id];
  if (!cop || cop.mode !== 'Road' || st.heatCop[id] === 1) return false;
  if (distance(config, cop, player) < HEAT.roadblockHideM) return false;
  if (heatReserve(world, st, id)) return true;
  return (
    st.phase[id] === COP_PARKED &&
    (st.patrolAt[id] ?? -1) >= 0 &&
    st.sirenOn[id] !== 1 &&
    (st.summonAt[id] ?? -1) < 0
  );
}

/**
 * Where the roadblock stands: the first clear stretch from HEAT.roadblockAheadM up the road (the
 * patrol's test: no branch, split zone, sharp bend, ramp, pad or lot nearby), short of the finish,
 * and the spots across it: each lane the route's way, or the lane and its shoulder on a one-lane road.
 */
export function roadblockSpots(config: SimConfig, playerAt: number): { at: number; spots: RoadPos[] } | null {
  const end = config.route.length - HEAT.roadblockFinishM;
  for (let i = 0; i < PATROL.tries; i++) {
    const at = playerAt + HEAT.roadblockAheadM + i * PATROL.stepM;
    if (at > end) return null;
    const pos = routePosAt(config, at);
    if (!pos || !patrolSpot(config, pos, true)) continue;
    const lanes = config.road.lanesAt(pos.edge, pos.s);
    const own = lanes.filter((l) => l.kind === 'drive' && l.direction === pos.dir);
    if (own.length === 0) continue;
    const spots = own.map((l) => ({ ...pos, d: l.dCenterM }));
    const shoulder = lanes.find((l) => l.kind === 'shoulder' && l.direction === pos.dir);
    if (spots.length === 1 && shoulder) spots.push({ ...pos, d: shoulder.dCenterM });
    return { at, spots: spots.slice(0, HEAT.roadblockCops) };
  }
  return null;
}

/** Tier 3: the roadblock up the road, from the cops out of the player's sight (none free: nothing). */
function sendRoadblock(world: World, config: SimConfig, st: CopsState, player: Mover): void {
  const where = roadblockSpots(config, config.route.progressAt(player.pos.edge, player.pos.s));
  if (!where) return;
  for (const spot of where.spots) {
    const id = st.cops.find((c) => blockReserve(world, config, st, c, player));
    const cop = id === undefined ? undefined : world.movers[id];
    if (id === undefined || !cop) return;
    cop.pos = spot;
    cop.speed = 0;
    cop.yaw = 0;
    cop.h = 0;
    st.phase[id] = COP_PARKED;
    st.spawns[id] = 1;
    st.sirenOn[id] = 1;
    st.heatCop[id] = 1;
    st.cause[id] = 'roadblock';
    st.patrolAt[id] = -1;
    st.patrolUntil[id] = 0;
    st.target[id] = player.id;
    st.closing[id] = 0;
    st.closingFor[id] = 0;
    st.blockAt[id] = where.at;
    st.blockUntil[id] = st.clock + HEAT.roadblockS * 60;
    emit(world, 'siren', id, { on: true, cause: 'roadblock', tier: 3 });
  }
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

/**
 * Playtest 2's patrol, on top of the cops-3 mix: 1 to `patrolMax` of the cops the mix leaves in
 * the lot (the difficulty's cop frequency scales the roll: Easy brings one, Normal an even spread,
 * Hard the most more often; 0 brings nobody) wait up the road instead. The cops still in the lot
 * then park in their own order: the lot's middle, then behind and ahead of it in turn.
 */
function startPatrol(
  world: World,
  config: SimConfig,
  st: CopsState,
  starting: number,
  lot: RoadPos | null,
): void {
  const scale = Math.max(0, world.params['cops.patrolScale'] ?? 1);
  const hi = Math.max(1, Math.round((config.event.cops?.patrolMax ?? 1) * Math.max(scale, 0.5)));
  const roll = nextFloat(world.rng.cops); // always drawn, so the stream stays aligned
  const freq = config.difficulty.copFrequency;
  const u = Math.min(1 - 1e-9, roll * freq);
  const want = freq > 0 && scale > 0 ? 1 + Math.min(hi - 1, Math.floor(u * hi)) : 0;
  const free = st.cops.filter((_id, k) => k >= starting);
  const spots = patrolSpots(world, config, Math.min(want, free.length));
  let inLot = 0;
  for (const id of st.cops) {
    const m = world.movers[id];
    if (!m) continue;
    const k = free.indexOf(id);
    const spot = k >= 0 ? spots[k] : undefined;
    if (spot) {
      m.pos = spot.pos;
      m.yaw = 0;
      m.speed = 0;
      st.spawns[id] = 1;
      st.patrolAt[id] = spot.at;
      st.cause[id] = 'patrol';
      continue;
    }
    if (lot) {
      const len = config.road.edges[lot.edge]?.length ?? lot.s;
      // Middle, then behind and ahead of it in turn, LOT_GAP_M apart: five fit the v1 lots (s 4 to 20).
      const off = inLot === 0 ? 0 : (inLot % 2 === 1 ? -1 : 1) * Math.ceil(inLot / 2) * LOT_GAP_M;
      m.pos = { ...lot, s: clamp(lot.s + off * lot.dir, 0, len) };
    }
    inLot++;
  }
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
      st.patrolAt[m.id] = -1;
      st.patrolUntil[m.id] = 0;
      st.blockAt[m.id] = -1;
      st.blockUntil[m.id] = 0;
      world.inputs[m.id] = { steer: 0, throttle: 0, brake: 255, flags: 0 };
    }
    if (!mix) return;
    // cops-3's spawn mix: the first `count` cops come out (each still on his roll), a wave gap
    // apart; the rest wait in the lot for a chaos summon (or, below, go on patrol).
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
    if ((mix.patrolMax ?? 0) > 0 && mix.mode !== 'none') startPatrol(world, config, st, count, spawn);
  },
  step(world: World, config: SimConfig) {
    const st = copsState(world);
    if (st.cops.length === 0) return;
    const { sirenTicks, pullOutTicks } = copTiming(world, config);
    const leadTicks = pullOutTicks - sirenTicks;
    if (chaosSummons(config)) stepChaos(world, config, st);
    if (heatOn(config)) stepHeat(world, config, st);
    const maxActive = Math.max(1, Math.round(world.params['cops.maxActive'] ?? 2));
    // Chasing, or parked with the siren going: each holds one of the maxActive places.
    let active = st.cops.filter(
      (id) =>
        st.heatCop[id] !== 1 &&
        (st.phase[id] === COP_CHASING || (st.phase[id] === COP_PARKED && st.sirenOn[id] === 1)),
    ).length;
    for (const id of st.cops) {
      const cop = world.movers[id];
      const def = defOf(config, cop);
      if (!cop || !def) continue;
      const patrolling = (st.patrolAt[id] ?? -1) >= 0 && (st.summonAt[id] ?? -1) < 0;
      if (st.phase[id] === COP_PARKED && (st.blockAt[id] ?? -1) >= 0) {
        // The roadblock: he stands in the lane until his man is past him, then chases him; it
        // lifts when its time is up (he pulls onto the shoulder).
        const target = world.movers[st.target[id] ?? -1];
        if (st.clock >= (st.blockUntil[id] ?? 0) || !chaseable(config, st, target)) liftBlock(world, st, id);
        else if (gapAlongRoute(config, target, cop) <= 0) {
          st.phase[id] = COP_CHASING;
          st.blockAt[id] = -1;
        }
      } else if (st.phase[id] === COP_PARKED && st.spawns[id] === 1 && patrolling) {
        // Playtest 2's patrol: he lights up as a player comes near, and pulls out as he arrives.
        // He wakes PATROL.wakeM short, or earlier for a fast rider, so the siren still sounds the
        // full siren lead (and a second more) before he pulls out.
        const { gap, speed } = patrolGap(world, config, st, cop);
        const wake = Math.max(PATROL.wakeM, PATROL.pullOutM + speed * (leadTicks / 60 + 1));
        if (st.sirenOn[id] !== 1 && gap <= wake && active < maxActive) {
          st.sirenOn[id] = 1;
          active++;
          emit(world, 'siren', id, { on: true, cause: 'patrol' });
        }
        // He pulls out as the player draws level (then he comes alongside), or when one has stopped
        // close by.
        if (st.sirenOn[id] === 1 && (gap <= 0 || (gap <= PATROL.pullOutM && speed < PATROL.stoppedMps))) {
          st.phase[id] = COP_CHASING;
          st.patrolUntil[id] = st.clock + PATROL.chaseS * 60;
        }
      } else if (st.phase[id] === COP_PARKED && st.spawns[id] === 1) {
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
        // A patrol chase runs out (unless his man is down: then he stays for the bust).
        const until = st.patrolUntil[id] ?? 0;
        const target = world.movers[st.target[id] ?? -1];
        if (until > 0 && st.clock >= until && !(target && isDown(target))) endChase(world, st, id);
      }
    }
    checkBusts(world, config, st);
    // Commands for the next tick. A cop who is down (knocked off) is left to sim/tumble.
    for (const id of st.cops) {
      const cop = world.movers[id];
      const def = defOf(config, cop);
      if (!cop || !def || cop.mode !== 'Road') continue;
      // A parked patrol cop shoved into a lane (riders bump: playtest 1 item 6) rolls back onto the
      // shoulder, as one with nobody to chase does; a stopped rider in a lane jams the traffic.
      if (st.phase[id] === COP_PARKED && (st.patrolAt[id] ?? -1) >= 0 && !clearOfLanes(config, cop.pos))
        drive(world, config, st, cop, def);
      else if (st.phase[id] === COP_PARKED)
        world.inputs[id] = { steer: 0, throttle: 0, brake: 255, flags: 0 };
      else {
        drive(world, config, st, cop, def);
        const input = world.inputs[id];
        if (input && copSwing(world, config, st, cop)) input.flags |= InputFlag.attack;
      }
    }
    st.clock += world.timeScale;
  },
};
