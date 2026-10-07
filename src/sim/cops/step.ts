// The cops: the system's step (sim/cops), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import type { EntityId } from '../../core';
import { combatState, relative } from '../combat';
import { type SimConfig, InputFlag } from '../types';
import { groundUnder } from '../ground';
import { type Mover, type World, emit } from '../world';
import {
  defOf,
  distance,
  CHAOS_MEMORY_TICKS,
  isPlayer,
  gapAlongRoute,
  PATROL,
  isDown,
  COP_CHASING,
  tierOf,
  endChase,
  CHAOS_HIT,
  COP_PARKED,
  jitter,
  HEAT,
  addHeat,
  HEAT_MAX,
  COP_DONE,
  routePosAt,
  sideLanes,
  roadblockSpots,
  habitOf,
  relentlessness,
  hp,
  HABIT,
  copsState,
  heatOn,
  clearOfLanes,
  drive,
  type CopsState,
} from './index';

export const CHAOS_HIT_COP = 2;

export const CHAOS_TAKEDOWN = 3;

/** A hit or kick within this distance of a cop makes its attacker his target. */
export const CHAOS_RADIUS_M = 60;

const CITE_ACROSS_M = 4;

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

/** Whether mayhem can summon cops in this race. */
function chaosSummons(config: SimConfig): boolean {
  const c = config.event.cops;
  return !!c && c.mode !== 'none' && (c.chaosSummon || c.mode === 'chaos-summoned');
}

