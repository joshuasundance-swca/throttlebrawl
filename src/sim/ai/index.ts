// sim/ai: the AIController (M1 ai-1), run in the controllers phase. Rivals drive through SimInput
// exactly like the player: this phase only writes world.inputs, and riders and combat act on them.
// Each tick an AI rider:
//   1. holds the event's pace, times its own jitter, the `ai.paceScale` tuning and the race's
//      rubber-band factor (riders-3, `rubberBandFactor` in sim/race);
//   2. picks a line: its spot in the lane, a weave, or alongside a fight target (brawlers hunt);
//   3. dodges traffic ahead crudely: around it (into the oncoming lane only as risk allows) or brakes;
//   4. swings at whoever is in its reach window, the player or another rival, with side and kick flags;
//   5. unsticks itself if it has made no progress for a while.
// Law riders (cops) are not driven here: cops-1 writes their inputs from the cops phase.
// All state is plain data in systemState(world, 'ai'); randomness comes only from the `ai` stream.
import { clamp, nextFloat, sin, type EntityId, type TuningParamDecl } from '../../core';
import { maxYawAt, riderState } from '../riders';
import { raceState, rubberBandFactor } from '../race';
import { InputFlag, type SimConfig, type SimInput } from '../types';
import { systemState, type Mover, type SimSystem, type World } from '../world';
import { PED_SIZE, see, vehicleSize, weaponReach, type ObstacleSize, type Reach, type Seen } from './sense';
import { resolveProfile, type AiProfile } from './styles';

export { AI_PRESETS, resolveProfile } from './styles';
export type { AiBehaviour, AiProfile } from './styles';
export { relativeS } from './sense';

export const AI_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'ai.paceScale',
    group: 'rivals',
    label: 'Rival pace',
    default: 1,
    min: 0.8,
    max: 1.2,
    step: 0.01,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'ai.aggressionScale',
    group: 'rivals',
    label: 'Rival aggression',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
];

/** Per-rider plain state, by entity id. Tick values are raw ticks; -1 means "none". */
export interface AiState {
  /** Where in its lane this rider likes to ride, metres from the lane centre. */
  laneOffset: number[];
  /** A small personal pace factor, so the pack spreads out. */
  paceJitter: number[];
  weavePhase: number[];
  /** Current fight target, or -1. */
  targetId: number[];
  /** Tick of the last attack press, or -1. */
  pressTick: number[];
  /** Flags held through the wind-up of the last press (side and kick bits). */
  pressHold: number[];
  pressHoldTicks: number[];
  /** No new swing before this tick. */
  nextAttackTick: number[];
  /** Committed avoidance line and until when, or -1. */
  avoidD: number[];
  avoidUntil: number[];
  /** Lowest distance-to-finish seen, the tick it improved, and an unstick window. */
  bestDist: number[];
  bestTick: number[];
  unstickUntil: number[];
  /** Swings started, by rider and by target (for tests and the debug report). */
  presses: number[];
  pressesOnPlayer: number[];
}

export function aiState(world: World): AiState {
  return systemState<AiState>(world, 'ai', () => ({
    laneOffset: [],
    paceJitter: [],
    weavePhase: [],
    targetId: [],
    pressTick: [],
    pressHold: [],
    pressHoldTicks: [],
    nextAttackTick: [],
    avoidD: [],
    avoidUntil: [],
    bestDist: [],
    bestTick: [],
    unstickUntil: [],
    presses: [],
    pressesOnPlayer: [],
  }));
}

// ---- Numbers (M1 starting values, [default]) ------------------------------------------------

