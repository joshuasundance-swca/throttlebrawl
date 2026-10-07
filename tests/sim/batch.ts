// The shared seeded-race batch (docs/milestones/M1.md, dev-1 and "One shared seeded-race batch").
//
// It runs the base pack's race 50 times, seeds 1..50, headless (Node, no DOM, no Three.js), with
// the BotController in the player slot and whatever field the event brings (rivals, the cop,
// traffic and pedestrians arrive with their lanes). Every race is then replayed in the same run
// from its recorded inputs, and the state hashes must match. Results are computed ONCE per source
// tree and cached, so every lane asserts over the same races without running its own:
//
//   // tests/sim/<lane>-something.test.ts
//   import { beforeAll, expect, it } from 'vitest';
//   import { simBatch, type BatchResult } from './batch';
//   let batch: BatchResult;
//   beforeAll(async () => { batch = await simBatch(); }, BATCH_TIMEOUT_MS);
//   it('...', () => { for (const race of batch.races) expect(...) });
//
// Vitest runs test files in separate workers, so the cache lives on disk
// (node_modules/.cache/throttlebrawl/), keyed by a hash of src/, packs/ and this file, and a change
// to any source makes a new key. A batch is cached in chunks of CHUNK_SEEDS seeds, each with its
// own file and lock: every worker waiting for a batch computes whichever chunk nobody holds yet, so
// the workers compute it side by side, and the chunks merge back in seed order (2026-10-05, the
// test diet: one worker used to compute the whole Normal batch while the others waited).
// SIM_BATCH_CACHE=0 turns the disk cache off. For a single scenario with per-tick access, call
// runSeededRace(seed, { onTick }) directly instead.
//
// M2 (dev-4, docs/milestones/M2.md): `presetBatch('easy' | 'hard')` runs PRESET_RACES more races per
// preset on the same seeds (no replay: the Normal batch proves determinism), cached the same way,
// so the Easy-versus-Hard comparisons share one set of races. A lane that needs per-tick numbers
// the RaceResult does not keep registers a hook in tests/sim/hooks/ (see hooks/index.ts) instead of
// running races of its own; hook results land in `race.hooks[id]` in every batch.
//
// The ImportMeta augmentation below gives this Node-side program the Vite type for
// import.meta.glob, which the base pack loader it imports uses (the app program gets it from
// src/vite-env.d.ts).
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessRace, type HeadlessRace } from '../../src/app';
import type { DifficultyPreset } from '../../src/core';
import { createBot, moverProblem, type BotStats } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { EntitySnapshot, SimEvent, SimInput, SimSnapshot } from '../../src/sim/api';
import type { ImportGlobFunction } from 'vite';
import { BATCH_HOOKS } from './hooks';

declare global {
  interface ImportMeta {
    glob: ImportGlobFunction;
  }
}

/** Bump when the result shape or the way races are run changes, to retire old caches. */
const BATCH_FORMAT = 3;
/**
 * Seeds per cached chunk of a batch: the Normal batch is 10 chunks, Easy and Hard 4 each. A chunk is
 * about 30 to 40 s of one worker's time on a CI runner, so the waiting workers share the work while
 * the per-chunk file and lock overhead stays small. [default]
 */
const CHUNK_SEEDS = 5;
export const BATCH_RACES = 50;
export const BATCH_SEEDS: readonly number[] = Array.from({ length: BATCH_RACES }, (_, i) => i + 1);
/** Races per non-default preset (Easy, Hard) in presetBatch: seeds 1..PRESET_RACES. [default] */
export const PRESET_RACES = 20;
export const PRESET_SEEDS: readonly number[] = Array.from({ length: PRESET_RACES }, (_, i) => i + 1);
/** A state hash is taken every this many ticks, plus one at the end. */
export const HASH_EVERY_TICKS = 60;
/** A trace sample of every mover is kept every this many ticks. */
export const TRACE_EVERY_TICKS = 60;
/** Safety stop, above the sim's own 15-minute hard stop. */
export const MAX_TICKS = 15 * 60 * 60 + 600;
/** How long a lane's beforeAll should allow for the batch (it may have to compute it). */
export const BATCH_TIMEOUT_MS = 15 * 60_000;

