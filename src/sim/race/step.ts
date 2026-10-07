// The race: the system's step (sim/race), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import { type EntityId, clamp } from '../../core';
import type { SimConfig } from '../types';
import { type World, emit } from '../world';
import { stampShortcuts } from './shortcuts';
import { scoreStyle, closeStyle } from './style';
import {
  isRacer,
  rubberBandBounds,
  raceState,
  measure,
  standings,
  MAX_RACE_TICKS,
  type RaceState,
} from './index';

/** A player still racing (the 'found it' stamp's riders). */
function isPlayerRacer(config: SimConfig, world: World, st: RaceState, id: EntityId): boolean {
  const m = world.movers[id];
  return (
    !!m &&
    config.riders[m.riderIndex]?.controller.kind === 'player' &&
    isRacer(config, world, id) &&
    st.status[id] === 'racing'
  );
}

function finish(world: World, st: RaceState, id: EntityId, classified: boolean): void {
  st.finishOrder.push(id);
  st.status[id] = 'finished';
  emit(world, 'finish', id, { place: st.finishOrder.length, classified });
}

/**
 * The rubber band: an AI rival behind the nearest racing player is pulled forward, one ahead eased
 * back, up to ±k at `range` metres. With no player still racing, nobody is pulled.
 */
function pullRubberBand(config: SimConfig, world: World, st: RaceState): void {
  const [lo, hi] = rubberBandBounds(config, world);
  const k = hi - 1;
  const range = world.params['race.rubberBandRangeM'] ?? 150;
  const players: number[] = [];
  for (const m of world.movers) {
    const def = config.riders[m.riderIndex];
    if (def?.controller.kind === 'player' && st.status[m.id] === 'racing') {
      players.push(st.distanceToFinish[m.id] ?? Infinity);
    }
  }
  for (const m of world.movers) {
    if (m.kind !== 'rider') continue;
    const def = config.riders[m.riderIndex];
    const mine = st.distanceToFinish[m.id];
    if (
      players.length === 0 ||
      def?.controller.kind !== 'ai' ||
      st.status[m.id] !== 'racing' ||
      mine === undefined
    ) {
      st.rubberBand[m.id] = 1;
      continue;
    }
    let gap = 0; // positive: behind the player
    let nearest = Infinity;
    for (const theirs of players) {
      if (Math.abs(mine - theirs) < nearest) {
        nearest = Math.abs(mine - theirs);
        gap = mine - theirs;
      }
    }
    st.rubberBand[m.id] = clamp(1 + k * clamp(gap / range, -1, 1), lo, hi);
  }
}

/** A `lapOrCheckpoint` event each time a racer passes the next of the route's checkpoints. */
function passCheckpoints(config: SimConfig, world: World, st: RaceState): void {
  const cps = config.route.checkpoints;
  for (const m of world.movers) {
    if (!isRacer(config, world, m.id) || st.status[m.id] !== 'racing') continue;
    let next = st.checkpoint[m.id] ?? 0;
    const progress = st.progress[m.id] ?? 0;
    while (next < cps.length && progress >= (cps[next]?.progress ?? Infinity)) {
      next++;
      emit(world, 'lapOrCheckpoint', m.id, { checkpoint: next - 1, lap: 1 });
    }
    st.checkpoint[m.id] = next;
  }
}

function endRace(config: SimConfig, world: World, st: RaceState): void {
  // Riders still running are classified by position; riders down stay down.
  const running = world.movers
    .filter((m) => isRacer(config, world, m.id) && st.status[m.id] === 'racing')
    .sort((a, b) => (st.distanceToFinish[a.id] ?? 0) - (st.distanceToFinish[b.id] ?? 0) || a.id - b.id);
  for (const m of running) {
    if (m.mode === 'Tumble' || m.mode === 'OnFoot') st.status[m.id] = 'down';
    else finish(world, st, m.id, true);
  }
  const down = running.filter((m) => st.status[m.id] === 'down').map((m) => m.id);
  const order = [...st.finishOrder, ...down, ...st.bustOrder];
  order.forEach((id, i) => (st.place[id] = i + 1));
  for (const m of world.movers) if (m.kind === 'rider') st.rubberBand[m.id] = 1;
  st.over = true;
  emit(world, 'raceEnd', -1, {
    finished: st.finishOrder.length,
    down: down.length,
    busted: st.bustOrder.length,
  });
}

export function raceStep(world: World, config: SimConfig): void {
  const st = raceState(world);
  if (st.over) return;
  if (world.tick === 0) emit(world, 'raceStart', -1, { routeLengthM: config.route.length });
  measure(world, config, st);

  // A bust from the cops phase (earlier this tick) takes the busted racer out of the running.
  for (const e of world.events) {
    if (e.type !== 'bust') continue;
    const who = [e.target, e.actor].find(
      (id): id is EntityId => id !== undefined && isRacer(config, world, id) && st.status[id] === 'racing',
    );
    if (who === undefined) continue;
    st.status[who] = 'busted';
    st.bustOrder.push(who);
  }

  scoreStyle(world, config, (id) => isRacer(config, world, id) && st.status[id] === 'racing');
  passCheckpoints(config, world, st);
  // W-Q: the 'found it' stamp, for players still racing.
  stampShortcuts(world, config, (id) => isPlayerRacer(config, world, st, id));
  for (const m of world.movers) {
    if (!isRacer(config, world, m.id) || st.status[m.id] !== 'racing') continue;
    if ((st.distanceToFinish[m.id] ?? Infinity) <= 0) finish(world, st, m.id, false);
  }

  const order = standings(config, world, st);
  order.forEach((id, i) => {
    const before = st.place[id] ?? i + 1;
    const now = i + 1;
    const passed = order[i + 1];
    // Only a pass on the road counts: moving up past someone who was busted is not an overtake.
    const onRoad = st.status[id] !== 'busted' && passed !== undefined && st.status[passed] === 'racing';
    if (now < before && onRoad && (st.place[passed] ?? 0) < before) {
      emit(world, 'overtake', id, { place: now }, { target: passed });
    }
  });
  order.forEach((id, i) => (st.place[id] = i + 1));
  pullRubberBand(config, world, st);

  const players = world.movers.filter((m) => config.riders[m.riderIndex]?.controller.kind === 'player');
  const playersDone = players.length > 0 && players.every((m) => st.status[m.id] !== 'racing');
  if (playersDone && st.playerFinishTick < 0) st.playerFinishTick = world.tick;
  const everyoneDone = order.every((id) => st.status[id] !== 'racing');
  const timedOut = playersDone && world.tick - st.playerFinishTick >= config.event.raceEndTimeoutTicks;
  if ((playersDone && (everyoneDone || timedOut)) || world.tick >= MAX_RACE_TICKS) {
    endRace(config, world, st);
  }
  closeStyle(world, config, (id) => {
    const status = st.status[id];
    return status === 'racing' || status === 'finished' ? status : 'other';
  });
}
