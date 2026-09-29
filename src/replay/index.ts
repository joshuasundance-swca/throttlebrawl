// replay: input recording (docs/architecture.md, "Replay and input recording"). Every race
// records the player slots' SimInputs and the mid-race tuning changes {tick, id, value}. The
// skeleton keeps plain arrays in memory; replay-1 adds run-length encoding, the header's replay
// key and state hashes every 60 ticks, and the ReplayController with desync detection.
import type { SimInput } from '../sim/api';

export const REPLAY_FORMAT_VERSION = 1;

export interface ReplayHeader {
  formatVersion: number;
  /** simCodeHash + simContentHash; in M1 the code part is the build commit. */
  replayKey: string;
  seed: number;
  eventId: string;
  /** Sim-affecting tuning values at race start. */
  tuning: Readonly<Record<string, number>>;
}

export interface Recording {
  header: ReplayHeader;
  /** One entry per stepped tick: the inputs of every player slot. */
  inputs: SimInput[][];
  params: { tick: number; id: string; value: number }[];
  /** State hashes at checkpoints (replay-1 fills these every 60 ticks). */
  hashes: { tick: number; hash: number }[];
}

export interface InputRecorder {
  begin(header: ReplayHeader): void;
  /** Records the inputs stepped at `tick` (ticks must arrive in order, starting at 0). */
  record(tick: number, inputs: readonly SimInput[]): void;
  recordParam(tick: number, id: string, value: number): void;
  checkpoint(tick: number, hash: number): void;
  /** The recording so far (the last race's stays in memory only, in M1). */
  current(): Recording | null;
}

export function createInputRecorder(): InputRecorder {
  let rec: Recording | null = null;
  return {
    begin(header) {
      rec = { header, inputs: [], params: [], hashes: [] };
    },
    record(tick, inputs) {
      if (!rec) return;
      if (tick !== rec.inputs.length)
        throw new Error(`replay: expected tick ${rec.inputs.length}, got ${tick}`);
      rec.inputs.push(inputs.map((i) => ({ ...i })));
    },
    recordParam(tick, id, value) {
      rec?.params.push({ tick, id, value });
    },
    checkpoint(tick, hash) {
      rec?.hashes.push({ tick, hash });
    },
    current: () => rec,
  };
}

/** Feeds recorded inputs back, tick by tick (replay-1 adds desync detection). */
export interface ReplayController {
  inputsAt(tick: number): readonly SimInput[] | null;
  paramsAt(tick: number): readonly { id: string; value: number }[];
}

export function createReplayController(rec: Recording): ReplayController {
  return {
    inputsAt: (tick) => rec.inputs[tick] ?? null,
    paramsAt: (tick) => rec.params.filter((p) => p.tick === tick),
  };
}