/** One mover at one trace tick (a compact copy of its snapshot). */
export interface MoverSample {
  id: number;
  kind: EntitySnapshot['kind'];
  mode: EntitySnapshot['mode'];
  edge: number;
  s: number;
  d: number;
  h: number;
  dir: 1 | -1;
  speed: number;
  health: number;
  faction: EntitySnapshot['faction'];
}

export interface FieldSummary {
  /** Riders on the grid, and how many of them are rivals (faction rider, not the player) or cops. */
  riders: number;
  rivals: number;
  cops: number;
  /** Most vehicles alive at once, and most at once per road direction (`dir` +1 and -1). */
  vehiclesMax: number;
  vehiclesByDirMax: { plus: number; minus: number };
  /** Most pedestrians alive at once. */
  pedsMax: number;
}

export interface RaceResult {
  seed: number;
  /** The difficulty preset the race ran on (the Normal batch: 'normal'). */
  difficulty: DifficultyPreset;
  /** Ticks stepped. */
  ticks: number;
  over: boolean;
  playerId: number;
  finishOrder: number[];
  playerFinished: boolean;
  /** Finishing place when finished, else the live place at the end. */
  playerPlace: number;
  field: FieldSummary;
  /** Every event the race emitted, in order. */
  events: SimEvent[];
  eventCounts: Record<string, number>;
  /** `hit` events whose actor is the player. */
  playerHits: number;
  /** Ticks where some mover was invalid (non-finite, unknown mode, bad road position). */
  invalidTicks: number;
  firstInvalid: string | null;
  /** Mover-ticks per `<kind>:<mode>`. */
  modeTicks: Record<string, number>;
  /** State hashes every HASH_EVERY_TICKS ticks and at the end, and the replay's at the same ticks. */
  hashes: number[];
  replayHashes: number[];
  /** Index into `hashes` of the first replay mismatch, or -1. */
  firstMismatch: number;
  /** The player slot's recorded input, one per tick. */
  inputs: SimInput[];
  /** Every mover every TRACE_EVERY_TICKS ticks. */
  trace: { tick: number; movers: MoverSample[] }[];
  bot: BotStats;
  /** Each registered hook's result for this race, by hook id (tests/sim/hooks/). */
  hooks: Record<string, unknown>;
  /** Wall-clock milliseconds for the race and its replay. */
  ms: number;
}

export interface BatchResult {
  format: number;
  key: string;
  races: RaceResult[];
  /** Wall-clock milliseconds this worker spent computing chunks (0 when it computed none). */
  ms: number;
  /** True when this worker computed no chunk: every chunk came from the cache or another worker. */
  fromCache: boolean;
}

export interface RaceOptions {
  /** Called after every step with the new snapshot and that tick's events. */
  onTick?: (snap: SimSnapshot, events: readonly SimEvent[]) => void;
  /** Skip the replay (for quick scenario runs, and the preset batches). */
  noReplay?: boolean;
  /** Easy, Normal or Hard (default Normal). */
  difficulty?: DifficultyPreset;
}

function sample(m: EntitySnapshot): MoverSample {
  const r = m.road;
  return {
    id: m.id,
    kind: m.kind,
    mode: m.mode,
    edge: r.edge,
    s: r.s,
    d: r.d,
    h: r.h,
    dir: r.dir,
    speed: m.speed,
    health: m.health,
    faction: m.faction,
  };
}

/**
 * The base event's race for a seed, with draft content included, as the dev and staging builds
 * (and CI's browser race) load it: lanes land new content as drafts (traffic types, for one), and
 * the batch must cover it. createHeadlessRace's default is live content only, like the prod build.
 */
export function createBatchRace(seed: number, difficulty: DifficultyPreset = 'normal'): HeadlessRace {
  // W-P road events off: this measures the riders, the AI, the law and traffic, and an event reshuffles
  // every seeded race (the events have their own tests: tests/sim/events-*.test.ts, e2e road-events).
  return createHeadlessRace({ seed, difficulty, tuning: NO_ROAD_EVENTS }, { includeDrafts: true });
}

