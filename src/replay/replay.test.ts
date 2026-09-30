import { describe, expect, it } from 'vitest';
import type { SimInput } from '../sim/api';
import {
  createInputRecorder,
  createReplayController,
  decodeInputs,
  decodeReplay,
  encodeInputs,
  encodeReplay,
  HASH_EVERY_TICKS,
  makeReplayKey,
  REPLAY_FORMAT_VERSION,
  type ReplayableSim,
  type ReplayHeader,
} from './index';

// replay-1 unit acceptance (docs/milestones/M1.md): run-length encoding round-trips; a tampered
// input reports a desync at the right tick; a mid-race tuning change is recorded and re-applied.
// The same checks over real headless races are in tests/sim/replay-determinism.test.ts.

const input = (steer: number, throttle = 255, brake = 0, flags = 0): SimInput => ({
  steer,
  throttle,
  brake,
  flags,
});

/** A toy deterministic sim: its state folds every input and parameter it sees. */
function toySim(): ReplayableSim & { params: Record<string, number> } {
  let tick = 0;
  let state = 0x811c9dc5;
  const pending: [string, number][] = [];
  const params: Record<string, number> = { gain: 1 };
  const fold = (n: number) => {
    state = Math.imul(state ^ (n & 0xffff), 0x01000193) >>> 0;
  };
  return {
    params,
    get tick() {
      return tick;
    },
    applyParam(id, value) {
      pending.push([id, value]);
    },
    step(inputs) {
      for (const [id, v] of pending.splice(0)) params[id] = v;
      for (const i of inputs) {
        fold(i.steer * (params['gain'] ?? 1));
        fold(i.throttle);
        fold(i.brake);
        fold(i.flags);
      }
      tick++;
    },
    hash: () => state,
  };
}

const header: ReplayHeader = {
  formatVersion: REPLAY_FORMAT_VERSION,
  replayKey: makeReplayKey('abc1234', 'deadbeef'),
  seed: 7,
  eventId: 'base:test',
  tuning: { gain: 1 },
};

/** Records `ticks` ticks of a scripted input stream on a toy sim, as app/ does. */
function recordToy(ticks: number, script: (t: number) => SimInput, params: [number, string, number][] = []) {
  const sim = toySim();
  const rec = createInputRecorder();
  rec.begin(header);
  while (sim.tick < ticks) {
    const t = sim.tick;
    for (const [at, id, v] of params)
      if (at === t) {
        sim.applyParam(id, v);
        rec.recordParam(t, id, v);
      }
    const cmd = [script(t)];
    rec.record(t, cmd);
    sim.step(cmd);
    if (t % HASH_EVERY_TICKS === 0) rec.checkpoint(t, sim.hash());
  }
  rec.finish(sim.tick - 1, sim.hash());
  const recording = rec.current();
  if (!recording) throw new Error('no recording');
  return { recording, finalHash: sim.hash() };
}

// Held inputs with occasional changes, like a thumb on a stick.
const script = (t: number) =>
  input(t < 100 ? 0 : t < 250 ? 40 : -20, t % 97 === 0 ? 0 : 255, 0, t === 400 ? 1 : 0);

