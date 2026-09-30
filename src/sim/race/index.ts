// sim/race: grid, progress, placing, the finish and the rubber band (M1 riders-3). Progress,
// placing and rubber-banding all read one number: distance to finish along the route
// (docs/architecture.md, "Races as routes").
//
// Who races: every rider except the law (faction `law`, a cop). A racer's status is `racing` until
// it ends `finished` (crossed the line, or still running at the race-end timeout and classified by
// position), `busted` (a `bust` event names it), or `down` (in a tumble or on foot when the race
// ends). The race ends when every player has finished or been busted, and every other racer has
// finished or been busted or the race-end timeout has passed; a hard stop guarantees it ends.
import { clamp, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadPos } from '../../road';
import type { SimConfig } from '../types';
import { emit, systemState, type SimSystem, type World } from '../world';

export const RACE_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'race.rubberBandStrength',
    group: 'race',
    label: 'Rubber band',
    default: 0.06,
    min: 0,
    max: 0.2,
    step: 0.01,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'race.rubberBandRangeM',
    group: 'race',
    label: 'Rubber band range',
    default: 150,
    min: 25,
    max: 500,
    step: 25,
    unit: 'm',
    affectsSim: true,
  },
];

/** A hard stop so a race always ends, whatever the riders do (15 minutes). */
export const MAX_RACE_TICKS = 15 * 60 * 60;

/** `law` marks a cop, who never races; the others are a racer's states. */
export type RiderStatus = 'racing' | 'finished' | 'down' | 'busted' | 'law';

export interface RaceState {
  over: boolean;
  /** By entity id: metres from the start line (riders only). */
  progress: number[];
  distanceToFinish: number[];
  /** By entity id: live position, 1 = leading; 0 for the law. */
  place: number[];
  /** Racers in finishing order (classified finishers at the timeout included, after the others). */
  finishOrder: EntityId[];
  /** Busted racers in the order they were busted. */
  bustOrder: EntityId[];
  /** By entity id. */
  status: RiderStatus[];
  /** By entity id: the pace factor the AI reads (1 = no pull), within rubberBandBounds. */
  rubberBand: number[];
  /** By entity id: how many of the route's checkpoints the racer has passed. */
  checkpoint: number[];
  /** Tick every player was done (finished or busted), or -1. */
  playerFinishTick: number;
}

export function raceState(world: World): RaceState {
  return systemState<RaceState>(world, 'race', () => ({
    over: false,
    progress: [],
    distanceToFinish: [],
    place: [],
    finishOrder: [],
    bustOrder: [],
    status: [],
    rubberBand: [],
    checkpoint: [],
    playerFinishTick: -1,
  }));
}

interface StartGrid {
  rows: number;
  perRow: number;
  rowGapM: number;
}

const DEFAULT_GRID: StartGrid = { rows: 3, perRow: 2, rowGapM: 8 };

/** The route's start grid (the route file's `startGrid`), or two per row, 8 m apart. */
function startGridOf(config: SimConfig): StartGrid {
  const g = config.route.startGrid;
  if (!g) return DEFAULT_GRID;
  const perRow = g.perRow >= 1 ? Math.floor(g.perRow) : DEFAULT_GRID.perRow;
  const rowGapM = g.rowGapM > 0 ? g.rowGapM : DEFAULT_GRID.rowGapM;
  const rows = g.rows >= 1 ? Math.floor(g.rows) : DEFAULT_GRID.rows;
  return { rows, perRow, rowGapM };
}

function isLaw(config: SimConfig, riderIndex: number): boolean {
  return config.riders[riderIndex]?.faction === 'law';
}

/**
 * Where rider `index` starts. Racers take grid slots in `config.riders` order: rows behind the
 * start line, `perRow` across the travel lane; rows past the route's grid keep the same spacing.
 * The law takes no racing slot: a cop is parked a row behind the last racer (cops-1 moves him).
 */
export function gridPosition(config: SimConfig, index: number): RoadPos {
  const { route, road } = config;
  const grid = startGridOf(config);
  let slot = 0;
  let racers = 0;
  for (let i = 0; i < config.riders.length; i++) {
    if (isLaw(config, i)) continue;
    if (i < index) slot++;
    racers++;
  }
  if (isLaw(config, index)) {
    let before = 0;
    for (let i = 0; i < index; i++) if (isLaw(config, i)) before++;
    slot = (Math.ceil(racers / grid.perRow) + 1) * grid.perRow + before;
  }
  const row = Math.floor(slot / grid.perRow);
  const col = slot % grid.perRow;
  const start = route.start;
  const lanes = road.lanesAt(start.edge, start.s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === start.dir) ?? lanes[0];
  const width = lane?.widthM ?? 3;
  // Columns spread evenly across the lane, riders at least 1.2 m apart, left to right as ridden.
  const spacing = Math.min(1.5, width / grid.perRow);
  const across = (col - (grid.perRow - 1) / 2) * Math.max(1.2, spacing);
  const d = (lane?.dCenterM ?? 0) + across * start.dir;
  const pos: RoadPos = { edge: start.edge, s: start.s - start.dir * row * grid.rowGapM, d, dir: start.dir };
  road.advance(pos);
  return pos;
}

/** The lowest and highest rubber-band factor this race can give: [1 − k, 1 + k]. */
export function rubberBandBounds(config: SimConfig, world: Pick<World, 'params'>): [number, number] {
  const k = (world.params['race.rubberBandStrength'] ?? 0.06) * Math.max(0, config.difficulty.rubberBand);
  return [1 - k, 1 + k];
}

/** The pace factor the AI reads for a rider (1 when there is no pull, or for anyone not an AI). */
export function rubberBandFactor(world: World, id: EntityId): number {
  return raceState(world).rubberBand[id] ?? 1;
}

function isRacer(config: SimConfig, world: World, id: EntityId): boolean {
  const m = world.movers[id];
  return m !== undefined && m.kind === 'rider' && !isLaw(config, m.riderIndex);
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

/** Finishers in order, then running racers by distance to finish (ties by id), then the busted. */
function standings(config: SimConfig, world: World, st: RaceState): EntityId[] {
  const running = world.movers
    .filter((m) => isRacer(config, world, m.id) && st.status[m.id] === 'racing')
    .map((m) => m.id)
    .sort((a, b) => (st.distanceToFinish[a] ?? 0) - (st.distanceToFinish[b] ?? 0) || a - b);
  return [...st.finishOrder, ...running, ...st.bustOrder];
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

export const raceSystem: SimSystem = {
  name: 'race',
  init(world: World, config: SimConfig) {
    const st = raceState(world);
    for (const m of world.movers) {
      if (m.kind !== 'rider') continue;
      st.status[m.id] = isLaw(config, m.riderIndex) ? 'law' : 'racing';
      st.rubberBand[m.id] = 1;
      st.checkpoint[m.id] = 0;
    }
    measure(world, config, st);
    standings(config, world, st).forEach((id, i) => (st.place[id] = i + 1));
    for (const m of world.movers) if (st.status[m.id] === 'law') st.place[m.id] = 0;
  },
  step(world: World, config: SimConfig) {
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

    passCheckpoints(config, world, st);
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
  },
};