/**
 * The tuning that turns the W-P road events off (their chance slider at 0), and playtest 2's cop
 * patrol and heat meter with them (`cops.patrolScale` and `cops.heatScale` 0): all of them reshuffle
 * every seeded race. The shared batch and the bot-race tests that measure other systems use it, so
 * their seeded races stay what they were. The patrol and the heat have their own races:
 * tests/sim/cops-patrol.test.ts, tests/sim/cops-heat.test.ts and the cops lane's other files.
 */
export const NO_ROAD_EVENTS: Readonly<Record<string, number>> = {
  'modifiers.setPieceChance': 0,
  'cops.patrolScale': 0,
  'cops.heatScale': 0,
};

/**
 * The isolation profile for a seeded test of ONE behaviour (R5 in the determinism run, 2026-10-03):
 * every optional world system off, each at the value its `system: true` declaration names the most
 * "off". A test turns back on only what it tests, on top:
 *
 *   createHeadlessRace({ seed, tuning: { ...ISOLATED, 'cops.heatScale': 3 } });
 *
 * A new system, or a retune of one, then cannot reshuffle that test's races. The riders, the rivals'
 * AI, combat and the road stay: they are the field. Pedestrians stay too: they have no off switch.
 * Roadside weapons have no off value either, so they go as sparse as the slider allows.
 *
 * The trade-off, stated: statistics measured in isolation stop catching interaction effects
 * (traffic shoving a wobbling lander, a roadblock taking the patrol's cops). The shared batch keeps
 * the world on and asserts invariants over it, and a system's own lane writes its interaction test
 * on purpose. tests/sim/isolation-profile.test.ts fails when a `system: true` declaration is
 * missing from this profile, so the lane that adds a world system adds its switch here.
 */
export const ISOLATED: Readonly<Record<string, number>> = {
  'traffic.density': 0,
  'peds.strayAnimalChance': 0,
  'modifiers.setPieceChance': 0,
  'modifiers.propContact': 0,
  'cops.spawnChance': 0,
  'cops.patrolScale': 0,
  'cops.heatScale': 0,
  'ground.offRoad': 0,
  'combat.pickupSpacingM': 3000,
  'combat.crashWeaponChance': 0,
  'smash.density': 0,
  'riders.furniture': 0,
  'riders.supports': 0,
  'riders.structures': 0,
  'riders.courseEdges': 0,
};

/** Seeds `from` to `to`, inclusive. */
export const seedRange = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** The most seeds one firstSeed search may try, so a search's CPU cost stays bounded. */
export const FIRST_SEED_MAX = 64;

/** The outcome of a firstSeed search. */
export interface SeedSearch<T> {
  /** The first seed whose result qualifies, or null when none in the range does. */
  seed: number | null;
  /** That seed's result, or null. */
  result: T | null;
  /** Every seed tried, in order, with its result (the qualifying one last). */
  tried: { seed: number; result: T }[];
  /** One plain line saying which seed was used, or that none qualified, for the output and messages. */
  summary: string;
}

/**
 * The first seed whose race contains a test's precondition (R6 in the determinism run): a bust, a
 * steal, a finish. The seeds are tried in order, so the same build always picks the same seed; when
 * content reshuffles the races, the search moves on to the next seed that qualifies instead of
 * failing. The test then asserts its property on the seed found. It fails only when no seed in the
 * range qualifies, which is a real "this never happens any more" signal. Prints the seed it used.
 */
export function firstSeed<T>(
  label: string,
  seeds: readonly number[],
  run: (seed: number) => T,
  qualifies: (result: T, seed: number) => boolean,
): SeedSearch<T> {
  if (seeds.length === 0 || seeds.length > FIRST_SEED_MAX)
    throw new Error(`firstSeed ${label}: ${seeds.length} seeds; search 1 to ${FIRST_SEED_MAX}`);
  const tried: { seed: number; result: T }[] = [];
  const span = (n: number) => (n === 1 ? `seed ${seeds[0]}` : `seeds ${seeds[0]} to ${seeds[n - 1]}`);
  for (const seed of seeds) {
    const result = run(seed);
    tried.push({ seed, result });
    if (qualifies(result, seed)) {
      const summary = `${label}: seed ${seed} (tried ${span(tried.length)})`;
      process.stdout.write(`[firstSeed] ${summary}\n`);
      return { seed, result, tried, summary };
    }
  }
  const summary = `${label}: none of ${span(seeds.length)} qualifies`;
  process.stdout.write(`[firstSeed] ${summary}\n`);
  return { seed: null, result: null, tried, summary };
}

