import { describe, expect, it } from 'vitest';
import { BARK_FACTS, BARK_TRIGGERS, barkFact } from './vocab';

describe('content vocab: bark triggers and facts', () => {
  it('holds the 21 v1 triggers, the M2 ones and the six cop habits (run W-T), with no duplicates', () => {
    expect(new Set(BARK_TRIGGERS).size).toBe(BARK_TRIGGERS.length);
    expect(BARK_TRIGGERS).toHaveLength(27);
    for (const t of [
      'cop-relentless',
      'cop-radar',
      'cop-citation',
      'cop-bill',
      'cop-budget-out',
      'cop-jurisdiction',
    ]) {
      expect(BARK_TRIGGERS).toContain(t);
    }
    for (const t of ['takedown-into-traffic', 'knocked-down-by-target', 'crash-self', 'near-miss']) {
      expect(BARK_TRIGGERS).toContain(t);
    }
  });

  it('knows the v1 facts, story flags by name, and nothing else', () => {
    expect(Object.keys(BARK_FACTS)).toHaveLength(20);
    expect(barkFact('grudge.speakerTowardTarget')).toMatchObject({ kind: 'number', memory: true });
    expect(barkFact('target.bikeClass')?.values).toContain('scooter');
    expect(barkFact('flags.metTheMayor')).toEqual({ kind: 'boolean', memory: true });
    expect(barkFact('flags.')).toBeUndefined();
    expect(barkFact('target.mood')).toBeUndefined();
    expect(barkFact('toString')).toBeUndefined();
  });
});
