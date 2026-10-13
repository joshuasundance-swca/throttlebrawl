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
import * as careerFlow from '../../src/app/career-flow';
import { recoveryCareer } from '../../src/app/recovery-context';
import { noteCareerProgress, type CareerProgress } from '../../src/app/race-progress';
import { DEFAULT_PROFILE, PROFILE_VERSION } from '../../src/save';
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
  it('rebuilds the original later-season career logs and onboarding against uninterrupted control', () => {
    const reg = REGIONAL;
    const defs = careerFlow.careerDefs(reg);
    const def = defs[0]!;
    const node = def.nodes[0]!;
    const starting = { ...careerFlow.startCareer(defs, structuredClone(DEFAULT_PROFILE)), season: 2 };
    const setup = careerFlow.careerRaceSetup(reg, defs, starting, def, node);
    const { sim, playerId } = createHeadlessRace(
      {
        seed: 77,
        eventId: node.event,
        playerBike: starting.bikes.current!,
        freePlay: false,
        tuning: ISOLATED,
        ...(setup.length ? { length: setup.length.id } : {}),
        ...(setup.patch ? { eventPatch: setup.patch } : {}),
        ...(setup.fieldLevel ? { fieldLevel: setup.fieldLevel } : {}),
      },
      { registry: reg },
    );
    const recorder = createInputRecorder();
    recorder.beginRace(sim, 'code+content');
    const original = {
      kind: 'career' as const,
      eventId: node.event,
      careerKey: def.key,
      nodeId: node.id,
      regionId: def.regionId,
      length: setup.length?.id ?? null,
      profileGuard: JSON.stringify({ format: 'profile', version: PROFILE_VERSION, data: starting }),
    };
    const derived = recoveryCareer(careerFlow, reg, defs, original, recorder.file()!.header);
    expect(derived.starting.season).toBe(2);
    expect(derived.setup.patch).toEqual(setup.patch);
    const freshProgress = (): CareerProgress => ({
      log: careerFlow.createRaceLog({
        playerId,
        rules: derived.setup.plan.rules,
        objectives: derived.setup.plan.objectives,
        routeId: careerFlow.bare(sim.config.event.routeId ?? ''),
        roadIds: sim.config.road.edges.map((e) => e.id),
        secrets: derived.def.secrets,
      }),
      onboarding: careerFlow.createOnboarding(derived.starting.oncePerCareer),
      doneTick: null,
      headline: '',
      ask: derived.ask,
      askLog: null,
      askMet: false,
    });
    const control = freshProgress();
    for (let tick = 0; tick < 120; tick++) {
      const input = quantizeInput({ steer: 0, throttle: 0, brake: 0, flags: 0 });
      recorder.record(tick, [input]);
      sim.step([input]);
      noteCareerProgress(careerFlow, control, sim.events(), sim.snapshot(), playerId, tick);
      if (tick % 60 === 0) recorder.checkpoint(tick, sim.hash());
    }
    const attempt: SavedRaceEnvelope = {
      format: 'saved-race',
      version: SAVED_RACE_VERSION,
      logicVersion: RESUME_LOGIC_VERSION,
      phase: 'riding',
      recording: recorder.file()!,
      savedHash: sim.hash(),
      context: { ...original, contextKey: derived.key },
    };
    const historical = freshProgress();
    const restored = reconstructSavedRace(
      attempt,
      roadsForHeader(reg, createStreamCache()),
      (events, snap, tick) => {
        noteCareerProgress(careerFlow, historical, events, snap, playerId, tick);
      },
    );
    expect(historical.log?.status()).toEqual(control.log?.status());
    expect(historical.log?.tally()).toEqual(control.log?.tally());
    expect(historical.onboarding.shown()).toEqual(control.onboarding.shown());
    expect(historical.onboarding.shown()).toContain('ride');
    expect(historical.doneTick).toBe(control.doneTick);
    expect(historical.askLog?.tally()).toEqual(control.askLog?.tally());
    expect(historical.askMet).toBe(control.askMet);
    expect(restored.sim.hash()).toBe(sim.hash());
  });
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