/** Runs one seeded race with the bot in the player slot, then replays it from its inputs. */
export function runSeededRace(seed: number, opts: RaceOptions = {}): RaceResult {
  const t0 = performance.now();
  const difficulty = opts.difficulty ?? 'normal';
  const { sim, config, route, playerId } = createBatchRace(seed, difficulty);
  const bot = createBot();
  const hooks = BATCH_HOOKS.map((h) => ({ id: h.id, run: h.create({ seed, difficulty, playerId, config }) }));
  const inputs: SimInput[] = [];
  const hashes: number[] = [];
  const events: SimEvent[] = [];
  const eventCounts: Record<string, number> = {};
  const modeTicks: Record<string, number> = {};
  const trace: RaceResult['trace'] = [];
  let invalidTicks = 0;
  let firstInvalid: string | null = null;
  let playerHits = 0;
  const riders = config.riders.length;
  const field: FieldSummary = {
    riders,
    rivals: config.riders.filter((r) => r.controller.kind !== 'player' && r.faction === 'rider').length,
    cops: config.riders.filter((r) => r.faction === 'law').length,
    vehiclesMax: 0,
    vehiclesByDirMax: { plus: 0, minus: 0 },
    pedsMax: 0,
  };

  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    const input = toSimInput(actions);
    inputs.push(input);
    sim.step([input]);
    snap = sim.snapshot();
    const stepEvents = sim.events();
    for (const e of stepEvents) {
      events.push(e);
      eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
      if (e.type === 'hit' && e.actor === playerId) playerHits++;
    }
    let vehicles = 0;
    let plus = 0;
    let minus = 0;
    let peds = 0;
    let bad: string | null = null;
    for (const m of snap.entities) {
      const key = `${m.kind}:${m.mode}`;
      modeTicks[key] = (modeTicks[key] ?? 0) + 1;
      if (m.kind === 'vehicle') {
        vehicles++;
        if (m.road.dir === 1) plus++;
        else minus++;
      } else if (m.kind === 'ped') peds++;
      if (!bad) {
        const problem = moverProblem(m, route);
        if (problem) bad = `tick ${snap.tick} entity ${m.id} (${m.kind}, ${m.mode}): ${problem}`;
      }
    }
    if (bad) {
      invalidTicks++;
      firstInvalid ??= bad;
    }
    field.vehiclesMax = Math.max(field.vehiclesMax, vehicles);
    field.vehiclesByDirMax.plus = Math.max(field.vehiclesByDirMax.plus, plus);
    field.vehiclesByDirMax.minus = Math.max(field.vehiclesByDirMax.minus, minus);
    field.pedsMax = Math.max(field.pedsMax, peds);
    if (sim.tick % HASH_EVERY_TICKS === 0) hashes.push(sim.hash());
    if (sim.tick % TRACE_EVERY_TICKS === 0) trace.push({ tick: sim.tick, movers: snap.entities.map(sample) });
    for (const h of hooks) h.run.onTick(snap, stepEvents);
    opts.onTick?.(snap, stepEvents);
  }
  hashes.push(sim.hash());

  // The same-run replay: a fresh sim from the same seed, stepped with the recorded inputs.
  const replayHashes: number[] = [];
  if (!opts.noReplay) {
    const replay = createBatchRace(seed, difficulty).sim;
    for (const input of inputs) {
      replay.step([input]);
      if (replay.tick % HASH_EVERY_TICKS === 0) replayHashes.push(replay.hash());
    }
    replayHashes.push(replay.hash());
  }
  const firstMismatch = opts.noReplay ? -1 : hashes.findIndex((h, i) => replayHashes[i] !== h);

  const me = snap.entities[playerId];
  const finishOrder = [...snap.race.finishOrder];
  const playerFinished = finishOrder.includes(playerId);
  return {
    seed,
    difficulty,
    ticks: sim.tick,
    over: sim.isOver(),
    playerId,
    finishOrder,
    playerFinished,
    playerPlace: playerFinished ? finishOrder.indexOf(playerId) + 1 : (me?.place ?? 0),
    field,
    events,
    eventCounts,
    playerHits,
    invalidTicks,
    firstInvalid,
    modeTicks,
    hashes,
    replayHashes,
    firstMismatch,
    inputs,
    trace,
    bot: bot.stats(),
    hooks: Object.fromEntries(hooks.map((h) => [h.id, h.run.result()])),
    ms: performance.now() - t0,
  };
}

