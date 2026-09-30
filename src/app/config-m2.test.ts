// buildSimConfig for M2 (docs/milestones/M2.md, app-3 item 3): the one place that turns settings
// and content into a SimConfig resolves the difficulty preset from its tuning declarations, the
// per-slot assists, the speed multiplier, the slow-motion toggle and the race length. Every
// setting is tested at a non-default value, and the resolved values reach the replay header.
import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, loadBasePack } from '../content';
import { replayHeader } from '../replay';
import { createSim, DIFFICULTY_TUNING, neutralInput, type SimConfig } from '../sim/api';
import { buildSimConfig, raceStartValues, streamForEvent, type RaceSetup } from './config';

const reg = loadBasePack();
const stream = streamForEvent(reg);
const build = (setup: Partial<RaceSetup> = {}) => buildSimConfig(reg, stream, { seed: 7, ...setup });

describe('buildSimConfig: the M2 settings', () => {
  it('defaults to Normal, no assists, full speed and slow motion on', () => {
    const c = build();
    expect(c.difficulty).toEqual({ presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 });
    expect(c.slots).toEqual([{ assists: { steer: 'off', autoThrottle: false } }]);
    expect(c.speedMultiplier).toBe(1);
    expect(c.slowMo).toBe(true);
    expect(c.event.lengthId).toBe('standard');
    expect(c.event.routeId).toBe('base:m1-skeleton-sprint');
  });

  it('resolves Easy and Hard from the starting numbers', () => {
    expect(build({ difficulty: 'easy' }).difficulty).toEqual({
      presetId: 'easy',
      riderAggression: 0.75,
      copFrequency: 0.5,
      rubberBand: 1.5,
    });
    expect(build({ difficulty: 'hard' }).difficulty).toEqual({
      presetId: 'hard',
      riderAggression: 1.25,
      copFrequency: 1.5,
      rubberBand: 0.5,
    });
  });

  it('reads a preset from its tuning values, and keeps them out of the sim tuning', () => {
    const c = build({
      difficulty: 'hard',
      tuning: { 'difficulty.hard.copFrequency': 2, 'riders.steerScale': 1.1 },
    });
    expect(c.difficulty.copFrequency).toBe(2);
    expect(c.difficulty.riderAggression).toBe(1.25);
    expect(Object.keys(c.tuning).filter((id) => id.startsWith('difficulty.'))).toEqual([]);
    expect(c.tuning['riders.steerScale']).toBe(1.1);
  });

  it('declares nine difficulty values (three presets by three scales), none sim-affecting', () => {
    expect(DIFFICULTY_TUNING.map((d) => d.id).sort()).toEqual(
      ['easy', 'hard', 'normal']
        .flatMap((p) => ['copFrequency', 'riderAggression', 'rubberBand'].map((s) => `difficulty.${p}.${s}`))
        .sort(),
    );
    expect(DIFFICULTY_TUNING.every((d) => !d.affectsSim)).toBe(true);
  });

  it('picks the difficulty values out of a panel for the next race start', () => {
    const get = (id: string) => (id === 'difficulty.easy.rubberBand' ? 1.7 : 0.9);
    const values = raceStartValues(DIFFICULTY_TUNING, get);
    expect(Object.keys(values)).toHaveLength(9);
    expect(values['difficulty.easy.rubberBand']).toBe(1.7);
    expect(build({ difficulty: 'easy', tuning: values }).difficulty.rubberBand).toBe(1.7);
  });

  it('writes the assists per human slot, the speed multiplier and the toggle', () => {
    const c = build({
      assists: [{ steer: 'strong', autoThrottle: true }],
      speedMultiplier: 0.8,
      slowMo: false,
    });
    expect(c.slots).toEqual([{ assists: { steer: 'strong', autoThrottle: true } }]);
    expect(c.speedMultiplier).toBe(0.8);
    expect(c.slowMo).toBe(false);
    for (const bad of [0, -1, Number.NaN, 3]) expect(build({ speedMultiplier: bad }).speedMultiplier).toBe(1);
  });

  it('picks the chosen race length and its route', () => {
    const files = basePackFiles().map((f) =>
      f.path === 'events/m1-skeleton-sprint.json'
        ? {
            ...f,
            json: {
              ...(f.json as Record<string, unknown>),
              lengths: [
                { id: 'standard', route: 'm1-skeleton-sprint', laps: 1 },
                { id: 'long', route: 'm1-skeleton-sprint', laps: 2 },
              ],
            },
          }
        : f,
    );
    const r = buildRegistry(files);
    const s = streamForEvent(r);
    expect(buildSimConfig(r, s, { seed: 1, length: 'long' }).event.lengthId).toBe('long');
    expect(buildSimConfig(r, s, { seed: 1 }).event.lengthId).toBe('standard');
    // A length the event does not offer (before road-3) falls back to the first, and says so.
    expect(buildSimConfig(r, s, { seed: 1, length: 'short' }).event.lengthId).toBe('standard');
  });

  it('puts every resolved setting in the replay header', () => {
    const c = build({
      difficulty: 'hard',
      assists: [{ steer: 'light', autoThrottle: false }],
      speedMultiplier: 0.9,
    });
    const h = replayHeader(c, 'code+content').config;
    expect(h?.difficulty).toEqual(c.difficulty);
    expect(h?.slots).toEqual(c.slots);
    expect(h?.speedMultiplier).toBe(0.9);
    expect(h?.slowMo).toBe(true);
    expect(h?.event.lengthId).toBe('standard');
  });

  it('changes the race when the difficulty changes (a non-default test)', () => {
    const run = (config: SimConfig) => {
      const sim = createSim(config);
      for (let t = 0; t < 900; t++) sim.step([neutralInput()]);
      return sim.hash();
    };
    expect(run(build({ difficulty: 'hard' }))).not.toBe(run(build({ difficulty: 'easy' })));
    expect(run(build({ difficulty: 'normal' }))).toBe(run(build()));
  });
});
