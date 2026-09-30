/// <reference types="vite/client" />
// tuning-1 acceptance (unit tier, headless): a mid-race change that affects the sim is recorded at
// its tick, and replaying the recording reproduces the state hashes. It drives the same protocol
// as app/'s step(): the panel sets a value on the registry, the registry calls recordTuningChange,
// the change is applied with sim.applyParam between steps and recorded as {tick, id, value}; the
// ReplayController re-applies it before stepping that tick. A control replay that drops the change
// must diverge, which proves the change reached the sim and the check can fail.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import {
  createInputRecorder,
  createReplayController,
  REPLAY_FORMAT_VERSION,
  type Recording,
} from '../../src/replay';
import { quantizeInput, SIM_TUNING, type SimInput } from '../../src/sim/api';
import { createTuningRegistry } from '../../src/tuning';

const TICKS = 720;
const CHANGE_AT = 150;

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

/** The sim-affecting parameter to move: steering if declared (a decided panel group). */
function pickParam() {
  const sim = SIM_TUNING.filter((d) => d.affectsSim);
  const d = sim.find((x) => x.group === 'steering') ?? sim[0];
  if (!d) throw new Error('no sim-affecting tuning declaration exists');
  const value = d.max !== d.default ? d.max : d.min;
  return { id: d.id, value };
}

function liveRace(seed: number): Recording {
  const pending: { id: string; value: number }[] = [];
  const registry = createTuningRegistry(SIM_TUNING, (id, value) => pending.push({ id, value }));
  const { sim, playerId, route } = createHeadlessRace({ seed, tuning: registry.simValues() });
  const recorder = createInputRecorder();
  recorder.begin({
    formatVersion: REPLAY_FORMAT_VERSION,
    replayKey: 'test',
    seed,
    eventId: sim.config.event.contentId,
    tuning: { ...sim.config.tuning },
  });
  const bot = createStubBot();
  const { id, value } = pickParam();
  while (sim.tick < TICKS) {
    // The panel moves a slider mid-race, between two steps.
    if (sim.tick === CHANGE_AT) registry.set(id, value);
    // app/'s step(): flush queued changes, apply them, record them at this tick.
    for (const change of pending.splice(0)) {
      sim.applyParam(change.id, change.value);
      recorder.recordParam(sim.tick, change.id, change.value);
    }
    const tick = sim.tick;
    const me = sim.snapshot().entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, route, a);
    const cmd = quantizeInput({ ...a, flags: 0 });
    recorder.record(tick, [cmd]);
    sim.step([cmd]);
    if (tick % 60 === 0) recorder.checkpoint(tick, sim.hash());
  }
  const rec = recorder.current();
  if (!rec) throw new Error('nothing recorded');
  return rec;
}

function replay(rec: Recording, withParams: boolean): { tick: number; hash: number }[] {
  const { sim } = createHeadlessRace({ seed: rec.header.seed, tuning: rec.header.tuning });
  const ctrl = createReplayController(rec);
  const hashes: { tick: number; hash: number }[] = [];
  while (sim.tick < rec.inputs.length) {
    const tick = sim.tick;
    if (withParams) for (const p of ctrl.paramsAt(tick)) sim.applyParam(p.id, p.value);
    const inputs: readonly SimInput[] | null = ctrl.inputsAt(tick);
    if (!inputs) throw new Error(`no inputs at ${tick}`);
    sim.step(inputs);
    if (tick % 60 === 0) hashes.push({ tick, hash: sim.hash() });
  }
  return hashes;
}

describe('tuning: a mid-race sim change is recorded and replays to the same hashes', () => {
  const rec = liveRace(11);
  const { id, value } = pickParam();

  it('records exactly the one change, at the tick it was applied', () => {
    expect(rec.params).toEqual([{ tick: CHANGE_AT, id, value }]);
    expect(rec.inputs).toHaveLength(TICKS);
  });

  it('the replay, re-applying the change before that tick, reproduces every checkpoint hash', () => {
    const replayed = replay(rec, true);
    console.log(
      `tuning replay: ${id} -> ${value} at tick ${CHANGE_AT}; ${replayed.length} checkpoints compared over ${TICKS} ticks`,
    );
    expect(replayed.length).toBe(rec.hashes.length);
    expect(replayed.length).toBeGreaterThan(10);
    expect(replayed).toEqual(rec.hashes);
  });

  it('control: a replay that drops the change diverges after it (so the check can fail)', () => {
    const control = replay(rec, false);
    const before = control.filter((h) => h.tick < CHANGE_AT);
    const after = control.filter((h) => h.tick > CHANGE_AT);
    expect(before).toEqual(rec.hashes.filter((h) => h.tick < CHANGE_AT));
    const diverged = after.filter((h, i) => h.hash !== rec.hashes.filter((r) => r.tick > CHANGE_AT)[i]?.hash);
    console.log(`tuning replay control: ${diverged.length} of ${after.length} later checkpoints diverged`);
    expect(diverged.length).toBeGreaterThan(0);
  });
});