const COAST_DECEL = 0.6;
/** Acquisition box for a swing (M1 starting numbers): |Δs| ≤ 4 m, |Δd| ≤ 3 m. */
const ACQUIRE_S = 4;
const ACQUIRE_D = 3;
/** Lateral offset a brawler holds from its target, inside every reach box. */
const FIGHT_OFFSET_D = 1.1;
/** How much faster than its pace a hunter rides after a player who got away ahead. */
const HUNT_PACE = 0.08;
/** A rider's half width plus a margin, for avoidance. */
const RIDER_CLEAR = 0.9;
const STUCK_TICKS = 240;
const UNSTICK_TICKS = 150;
const WEAVE_PERIOD_TICKS = 240;
const TAU = 6.283185307179586;

function isAiRider(config: SimConfig, m: Mover): boolean {
  const def = config.riders[m.riderIndex];
  return m.kind === 'rider' && def?.controller.kind === 'ai' && def.faction !== 'law';
}

function profileOf(config: SimConfig, m: Mover): AiProfile {
  const c = config.riders[m.riderIndex]?.controller;
  return c?.kind === 'ai' ? resolveProfile(c.style, c.personality) : resolveProfile('racer', undefined);
}

function playerIds(world: World, config: SimConfig): EntityId[] {
  const out: EntityId[] = [];
  for (const m of world.movers) if (config.riders[m.riderIndex]?.controller.kind === 'player') out.push(m.id);
  return out;
}

function canFight(world: World, config: SimConfig, other: Mover, me: Mover): boolean {
  if (other.id === me.id || other.kind !== 'rider' || other.mode !== 'Road') return false;
  const def = config.riders[other.riderIndex];
  if (!def || def.faction === 'law') return false;
  // Someone knocked off (health 0) is out of the fight, as combat's auto-target also says.
  if ((riderState(world).health[other.id] ?? def.healthMax) <= 0) return false;
  return !raceState(world).finishOrder.includes(other.id);
}

/** Picks from candidates by the profile's target preference; `nearest` is the fallback. */
function pickByPreference(
  world: World,
  config: SimConfig,
  cands: readonly Seen[],
  prefs: readonly string[],
): Seen | null {
  if (cands.length === 0) return null;
  const race = raceState(world);
  const nearest = (): Seen | null => {
    let best: Seen | null = null;
    for (const c of cands) {
      if (!best || Math.abs(c.ahead) + Math.abs(c.dd) < Math.abs(best.ahead) + Math.abs(best.dd)) best = c;
    }
    return best;
  };
  for (const pref of prefs) {
    if (pref === 'player') {
      const hit = cands.find((c) => config.riders[c.mover.riderIndex]?.controller.kind === 'player');
      if (hit) return hit;
    } else if (pref === 'leader') {
      let best: Seen | null = null;
      for (const c of cands) {
        if (!best || (race.place[c.mover.id] ?? 99) < (race.place[best.mover.id] ?? 99)) best = c;
      }
      if (best) return best;
    } else if (pref === 'nearest') {
      return nearest();
    }
    // `grudge` and `crew-enemy` need the career's grudges and crews (M4): skipped in M1.
  }
  return nearest();
}

/** Finds the nearest mover blocking the line `d` within `look` metres ahead. */
function blockerAt(
  seen: readonly { s: Seen; size: ObstacleSize }[],
  d: number,
  look: number,
): { s: Seen; size: ObstacleSize } | null {
  let best: { s: Seen; size: ObstacleSize } | null = null;
  for (const o of seen) {
    const front = o.s.ahead - o.size.halfLength;
    if (o.s.ahead + o.size.halfLength < 0 || front > look) continue;
    if (Math.abs(o.s.mover.pos.d - d) >= o.size.halfWidth + RIDER_CLEAR) continue;
    if (!best || o.s.ahead < best.s.ahead) best = o;
  }
  return best;
}

