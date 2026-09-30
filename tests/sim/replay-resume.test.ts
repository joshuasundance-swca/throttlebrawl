import { describe, expect, it } from 'vitest';
import { createHeadlessRace, resumeFromRecording, roadsForHeader, streamForEvent } from '../../src/app';
import { loadBasePack } from '../../src/content';
import { blankActions, botInput, createBot } from '../../src/dev';
import {
  createAutosave,
  createInputRecorder,
  createRecordingStore,
  HASH_EVERY_TICKS,
  makeReplayKey,
  SAVE_EVERY_TICKS,
  type RecordingStorage,
} from '../../src/replay';
import type { SimInput } from '../../src/sim/api';

// replay-2 acceptance, headless (docs/milestones/M2.md): a race saved mid-race resumes after a
// "reload" (a new store over the same storage), is re-run to the saved tick by app/'s
// resumeFromRecording, rides on, and matches an uninterrupted control run's state hash at a later
// tick. The browser version of this test waits for app-4, which wires the store, the resume card
// and the Start-tap sequence into the running app; until then this file is the proof, over the
// real base pack, road, route and bot.
//
// The bot keeps its own memory (whom it fights, whether it took the shortcut), so a freshly built
// bot would ride on differently from the control's. "Rides on" therefore feeds the control run's
// own recorded inputs after the resume tick, as a player repeating the same moves would.

const SEED = 11;
const PAUSE_TICK = 1234; // not a multiple of the 5 s interval: the hide's own flush is what saves
const LATER_TICK = 2400;
const SIX_MINUTES = 6 * 60 * 60;
const REPLAY_KEY = makeReplayKey('test-code', 'test-content');

function memoryStorage(): RecordingStorage & { copy(): RecordingStorage } {
  const map = new Map<string, string>();
  const make = (m: Map<string, string>): RecordingStorage => ({
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  });
  return { ...make(map), copy: () => make(new Map(map)) };
}

interface Control {
  inputs: SimInput[];
  hashes: Map<number, number>;
  /** The storage as it stood right after the hide at PAUSE_TICK, and right before it. */
  afterHide: RecordingStorage;
  beforeHide: RecordingStorage;
  /** The whole race's recording, for the fast-forward timing. */
  full: ReturnType<ReturnType<typeof createInputRecorder>['current']>;
  ticks: number;
}

/** The uninterrupted control race: the bot rides, the recording autosaves, a hide at PAUSE_TICK. */
function controlRace(): Control {
  const { sim, route, playerId } = createHeadlessRace({ seed: SEED });
  const bot = createBot();
  const recorder = createInputRecorder();
  const storage = memoryStorage();
  const auto = createAutosave(createRecordingStore({ keyPrefix: 'test', storage }));
  recorder.beginRace(sim, REPLAY_KEY);
  const inputs: SimInput[] = [];
  const hashes = new Map<number, number>();
  let afterHide: RecordingStorage | null = null;
  let beforeHide: RecordingStorage | null = null;
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < SIX_MINUTES) {
    const tick = sim.tick;
    if (tick === PAUSE_TICK) {
      beforeHide = storage.copy();
      auto.flush(recorder.current()); // app/ reports the hide
      afterHide = storage.copy();
    }
    const a = blankActions();
    bot.drive(snap, playerId, route, a);
    const input = botInput(a);
    inputs.push(input);
    recorder.record(tick, [input]);
    sim.step([input]);
    if (tick % HASH_EVERY_TICKS === 0) {
      recorder.checkpoint(tick, sim.hash());
      hashes.set(tick, sim.hash());
    }
    auto.afterTick(tick + 1, recorder.current());
    snap = sim.snapshot();
  }
  recorder.finish(sim.tick - 1, sim.hash());
  if (!afterHide || !beforeHide) throw new Error(`the race ended before tick ${PAUSE_TICK}`);
  return { inputs, hashes, afterHide, beforeHide, full: recorder.current(), ticks: sim.tick };
}

const reg = loadBasePack({ includeDrafts: false });
const roadsFor = roadsForHeader(reg, streamForEvent(reg));

