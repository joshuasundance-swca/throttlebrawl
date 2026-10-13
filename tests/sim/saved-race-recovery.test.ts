import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app/headless';
import { reconstructSavedRace } from '../../src/app/race-recovery';
import { createStreamCache, regionChoices } from '../../src/app/regions';
import { roadsForHeader } from '../../src/app/resume';
import { loadBasePack, registryFromGlob } from '../../src/content';
import { RESUME_LOGIC_VERSION, SAVED_RACE_VERSION, type SavedRaceEnvelope } from '../../src/app/saved-race';
import { createInputRecorder } from '../../src/replay';
import { DEFAULT_SETTINGS } from '../../src/save';
import { quantizeInput } from '../../src/sim/api';
import { ISOLATED } from './batch';

const REGIONAL = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);

function fixture(terminal = false, regional = false) {
  const reg = regional ? REGIONAL : loadBasePack();
  const choice = regional ? regionChoices(reg).find((c) => c.packId !== 'base') : null;
  if (regional && !choice) throw new Error('No carried regional race available');
  const { sim } = createHeadlessRace(
    {
      seed: 77,
      difficulty: 'hard',
      speedMultiplier: 0.9,
      ...(choice ? { eventId: choice.eventId } : {}),
      tuning: { ...ISOLATED, 'riders.steerScale': 1.1 },
    },
    { registry: reg },
  );
  const recorder = createInputRecorder();
  recorder.beginRace(sim, 'code+content');
  const hashes: number[] = [];
  for (let tick = 0; tick < 120; tick++) {
    if (tick === 80) {
      sim.applyParam('riders.steerScale', 1.2);
      recorder.recordParam(tick, 'riders.steerScale', 1.2);
    }
    const input = quantizeInput({ steer: ((tick % 31) - 15) / 127, throttle: 0.8, brake: 0, flags: 0 });
    recorder.record(tick, [input]);
    sim.step([input]);
    hashes.push(sim.hash());
    if (tick % 60 === 0) recorder.checkpoint(tick, sim.hash());
  }
  if (terminal) recorder.finish(sim.tick - 1, sim.hash());
  const recording = recorder.file()!;
  const base = {
    format: 'saved-race' as const,
    version: SAVED_RACE_VERSION,
    logicVersion: RESUME_LOGIC_VERSION,
    recording,
    savedHash: sim.hash(),
    context: {
      kind: 'quick' as const,
      eventId: recording.header.eventId,
      route: null,
      settings: structuredClone(DEFAULT_SETTINGS),
      contextKey: 'original-plan',
    },
  };
  const attempt: SavedRaceEnvelope = terminal
    ? {
        ...base,
        phase: 'pending-result',
        result: { build: 'original-build', at: '2026-10-12T12:00:00.000Z' },
      }
    : { ...base, phase: 'riding' };
  return { sim, attempt, hashes, roads: roadsForHeader(reg, createStreamCache()) };
}

describe('saved attempt reconstruction', () => {
  it('folds every original step and preserves non-default config, tuning and continued hashes', () => {
    const f = fixture();
    const folded: number[] = [];
    const restored = reconstructSavedRace(f.attempt, f.roads, (_events, snap, tick) => {
      expect(snap.tick).toBe(tick + 1);
      folded.push(tick);
    });
    expect(folded).toEqual(Array.from({ length: 120 }, (_, i) => i));
    expect(restored.ticks).toBe(120);
    expect(restored.checked).toBe(f.attempt.recording.hashes.length);
    expect(restored.sim.hash()).toBe(f.sim.hash());
    expect(restored.sim.config.difficulty.presetId).toBe('hard');
    expect(restored.sim.config.speedMultiplier).toBe(0.9);
    for (let tick = 120; tick < 180; tick++) {
      const cmd = quantizeInput({ steer: 0, throttle: 1, brake: 0, flags: 0 });
      f.sim.step([cmd]);
      restored.sim.step([cmd]);
      expect(restored.sim.hash()).toBe(f.sim.hash());
    }
  });

  it('retains the terminal marker and stops exactly after its last input', () => {
    const f = fixture(true);
    let steps = 0;
    const restored = reconstructSavedRace(f.attempt, f.roads, () => {
      steps++;
    });
    expect(steps).toBe(f.attempt.recording.inputs.ticks);
    expect(restored.sim.tick).toBe(f.sim.tick);
    expect(restored.sim.snapshot()).toEqual(f.sim.snapshot());
    expect(restored.recording.end).toEqual(f.attempt.recording.end);
    expect(restored.checked).toBe(f.attempt.recording.hashes.length + 1);
  });

  it('rebuilds the actual regional road and route named in the saved header', () => {
    const f = fixture(false, true);
    expect(f.attempt.recording.header.eventId.startsWith('base:')).toBe(false);
    const restored = reconstructSavedRace(f.attempt, f.roads, () => {});
    expect(restored.sim.config.event).toEqual(f.sim.config.event);
    expect(restored.sim.snapshot()).toEqual(f.sim.snapshot());
    expect(restored.sim.hash()).toBe(f.sim.hash());
  });

  it.each(['checkpoint', 'tail'] as const)('refuses a tampered %s hash', (damage) => {
    const f = fixture();
    if (damage === 'checkpoint')
      f.attempt.recording.hashes[0]!.hash = (f.attempt.recording.hashes[0]!.hash ^ 1) >>> 0;
    else f.attempt.savedHash = (f.attempt.savedHash ^ 1) >>> 0;
    expect(() => reconstructSavedRace(f.attempt, f.roads, () => {})).toThrow(/hash|desync/i);
  });
});
