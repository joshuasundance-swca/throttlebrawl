// sim/ai: the AIController (M1 ai-1), run in the controllers phase. Rivals drive through SimInput
// exactly like the player: this phase only writes world.inputs, and riders and combat act on them.
// Each tick an AI rider:
//   1. holds the event's pace, times its own jitter, the `ai.paceScale` tuning and the race's
//      rubber-band factor (riders-3, `rubberBandFactor` in sim/race);
//   2. picks a line: its spot in the lane, a weave, or alongside a fight target (brawlers hunt);
//   3. dodges traffic ahead crudely: around it (into the oncoming lane only as risk allows) or brakes;
//   4. swings at whoever is in its reach window, the player or another rival, with side and kick flags;
//   5. unsticks itself if it has made no progress for a while.
// M2 ai-2 adds: a race-long grudge (a rider who noted a grudge against someone, through tumble-2's
// noteGrudge, puts them first in its target choice and comes looking for them until the finish),
// takedown intent (a brawler rides on the side of its target that lets its hits push the target
// toward an oncoming car or a rail), and difficulty (the preset's
// aggression scale here; its rubber-band scale in sim/race's rubberBandBounds).
// M4 rivals-1 (built early) adds the cast's styles (styles.ts: weaver, showboat, grudge-keeper,
// scrapper, crowd-pleaser, crew-boss), authored rivalries (a rider's `rivals` are hunted like a
// grudge, with no grudge needed), the career's saved grudge table (`SimConfig.grudges`: points at or
// above `ai.grudgeHuntAt` make the holder hunt that rider from the start), and a preferred weapon
// (an unarmed rider steers over a lying pickup of it).
// Law riders (cops) are not driven here: cops-1 writes their inputs from the cops phase.
// All state is plain data in systemState(world, 'ai'); randomness comes only from the `ai` stream.
import { clamp, nextFloat, sin, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadNetwork } from '../../road';
import { combatView, pickupWeapon, STOWED_H } from '../combat';
import { maxYawAt, riderState } from '../riders';
import { raceState, rubberBandFactor } from '../race';
import { InputFlag, type SimConfig, type SimInput } from '../types';
import { systemState, type Mover, type SimSystem, type World } from '../world';
import { PED_SIZE, see, vehicleSize, weaponReach, type ObstacleSize, type Reach, type Seen } from './sense';
import {
  BELL_TELL_TICKS,
  holdForBell,
  initSignature,
  interruptSignature,
  moveOf,
  releaseBell,
  RELENTLESS_AGGRESSION,
  signatureState,
  slowBurn,
  stepSignature,
  type SignatureOut,
} from './signature';
import { bareId, resolveProfile, type AiProfile } from './styles';

