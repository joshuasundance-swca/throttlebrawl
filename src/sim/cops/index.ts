// sim/cops: one cop who chases, can be hit like any rider, and busts a downed player
// (docs/milestones/M1.md, cops-1). The cop is an ordinary rider with the `law` faction and a `cop`
// controller: this system is his AIController. It runs in the cops phase, after riders and
// combat, so the command it writes takes effect on the next tick; the controllers phase skips him.
//
// - Parked: he waits where he starts until `cops.spawnDelayS` (÷ difficulty.copFrequency) has
//   passed, then sounds the siren and gives chase. "Slow to start a chase, then relentless."
// - Chase: he targets the nearest player, or whoever caused chaos (a hit or kick) near him in the
//   last 10 s. While the target rides he closes to `cops.followGapM` behind and holds there, so
//   he does not shadow every crash; once the target is down he pulls up beside him.
// - Bust: a player who is down (Tumble or OnFoot) within `law.bustRadiusM` × `cops.bustRadiusScale`
//   of an upright, spawned cop for `law.bustDwellS` × `cops.bustDwellScale` of scaled time is
//   busted: a `bust` event with the fine, once per player. Race end on a bust is sim/race's.
//
// Every timer advances by world.timeScale per tick (M1 cross-lane rule), so a hit-stop freezes
// them and M2's slow motion stretches them. All state is plain data keyed by entity id.
import { clamp, type EntityId, type TuningParamDecl } from '../../core';
import { maxYawAt } from '../riders';
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
const COAST_DECEL = 0.6; // m/s², the riding model's off-throttle deceleration

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

/** The cop's command for the next tick: close on the target, hold the gap, or pull up beside him. */
function drive(world: World, config: SimConfig, st: CopsState, cop: Mover, def: SimRiderDef): void {
  const bike = def.bike;
  const pos = cop.pos;
  const v = cop.speed;
  const target = st.phase[cop.id] === COP_CHASING ? world.movers[st.target[cop.id] ?? -1] : undefined;

  let vWant = 0;
  let dWant = pos.d;
  if (target) {
    const gap = gapAlongRoute(config, cop, target);
    const decel = bike.brakeMps2 * 0.6;
    if (isDown(target)) {
      // Pull up just behind him: the speed from which braking stops the bike in time.
      const room = gap - PULL_UP_GAP_M;
      vWant = room > 0 ? Math.sqrt(2 * decel * room) : 0;
      dWant = target.pos.d;
    } else {
      // Close to the follow gap, then match his speed; brake early enough not to overshoot.
      const followGap = world.params['cops.followGapM'] ?? 40;
      const room = gap - followGap;
      vWant = room > 0 ? target.speed + Math.sqrt(2 * decel * room) : target.speed + 0.5 * room;
      if (gap < 30) dWant = target.pos.d;
    }
    vWant = clamp(vWant, 0, bike.topSpeedMps);
  }
  if (!target) {
    // Nothing to chase: keep to the travel lane and roll to a stop.
    const lanes = config.road.lanesAt(pos.edge, pos.s);
    dWant = (lanes.find((l) => l.kind === 'drive' && l.direction === pos.dir) ?? lanes[0])?.dCenterM ?? pos.d;
  }

  const err = vWant - v;
  let throttle = 0;
  let brake = 0;
  if (vWant <= 0.05 && v < 0.5) brake = 1;
  else if (err >= 0)
    throttle = clamp(holdThrottle(bike.accelMps2, bike.topSpeedMps, vWant) + 0.5 * err, 0, 1);
  else if (err < -0.5) brake = clamp(-err * 0.3, 0, 1);

  // Steering: a lateral speed toward dWant, with the road's curvature fed forward (as sim/ai).
  const edge = config.road.edges[pos.edge];
  if (edge) dWant = clamp(dWant, edge.dMin + 0.8, edge.dMax - 0.8);
  const steerScale = world.params['riders.steerScale'] ?? 1;
  const vLat = clamp((dWant - pos.d) * 0.8, -3, 3) * pos.dir;
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
    for (const m of world.movers) {
      if (defOf(config, m)?.controller.kind !== 'cop') continue;
      st.cops.push(m.id);
      st.phase[m.id] = COP_PARKED;
      st.target[m.id] = -1;
      st.chaosUntil[m.id] = 0;
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
        st.target[id] = pickTarget(world, config, st, cop);
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
