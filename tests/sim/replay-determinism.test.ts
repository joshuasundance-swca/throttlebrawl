import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
  makeReplayKey,
  type Recording,
} from '../../src/replay';
import { createSim, quantizeInput, type Sim } from '../../src/sim/api';

// replay-1 acceptance over real headless races (docs/milestones/M1.md): each race replays in the
// same run to identical state hashes; a tampered input reports a desync at the right tick; a
// mid-race tuning change is recorded and the replay reproduces the hashes.
//
// Interim: until dev-1's shared 50-race batch (tests/sim/batch.ts) exists, this file records its
// own few seeded bot races the way app/ does. When the batch lands, the replay check moves onto
// the batch's races and this file stops racing on its own.

const SEEDS = [1, 7, 42];
const MAX_TICKS = 60 * 600;

function blank(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

interface Recorded {
  recording: Recording;
  finalHash: number;
  ticks: number;
  makeSim: () => Sim;
}

/** One seeded bot race, recorded exactly as app/ records a live race. */
function recordRace(
  seed: number,
  tuningAt: { tick: number; id: string; value: number } | null = null,
): Recorded {
  const race = createHeadlessRace({ seed });
  const { sim, route, playerId } = race;
  const bot = createStubBot();
  const recorder = createInputRecorder();
  recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const tick = sim.tick;
    if (tuningAt && tuningAt.tick === tick) {
      sim.applyParam(tuningAt.id, tuningAt.value);
      recorder.recordParam(tick, tuningAt.id, tuningAt.value);
    }
    const me = sim.snapshot().entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, route, a);
    const cmd = [quantizeInput({ ...a, flags: 0 })];
    recorder.record(tick, cmd);
    sim.step(cmd);
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
  }
  recorder.finish(sim.tick - 1, sim.hash());
  const recording = recorder.current();
  if (!recording) throw new Error('no recording');
  // A fresh sim from the recording's own header, with the region's road handles.
  const makeSim = () => createSim(configFromHeader(recording.header, race.config.road, race.config.route));
  return { recording, finalHash: sim.hash(), ticks: sim.tick, makeSim };
}

describe('replay-1: record-then-replay over real races', () => {
  const races = SEEDS.map((seed) => ({ seed, ...recordRace(seed) }));

  it('replays every race to identical state hashes', () => {
    let checked = 0;
    for (const r of races) {
      const result = createReplayController(r.recording).run(r.makeSim());
      expect(result.desync, `seed ${r.seed}`).toBeNull();
      expect(result.ticks).toBe(r.ticks);
      expect(result.finalHash).toBe(r.finalHash);
      checked += result.checked;
    }
    console.log(
      `[examined] ${races.length} races, ${races.reduce((n, r) => n + r.ticks, 0)} ticks, ${checked} hashes compared`,
    );
    expect(checked).toBeGreaterThan(races.length * 60);
  });

  it('replays from the run-length-encoded file too, and says how big it is', () => {
    const r = races[0];
    if (!r) throw new Error('no race');
    const text = JSON.stringify(encodeReplay(r.recording));
    const back = decodeReplay(JSON.parse(text));
    expect(createReplayController(back).run(r.makeSim()).desync).toBeNull();
    const raw = JSON.stringify(r.recording.inputs).length;
    console.log(
      `replay file: ${r.ticks} ticks, ${text.length} bytes of JSON (plain inputs alone ${raw} bytes)`,
    );
    expect(text.length).toBeLessThan(raw);
  });

  it('reports a tampered input as a desync at the first checkpoint after it', () => {
    const r = races[1];
    if (!r) throw new Error('no race');
    const tampered = structuredClone(r.recording);
    const at = 1000;
    const slot = tampered.inputs[at]?.[0];
    if (!slot) throw new Error(`no tick ${at}`);
    slot.throttle = 0; // one tick off the gas
    const result = createReplayController(tampered).run(r.makeSim());
    expect(result.desync?.tick).toBe(Math.ceil(at / HASH_EVERY_TICKS) * HASH_EVERY_TICKS);
  });

  it('records a mid-race tuning change and replays it to the same hashes', () => {
    const change = { tick: 900, id: 'riders.steerScale', value: 1.3 };
    const r = recordRace(7, change);
    expect(r.recording.params).toEqual([change]);
    const result = createReplayController(r.recording).run(r.makeSim());
    expect(result.desync).toBeNull();
    expect(result.finalHash).toBe(r.finalHash);
    // The change matters: the untuned race differs, and a replay that drops it desyncs.
    const plain = races.find((x) => x.seed === 7);
    expect(r.finalHash).not.toBe(plain?.finalHash);
    const dropped = createReplayController({ ...r.recording, params: [] }).run(r.makeSim());
    expect(dropped.desync?.tick).toBeGreaterThanOrEqual(change.tick);
  });
});