export { AI_PRESETS, AI_STYLE_IDS, bareId, huntsByDefault, NEUTRAL_TRAITS, resolveProfile } from './styles';
export type { AiBehaviour, AiProfile, AiStyleId, AiTraits } from './styles';
export { relativeS } from './sense';
export { oncomingSide, signatureState, signatureView } from './signature';
export type { SignatureState } from './signature';

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
  {
    // rivals-1: 1 gives each style its quirks (weaver swerves, showboat picks safe fights and so on);
    // 0 keeps the style's numbers but rides M1's two behaviour sets. ON by default [default] since
    // the integration round (2026-10-01): the maintainer wants fun and variety (playtest 1c, "keep
    // things fun"), and with them on the eight rivals ride visibly differently. 0 rides as before.
    id: 'ai.styleQuirks',
    group: 'rivals',
    label: 'Rival style quirks',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
  },
  {
    // rivals-1: grudge points (from the career's saved table) at which a rival hunts the rider it holds
    // them against from the start of the race; the content-pack doc's example `huntThreshold`.
    id: 'ai.grudgeHuntAt',
    group: 'rivals',
    label: 'Career grudge to hunt',
    default: 4,
    min: 1,
    max: 10,
    step: 1,
    unit: 'pts',
    affectsSim: true,
  },
  {
    // Interview, 2026-10-02 ("Visible personalities"): 1 lets each rival do its signature move
    // (signature.ts: Chad's selfie, the Mayor's wave, Gus's bell and so on); 0 turns them all off.
    id: 'ai.signatures',
    group: 'rivals',
    label: 'Rival signature moves',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
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
  /** Ticks spent hunting a player as its fight target (for tests and the debug report). */
  huntTicksOnPlayer: number[];
  /** Takedown intent (ai-2): the push direction it committed to (±1, 0 none) and until which tick. */
  pushSide: number[];
  pushUntil: number[];
  /** rivals-1: hits taken, by victim entity id, then attacker entity id (the grudge-keeper's tally). */
  wrongs: Record<string, Record<string, number>>;
  /** rivals-1: who last landed a hit on this rider, and on which tick (-1: nobody yet). */
  lastHitBy: number[];
  lastHitTick: number[];
  /** rivals-1: riders this one hunts from the start, from the career's grudge table (entity ids). */
  careerGrudge: number[][];
  /** rivals-1 counters, for tests and the debug report: swings at the race leader, ticks spent
   * fleeing, and ticks spent steering for a preferred weapon. */
  pressesOnLeader: number[];
  fleeTicks: number[];
  seekTicks: number[];
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
    huntTicksOnPlayer: [],
    pushSide: [],
    pushUntil: [],
    wrongs: {},
    lastHitBy: [],
    lastHitTick: [],
    careerGrudge: [],
    pressesOnLeader: [],
    fleeTicks: [],
    seekTicks: [],
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
/** How far out traffic is seen, and how many seconds of closing make a car a blocker. */
const SEE_TRAFFIC_M = 250;
const BLOCK_AHEAD_S = 4;
/** Look-ahead for checking a chosen line against traffic, metres (plus 2.5 s of closing). */
const LINE_CHECK_M = 15;
/** Seconds of warning a rider takes from a faster car coming up behind it. */
const PASS_WARN_S = 3;
/** Along-road margin past a vehicle's ends within which it counts as alongside, m. */
const ALONGSIDE_MARGIN_M = 2.5;
const STUCK_TICKS = 240;
const UNSTICK_TICKS = 150;
// rivals-1 (M4, [default]).
/** How long a launch trait (slow or quick off the line) lasts from the start, ticks. */
const LAUNCH_TICKS = 720;
/** A fleeing rider moves this far across from the nearest rider within FLEE_NEAR_M, and rides faster. */
const FLEE_AWAY_M = 3;
const FLEE_NEAR_M = 12;
const FLEE_PACE = 0.05;
/** A road weaver swerves only inside its lane while another rider is this close along the road, m. */
const ROAD_WEAVE_CLEAR_M = 10;
/** A defending rider counts a rider this far behind it (metres) as closing in on it. */
const CHASER_BEHIND_M = 8;
/** How far ahead an unarmed rider looks for its preferred weapon lying on the road, metres. */
const WEAPON_SEEK_M = 80;
/** The grudge-keeper's swing chance grows by this much per wrong, for up to TALLY_KEEN_MAX wrongs. */
const TALLY_KEEN = 0.25;
const TALLY_KEEN_MAX = 4;
const TAU = 6.283185307179586;
// ai-2 takedown intent (M2, [default]).
/** A rail this close to the target's side of the road (metres of d) is worth pushing it toward. */
const RAIL_NEAR_M = 3.5;
/** An oncoming car within this many seconds of closing (plus a margin) makes the oncoming side the pick. */
const ONCOMING_WARN_S = 4;
const ONCOMING_MARGIN_M = 20;
/** Changing sides round a target is done only this far ahead of or behind it, never through it. */
const SIDE_SWITCH_S = 2.5;
/** While changing sides, a brawler holds the target this far ahead of itself. */
const SWITCH_BACK_M = 4;
/** How long a brawler sticks to a push direction once it picks one, so passing cars and a rail don't flip it. */
const PUSH_COMMIT_TICKS = 180;

function isAiRider(config: SimConfig, m: Mover): boolean {
  const def = config.riders[m.riderIndex];
  return m.kind === 'rider' && def?.controller.kind === 'ai' && def.faction !== 'law';
}

function profileOf(world: World, config: SimConfig, m: Mover): AiProfile {
  const c = config.riders[m.riderIndex]?.controller;
  const quirks = (world.params['ai.styleQuirks'] ?? 0) >= 0.5;
  return c?.kind === 'ai'
    ? resolveProfile(c.style, c.personality, quirks)
    : resolveProfile('racer', undefined, quirks);
}

/** A mover's bare rider id (`chad-speedwell`), or '' for a non-rider. */
function riderIdOf(config: SimConfig, m: Mover): string {
  const def = config.riders[m.riderIndex];
  return m.kind === 'rider' && def ? bareId(def.contentId) : '';
}

/**
 * Everyone `id` hunts as a grudge this tick, in ascending id order: the race-long grudges (ai-2),
 * the career's saved ones, the grudge-keeper's tally, and the scrapper's fresh score to settle.
 * Riders who have finished are left out. The tally hunts players only: every wrong is counted (and
 * makes him swing harder at whoever did it), but a tally against another rival would pull him off
 * the player, and playtest 1 asked that the rivals' pressure on the player stay as it was.
 */
function huntList(
  world: World,
  st: AiState,
  prof: AiProfile,
  id: EntityId,
  players: readonly EntityId[],
): EntityId[] {
  const out = grudgeTargets(world, id);
  const done = raceState(world).finishOrder;
  const add = (g: number): void => {
    if (g >= 0 && g !== id && !out.includes(g) && !done.includes(g)) out.push(g);
  };
  for (const g of st.careerGrudge[id] ?? []) add(g);
  const tr = prof.traits;
  if (tr.tally > 0) {
    for (const [k, n] of Object.entries(st.wrongs[id] ?? {})) {
      if (n >= tr.tally && players.includes(Number(k))) add(Number(k));
    }
  }
  if (tr.retaliateTicks > 0 && world.tick - (st.lastHitTick[id] ?? -1e9) <= tr.retaliateTicks) {
    add(st.lastHitBy[id] ?? -1);
  }
  return out.sort((a, b) => a - b);
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

/**
 * The riders `id` holds a race-long grudge against (noted by tumble-2 through `noteGrudge`), in
 * ascending id order. Racers who have finished are left out: the grudge ends at their finish.
 */
export function grudgeTargets(world: World, id: EntityId): EntityId[] {
  const out: EntityId[] = [];
  const race = raceState(world);
  for (const [against, holders] of Object.entries(world.facts.grudgeNotedBy)) {
    const target = Number(against);
    if (holders.includes(id) && !race.finishOrder.includes(target)) out.push(target);
  }
  return out;
}

/** The target preference with `grudge` first when this rider holds a grudge (ai-2). */
function preferences(prof: AiProfile, grudges: readonly EntityId[]): readonly string[] {
  if (grudges.length === 0) return prof.targetPreference;
  return ['grudge', ...prof.targetPreference.filter((p) => p !== 'grudge')];
}

/** Picks from candidates by the profile's target preference; `nearest` is the fallback. */
function pickByPreference(
  world: World,
  config: SimConfig,
  cands: readonly Seen[],
  prefs: readonly string[],
  grudges: readonly EntityId[] = [],
  rivals: readonly string[] = [],
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
    if (pref === 'grudge') {
      // The race-long grudge (ai-2): the nearest rider this one holds a grudge against.
      let best: Seen | null = null;
      for (const c of cands) {
        if (!grudges.includes(c.mover.id)) continue;
        if (!best || Math.abs(c.ahead) + Math.abs(c.dd) < Math.abs(best.ahead) + Math.abs(best.dd)) best = c;
      }
      if (best) return best;
    } else if (pref === 'rival') {
      // An authored rivalry (rivals-1): the nearest rider on this one's `rivals` list.
      let best: Seen | null = null;
      for (const c of cands) {
        if (!rivals.includes(riderIdOf(config, c.mover))) continue;
        if (!best || Math.abs(c.ahead) + Math.abs(c.dd) < Math.abs(best.ahead) + Math.abs(best.dd)) best = c;
      }
      if (best) return best;
    } else if (pref === 'chaser') {
      // Someone closing in from behind (rivals-1's crew-boss): the nearest rider just behind or level.
      let best: Seen | null = null;
      for (const c of cands) {
        if (c.ahead > 1 || c.ahead < -CHASER_BEHIND_M) continue;
        if (!best || Math.abs(c.ahead) + Math.abs(c.dd) < Math.abs(best.ahead) + Math.abs(best.dd)) best = c;
      }
      if (best) return best;
    } else if (pref === 'player') {
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
    // `crew-enemy` needs crews in SimConfig (a follow-up): skipped until then. The career's saved
    // grudges join the race-long ones in `grudges` (rivals-1).
  }
  return nearest();
}

/**
 * Takedown intent (ai-2): the way along road d (+1 or −1) a hit should push the target, or 0 for
 * no preference. An oncoming car about to pass the target on its oncoming side wins; then a rail
 * close to the target. With neither, there is nothing to push the target into, so no preference:
 * the brawler keeps the side it is on (M1), rather than circling a target for an empty road. The
 * victim of a hit is knocked away from the attacker, so the attacker rides on the other side.
 */
export function takedownPush(
  road: RoadNetwork,
  target: Mover,
  obstacles: readonly { s: Seen; size: ObstacleSize }[],
): number {
  const t = target.pos;
  // The oncoming side of the road: where its drive lanes lie against the target's own.
  let own = 0;
  let ownN = 0;
  let other = 0;
  let otherN = 0;
  for (const l of road.lanesAt(t.edge, t.s)) {
    if (l.kind !== 'drive') continue;
    if (l.direction === t.dir) {
      own += l.dCenterM;
      ownN++;
    } else {
      other += l.dCenterM;
      otherN++;
    }
  }
  const oncoming = otherN === 0 ? 0 : other / otherN >= (ownN === 0 ? t.d : own / ownN) ? 1 : -1;
  if (oncoming !== 0) {
    for (const o of obstacles) {
      if (o.s.vAlong >= 0 || o.s.mover.kind !== 'vehicle') continue;
      if ((o.s.mover.pos.d - t.d) * oncoming <= 0) continue;
      const front = o.s.ahead - o.size.halfLength;
      if (o.s.ahead + o.size.halfLength < 0) continue;
      if (front <= (target.speed - o.s.vAlong) * ONCOMING_WARN_S + ONCOMING_MARGIN_M) return oncoming;
    }
  }
  const edge = road.edges[t.edge];
  if (edge) {
    for (const side of [1, -1] as const) {
      const b = road.barrierAt(t.edge, t.s, side > 0 ? 'right' : 'left');
      if (b?.kind !== 'rail') continue;
      const rim = side > 0 ? edge.dMax : edge.dMin;
      if (Math.abs(rim - t.d) <= RAIL_NEAR_M) return side;
    }
  }
  return 0;
}

/**
 * The push direction a brawler acts on: a new nonzero pick holds for PUSH_COMMIT_TICKS, and while
 * it holds, a different pick (or none) does not replace it.
 */
function committedPush(st: AiState, id: EntityId, tick: number, raw: number): number {
  const held = st.pushSide[id] ?? 0;
  if (held !== 0 && tick < (st.pushUntil[id] ?? -1) && raw !== held) return held;
  if (raw !== 0) {
    st.pushSide[id] = raw;
    st.pushUntil[id] = tick + PUSH_COMMIT_TICKS;
  }
  return raw;
}

/**
 * Finds the nearest mover blocking the line `d` within `look` metres ahead, or further when it is
 * closing fast (an oncoming car is seen BLOCK_AHEAD_S seconds out, whatever the distance).
 */
function blockerAt(
  seen: readonly { s: Seen; size: ObstacleSize }[],
  v: number,
  d: number,
  look: number,
): { s: Seen; size: ObstacleSize } | null {
  let best: { s: Seen; size: ObstacleSize } | null = null;
  for (const o of seen) {
    const front = o.s.ahead - o.size.halfLength;
    const reach = Math.max(look, (v - o.s.vAlong) * BLOCK_AHEAD_S);
    if (o.s.ahead + o.size.halfLength < 0 || front > reach) continue;
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

/** Whether every line from `from` to `to` (every half metre) is clear: getting there is safe too. */
function pathClear(
  seen: readonly { s: Seen; size: ObstacleSize }[],
  v: number,
  from: number,
  to: number,
  reach: number,
): boolean {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / 0.5));
  for (let i = 1; i <= steps; i++) {
    if (!lineClear(seen, v, from + ((to - from) * i) / steps, reach)) return false;
  }
  return true;
}

function steerFor(
  world: World,
  config: SimConfig,
  m: Mover,
  dTarget: number,
  lateralMax: number,
  gain: number,
): number {
  const def = config.riders[m.riderIndex];
  const bike = def?.bike;
  if (!bike) return 0;
  const road = config.road;
  const pos = m.pos;
  const v = m.speed;
  const steerScale = world.params['riders.steerScale'] ?? 1;
  // Lateral speed wanted, in the rider's frame (its right is −d when riding toward −s).
  const vLat = clamp((dTarget - pos.d) * gain, -lateralMax, lateralMax) * pos.dir;
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
  const prof = profileOf(world, config, m);
  const tr = prof.traits;
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
  let speedTarget =
    config.event.paceMps * (st.paceJitter[id] ?? 1) * paceScale * rubberBandFactor(world, id) * tr.paceBias;
  // Quick off the line (rivals-1): it aims higher for the first seconds. Slow off the line caps the
  // throttle instead, below.
  const launching = tick < LAUNCH_TICKS;
  if (launching && tr.launch > 1) speedTarget *= tr.launch;
  if (finished) speedTarget = Math.min(speedTarget, 12);
  else if (playersDone) speedTarget = def?.bike.topSpeedMps ?? speedTarget;

  // 2. The line: own spot in the lane, plus a weave. An erratic weaver's swing jumps now and then,
  // and a road weaver's swing is not held inside its own lane (traffic checks below still apply).
  const lanes = road.lanesAt(pos.edge, pos.s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === pos.dir) ?? lanes[0];
  const laneCentre = lane?.dCenterM ?? 0;
  const laneHalf = Math.max(0, (lane?.widthM ?? 3) / 2 - 0.6);
  if (tr.erratic > 0 && racing && nextFloat(world.rng.ai) < tr.erratic / 60) {
    st.weavePhase[id] = ((st.weavePhase[id] ?? 0) + (0.5 + nextFloat(world.rng.ai)) * (TAU / 2)) % TAU;
  }
  const weave =
    prof.weave * tr.weaveSpanM * sin((st.weavePhase[id] ?? 0) + (tick * TAU) / tr.weavePeriodTicks);
  const swing = (st.laneOffset[id] ?? 0) + weave;
  let dTarget = tr.roadWeave
    ? clamp(laneCentre + swing, dLo, dHi)
    : laneCentre + clamp(swing, -laneHalf, laneHalf);
  let lateralMax = 3;
  let lateralGain = 1;
  if (finished) {
    // Home: pull onto its own side's shoulder, clear of the lane, so nobody still racing (and no
    // car behind it) is walled off by a rider parked in the lane at the road's end.
    const shoulder = lanes.find((l) => l.kind === 'shoulder' && l.direction === pos.dir);
    if (shoulder) {
      dTarget = shoulder.dCenterM;
      lateralMax = 5;
      lateralGain = 3; // the road ends soon after the line: get across quickly
    }
  }

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
      const s = see(road, m, other, SEE_TRAFFIC_M);
      if (s) obstacles.push({ s, size: other.kind === 'vehicle' ? vSize : PED_SIZE });
    }
  }
  // A road weaver keeps its swerve inside its lane while other riders are close, so a bunched pack
  // (the start, a fight) does not turn its swerve into random bumps (rivals-1).
  if (tr.roadWeave && !finished && riders.some((r) => Math.abs(r.ahead) < ROAD_WEAVE_CLEAR_M)) {
    dTarget = laneCentre + clamp(swing, -laneHalf, laneHalf);
  }

  // Fight: brawlers hunt a target when healthy enough; everyone swings at whoever is in reach.
  let aggr = prof.aggression * (world.params['ai.aggressionScale'] ?? 1) * config.difficulty.riderAggression;
  const healthMax = def?.healthMax ?? 100;
  const health = riderState(world).health[id] ?? healthMax;
  const healthFrac = health / Math.max(1, healthMax);
  let brave = tr.fearless || healthFrac >= 0.5 * (1 - prof.courage);
  // A crowd-pleaser whose fight has turned stops fighting and rides away (rivals-1).
  const fleeing = racing && tr.fleeBelow > 0 && healthFrac < tr.fleeBelow;
  // A race-long grudge (ai-2) makes any rider a hunter of the riders it holds the grudge against,
  // and so do the career's saved grudges, the grudge-keeper's tally, the scrapper's score to settle
  // and an authored rivalry (rivals-1); a brawler hunts anyone, grudges first.
  const grudges = huntList(world, st, prof, id, players);
  // Signature moves (interview, 2026-10-02: "Visible personalities"; signature.ts).
  const move = moveOf(world, id);
  // Deacon's slow burn: calm and simmering, he picks no fight and throws nothing; relentless, he
  // hunts whoever wronged him most, fearless and keener.
  const burn = move === 'slow-burn' ? slowBurn(world, id, st.wrongs[id], grudgeTargets(world, id)) : null;
  const calm = burn !== null && burn.mood !== 'relentless';
  if (burn?.mood === 'relentless') {
    aggr *= RELENTLESS_AGGRESSION;
    brave = true;
    if (burn.huntId >= 0 && burn.huntId !== id && !grudges.includes(burn.huntId)) {
      if (!raceState(world).finishOrder.includes(burn.huntId)) grudges.push(burn.huntId);
      grudges.sort((a, b) => a - b);
    }
  }
  const prefs = preferences(prof, grudges);
  const brawler = prof.behaviour === 'brawler';
  const isRival = (r: Seen): boolean =>
    prof.rivals.length > 0 && prof.rivals.includes(riderIdOf(config, r.mover));
  const huntable = (r: Seen): boolean =>
    (brawler || grudges.includes(r.mover.id) || isRival(r)) && looksGood(world, config, prof, r, healthFrac);
  let target: Seen | null = null;
  if (
    racing &&
    !unsticking &&
    !fleeing &&
    !calm &&
    (brawler || grudges.length > 0 || prof.rivals.length > 0) &&
    brave &&
    aggr > 0
  ) {
    const seekRange = 10 + 30 * Math.min(1, aggr);
    const pool = riders.filter((r) => Math.abs(r.ahead) <= seekRange && huntable(r));
    const current = st.targetId[id] ?? -1;
    const grudge = pickByPreference(world, config, pool, ['grudge'], grudges);
    const held = grudge && grudges.includes(grudge.mover.id) ? grudge : null;
    const keep = riders.find(
      (r) => r.mover.id === current && Math.abs(r.ahead) <= seekRange * 1.3 && huntable(r),
    );
    // Where a rivalry ranks against the player is the rider's `targetPreference` (its `rival` entry);
    // a rider who only hunts grudges and rivals has nobody else in its pool anyway.
    target = held ?? keep ?? pickByPreference(world, config, pool, prefs, grudges, prof.rivals);
  }
  st.targetId[id] = target ? target.mover.id : -1;
  if (fleeing) {
    // Away from the nearest rider, a little faster than its pace.
    st.fleeTicks[id] = (st.fleeTicks[id] ?? 0) + 1;
    let near: Seen | null = null;
    for (const r of riders) {
      if (Math.abs(r.ahead) > FLEE_NEAR_M) continue;
      if (!near || Math.abs(r.ahead) + Math.abs(r.dd) < Math.abs(near.ahead) + Math.abs(near.dd)) near = r;
    }
    if (near) {
      const away = near.dd > 0 ? -1 : 1;
      let d = pos.d + away * FLEE_AWAY_M;
      if (d < dLo || d > dHi) d = pos.d - away * FLEE_AWAY_M;
      dTarget = clamp(d, dLo, dHi);
      lateralMax = 4;
    }
    speedTarget *= 1 + FLEE_PACE;
  } else if (!target && racing && !unsticking && prof.preferredWeapon !== null) {
    // An unarmed rider (or one holding something else) steers over its preferred weapon lying ahead.
    const seek = weaponAhead(world, config, m, prof.preferredWeapon);
    if (seek) {
      dTarget = clamp(seek.mover.pos.d, dLo, dHi);
      lateralMax = 3;
      st.seekTicks[id] = (st.seekTicks[id] ?? 0) + 1;
    }
  }
  if (target) {
    if (players.includes(target.mover.id)) st.huntTicksOnPlayer[id] = (st.huntTicksOnPlayer[id] ?? 0) + 1;
    // Which side of the target to ride on (+1: its +d side). A rider's own preferred side wins;
    // otherwise a brawler after a player takes the side that pushes them toward danger (takedown
    // intent), and anyone else stays on the side it is already on. Rival-against-rival fights keep
    // the M1 rule: two brawlers each wanting the other's far side would circle forever.
    const current = target.dd > 0 ? -1 : 1;
    let side = prof.preferredSide === 'left' ? -pos.dir : prof.preferredSide === 'right' ? pos.dir : 0;
    let switching = false;
    if (side === 0) {
      const intent = brawler && players.includes(target.mover.id);
      const push = intent ? committedPush(st, id, tick, takedownPush(road, target.mover, obstacles)) : 0;
      side = push !== 0 ? -push : current;
      // Never through the target, and never out of a fight it is already in: alongside, it keeps
      // its side and fights; it crosses over only while it is still closing in.
      if (side !== current) {
        if (Math.abs(target.ahead) < SIDE_SWITCH_S) side = current;
        else switching = true;
      }
    }
    let d = target.mover.pos.d + side * FIGHT_OFFSET_D;
    if (d < dLo || d > dHi) d = target.mover.pos.d - side * FIGHT_OFFSET_D;
    dTarget = clamp(d, dLo, dHi);
    lateralMax = 3.5;
    // Close the gap along the road: chase hard, wait gently. A brawler waits (drops below its
    // pace) only for a player behind it, easing off rather than braking so it is still near the
    // player's speed when they meet; a rival behind it is left to catch up, so rival fights don't
    // stall the pack. Changing sides, it keeps the target a few metres ahead until it is across.
    // A defending crew boss (rivals-1) waits for nobody: she fights from the front.
    const waitsFor =
      players.includes(target.mover.id) && !tr.defends ? config.event.paceMps * 0.6 : speedTarget;
    const ahead = switching ? target.ahead - SWITCH_BACK_M : target.ahead;
    const gain = ahead >= 0 ? 0.8 : 0.25;
    speedTarget = clamp(target.vAlong + ahead * gain, waitsFor, speedTarget * 1.15);
  } else if (
    racing &&
    brave &&
    !fleeing &&
    aggr > 0 &&
    ((brawler &&
      prof.targetPreference.find((p) => p !== 'grudge') === 'player' &&
      players.some((p) => (race.distanceToFinish[p] ?? Infinity) < dist)) ||
      grudges.some((g) => (race.distanceToFinish[g] ?? Infinity) < dist))
  ) {
    // A hunter keeps after a player (or anyone it holds a grudge against) who got away ahead, a
    // little above its pace.
    if (!calm) speedTarget *= 1 + HUNT_PACE * Math.min(1, aggr);
  }

  // A timed signature move (signature.ts) may change the line, the pace and the swings. The traffic
  // rules below still have the last word on the line, so no move rides anyone into a car.
  let sig: SignatureOut = {};
  if (move !== null && move !== 'slow-burn' && move !== 'bell') {
    if (racing && !unsticking) {
      sig = stepSignature(
        {
          world,
          road,
          m,
          riders,
          obstacles,
          target,
          players,
          free: !fleeing,
          lastHitTick: st.lastHitTick[id] ?? -1,
          lastHitBy: st.lastHitBy[id] ?? -1,
          laneCentre,
          laneWidth: lane?.widthM ?? 3,
          dLo,
          dHi,
          speedTarget,
          punch: weaponReach(config, 'punch'),
          kick: weaponReach(config, 'kick'),
        },
        move,
      );
    } else {
      interruptSignature(world, id);
    }
  }
  if (sig.dTarget !== undefined) dTarget = sig.dTarget;
  if (sig.lateralMax !== undefined) lateralMax = sig.lateralMax;
  if (sig.lateralGain !== undefined) lateralGain = sig.lateralGain;
  if (sig.speedTarget !== undefined) speedTarget = sig.speedTarget;

  // A fight or weave line into the path of traffic is not worth it: back to its own spot in its
  // own lane when that is clear and the chosen line is not.
  if (!pathClear(obstacles, v, pos.d, dTarget, LINE_CHECK_M)) {
    const home = laneCentre + clamp(st.laneOffset[id] ?? 0, -laneHalf, laneHalf);
    // Neither is safe to reach: hold the line it is on (the blocker rules below still apply).
    dTarget = pathClear(obstacles, v, pos.d, home, LINE_CHECK_M) ? home : pos.d;
  }
  // A car coming up from behind faster passes in its lane: give it room, own side of the road first.
  for (const o of obstacles) {
    if (o.s.ahead >= 0 || o.s.vAlong <= v) continue;
    if (-o.s.ahead - o.size.halfLength > (o.s.vAlong - v) * PASS_WARN_S + 5) continue;
    const od = o.s.mover.pos.d;
    const room = o.size.halfWidth + RIDER_CLEAR + 0.2;
    if (Math.abs(dTarget - od) >= room) continue;
    const sides = [od + room * pos.dir, od - room * pos.dir].filter(
      (c) => c >= dLo && c <= dHi && pathClear(obstacles, v, pos.d, c, LINE_CHECK_M),
    );
    const away = sides[0];
    if (away !== undefined) {
      dTarget = away;
      lateralMax = Math.max(lateralMax, 4);
    }
  }

  // Unsticking: back up to pace (traffic below still has the last word on speed).
  if (unsticking) speedTarget = Math.max(speedTarget, config.event.paceMps * 0.8);

  // 3. Traffic: go around the nearest blocker, or brake behind it.
  const committed = (st.avoidUntil[id] ?? -1) >= tick;
  if (committed) dTarget = st.avoidD[id] ?? dTarget;
  const blocker = blockerAt(obstacles, v, dTarget, look) ?? blockerAt(obstacles, v, pos.d, look * 0.5);
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
        // Crossing other traffic's lines on the way there counts too (not the blocker's own).
        const others = obstacles.filter((x) => x !== blocker);
        if (!pathClear(others, v, pos.d, cand, LINE_CHECK_M)) continue;
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
        // Held until the blocker is passed: its length plus a margin, at the closing speed.
        const passS = (Math.max(0, gap) + 2 * blocker.size.halfLength + 8) / Math.max(Math.abs(closing), 2);
        st.avoidUntil[id] = tick + Math.round(Math.min(passS, 12) * 60) + 20;
        // Not across yet and close: ease off until the line opens.
        if (Math.abs(pos.d - best) > w * 0.6 && gap < v * 0.9)
          speedTarget = Math.min(speedTarget, o.vAlong + 3);
      } else if (o.vAlong < 0) {
        // Boxed in by an oncoming car: braking does not help. Get out of its band on this
        // rider's own side of it, as fast as it can, and let the next tick sort out the rest.
        const escape = clamp(od + w * pos.dir, dLo, dHi);
        dTarget = escape;
        lateralMax = 5;
        lateralGain = 3;
        st.avoidD[id] = escape;
        st.avoidUntil[id] = tick + 30;
      } else {
        // Boxed in: a speed that stops about 4 m behind it, braking at 5 m/s².
        const room = Math.max(0, gap - 4);
        speedTarget = Math.min(speedTarget, Math.max(0, o.vAlong) + Math.sqrt(2 * 5 * room));
        st.avoidUntil[id] = -1;
      }
    }
  }
  // Hard rule last: never steer into a vehicle alongside; hold at least its clearance from it.
  for (const o of obstacles) {
    const along = o.size.halfLength + ALONGSIDE_MARGIN_M;
    if (o.s.ahead > along || o.s.ahead < -along) continue;
    const od = o.s.mover.pos.d;
    const clearance = o.size.halfWidth + RIDER_CLEAR;
    if (pos.d >= od) dTarget = Math.max(dTarget, Math.min(od + clearance, dHi));
    else dTarget = Math.min(dTarget, Math.max(od - clearance, dLo));
  }

  // 4. Swing at whoever is in the reach window (predicted to the end of the wind-up).
  let flags = 0;
  const held =
    (st.pressTick[id] ?? -1) >= 0 && tick - (st.pressTick[id] ?? 0) <= (st.pressHoldTicks[id] ?? 0);
  if (held) flags |= st.pressHold[id] ?? 0;
  // Gus's bell is ringing (or his swing is winding up behind it): no second swing meanwhile.
  const ringing = move === 'bell' && (signatureState(world).phase[id] ?? -1) >= 0;
  if (
    racing &&
    !unsticking &&
    !fleeing &&
    !calm &&
    !sig.noSwing &&
    !ringing &&
    aggr > 0 &&
    tick >= (st.nextAttackTick[id] ?? 0)
  ) {
    let swing = trySwing(world, config, m, st, prof, riders, target, aggr, players, grudges, healthFrac);
    // Gus: the swing waits behind the bell. Nothing is pressed until it has rung out.
    if (swing !== 0 && move === 'bell' && holdForBell(world, id, swing, st.targetId[id] ?? -1)) {
      st.pressTick[id] = -1;
      st.nextAttackTick[id] = (st.nextAttackTick[id] ?? tick) + BELL_TELL_TICKS;
      swing = 0;
    }
    flags |= swing;
  }
  if (move === 'bell') {
    if (racing && !unsticking) {
      const rung = releaseBell(world, id, st.pressHoldTicks[id] ?? 0);
      if (rung !== 0) {
        st.pressTick[id] = tick;
        st.pressHold[id] = rung & ~InputFlag.attack;
        flags |= rung;
      }
    } else {
      interruptSignature(world, id);
    }
  }
  // A move's own swing (Kevin's counter, Tammy's shove), whatever the swing timer says.
  if (sig.press && racing && !unsticking) flags |= pressAt(world, config, m, st, sig.press, players);

  const drive = throttleFor(config, m, speedTarget);
  // Dial-Up's lag: a dead throttle and no brake while he is frozen.
  const brake = sig.freeze ? 0 : drive.brake;
  // Slow off the line (rivals-1): the throttle is capped for the first seconds.
  const throttle = sig.freeze
    ? 0
    : launching && tr.launch < 1
      ? Math.min(drive.throttle, tr.launch)
      : drive.throttle;
  const steer = steerFor(world, config, m, clamp(dTarget, dLo, dHi), lateralMax, lateralGain);
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
  grudges: readonly EntityId[],
  healthFrac: number,
): number {
  const punch = weaponReach(config, 'punch');
  const kick = weaponReach(config, 'kick');
  const v = m.speed;
  const box = riders.filter((r) => Math.abs(r.ahead) <= ACQUIRE_S && Math.abs(r.dd) <= ACQUIRE_D);
  const reachable = box.filter(
    (r) => (inReach(r, v, punch) || inReach(r, v, kick)) && looksGood(world, config, prof, r, healthFrac),
  );
  if (reachable.length === 0) return 0;
  const victim =
    (target && reachable.find((r) => r.mover.id === target.mover.id)) ??
    pickByPreference(world, config, reachable, preferences(prof, grudges), grudges, prof.rivals);
  if (!victim) return 0;
  const rng = world.rng.ai;
  // The grudge-keeper's tally (rivals-1): each wrong this victim did him makes him keener, up to 4.
  const wrongs = prof.traits.tally > 0 ? (st.wrongs[m.id]?.[victim.mover.id] ?? 0) : 0;
  const keen = 1 + TALLY_KEEN * Math.min(TALLY_KEEN_MAX, wrongs);
  const chance = Math.min(
    0.5,
    (0.02 + 0.1 * aggr) * (target && victim.mover.id === target.mover.id ? 2 : 1) * keen,
  );
  if (nextFloat(rng) >= chance) return 0;
  const canKick = inReach(victim, v, kick);
  const canPunch = inReach(victim, v, punch);
  // The kick-or-punch mix stays M1's: a kick-when-it-shoves-toward-danger bonus is a feel number,
  // held for combat-3's playtest-tuned kick shove (M2 prep rules).
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
  if (raceState(world).place[victim.mover.id] === 1)
    st.pressesOnLeader[id] = (st.pressesOnLeader[id] ?? 0) + 1;
  return InputFlag.attack | hold;
}