/** Boot after a reload: offer, resume to the saved tick, ride on with the control's inputs. */
function resumeAndRideOn(storage: RecordingStorage, control: Control) {
  const store = createRecordingStore({ keyPrefix: 'test', storage });
  const offer = store.offer(REPLAY_KEY);
  if (offer.kind !== 'resume') throw new Error(`expected a resume offer, got ${offer.kind}`);
  const resumed = resumeFromRecording(offer.recording, roadsFor);
  const recorder = createInputRecorder();
  recorder.resume(offer.recording);
  const { sim } = resumed;
  const mismatches: number[] = [];
  let compared = 0;
  while (sim.tick <= LATER_TICK) {
    const tick = sim.tick;
    const input = control.inputs[tick];
    if (!input) throw new Error(`no control input at ${tick}`);
    recorder.record(tick, [input]);
    sim.step([input]);
    if (tick % HASH_EVERY_TICKS === 0) {
      recorder.checkpoint(tick, sim.hash());
      compared++;
      if (control.hashes.get(tick) !== sim.hash()) mismatches.push(tick);
    }
  }
  return { offer, resumed, sim, recorder, mismatches, compared };
}

describe('replay-2: resume after a reload, headless', () => {
  const control = controlRace();

  it('a hide saves the race; after a reload it resumes, rides on and matches the control run', () => {
    const run = resumeAndRideOn(control.afterHide, control);
    expect(run.offer.kind === 'resume' && run.offer.tick).toBe(PAUSE_TICK);
    expect(run.resumed.ticks).toBe(PAUSE_TICK);
    expect(run.resumed.desync).toBeNull();
    expect(run.resumed.checked).toBeGreaterThanOrEqual(Math.floor(PAUSE_TICK / HASH_EVERY_TICKS));
    console.log(
      `[examined] seed ${SEED}: resumed at tick ${run.resumed.ticks} (${run.resumed.checked} saved hashes checked), ` +
        `rode on to ${LATER_TICK}: ${run.compared} hashes compared with the control run, ${run.mismatches.length} differ`,
    );
    expect(run.compared).toBeGreaterThan(10);
    expect(run.mismatches).toEqual([]);
    // The state after stepping LATER_TICK, against the control's at the same tick.
    expect(control.hashes.has(LATER_TICK)).toBe(true);
    expect(run.sim.hash()).toBe(control.hashes.get(LATER_TICK));
    // The carried-on recording is the control's, tick for tick.
    expect(run.recorder.current()?.inputs.map((t) => t[0])).toEqual(control.inputs.slice(0, LATER_TICK + 1));
  }, 120_000);

  it(`a tab killed without a hide resumes from the last 5 s save (loses under ${SAVE_EVERY_TICKS} ticks)`, () => {
    const run = resumeAndRideOn(control.beforeHide, control);
    const at = run.offer.kind === 'resume' ? run.offer.tick : -1;
    expect(at).toBe(Math.floor(PAUSE_TICK / SAVE_EVERY_TICKS) * SAVE_EVERY_TICKS);
    expect(PAUSE_TICK - at).toBeLessThan(SAVE_EVERY_TICKS);
    expect(run.resumed.desync).toBeNull();
    expect(run.mismatches).toEqual([]);
  }, 120_000);

  it('a build with another replay key refuses the saved race', () => {
    const offer = createRecordingStore({ keyPrefix: 'test', storage: control.afterHide }).offer(
      makeReplayKey('other-code', 'test-content'),
    );
    expect(offer.kind).toBe('stale');
  });

  it('prints the fast-forward time, and projects it to a 6-minute race', () => {
    const rec = control.full;
    if (!rec) throw new Error('no recording');
    const { end: _end, ...unfinished } = rec;
    const t0 = performance.now();
    const result = resumeFromRecording(unfinished, roadsFor);
    const ms = performance.now() - t0;
    expect(result.desync).toBeNull();
    const perTick = ms / result.ticks;
    console.log(
      `[examined] fast-forward (Node, the dev machine): ${result.ticks} ticks in ${ms.toFixed(0)} ms ` +
        `(${(perTick * 1000).toFixed(1)} µs per tick); a 6-minute race (${SIX_MINUTES} ticks) projects to ` +
        `${((perTick * SIX_MINUTES) / 1000).toFixed(2)} s. The bot's race ends at ${control.ticks} ticks, so ` +
        'the 6-minute figure is a projection, not a measured 6-minute race.',
    );
    expect(result.ticks).toBe(control.ticks);
  }, 120_000);
});