/** Whether a line d is clear of every obstacle within `reach` metres plus 2.5 s of closing. */
function lineClear(
  seen: readonly { s: Seen; size: ObstacleSize }[],
  v: number,
  d: number,
  reach: number,
): boolean {
  for (const o of seen) {
    if (Math.abs(o.s.mover.pos.d - d) >= o.size.halfWidth + RIDER_CLEAR) continue;
    const closing = Math.max(0, v - o.s.vAlong);
    const front = o.s.ahead - o.size.halfLength;
    if (o.s.ahead + o.size.halfLength < -2) continue;
    if (front < reach + closing * 2.5) return false;
  }
  return true;
}

function steerFor(world: World, config: SimConfig, m: Mover, dTarget: number, lateralMax: number): number {
  const def = config.riders[m.riderIndex];
  const bike = def?.bike;
  if (!bike) return 0;
  const road = config.road;
  const pos = m.pos;
  const v = m.speed;
  const steerScale = world.params['riders.steerScale'] ?? 1;
  // Lateral speed wanted, in the rider's frame (its right is −d when riding toward −s).
  const vLat = clamp((dTarget - pos.d) * 1.0, -lateralMax, lateralMax) * pos.dir;
  const wantYaw = vLat / Math.max(v, 5);
  const turn = pos.dir * road.kappaAt(pos.edge, pos.s) * v + 3 * (wantYaw - m.yaw);
  const yawTarget = m.yaw + turn / 4;
  return clamp(yawTarget / maxYawAt(bike.steerRateMps, v, steerScale), -1, 1);
}

function throttleFor(config: SimConfig, m: Mover, target: number): { throttle: number; brake: number } {
  const bike = config.riders[m.riderIndex]?.bike;
  if (!bike) return { throttle: 0, brake: 0 };
  const v = m.speed;
  const t = Math.max(0, Math.min(target, bike.topSpeedMps * 0.98));
  const hold = (bike.accelMps2 * (t * t)) / (bike.topSpeedMps * bike.topSpeedMps) + COAST_DECEL;
  const throttle = clamp(hold / (bike.accelMps2 + COAST_DECEL) + 0.5 * (t - v), 0, 1);
  const over = v - t;
  const brake = over > 1.5 ? clamp((over - 1.5) * 0.35, 0, 1) : 0;
  return { throttle: brake > 0 ? 0 : throttle, brake };
}