/**
 * Throws a signature move's own swing now (Kevin's counter, Tammy's shove): the side toward the
 * victim, a kick when asked, the swing timer restarted. Counted like any other swing.
 */
function pressAt(
  world: World,
  config: SimConfig,
  m: Mover,
  st: AiState,
  press: { victim: Seen; kick: boolean },
  players: readonly EntityId[],
): number {
  const r = weaponReach(config, press.kick ? 'kick' : 'punch');
  const side = press.victim.dd * m.pos.dir > 0 ? InputFlag.attackSideRight : InputFlag.attackSideLeft;
  const hold = side | (press.kick ? InputFlag.kick : 0);
  const tick = world.tick;
  const id = m.id;
  st.pressTick[id] = tick;
  st.pressHold[id] = hold;
  st.pressHoldTicks[id] = r.windupTicks;
  st.nextAttackTick[id] = tick + r.cycleTicks;
  st.presses[id] = (st.presses[id] ?? 0) + 1;
  if (players.includes(press.victim.mover.id)) st.pressesOnPlayer[id] = (st.pressesOnPlayer[id] ?? 0) + 1;
  if (raceState(world).place[press.victim.mover.id] === 1)
    st.pressesOnLeader[id] = (st.pressesOnLeader[id] ?? 0) + 1;
  return InputFlag.attack | hold;
}

