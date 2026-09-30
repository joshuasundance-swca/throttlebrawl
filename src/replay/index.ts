// replay: input recording and playback (docs/architecture.md, "Replay and input recording";
// docs/milestones/M1.md, replay-1). Every race records the player slots' quantized SimInputs per
// tick, the mid-race tuning changes {tick, id, value} and a state hash every 60 ticks. The
// recording lives in memory as plain per-tick arrays (the last race only, in M1); `encodeReplay`
// turns it into the run-length-encoded file the debug file carries, and `createReplayController`
// plays it back against a fresh sim with desync detection. replay/ imports only the sim contract.
import type { SimConfig, SimInput, Sim } from '../sim/api';

export const REPLAY_FORMAT_VERSION = 1;
/** The recording keeps the state hash after every tick that is a multiple of this. */
export const HASH_EVERY_TICKS = 60;

/** The race's SimConfig as plain data: the road and route handles are rebuilt from the event. */
export type ReplayConfig = Omit<SimConfig, 'road' | 'route'>;

export interface ReplayHeader {
  formatVersion: number;
  /** simCodeHash + simContentHash; in M1 the code part is the build commit. */
  replayKey: string;
  seed: number;
  eventId: string;
  /** Sim-affecting tuning values at race start. */
  tuning: Readonly<Record<string, number>>;
  /** The whole SimConfig minus the road and route handles (set by `replayHeader`). */
  config?: ReplayConfig;
  /** Player slots recorded per tick. */
  playerSlots?: number;
  hashEveryTicks?: number;
}

export interface Recording {
  header: ReplayHeader;
  /** One entry per stepped tick: the inputs of every player slot. */
  inputs: SimInput[][];
  params: { tick: number; id: string; value: number }[];
  /** State hashes after stepping each checkpoint tick (every 60 ticks). */
  hashes: { tick: number; hash: number }[];
  /** The last stepped tick and the hash after it, once the race is finished. */
  end?: { tick: number; hash: number };
}

/** `simCodeHash + simContentHash`: the replay key (docs/architecture.md). */
export function makeReplayKey(simCodeHash: string, simContentHash: string): string {
  return `${simCodeHash}+${simContentHash}`;
}

/** A complete header for a race: the SimConfig as plain data plus the key. */
export function replayHeader(config: SimConfig, replayKey: string): ReplayHeader {
  const { road: _road, route: _route, ...plain } = config;
  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    replayKey,
    seed: config.seed,
    eventId: config.event.contentId,
    tuning: { ...config.tuning },
    config: structuredClone(plain),
    playerSlots: config.playerSlots,
    hashEveryTicks: HASH_EVERY_TICKS,
  };
}

/** Rebuilds a SimConfig from a header and the road handles the event's region gives. */
export function configFromHeader(
  header: ReplayHeader,
  road: SimConfig['road'],
  route: SimConfig['route'],
): SimConfig {
  if (!header.config) throw new Error('replay: this header carries no SimConfig');
  return { ...structuredClone(header.config), road, route };
}

export interface InputRecorder {
  begin(header: ReplayHeader): void;
  /** Starts a recording from the race's own config (the full header). */
  beginRace(sim: Pick<Sim, 'config'>, replayKey: string): void;
  /** Records the inputs stepped at `tick` (ticks must arrive in order, starting at 0). */
  record(tick: number, inputs: readonly SimInput[]): void;
  recordParam(tick: number, id: string, value: number): void;
  /** The state hash after stepping `tick`. */
  checkpoint(tick: number, hash: number): void;
  /** The last stepped tick and the hash after it. */
  finish(tick: number, hash: number): void;
  /** The recording so far (the last race's stays in memory only, in M1). */
  current(): Recording | null;
  /** The recording as a run-length-encoded file, for the debug file. */
  file(): ReplayFile | null;
}

export function createInputRecorder(): InputRecorder {
  let rec: Recording | null = null;
  const recorder: InputRecorder = {
    begin(header) {
      rec = { header, inputs: [], params: [], hashes: [] };
    },
    beginRace(sim, replayKey) {
      recorder.begin(replayHeader(sim.config, replayKey));
    },
    record(tick, inputs) {
      if (!rec) return;
      if (tick !== rec.inputs.length)
        throw new Error(`replay: expected tick ${rec.inputs.length}, got ${tick}`);
      rec.inputs.push(
        inputs.map((i) => ({ steer: i.steer, throttle: i.throttle, brake: i.brake, flags: i.flags })),
      );
    },
    recordParam(tick, id, value) {
      rec?.params.push({ tick, id, value });
    },
    checkpoint(tick, hash) {
      rec?.hashes.push({ tick, hash });
    },
    finish(tick, hash) {
      if (rec) rec.end = { tick, hash };
    },
    current: () => rec,
    file: () => (rec ? encodeReplay(rec) : null),
  };
  return recorder;
}

// ---- Run-length encoding ------------------------------------------------------------------

/**
 * Per-slot runs, flat: `[count, steer, throttle, brake, flags, count, ...]`. A held stick or a
 * held throttle collapses to one run; analog steering that changes every tick costs 5 numbers.
 */
export interface EncodedInputs {
  ticks: number;
  slots: number[][];
}

const RUN = 5;