function driveRider(
  world: World,
  config: SimConfig,
  m: Mover,
  st: AiState,
  players: readonly EntityId[],
): SimInput {
  const road = config.road;
  const def = config.riders[m.riderIndex];
  const race = raceState(world);
  const prof = profileOf(config, m);
  const pos = m.pos;
  const v = m.speed;
  const id = m.id;
  const tick = world.tick;
  const edge = road.edges[pos.edge];
  const dLo = (edge?.dMin ?? -5) + 0.7;
  const dHi = (edge?.dMax ?? 5) - 0.7;
  const finished = race.finishOrder.includes(id);
  // Once every player is home the fight is over: the rest hurry to the line for the results.
  const playersDone = players.length > 0 && players.every((p) => race.finishOrder.includes(p));
  const racing = !finished && !playersDone;

  // Progress watch: unstick after STUCK_TICKS without 2 m of progress.
  const dist = race.distanceToFinish[id] ?? Infinity;
  if (dist < (st.bestDist[id] ?? Infinity) - 2) {
    st.bestDist[id] = dist;
    st.bestTick[id] = tick;
  }
  if (!finished && tick - (st.bestTick[id] ?? 0) > STUCK_TICKS && (st.unstickUntil[id] ?? -1) < tick) {
    st.unstickUntil[id] = tick + UNSTICK_TICKS;
    st.bestTick[id] = tick;
  }
  const unsticking = (st.unstickUntil[id] ?? -1) >= tick;

  // 1. Pace.
  const paceScale = world.params['ai.paceScale'] ?? 1;
  let speedTarget = config.event.paceMps * (st.paceJitter[id] ?? 1) * paceScale * rubberBandFactor(world, id);
  if (finished) speedTarget = Math.min(speedTarget, 12);
  else if (playersDone) speedTarget = def?.bike.topSpeedMps ?? speedTarget;

  // 2. The line: own spot in the lane, plus a weave.
  const lanes = road.lanesAt(pos.edge, pos.s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === pos.dir) ?? lanes[0];
  const laneCentre = lane?.dCenterM ?? 0;
  const laneHalf = Math.max(0, (lane?.widthM ?? 3) / 2 - 0.6);
  const weave = prof.weave * 1.4 * sin((st.weavePhase[id] ?? 0) + (tick * TAU) / WEAVE_PERIOD_TICKS);
  let dTarget = laneCentre + clamp((st.laneOffset[id] ?? 0) + weave, -laneHalf, laneHalf);
  let lateralMax = 3;

  // Everyone this rider can see.
  const look = clamp(14 + v * 2.2, 14, 90);
  const riders: Seen[] = [];
  const obstacles: { s: Seen; size: ObstacleSize }[] = [];
  const vSize = vehicleSize(config);
  for (const other of world.movers) {
    if (other.id === id) continue;
    if (other.kind === 'rider') {
      if (!canFight(world, config, other, m)) continue;
      const s = see(road, m, other, 60);
      if (s) riders.push(s);
    } else if (other.kind === 'vehicle' || other.kind === 'ped') {
      const s = see(road, m, other, look + 60);
      if (s) obstacles.push({ s, size: other.kind === 'vehicle' ? vSize : PED_SIZE });
    }
  }

  // Fight: brawlers hunt a target when healthy enough; everyone swings at whoever is in reach.
  const aggr =
    prof.aggression * (world.params['ai.aggressionScale'] ?? 1) * config.difficulty.riderAggression;
  const healthMax = def?.healthMax ?? 100;
  const health = riderState(world).health[id] ?? healthMax;
  const brave = health / Math.max(1, healthMax) >= 0.5 * (1 - prof.courage);
  let target: Seen | null = null;
  if (racing && !unsticking && prof.behaviour === 'brawler' && brave && aggr > 0) {
    const seekRange = 10 + 30 * Math.min(1, aggr);
    const current = st.targetId[id] ?? -1;
    const keep = riders.find((r) => r.mover.id === current && Math.abs(r.ahead) <= seekRange * 1.3);
    target =
      keep ??
      pickByPreference(
        world,
        config,
        riders.filter((r) => Math.abs(r.ahead) <= seekRange),
        prof.targetPreference,
      );
  }
  st.targetId[id] = target ? target.mover.id : -1;
  if (target) {
    let side = prof.preferredSide === 'left' ? -pos.dir : prof.preferredSide === 'right' ? pos.dir : 0;
    if (side === 0) side = target.dd > 0 ? -1 : 1; // stay on the side I'm already on
    let d = target.mover.pos.d + side * FIGHT_OFFSET_D;
    if (d < dLo || d > dHi) d = target.mover.pos.d - side * FIGHT_OFFSET_D;
    dTarget = clamp(d, dLo, dHi);
    lateralMax = 3.5;
    // Close the gap along the road: chase hard, wait gently. A brawler waits (drops below its
    // pace) only for a player behind it, easing off rather than braking so it is still near the
    // player's speed when they meet; a rival behind it is left to catch up, so rival fights don't
    // stall the pack.
    const waitsFor = players.includes(target.mover.id) ? config.event.paceMps * 0.6 : speedTarget;
    const gain = target.ahead >= 0 ? 0.8 : 0.25;
    speedTarget = clamp(target.vAlong + target.ahead * gain, waitsFor, speedTarget * 1.15);
  } else if (
    racing &&
    prof.behaviour === 'brawler' &&
    brave &&
    aggr > 0 &&
    prof.targetPreference[0] === 'player' &&
    players.some((p) => (race.distanceToFinish[p] ?? Infinity) < dist)
  ) {
    // A hunter keeps after a player who got away ahead, a little above its pace.
    speedTarget *= 1 + HUNT_PACE * Math.min(1, aggr);
  }

  // Unsticking: back up to pace (traffic below still has the last word on speed).
  if (unsticking) speedTarget = Math.max(speedTarget, config.event.paceMps * 0.8);

  // 3. Traffic: go around the nearest blocker, or brake behind it.
  const committed = (st.avoidUntil[id] ?? -1) >= tick;
  if (committed) dTarget = st.avoidD[id] ?? dTarget;
  const blocker = blockerAt(obstacles, dTarget, look) ?? blockerAt(obstacles, pos.d, look * 0.5);
  if (blocker) {
    const o = blocker.s;
    const gap = o.ahead - blocker.size.halfLength;
    const closing = v - o.vAlong;
    const ttc = closing > 0.1 ? gap / closing : Infinity;
    if (ttc < 3.5 || gap < 10) {
      const od = o.mover.pos.d;
      const w = blocker.size.halfWidth + RIDER_CLEAR + 0.4;
      let best: number | null = null;
      let bestCost = Infinity;
      for (const cand of [od - w, od + w, od - w - 1, od + w + 1]) {
        if (cand < dLo || cand > dHi) continue;
        if (!lineClear(obstacles, v, cand, gap + 20)) continue;
        const risk = unsticking ? 1 : prof.riskTaking;
        const oncoming = cand * pos.dir < 0 ? (1.2 - risk) * 4 : 0;
        const cost = Math.abs(cand - pos.d) + oncoming;
        if (cost < bestCost) {
          bestCost = cost;
          best = cand;
        }
      }
      if (best !== null) {
        dTarget = best;
        lateralMax = 5;
        st.avoidD[id] = best;
        st.avoidUntil[id] =
          tick + Math.round(((gap + 2 * blocker.size.halfLength + 8) / Math.max(v, 5)) * 60) + 20;
        // Not across yet and close: ease off until the line opens.
        if (Math.abs(pos.d - best) > w * 0.6 && gap < v * 0.9)
          speedTarget = Math.min(speedTarget, o.vAlong + 3);
      } else {
        // Boxed in: a speed that stops about 4 m behind it, braking at 5 m/s².
        const room = Math.max(0, gap - 4);
        speedTarget = Math.min(speedTarget, Math.max(0, o.vAlong) + Math.sqrt(2 * 5 * room));
        st.avoidUntil[id] = -1;
      }
    }
  }
  // 4. Swing at whoever is in the reach window (predicted to the end of the wind-up).
  let flags = 0;
  const held =
    (st.pressTick[id] ?? -1) >= 0 && tick - (st.pressTick[id] ?? 0) <= (st.pressHoldTicks[id] ?? 0);
  if (held) flags |= st.pressHold[id] ?? 0;
  if (racing && !unsticking && aggr > 0 && tick >= (st.nextAttackTick[id] ?? 0)) {
    flags |= trySwing(world, config, m, st, prof, riders, target, aggr, players);
  }

  const { throttle, brake } = throttleFor(config, m, speedTarget);
  const steer = steerFor(world, config, m, clamp(dTarget, dLo, dHi), lateralMax);
  return {
    steer: Math.round(steer * 127),
    throttle: Math.round(throttle * 255),
    brake: Math.round(brake * 255),
    flags,
  };
}