/**
 * Whether a fight with `r` suits this rider's style (rivals-1). A showboat fights only when it will
 * look good: never the race leader (he sides with whoever is winning), and never anyone healthier
 * than him. Every other style fights anyone.
 */
function looksGood(world: World, config: SimConfig, prof: AiProfile, r: Seen, healthFrac: number): boolean {
  if (!prof.traits.showboat) return true;
  if (raceState(world).place[r.mover.id] === 1) return false;
  const def = config.riders[r.mover.riderIndex];
  const max = def?.healthMax ?? 100;
  const theirs = (riderState(world).health[r.mover.id] ?? max) / Math.max(1, max);
  return theirs <= healthFrac;
}

/** The nearest lying pickup of `weapon` ahead of `m` within WEAPON_SEEK_M, unless it already holds one. */
function weaponAhead(world: World, config: SimConfig, m: Mover, weapon: string): Seen | null {
  const heldNow = combatView(world, m.id).heldWeapon;
  if (heldNow !== null && bareId(heldNow) === weapon) return null;
  let best: Seen | null = null;
  for (const p of world.movers) {
    if (p.kind !== 'pickup' || p.h < STOWED_H / 2) continue;
    if (bareId(pickupWeapon(world, p.id)) !== weapon) continue;
    const s = see(config.road, m, p, WEAPON_SEEK_M);
    if (!s || s.ahead < 2 || s.ahead > WEAPON_SEEK_M) continue;
    if (!best || s.ahead < best.ahead) best = s;
  }
  return best;
}

