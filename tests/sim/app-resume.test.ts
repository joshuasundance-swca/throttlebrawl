// Resume after a reload (docs/architecture.md, "Resume after a reload"; docs/milestones/M2.md,
// app-3 item 4, the acceptance test): the recording is the saved state. Record 600 ticks of
// scripted inputs (with a mid-race tuning change), save the recording the way the game does
// (run-length-encoded JSON), build a fresh headless sim from the header alone and fast-forward it
// to tick 600 with the recorded inputs: the same hash at every 60th tick. Then step the original
// and the resumed sim 600 more ticks with the same inputs: identical hashes throughout.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, resumeFromRecording, roadsForHeader, streamForEvent } from '../../src/app';
import { loadBasePack } from '../../src/content';
import { createInputRecorder, decodeReplay, encodeReplay, makeReplayKey } from '../../src/replay';
import { InputFlag, quantizeInput, type Sim, type SimInput } from '../../src/sim/api';

/** A scripted rider: full-ish throttle, a slow weave, an attack now and then, a kick rarely. */
function scripted(tick: number): SimInput {
  const phase = (tick % 240) / 240;
  const steer = phase < 0.5 ? phase * 2 - 0.5 : 1.5 - phase * 2;
  const flags = (tick % 90 === 45 ? InputFlag.attack : 0) | (tick % 400 === 200 ? InputFlag.kick : 0);
  return quantizeInput({ steer: steer * 0.6, throttle: tick % 300 < 280 ? 1 : 0.4, brake: 0, flags });
}

const SAVED_TICK = 600;
const MORE_TICKS = 600;

describe('app: resume a race from its saved recording', () => {
  it('fast-forwards a fresh sim from the header to the saved tick and stays in step after', () => {
    // The original race, on a non-default setup so the header (not the current settings) decides.
    const original = createHeadlessRace({
      seed: 4242,
      difficulty: 'hard',
      speedMultiplier: 0.9,
      slowMo: false,
    });
    const a: Sim = original.sim;
    const recorder = createInputRecorder();
    recorder.beginRace(a, makeReplayKey('code', 'content'));
    const checkpoints: { tick: number; hash: number }[] = [];
    for (let tick = 0; tick < SAVED_TICK; tick++) {
      if (tick === 300) {
        // A tuning change mid-race, as the panel makes one: applied between steps and recorded.
        a.applyParam('riders.steerScale', 1.2);
        recorder.recordParam(tick, 'riders.steerScale', 1.2);
      }
      const input = scripted(tick);
      recorder.record(tick, [input]);
      a.step([input]);
      if (tick % 60 === 0) {
        recorder.checkpoint(tick, a.hash());
        checkpoints.push({ tick, hash: a.hash() });
      }
    }
    expect(a.tick).toBe(SAVED_TICK);

    // Saved the way the game saves it, then read back after the "reload".
    const rec = recorder.current();
    if (!rec) throw new Error('no recording');
    const saved = JSON.stringify(encodeReplay(rec));
    const loaded = decodeReplay(JSON.parse(saved));

    // A fresh headless sim from the header alone, fast-forwarded with the recorded inputs.
    const reg = loadBasePack();
    const t0 = performance.now();
    const resumed = resumeFromRecording(loaded, roadsForHeader(reg, streamForEvent(reg)));
    const ms = performance.now() - t0;
    const b = resumed.sim;
    console.log(
      `[examined] resume: ${resumed.ticks} ticks fast-forwarded in ${ms.toFixed(0)} ms, ` +
        `${resumed.checked} checkpoint hashes compared, desync ${resumed.desync ? 'at ' + resumed.desync.tick : 'none'}`,
    );
    expect(resumed.desync).toBeNull();
    expect(resumed.ticks).toBe(SAVED_TICK);
    expect(b.tick).toBe(SAVED_TICK);
    // Every 60th tick was compared: 0, 60, ..., 540.
    expect(resumed.checked).toBe(checkpoints.length);
    expect(checkpoints.length).toBe(10);
    expect(b.hash()).toBe(a.hash());
    // The header's settings, not today's, built it.
    expect(b.config.difficulty.presetId).toBe('hard');
    expect(b.config.speedMultiplier).toBe(0.9);
    expect(b.config.slowMo).toBe(false);
    expect(b.config.tuning).toEqual(a.config.tuning);

    // Both ride on with the same inputs.
    let compared = 0;
    for (let tick = SAVED_TICK; tick < SAVED_TICK + MORE_TICKS; tick++) {
      const input = scripted(tick);
      a.step([input]);
      b.step([input]);
      expect(b.hash(), `tick ${tick}`).toBe(a.hash());
      compared++;
    }
    expect(compared).toBe(MORE_TICKS);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it('notices a recording that does not match its hashes (a desync is reported, not hidden)', () => {
    const { sim } = createHeadlessRace({ seed: 99 });
    const recorder = createInputRecorder();
    recorder.beginRace(sim, 'k');
    for (let tick = 0; tick < 120; tick++) {
      const input = scripted(tick);
      recorder.record(tick, [input]);
      sim.step([input]);
      if (tick % 60 === 0) recorder.checkpoint(tick, sim.hash() ^ (tick === 60 ? 1 : 0));
    }
    const rec = recorder.current();
    if (!rec) throw new Error('no recording');
    const reg = loadBasePack();
    const resumed = resumeFromRecording(rec, roadsForHeader(reg, streamForEvent(reg)));
    expect(resumed.desync?.tick).toBe(60);
  });
});