/** Runs the batch now, without the cache. */
export function runBatch(seeds: readonly number[] = BATCH_SEEDS): RaceResult[] {
  return seeds.map((seed) => runSeededRace(seed));
}

/** Runs a preset's batch now, without the cache: no replay (the Normal batch covers determinism). */
export function runPresetBatch(
  difficulty: DifficultyPreset,
  seeds: readonly number[] = PRESET_SEEDS,
): RaceResult[] {
  return seeds.map((seed) => runSeededRace(seed, { difficulty, noReplay: true }));
}

// ---- The shared cache ---------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'throttlebrawl');

function filesUnder(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(repoRoot, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

/** A hash of everything the batch's results depend on. */
export function batchKey(seeds: readonly number[] = BATCH_SEEDS, variant = 'normal'): string {
  const h = createHash('sha256');
  h.update(`format ${BATCH_FORMAT}; node ${process.version}; ${variant}; seeds ${seeds.join(',')}\n`);
  for (const f of [
    ...filesUnder('src'),
    ...filesUnder('packs'),
    ...filesUnder('tests/sim/hooks'),
    'tests/sim/batch.ts',
  ]) {
    h.update(`${f}\n`);
    h.update(readFileSync(path.join(repoRoot, f)));
  }
  return h.digest('hex').slice(0, 16);
}

/** Creates the lock file, or returns null when another worker holds it. */
function tryLock(lock: string): number | null {
  try {
    return openSync(lock, 'wx');
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One cached chunk of a batch: CHUNK_SEEDS (or fewer) consecutive seeds' races. */
interface BatchChunk {
  format: number;
  key: string;
  seeds: number[];
  races: RaceResult[];
}

/** `seeds` in runs of CHUNK_SEEDS, in order. */
function seedChunks(seeds: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < seeds.length; i += CHUNK_SEEDS) chunks.push(seeds.slice(i, i + CHUNK_SEEDS));
  return chunks;
}

/** A chunk file of this format and key that holds exactly `seeds`' races, in order, or null. */
function readChunk(file: string, key: string, seeds: readonly number[]): BatchChunk | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as BatchChunk;
    const same = (a: readonly number[]) => a.length === seeds.length && a.every((s, i) => s === seeds[i]);
    return parsed.format === BATCH_FORMAT &&
      parsed.key === key &&
      same(parsed.seeds) &&
      same(parsed.races.map((r) => r.seed))
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Deletes a lock older than the timeout: its worker was killed. */
function clearStaleLock(lock: string): void {
  try {
    if (Date.now() - statSync(lock).mtimeMs > BATCH_TIMEOUT_MS) rmSync(lock, { force: true });
  } catch {
    // The lock vanished between the two calls: the next pass reads the chunk.
  }
}

let memo: Promise<BatchResult> | null = null;
const presetMemo = new Map<string, Promise<BatchResult>>();

/**
 * The shared batch: 50 seeded bot races with their replays, computed once per source tree.
 * Every lane's tests/sim/<lane>-*.test.ts reads this; nobody runs their own 50 races.
 */
export function simBatch(): Promise<BatchResult> {
  memo ??= loadOrCompute('normal', BATCH_SEEDS, (seeds) => runBatch(seeds));
  return memo;
}

/**
 * The Easy or Hard batch (dev-4): PRESET_RACES seeded bot races on that preset, no replay, cached
 * like the Normal batch. The Easy-versus-Hard comparisons read these instead of racing their own.
 */
export function presetBatch(difficulty: 'easy' | 'hard'): Promise<BatchResult> {
  let p = presetMemo.get(difficulty);
  if (!p) {
    p = loadOrCompute(difficulty, PRESET_SEEDS, (seeds) => runPresetBatch(difficulty, seeds));
    presetMemo.set(difficulty, p);
  }
  return p;
}

/**
 * A batch from its cached chunks. Each pass takes every chunk that is cached and computes each
 * chunk no other worker holds the lock of, yielding after each one, so a file that awaits two
 * batches at once (riders-difficulty: Easy and Hard) works on both. It sleeps only when every
 * missing chunk is locked by another worker. The chunks merge in seed order.
 */
async function loadOrCompute(
  variant: string,
  seeds: readonly number[],
  run: (seeds: readonly number[]) => RaceResult[],
): Promise<BatchResult> {
  const key = batchKey(seeds, variant);
  if (process.env['SIM_BATCH_CACHE'] === '0') {
    const t0 = performance.now();
    const races = run(seeds);
    return { format: BATCH_FORMAT, key, races, ms: performance.now() - t0, fromCache: false };
  }

  mkdirSync(cacheDir, { recursive: true });
  // The Normal batch keeps its M1 stem; the presets add theirs. Chunk i is `<stem>-<key>-c<i>.json`.
  const stem = variant === 'normal' ? 'sim-batch' : `sim-batch-${variant}`;
  const chunks = seedChunks(seeds);
  const done: (BatchChunk | null)[] = chunks.map(() => null);
  const deadline = Date.now() + BATCH_TIMEOUT_MS;
  let ms = 0;
  let computed = 0;
  for (;;) {
    let progressed = false;
    for (const [i, chunkSeeds] of chunks.entries()) {
      if (done[i]) continue;
      const file = path.join(cacheDir, `${stem}-${key}-c${i}.json`);
      done[i] = readChunk(file, key, chunkSeeds);
      if (done[i]) continue;
      const lock = `${file}.lock`;
      const fd = tryLock(lock);
      if (fd === null) {
        clearStaleLock(lock);
        continue;
      }
      try {
        done[i] = readChunk(file, key, chunkSeeds);
        if (done[i]) continue;
        const t0 = performance.now();
        const chunk: BatchChunk = { format: BATCH_FORMAT, key, seeds: chunkSeeds, races: run(chunkSeeds) };
        const took = performance.now() - t0;
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(chunk));
        renameSync(tmp, file);
        done[i] = chunk;
        ms += took;
        computed++;
        progressed = true;
        process.stdout.write(
          `[sim batch] ${variant} chunk ${i + 1}/${chunks.length} (seeds ${chunkSeeds[0]} to ` +
            `${chunkSeeds[chunkSeeds.length - 1]}) computed in ${(took / 1000).toFixed(1)} s, pid ${process.pid}\n`,
        );
      } finally {
        closeSync(fd);
        rmSync(lock, { force: true });
      }
      // Let this worker's other batch waits take a turn before the next chunk.
      await sleep(0);
    }
    if (done.every((c) => c !== null)) break;
    if (!progressed) {
      if (Date.now() > deadline) throw new Error(`sim batch: timed out waiting for ${stem}-${key} chunks`);
      await sleep(500);
    }
  }

  if (computed > 0) {
    // Chunks and whole batches of this variant from other source trees are dead weight now.
    const old = new RegExp(`^${stem}-([0-9a-f]+)(?:-c\\d+)?\\.json$`);
    for (const f of readdirSync(cacheDir)) {
      const m = old.exec(f);
      if (m && m[1] !== key) rmSync(path.join(cacheDir, f), { force: true });
    }
  }
  const races = done.flatMap((c) => c?.races ?? []);
  return { format: BATCH_FORMAT, key, races, ms, fromCache: computed === 0 };
}