export function encodeInputs(ticks: readonly (readonly SimInput[])[]): EncodedInputs {
  const slotCount = ticks.reduce((n, t) => Math.max(n, t.length), 0);
  const slots: number[][] = [];
  for (let s = 0; s < slotCount; s++) {
    const runs: number[] = [];
    for (const t of ticks) {
      const i = t[s];
      if (!i) throw new Error('replay: every tick must carry every slot');
      const at = runs.length - RUN;
      if (
        at >= 0 &&
        runs[at + 1] === i.steer &&
        runs[at + 2] === i.throttle &&
        runs[at + 3] === i.brake &&
        runs[at + 4] === i.flags
      ) {
        runs[at] = (runs[at] ?? 0) + 1;
      } else {
        runs.push(1, i.steer, i.throttle, i.brake, i.flags);
      }
    }
    slots.push(runs);
  }
  return { ticks: ticks.length, slots };
}

export function decodeInputs(enc: EncodedInputs): SimInput[][] {
  const out: SimInput[][] = Array.from({ length: enc.ticks }, () => []);
  for (const runs of enc.slots) {
    let t = 0;
    if (runs.length % RUN !== 0) throw new Error('replay: runs are not whole');
    for (let r = 0; r < runs.length; r += RUN) {
      const [n = 0, steer = 0, throttle = 0, brake = 0, flags = 0] = runs.slice(r, r + RUN);
      if (!Number.isInteger(n) || n < 1) throw new Error('replay: runs hold a bad count');
      for (let k = 0; k < n; k++) out[t++]?.push({ steer, throttle, brake, flags });
    }
    if (t !== enc.ticks) throw new Error(`replay: runs add up to ${t} ticks, not ${enc.ticks}`);
  }
  return out;
}

/** The recording as a file: the header, run-length-encoded inputs, tuning changes and hashes. */
export interface ReplayFile {
  header: ReplayHeader;
  inputs: EncodedInputs;
  params: Recording['params'];
  hashes: Recording['hashes'];
  end?: Recording['end'];
}

export function encodeReplay(rec: Recording): ReplayFile {
  return {
    header: rec.header,
    inputs: encodeInputs(rec.inputs),
    params: rec.params,
    hashes: rec.hashes,
    ...(rec.end ? { end: rec.end } : {}),
  };
}

/** Reads a parsed replay file. Throws on a newer format or runs that do not add up. */
export function decodeReplay(raw: unknown): Recording {
  const file = raw as Partial<ReplayFile> | null;
  const header = file?.header;
  if (!file || typeof header !== 'object' || !file.inputs || !Array.isArray(file.inputs.slots))
    throw new Error('replay: not a replay file');
  if (typeof header.formatVersion !== 'number' || header.formatVersion > REPLAY_FORMAT_VERSION)
    throw new Error(`replay: format ${String(header.formatVersion)} is newer than this build reads`);
  return {
    header,
    inputs: decodeInputs(file.inputs),
    params: file.params ?? [],
    hashes: file.hashes ?? [],
    ...(file.end ? { end: file.end } : {}),
  };
}

// ---- Playback -----------------------------------------------------------------------------

/** What playback needs from a sim: a fresh one, built from the recording's config. */
export type ReplayableSim = Pick<Sim, 'tick' | 'step' | 'hash' | 'applyParam'>;

export interface Desync {
  /** The first checkpoint tick whose hash differs. */
  tick: number;
  expected: number;
  actual: number;
}

export interface ReplayResult {
  /** Ticks stepped. */
  ticks: number;
  /** Hashes compared (checkpoints plus the end). */
  checked: number;
  desync: Desync | null;
  finalHash: number;
}

export type ReplayStep = 'stepped' | 'desync' | 'end';

/** Feeds recorded inputs back, tick by tick, and compares state hashes. */
export interface ReplayController {
  inputsAt(tick: number): readonly SimInput[] | null;
  paramsAt(tick: number): readonly { id: string; value: number }[];
  /** Re-applies the tick's tuning changes, steps the sim with its inputs, then checks the hash. */
  step(sim: ReplayableSim): ReplayStep;
  /** Steps to the end of the recording or to the first desync. */
  run(sim: ReplayableSim): ReplayResult;
  readonly desync: Desync | null;
}

export function createReplayController(rec: Recording): ReplayController {
  const paramsByTick = new Map<number, { id: string; value: number }[]>();
  for (const p of rec.params) {
    const list = paramsByTick.get(p.tick) ?? [];
    list.push({ id: p.id, value: p.value });
    paramsByTick.set(p.tick, list);
  }
  const hashByTick = new Map<number, number>();
  for (const h of rec.hashes) hashByTick.set(h.tick, h.hash);
  let desync: Desync | null = null;
  let checked = 0;
  let stepped = 0;

  const check = (tick: number, expected: number | undefined, actual: number) => {
    if (expected === undefined) return;
    checked++;
    if (expected !== actual && !desync) desync = { tick, expected, actual };
  };

  const controller: ReplayController = {
    inputsAt: (tick) => rec.inputs[tick] ?? null,
    paramsAt: (tick) => paramsByTick.get(tick) ?? [],
    get desync() {
      return desync;
    },
    step(sim) {
      if (desync) return 'desync';
      const tick = sim.tick;
      const inputs = rec.inputs[tick];
      if (!inputs) return 'end';
      for (const p of controller.paramsAt(tick)) sim.applyParam(p.id, p.value);
      sim.step(inputs);
      stepped++;
      const hash = hashByTick.has(tick) || rec.end?.tick === tick ? sim.hash() : 0;
      check(tick, hashByTick.get(tick), hash);
      if (rec.end?.tick === tick) check(tick, rec.end.hash, hash);
      return desync ? 'desync' : 'stepped';
    },
    run(sim) {
      while (controller.step(sim) === 'stepped');
      return { ticks: stepped, checked, desync, finalHash: sim.hash() };
    },
  };
  return controller;
}