function inReach(s: Seen, v: number, r: Reach): boolean {
  const ds = s.ahead + (s.vAlong - v) * (r.windupTicks / 60);
  return Math.abs(ds) <= r.sM && Math.abs(s.dd) <= r.dM;
}

function trySwing(
  world: World,
  config: SimConfig,
  m: Mover,
  st: AiState,
  prof: AiProfile,
  riders: readonly Seen[],
  target: Seen | null,
  aggr: number,
  players: readonly EntityId[],
): number {
  const punch = weaponReach(config, 'punch');
  const kick = weaponReach(config, 'kick');
  const v = m.speed;
  const box = riders.filter((r) => Math.abs(r.ahead) <= ACQUIRE_S && Math.abs(r.dd) <= ACQUIRE_D);
  const reachable = box.filter((r) => inReach(r, v, punch) || inReach(r, v, kick));
  if (reachable.length === 0) return 0;
  const victim =
    (target && reachable.find((r) => r.mover.id === target.mover.id)) ??
    pickByPreference(world, config, reachable, prof.targetPreference);
  if (!victim) return 0;
  const rng = world.rng.ai;
  const chance = Math.min(0.5, (0.02 + 0.1 * aggr) * (target && victim.mover.id === target.mover.id ? 2 : 1));
  if (nextFloat(rng) >= chance) return 0;
  const canKick = inReach(victim, v, kick);
  const canPunch = inReach(victim, v, punch);
  const useKick = canKick && (!canPunch || nextFloat(rng) < 0.25 + 0.6 * prof.dirtiness);
  const r = useKick ? kick : punch;
  // Side flags are in the rider's frame: its right is +d when riding toward +s.
  const side = victim.dd * m.pos.dir > 0 ? InputFlag.attackSideRight : InputFlag.attackSideLeft;
  const hold = side | (useKick ? InputFlag.kick : 0);
  const tick = world.tick;
  const id = m.id;
  st.pressTick[id] = tick;
  st.pressHold[id] = hold;
  st.pressHoldTicks[id] = r.windupTicks;
  st.nextAttackTick[id] =
    tick + r.cycleTicks + Math.round((1 - Math.min(1, aggr)) * 40 + nextFloat(rng) * 20);
  st.presses[id] = (st.presses[id] ?? 0) + 1;
  if (players.includes(victim.mover.id)) st.pressesOnPlayer[id] = (st.pressesOnPlayer[id] ?? 0) + 1;
  return InputFlag.attack | hold;
}

