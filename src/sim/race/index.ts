// sim/race: grid, progress, placing, the finish and the rubber band (M1 riders-3). Progress,
// placing and rubber-banding all read one number: distance to finish along the route
// (docs/architecture.md, "Races as routes").
//
// Who races: every rider except the law (faction `law`, a cop). A racer's status is `racing` until
// it ends `finished` (crossed the line, or still running at the race-end timeout and classified by
// position), `busted` (a `bust` event names it), or `down` (in a tumble or on foot when the race
// ends). The race ends when every player has finished or been busted, and every other racer has
// finished or been busted or the race-end timeout has passed; a hard stop guarantees it ends.
import type { EntityId, TuningParamDecl } from '../../core';
import type { RoadPos } from '../../road';
import { offCourse } from '../riders';
import type { SimConfig } from '../types';
import { systemState, type SimSystem, type World } from '../world';
import { STYLE_TUNING } from './style';
import { lateSteps } from '../late';

export { STYLE_TUNING, styleRunOf } from './style';

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
  ...STYLE_TUNING,
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

export function isRacer(config: SimConfig, world: World, id: EntityId): boolean {
  const m = world.movers[id];
  return m !== undefined && m.kind === 'rider' && !isLaw(config, m.riderIndex);
}

export function measure(world: World, config: SimConfig, st: RaceState): void {
  for (const m of world.movers) {
    if (m.kind !== 'rider') continue;
    // Off the course's roads (the maintainer, 2026-10-06: "a corner cut across the roofs or a lot counts if
    // the rider rejoins the course ahead"; sim/riders `offCourse`): out past the edge in the air, up on a roof
    // past the band, or down past the edge until the respawn. The progress stays where he left, and is taken
    // again where he rejoins: ahead is the cut's gain, behind is none, and a reset at the crossing gains nothing.
    if (offCourse(world, config, m) && st.progress[m.id] !== undefined) continue;
    const p = config.route.progressAt(m.pos.edge, m.pos.s);
    if (p !== -Infinity) st.progress[m.id] = p;
    const dist = config.route.distanceToFinish(m.pos.edge, m.pos.s);
    st.distanceToFinish[m.id] = dist === Infinity ? (st.distanceToFinish[m.id] ?? config.route.length) : dist;
  }
}

/** Finishers in order, then running racers by distance to finish (ties by id), then the busted. */
export function standings(config: SimConfig, world: World, st: RaceState): EntityId[] {
  const running = world.movers
    .filter((m) => isRacer(config, world, m.id) && st.status[m.id] === 'racing')
    .map((m) => m.id)
    .sort((a, b) => (st.distanceToFinish[a] ?? 0) - (st.distanceToFinish[b] ?? 0) || a - b);
  return [...st.finishOrder, ...running, ...st.bustOrder];
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
  // The step is in ./step.ts, a lazy chunk the race waits for (src/sim/late.ts).
  step: (world, config) => lateSteps().raceStep(world, config),
};