describe('run-length encoding', () => {
  it('round-trips per-slot streams, including single ticks and long holds', () => {
    const ticks: SimInput[][] = [];
    for (let t = 0; t < 1000; t++)
      ticks.push([script(t), input(t % 3, 0, t > 500 ? 255 : 0, t % 50 === 0 ? 8 : 0)]);
    const enc = encodeInputs(ticks);
    expect(enc.ticks).toBe(1000);
    expect(enc.slots).toHaveLength(2);
    expect(decodeInputs(enc)).toEqual(ticks);
    // The held stream collapses; the every-tick-changing one does not grow past 5 numbers per tick.
    expect(enc.slots[0]?.length ?? 0).toBeLessThan(5 * 30);
    expect(enc.slots[1]?.length ?? 0).toBeLessThanOrEqual(5 * 1000);
  });

  it('round-trips an empty recording and a whole replay file through JSON', () => {
    expect(decodeInputs(encodeInputs([]))).toEqual([]);
    const { recording } = recordToy(700, script, [[300, 'gain', 3]]);
    const file = JSON.parse(JSON.stringify(encodeReplay(recording))) as unknown;
    expect(decodeReplay(file)).toEqual(recording);
  });

  it('refuses a file from a newer format, or with runs that do not add up', () => {
    const file = encodeReplay(recordToy(120, script).recording);
    expect(() => decodeReplay({ ...file, header: { ...file.header, formatVersion: 99 } })).toThrow(/newer/);
    const broken = { ...file, inputs: { ...file.inputs, ticks: file.inputs.ticks + 1 } };
    expect(() => decodeReplay(broken)).toThrow(/runs/);
    expect(() => decodeReplay({ nope: true })).toThrow();
  });
});

describe('the recorder', () => {
  it('keeps every player slot per tick, tuning changes and a hash every 60 ticks', () => {
    const { recording } = recordToy(200, script, [[50, 'gain', 2]]);
    expect(recording.inputs).toHaveLength(200);
    expect(recording.params).toEqual([{ tick: 50, id: 'gain', value: 2 }]);
    expect(recording.hashes.map((h) => h.tick)).toEqual([0, 60, 120, 180]);
    expect(recording.end?.tick).toBe(199);
  });

  it('copies inputs, so a later change to the caller object cannot rewrite history', () => {
    const rec = createInputRecorder();
    rec.begin(header);
    const cmd = input(10);
    rec.record(0, [cmd]);
    cmd.steer = 99;
    expect(rec.current()?.inputs[0]?.[0]?.steer).toBe(10);
  });

  it('refuses ticks out of order', () => {
    const rec = createInputRecorder();
    rec.begin(header);
    rec.record(0, [input(0)]);
    expect(() => rec.record(2, [input(0)])).toThrow(/expected tick 1/);
  });

  it('builds the replay key from the sim code and sim content hashes', () => {
    expect(makeReplayKey('abc1234', 'deadbeef')).toBe('abc1234+deadbeef');
  });
});

describe('the replay controller', () => {
  it('replays to identical hashes at every checkpoint and at the end', () => {
    const { recording, finalHash } = recordToy(1000, script);
    const result = createReplayController(recording).run(toySim());
    expect(result).toMatchObject({ ticks: 1000, desync: null, finalHash });
    expect(result.checked).toBe(recording.hashes.length + 1);
  });

  it('reports a tampered input as a desync at the first checkpoint after it', () => {
    const { recording } = recordToy(1000, script);
    const tampered = structuredClone(recording);
    const slot = tampered.inputs[433]?.[0];
    if (!slot) throw new Error('no tick 433');
    slot.steer += 1;
    const result = createReplayController(tampered).run(toySim());
    expect(result.desync?.tick).toBe(480);
    expect(result.ticks).toBe(481); // it stops at the desync
    expect(result.desync?.expected).toBe(recording.hashes.find((h) => h.tick === 480)?.hash);
  });

  it('re-applies each recorded tuning change before stepping its tick', () => {
    const { recording, finalHash } = recordToy(600, script, [[301, 'gain', 3]]);
    expect(createReplayController(recording).run(toySim())).toMatchObject({ desync: null, finalHash });
    // Without the change the replay must fail, at the first checkpoint after tick 301.
    const without = { ...recording, params: [] };
    expect(createReplayController(without).run(toySim()).desync?.tick).toBe(360);
  });

  it('steps one tick at a time and says when the recording runs out', () => {
    const { recording } = recordToy(3, script);
    const c = createReplayController(recording);
    const sim = toySim();
    expect([c.step(sim), c.step(sim), c.step(sim), c.step(sim)]).toEqual([
      'stepped',
      'stepped',
      'stepped',
      'end',
    ]);
    expect(c.inputsAt(1)).toEqual([script(1)]);
    expect(c.inputsAt(3)).toBeNull();
  });
});