export const aiSystem: SimSystem = {
  name: 'controllers',
  init(world: World, config: SimConfig) {
    const st = aiState(world);
    const rng = world.rng.ai;
    for (const m of world.movers) {
      if (!isAiRider(config, m)) continue;
      // Rolled in ascending id order at race start, so they are the same for a seed.
      st.laneOffset[m.id] = (nextFloat(rng) * 2 - 1) * 0.9;
      st.paceJitter[m.id] = 0.97 + nextFloat(rng) * 0.06;
      st.weavePhase[m.id] = nextFloat(rng) * TAU;
      st.targetId[m.id] = -1;
      st.pressTick[m.id] = -1;
      st.pressHold[m.id] = 0;
      st.pressHoldTicks[m.id] = 0;
      st.nextAttackTick[m.id] = 120; // no swings off the start line
      st.avoidD[m.id] = 0;
      st.avoidUntil[m.id] = -1;
      st.bestDist[m.id] = config.route.length + 1000;
      st.bestTick[m.id] = 0;
      st.unstickUntil[m.id] = -1;
      st.presses[m.id] = 0;
      st.pressesOnPlayer[m.id] = 0;
    }
  },
  step(world: World, config: SimConfig) {
    const st = aiState(world);
    const players = playerIds(world, config);
    for (const m of world.movers) {
      if (!isAiRider(config, m)) continue;
      if (m.mode === 'Road') {
        world.inputs[m.id] = driveRider(world, config, m, st, players);
      } else if (m.mode === 'Airborne') {
        const prev = world.inputs[m.id];
        world.inputs[m.id] = { steer: 0, throttle: prev?.throttle ?? 0, brake: 0, flags: 0 };
      } else {
        // Down (Tumble or OnFoot): ask for the quick remount; tumble-1 decides when it happens.
        world.inputs[m.id] = { steer: 0, throttle: 0, brake: 0, flags: InputFlag.skipRunBack };
        st.bestTick[m.id] = world.tick;
      }
    }
  },
};