function hasFinished(config: SimConfig, m: Mover): boolean {
  return config.route.distanceToFinish(m.pos.edge, m.pos.s) <= 0;
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
): { gap: number; speed: number; id: EntityId } {
  let gap = Infinity;
  let speed = 0;
  let id: EntityId = -1;
  for (const m of world.movers) {
    if (!isPlayer(config, m) || !chaseable(config, st, m)) continue;
    const g = gapAlongRoute(config, m, cop);
    if (g >= -PATROL.pullOutM && g < gap) {
      gap = g;
      speed = m.speed;
      id = m.id;
    }
  }
  return { gap, speed, id };
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
  // A cop whose pursuit budget is spent (run W-T) is never sent again.
  if (!cop || cop.mode !== 'Road' || st.heatCop[id] === 1 || st.broke[id] === 1) return false;
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
  if (!cop || cop.mode !== 'Road' || st.broke[id] === 1 || (st.blockAt[id] ?? -1) >= 0) return false;
  if (distance(config, cop, player) < HEAT.roadblockHideM) return false;
  // Run W-T: a cop chasing him from out of sight behind is radioed ahead (the file header).
  if (
    st.phase[id] === COP_CHASING &&
    st.target[id] === player.id &&
    gapAlongRoute(config, cop, player) >= HEAT.roadblockHideM
  )
    return true;
  if (st.heatCop[id] === 1) return false;
  if (heatReserve(world, st, id)) return true;
  return (
    st.phase[id] === COP_PARKED &&
    (st.patrolAt[id] ?? -1) >= 0 &&
    st.sirenOn[id] !== 1 &&
    (st.summonAt[id] ?? -1) < 0
  );
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
 * The END OF JURISDICTION sign, each tick (before the heat meter): a player riding over it toward
 * the finish for the first time, with heat or a cop on him, has his heat set to nothing and every
 * cop on him who is not a heat cop pulls over (the heat meter then drops its own: "LOST 'EM").
 */
function stepJurisdiction(world: World, config: SimConfig, st: CopsState): void {
  if (st.lineAt < 0) return;
  for (const m of world.movers) {
    if (!isPlayer(config, m)) continue;
    const id = m.id;
    const now = config.route.progressAt(m.pos.edge, m.pos.s);
    const before = st.lastProgress[id] ?? now;
    st.lastProgress[id] = now;
    if (st.crossed[id] === 1 || !(before < st.lineAt && now >= st.lineAt) || now - before > 50) continue;
    st.crossed[id] = 1;
    const heat = st.heat[id] ?? 0;
    const on = st.cops.filter((c) => st.phase[c] === COP_CHASING && st.target[c] === id);
    if (heat <= 0 && on.length === 0) continue;
    let speaker: EntityId = id;
    let nearest = Infinity;
    for (const c of on) {
      const cop = world.movers[c];
      const dist = cop ? distance(config, cop, m) : Infinity;
      if (dist < nearest) {
        nearest = dist;
        speaker = c;
      }
      if (st.heatCop[c] !== 1) endChase(world, st, c);
    }
    st.heat[id] = 0;
    st.heatAt[id] = st.clock;
    emit(world, 'law', speaker, { kind: 'jurisdiction', heatBefore: heat / HEAT_MAX }, { target: id });
  }
}

/**
 * The habits, each tick after the phases (run W-T): chasing time for the relentless and the budget
 * cops (with the relentless levels, and a spent budget pulling him over), the citations cop's book,
 * and the bill at a player's finish.
 */
function stepHabits(world: World, config: SimConfig, st: CopsState): void {
  for (const id of st.cops) {
    const cop = world.movers[id];
    const h = habitOf(defOf(config, cop));
    if (!cop || !h || st.phase[id] !== COP_CHASING) continue;
    const target = world.movers[st.target[id] ?? -1];
    if (!target) continue;
    const chased = (st.chasedFor[id] ?? 0) + world.timeScale;
    st.chasedFor[id] = chased;
    if (h.kind === 'relentless') {
      const r = relentlessness(world, config, id);
      const level = r >= 1 ? 2 : r >= 0.5 ? 1 : 0;
      if (level > (st.level[id] ?? 0)) {
        st.level[id] = level;
        emit(world, 'law', id, { kind: 'relentless', level }, { target: target.id });
      }
    } else if (h.kind === 'budget') {
      const budgetS = hp(h, 'budgetS', HABIT.budget.budgetS);
      if (chased >= budgetS * 60 - 1e-9) {
        st.broke[id] = 1;
        emit(world, 'law', id, { kind: 'budgetOut', budgetS }, { target: target.id });
        if (!liftBlock(world, st, id)) endChase(world, st, id);
      }
    } else if (h.kind === 'citations' && target.mode === 'Road' && isPlayer(config, target)) {
      const rel = relative(config.road, cop, target, CITE_ACROSS_M + 10);
      const along = hp(h, 'alongsideM', HABIT.citations.alongsideM);
      if (!rel || Math.abs(rel.ds) > along || Math.abs(rel.dd) > CITE_ACROSS_M) continue;
      const every = Math.max(0.5, hp(h, 'everyS', HABIT.citations.everyS)) * 60;
      const ticks = (st.citeTicks[id] ?? 0) + world.timeScale;
      if (ticks < every - 1e-9) {
        st.citeTicks[id] = ticks;
        continue;
      }
      st.citeTicks[id] = ticks - every;
      const cashEach = Math.round(hp(h, 'cashEach', HABIT.citations.cashEach));
      const count = (st.cites[id] ?? 0) + 1;
      st.cites[id] = count;
      const totalCash = (st.owed[target.id] ?? 0) + cashEach;
      st.owed[target.id] = totalCash;
      st.owedCount[target.id] = (st.owedCount[target.id] ?? 0) + 1;
      emit(world, 'law', id, { kind: 'citation', count, cashEach, totalCash }, { target: target.id });
    }
  }
  // The bill: a player who finishes owing citations is billed once, by the cop who wrote the most.
  for (const m of world.movers) {
    if (!isPlayer(config, m) || (st.owedCount[m.id] ?? 0) === 0 || st.billed[m.id] === 1) continue;
    if (!hasFinished(config, m)) continue;
    st.billed[m.id] = 1;
    let by: EntityId = st.cops[0] ?? m.id;
    for (const c of st.cops) if ((st.cites[c] ?? 0) > (st.cites[by] ?? 0)) by = c;
    const data = { kind: 'bill', count: st.owedCount[m.id] ?? 0, totalCash: st.owed[m.id] ?? 0 };
    emit(world, 'law', by, data, { target: m.id });
  }
}

export function copsStep(world: World, config: SimConfig): void {
  const st = copsState(world);
  if (st.cops.length === 0) return;
  const { sirenTicks, pullOutTicks } = copTiming(world, config);
  const leadTicks = pullOutTicks - sirenTicks;
  if (chaosSummons(config)) stepChaos(world, config, st);
  stepJurisdiction(world, config, st);
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
      const { gap, speed, id: who } = patrolGap(world, config, st, cop);
      const h = habitOf(def);
      const radar = h?.kind === 'radar' && (st.radarAt[id] ?? -1) >= 0 ? h : null;
      const wakeAt = radar ? hp(radar, 'rangeM', HABIT.radar.rangeM) : PATROL.wakeM;
      const wake = Math.max(wakeAt, PATROL.pullOutM + speed * (leadTicks / 60 + 1));
      // Run W-T: a radar trooper at his bridge reads each player once as he comes in range, and
      // wakes only for one over the limit; one under it rides by.
      let lightsUp = true;
      if (radar) {
        if (who >= 0 && gap >= 0 && gap <= wake && st.radarSeen[id] !== who) {
          const limitMps = hp(radar, 'limitMps', HABIT.radar.limitMps);
          const over = speed > limitMps;
          st.radarSeen[id] = who;
          st.radarOver[id] = over ? 1 : 0;
          emit(world, 'law', id, { kind: 'radar', mps: speed, limitMps, over }, { target: who });
          if (over) addHeat(world, config, who, HABIT.radar.heat);
        }
        lightsUp = st.radarOver[id] === 1;
      }
      if (lightsUp && st.sirenOn[id] !== 1 && gap <= wake && active < maxActive) {
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
  stepHabits(world, config, st);
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
    else if (st.phase[id] === COP_PARKED) world.inputs[id] = { steer: 0, throttle: 0, brake: 255, flags: 0 };
    else {
      drive(world, config, st, cop, def);
      const input = world.inputs[id];
      if (input && copSwing(world, config, st, cop)) input.flags |= InputFlag.attack;
    }
  }
  st.clock += world.timeScale;
}
