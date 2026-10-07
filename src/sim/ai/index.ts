// sim/ai: the AIController (M1 ai-1), run in the controllers phase. Rivals drive through SimInput
// exactly like the player: this phase only writes world.inputs, and riders and combat act on them.
// Each tick an AI rider:
//   1. holds the event's pace, times its own jitter, the `ai.paceScale` tuning and the race's
//      rubber-band factor (riders-3, `rubberBandFactor` in sim/race);
//   2. picks a line: its spot in the lane, a weave, or alongside a fight target (brawlers hunt);
//   3. dodges traffic ahead crudely: around it (into the oncoming lane only as risk allows) or brakes;
//   4. swings at whoever is in its reach window, the player or another rival, with side and kick flags,
//      and holding a thrown weapon (Kevin's briefcase) throws it at a rider in its throw range ahead;
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
// W-Q (the pitch deck's item 9, "Rivals use the shortcuts"): each rival decides at the start, per
// shortcut on the route, whether it takes it (chance `ai.shortcutChance`, rolled from a stream of
// its own seeded by the race seed and the rider, so the `ai` stream and everything after it are
// untouched), and in the last SHORTCUT_APPROACH_M before a zone it takes, it rides into the zone
// (the dev bot's line, just inside its inner edge). Traffic still has the last word on the line.
// Law riders (cops) are not driven here: cops-1 writes their inputs from the cops phase.
// All state is plain data in systemState(world, 'ai'); randomness comes only from the `ai` stream.
import { clamp, createRng, nextFloat, streamSeed, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadNetwork } from '../../road';
import { raceState } from '../race';
import type { SimConfig } from '../types';
import { systemState, type Mover, type SimSystem, type World } from '../world';
import type { ObstacleSize, Seen } from './sense';
import { rivalTakeChance, SHORTCUT_APPROACH_M } from './branches';
import { signatureGapScale } from './level';
import { initSignature } from './signature';
import { bareId, resolveProfile, type AiProfile } from './styles';
import { lateSteps } from '../late';

export { AI_PRESETS, AI_STYLE_IDS, bareId, huntsByDefault, NEUTRAL_TRAITS, resolveProfile } from './styles';
export type { AiBehaviour, AiProfile, AiStyleId, AiTraits } from './styles';
export { relativeS } from './sense';
export { oncomingSide, signatureState, signatureView } from './signature';
export type { SignatureState } from './signature';

export const AI_TUNING: readonly TuningParamDecl[] = [
  {
    // W-Q: how likely a rival takes each shortcut on its route (decided per rival at the start).
    id: 'ai.shortcutChance',
    group: 'rivals',
    label: 'Rivals take a shortcut',
    default: 0.35,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: true,
  },
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
  /** W-Q: per rider, bit k set when it takes the route's k-th shortcut (route.shortcuts order). */
  shortcuts: number[];
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
    shortcuts: [],
  }));
}
/** How far before a shortcut's split zone a rival that takes it starts moving into it, m (the bot's). */
export { SHORTCUT_APPROACH_M };
/** Shortcut bits kept per rider (a route has a handful). */
export const MAX_SHORTCUTS = 30;
export const TAU = 6.283185307179586;
// ai-2 takedown intent (M2, [default]).
/** A rail this close to the target's side of the road (metres of d) is worth pushing it toward. */
const RAIL_NEAR_M = 3.5;
/** An oncoming car within this many seconds of closing (plus a margin) makes the oncoming side the pick. */
const ONCOMING_WARN_S = 4;
const ONCOMING_MARGIN_M = 20;

export function isAiRider(config: SimConfig, m: Mover): boolean {
  const def = config.riders[m.riderIndex];
  return m.kind === 'rider' && def?.controller.kind === 'ai' && def.faction !== 'law';
}

export function profileOf(world: World, config: SimConfig, m: Mover): AiProfile {
  const c = config.riders[m.riderIndex]?.controller;
  const quirks = (world.params['ai.styleQuirks'] ?? 0) >= 0.5;
  return c?.kind === 'ai'
    ? resolveProfile(c.style, c.personality, quirks)
    : resolveProfile('racer', undefined, quirks);
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
      // W-Q: which shortcuts it takes, from its own stream (the `ai` stream is not drawn).
      const pick = createRng(streamSeed(config.seed, 'ai.shortcuts', m.id));
      const chance = clamp(world.params['ai.shortcutChance'] ?? 0.35, 0, 1);
      // A route's `aiTake`, and a branch holding a gap (left to the bold), decide per branch
      // (branches.ts); one draw per shortcut either way, so no other rider's roll moves.
      const risk = profileOf(world, config, m).riskTaking;
      let mask = 0;
      config.route.shortcuts.forEach((z, k) => {
        if (k < MAX_SHORTCUTS && nextFloat(pick) < rivalTakeChance(config, z, risk, chance)) mask |= 1 << k;
      });
      st.shortcuts[m.id] = mask;
      const c = config.riders[m.riderIndex]?.controller;
      initSignature(
        world,
        config.seed,
        m.id,
        c?.kind === 'ai' ? c.personality?.signature : undefined,
        signatureGapScale(config),
      );
    }
  },
  // The step is in ./step.ts, a lazy chunk the race waits for (src/sim/late.ts).
  step: (world, config) => lateSteps().aiStep(world, config),
};