/**
 * Tallies last tick's landed hits on AI riders (rivals-1): who hit whom, how often, and when. A kick
 * also emits a `kick` event; only the `hit` is counted.
 */
function noteHits(world: World, config: SimConfig, st: AiState): void {
  for (const e of world.lastEvents) {
    if (e.type !== 'hit' || e.target === undefined) continue;
    const victim = world.movers[e.target];
    if (!victim || !isAiRider(config, victim) || e.actor === e.target) continue;
    const row = (st.wrongs[e.target] ??= {});
    row[e.actor] = (row[e.actor] ?? 0) + 1;
    st.lastHitBy[e.target] = e.actor;
    st.lastHitTick[e.target] = e.tick;
  }
}

/**
 * The career's saved grudges (rivals-1): the riders `holder` holds at least `ai.grudgeHuntAt` points
 * against in `SimConfig.grudges`, by entity id. The table is keyed by content id; a bare rider id is
 * accepted on either side.
 */
function careerGrudgesOf(world: World, config: SimConfig, holder: Mover): number[] {
  const def = config.riders[holder.riderIndex];
  if (!def) return [];
  const table = config.grudges[def.contentId] ?? config.grudges[bareId(def.contentId)];
  if (!table) return [];
  const at = world.params['ai.grudgeHuntAt'] ?? 4;
  const out: number[] = [];
  for (const o of world.movers) {
    if (o.kind !== 'rider' || o.id === holder.id) continue;
    const od = config.riders[o.riderIndex];
    if (!od) continue;
    const pts = table[od.contentId] ?? table[bareId(od.contentId)] ?? 0;
    if (pts >= at) out.push(o.id);
  }
  return out;
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
      st.huntTicksOnPlayer[m.id] = 0;
      st.pushSide[m.id] = 0;
      st.pushUntil[m.id] = -1;
      st.lastHitBy[m.id] = -1;
      st.lastHitTick[m.id] = -1;
      st.careerGrudge[m.id] = careerGrudgesOf(world, config, m);
      st.pressesOnLeader[m.id] = 0;
      st.fleeTicks[m.id] = 0;
      st.seekTicks[m.id] = 0;
      const c = config.riders[m.riderIndex]?.controller;
      initSignature(world, config.seed, m.id, c?.kind === 'ai' ? c.personality?.signature : undefined);
    }
  },
  step(world: World, config: SimConfig) {
    const st = aiState(world);
    const players = playerIds(world, config);
    noteHits(world, config, st);
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
        interruptSignature(world, m.id);
      }
    }
  },
};
