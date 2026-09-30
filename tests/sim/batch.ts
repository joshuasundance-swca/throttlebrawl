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
// (node_modules/.cache/throttlebrawl/), keyed by a hash of src/, packs/ and this file: the first
// worker computes it under a lock file while the others wait, and a change to any source makes a
// new key. SIM_BATCH_CACHE=0 turns the disk cache off. For a single scenario with per-tick access,
// call runSeededRace(seed, { onTick }) directly instead.
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
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { loadBasePack } from '../../src/content';
import { createBot, moverProblem, type BotStats } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import {
  createSim,
  type EntitySnapshot,
  type RouteQueries,
  type Sim,
  type SimConfig,
  type SimEvent,
  type SimInput,
  type SimSnapshot,
} from '../../src/sim/api';
import type { ImportGlobFunction } from 'vite';

declare global {
  interface ImportMeta {
    glob: ImportGlobFunction;
  }
}

/** Bump when the result shape or the way races are run changes, to retire old caches. */
const BATCH_FORMAT = 1;
export const BATCH_RACES = 50;
export const BATCH_SEEDS: readonly number[] = Array.from({ length: BATCH_RACES }, (_, i) => i + 1);
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
  /** Wall-clock milliseconds for the race and its replay. */
  ms: number;
}

export interface BatchResult {
  format: number;
  key: string;
  races: RaceResult[];
  /** Wall-clock milliseconds to compute (0 when it came from the cache). */
  ms: number;
  fromCache: boolean;
}

export interface RaceOptions {
  /** Called after every step with the new snapshot and that tick's events. */
  onTick?: (snap: SimSnapshot, events: readonly SimEvent[]) => void;
  /** Skip the replay (for quick scenario runs). */
  noReplay?: boolean;
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
 * the batch must cover it. app's createHeadlessRace loads live content only, like the prod build.
 */
export function createBatchRace(seed: number): {
  sim: Sim;
  config: SimConfig;
  route: RouteQueries;
  playerId: number;
} {
  const reg = loadBasePack({ includeDrafts: true });
  const config = buildSimConfig(reg, streamForEvent(reg), { seed });
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  return { sim: createSim(config), config, route: config.route, playerId };
}

/** Runs one seeded race with the bot in the player slot, then replays it from its inputs. */
export function runSeededRace(seed: number, opts: RaceOptions = {}): RaceResult {
  const t0 = performance.now();
  const { sim, config, route, playerId } = createBatchRace(seed);
  const bot = createBot();
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
    opts.onTick?.(snap, stepEvents);
  }
  hashes.push(sim.hash());

  // The same-run replay: a fresh sim from the same seed, stepped with the recorded inputs.
  const replayHashes: number[] = [];
  if (!opts.noReplay) {
    const replay = createBatchRace(seed).sim;
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
    ms: performance.now() - t0,
  };
}

/** Runs the batch now, without the cache. */
export function runBatch(seeds: readonly number[] = BATCH_SEEDS): RaceResult[] {
  return seeds.map((seed) => runSeededRace(seed));
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
export function batchKey(seeds: readonly number[] = BATCH_SEEDS): string {
  const h = createHash('sha256');
  h.update(`format ${BATCH_FORMAT}; node ${process.version}; seeds ${seeds.join(',')}\n`);
  for (const f of [...filesUnder('src'), ...filesUnder('packs'), 'tests/sim/batch.ts']) {
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

function readCache(file: string, key: string): BatchResult | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as BatchResult;
    return parsed.format === BATCH_FORMAT && parsed.key === key
      ? { ...parsed, ms: 0, fromCache: true }
      : null;
  } catch {
    return null;
  }
}

let memo: Promise<BatchResult> | null = null;

/**
 * The shared batch: 50 seeded bot races with their replays, computed once per source tree.
 * Every lane's tests/sim/<lane>-*.test.ts reads this; nobody runs their own 50 races.
 */
export function simBatch(): Promise<BatchResult> {
  memo ??= loadOrCompute();
  return memo;
}

async function loadOrCompute(): Promise<BatchResult> {
  const key = batchKey();
  const compute = (): BatchResult => {
    const t0 = performance.now();
    const races = runBatch();
    return { format: BATCH_FORMAT, key, races, ms: performance.now() - t0, fromCache: false };
  };
  if (process.env['SIM_BATCH_CACHE'] === '0') return compute();

  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `sim-batch-${key}.json`);
  const lock = `${file}.lock`;
  const deadline = Date.now() + BATCH_TIMEOUT_MS;
  for (;;) {
    const cached = readCache(file, key);
    if (cached) return cached;
    const fd = tryLock(lock);
    if (fd === null) {
      // Another worker is computing. A lock older than the timeout is stale (a killed run).
      try {
        if (Date.now() - statSync(lock).mtimeMs > BATCH_TIMEOUT_MS) rmSync(lock, { force: true });
      } catch {
        // The lock vanished between the two calls: loop and read the result.
      }
      if (Date.now() > deadline) throw new Error(`sim batch: timed out waiting for ${lock}`);
      await sleep(500);
      continue;
    }
    try {
      const again = readCache(file, key);
      if (again) return again;
      const result = compute();
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(result));
      renameSync(tmp, file);
      // Older batches (other source trees) are dead weight now.
      for (const f of readdirSync(cacheDir))
        if (/^sim-batch-[0-9a-f]+\.json$/.test(f) && f !== path.basename(file))
          rmSync(path.join(cacheDir, f), { force: true });
      return result;
    } finally {
      closeSync(fd);
      rmSync(lock, { force: true });
    }
  }
}
