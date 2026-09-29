// sim/race: grid, progress, placing and the finish (riders-3 owns this folder after app-1).
// Progress, placing and rubber-banding all read one number: distance to finish along the route.
import type { EntityId, TuningParamDecl } from '../../core';
import type { RoadPos } from '../../road';
import type { SimConfig } from '../types';
import { emit, systemState, type SimSystem, type World } from '../world';

export const RACE_TUNING: readonly TuningParamDecl[] = [];

/** A hard stop so a race always ends, whatever the riders do (15 minutes). */
export const MAX_RACE_TICKS = 15 * 60 * 60;

export interface RaceState {
  over: boolean;
  /** By entity id: metres from the start line (riders only). */
  progress: number[];
  distanceToFinish: number[];
  /** By entity id: live position, 1 = leading. */
  place: number[];
  finishOrder: EntityId[];
  /** Tick the last player finished, or -1. */
  playerFinishTick: number;
}

export function raceState(world: World): RaceState {
  return systemState<RaceState>(world, 'race', () => ({
    over: false,
    progress: [],
    distanceToFinish: [],
    place: [],
    finishOrder: [],
    playerFinishTick: -1,
  }));
}

/** Where grid slot `index` starts: rows behind the start line, spread across the lane. */
export function gridPosition(config: SimConfig, index: number): RoadPos {
  const { route, road } = config;
  const perRow = 2;
  const rowGapM = 8;
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  const start = route.start;
  const lanes = road.lanesAt(start.edge, start.s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === start.dir) ?? lanes[0];
  const d = (lane?.dCenterM ?? 0) + (col - (perRow - 1) / 2) * 1.5;
  const pos: RoadPos = { edge: start.edge, s: start.s - start.dir * row * rowGapM, d, dir: start.dir };
  road.advance(pos);
  return pos;
}

function isRider(world: World, id: EntityId): boolean {
  return world.movers[id]?.kind === 'rider';
}

function measure(world: World, config: SimConfig, st: RaceState): void {
  for (const m of world.movers) {
    if (m.kind !== 'rider') continue;
    const p = config.route.progressAt(m.pos.edge, m.pos.s);
    if (p !== -Infinity) st.progress[m.id] = p;
    const dist = config.route.distanceToFinish(m.pos.edge, m.pos.s);
    st.distanceToFinish[m.id] = dist === Infinity ? (st.distanceToFinish[m.id] ?? config.route.length) : dist;
  }
}

/** Finished riders in finishing order, then everyone else by distance to finish (ties by id). */
function standings(world: World, st: RaceState): EntityId[] {
  const running = world.movers
    .filter((m) => m.kind === 'rider' && !st.finishOrder.includes(m.id))
    .map((m) => m.id)
    .sort((a, b) => (st.distanceToFinish[a] ?? 0) - (st.distanceToFinish[b] ?? 0) || a - b);
  return [...st.finishOrder, ...running];
}

export const raceSystem: SimSystem = {
  name: 'race',
  init(world: World, config: SimConfig) {
    const st = raceState(world);
    measure(world, config, st);
    standings(world, st).forEach((id, i) => (st.place[id] = i + 1));
  },
  step(world: World, config: SimConfig) {
    const st = raceState(world);
    if (st.over) return;
    if (world.tick === 0) emit(world, 'raceStart', -1, { routeLengthM: config.route.length });
    measure(world, config, st);
    for (const m of world.movers) {
      if (!isRider(world, m.id) || st.finishOrder.includes(m.id)) continue;
      if ((st.distanceToFinish[m.id] ?? Infinity) <= 0) {
        st.finishOrder.push(m.id);
        emit(world, 'finish', m.id, { place: st.finishOrder.length });
      }
    }
    const order = standings(world, st);
    order.forEach((id, i) => {
      const before = st.place[id] ?? i + 1;
      const now = i + 1;
      const passed = order[i + 1];
      if (now < before && passed !== undefined && (st.place[passed] ?? 0) < before) {
        emit(world, 'overtake', id, { place: now }, { target: passed });
      }
    });
    order.forEach((id, i) => (st.place[id] = i + 1));

    const players = world.movers.filter((m) => config.riders[m.riderIndex]?.controller.kind === 'player');
    const playersDone = players.length > 0 && players.every((m) => st.finishOrder.includes(m.id));
    if (playersDone && st.playerFinishTick < 0) st.playerFinishTick = world.tick;
    const everyone = order.length === st.finishOrder.length;
    const timedOut = playersDone && world.tick - st.playerFinishTick >= config.event.raceEndTimeoutTicks;
    if ((playersDone && (everyone || timedOut)) || world.tick >= MAX_RACE_TICKS) {
      st.over = true;
      emit(world, 'raceEnd', -1, { finished: st.finishOrder.length });
    }
  },
};
