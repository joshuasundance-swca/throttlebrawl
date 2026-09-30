// sim/cops: one cop who chases, can be hit like any rider, and busts a downed player
// (docs/milestones/M1.md, cops-1). The cop is an ordinary rider with the `law` faction and a `cop`
// controller: this system is his AIController. It runs in the cops phase, after riders and
// combat, so the command it writes takes effect on the next tick; the controllers phase skips him.
//
// - Parked: he waits at the route's first `copSpawn` feature (the lot beside the road), on the
//   shoulder at the lot's road edge, until `cops.spawnDelayS` (÷ difficulty.copFrequency) has
//   passed, then sounds the siren and pulls out after you. "Slow to start a chase, then
//   relentless." A route with no `copSpawn` leaves him on sim/race's grid slot behind the field.
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
// Every timer advances by world.timeScale per tick (M1 cross-lane rule), so a hit-stop freezes
// them and M2's slow motion stretches them. All state is plain data keyed by entity id.
import { clamp, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadPos } from '../../road';
import { barrierLimits, maxYawAt } from '../riders';
import type { SimConfig, SimRiderDef } from '../types';
import { emit, systemState, type Mover, type SimSystem, type World } from '../world';

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
];

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
}

export function copsState(world: World): CopsState {
  return systemState<CopsState>(world, 'cops', () => ({
    clock: 0,
    cops: [],
    phase: [],
    target: [],
    chaosUntil: [],
    closing: [],
    closingFor: [],
    dwell: [],
    busted: [],
  }));
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
      if (spell >= MOVE_IN_TICKS) {
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
    emit(world, 'bust', by.id, { fineCash: law.fineCash, dwellTicks: dwell }, { target: m.id });
    endChase(world, st, by.id);
  }
}

export const copsSystem: SimSystem = {
  name: 'cops',
  init(world: World, config: SimConfig) {
    const st = copsState(world);
    const spawn = copSpawnPos(config);
    for (const m of world.movers) {
      if (defOf(config, m)?.controller.kind !== 'cop') continue;
      // From the lot, not the grid (M1 fields one cop; M4's spawn mix decides where more wait).
      if (spawn) {
        m.pos = { ...spawn };
        m.yaw = 0;
        m.speed = 0;
      }
      st.cops.push(m.id);
      st.phase[m.id] = COP_PARKED;
      st.target[m.id] = -1;
      st.chaosUntil[m.id] = 0;
      st.closing[m.id] = 0;
      st.closingFor[m.id] = 0;
      world.inputs[m.id] = { steer: 0, throttle: 0, brake: 255, flags: 0 };
    }
  },
  step(world: World, config: SimConfig) {
    const st = copsState(world);
    if (st.cops.length === 0) return;
    const frequency = config.difficulty.copFrequency;
    const delayTicks = frequency > 0 ? ((world.params['cops.spawnDelayS'] ?? 20) * 60) / frequency : Infinity;
    for (const id of st.cops) {
      const cop = world.movers[id];
      const def = defOf(config, cop);
      if (!cop || !def) continue;
      if (st.phase[id] === COP_PARKED && st.clock >= delayTicks) {
        st.phase[id] = COP_CHASING;
        emit(world, 'siren', id, { on: true });
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
      else drive(world, config, st, cop, def);
    }
    st.clock += world.timeScale;
  },
};
