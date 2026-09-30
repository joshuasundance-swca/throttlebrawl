import { describe, expect, it } from 'vitest';
import { loadBasePack } from '../content';
import { aiController, buildSimConfig, streamForEvent } from './config';

describe('app/config: rival personalities reach the sim (the ai-1 contract wire)', () => {
  it('passes a rider’s own personality numbers, target list and side through with its style', () => {
    const c = aiController({
      style: 'heavy-hitter',
      aggression: 0.9,
      dirtiness: 0.25,
      weave: 0,
      targetPreference: ['player', 'nearest'],
      preferredSide: 'left',
    });
    expect(c).toEqual({
      kind: 'ai',
      style: 'heavy-hitter',
      personality: {
        aggression: 0.9,
        dirtiness: 0.25,
        weave: 0,
        targetPreference: ['player', 'nearest'],
        preferredSide: 'left',
      },
    });
  });

  it('drops fields of the wrong type and defaults a missing personality to the racer style', () => {
    const c = aiController({
      style: 'racer',
      aggression: 'lots',
      courage: Number.NaN,
      targetPreference: [1, 2],
      preferredSide: 'up',
    });
    expect(c).toEqual({ kind: 'ai', style: 'racer', personality: {} });
    expect(aiController(undefined)).toEqual({ kind: 'ai', style: 'racer', personality: {} });
  });

  it('builds every rival of the base event with an ai controller carrying its style', () => {
    const reg = loadBasePack();
    const config = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
    const rivals = config.riders.filter((r) => r.controller.kind === 'ai');
    expect(rivals.length).toBeGreaterThan(0);
    for (const r of rivals) {
      if (r.controller.kind !== 'ai') throw new Error('unreachable');
      expect(typeof r.controller.style).toBe('string');
      expect(r.controller.personality).toBeTypeOf('object');
    }
  });
});
