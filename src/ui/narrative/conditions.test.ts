import { describe, expect, it } from 'vitest';
import { BARK_FACTS } from '../../content';
import {
  conditionHolds,
  conditionsFrom,
  isKnownFact,
  isMemoryFact,
  matchConditions,
  novelty,
  specificity,
  type BarkCondition,
} from './conditions';

const c = (fact: string, op: BarkCondition['op'], value: unknown): BarkCondition => ({ fact, op, value });

describe('bark conditions', () => {
  it('know the v1 fact list and the flags family, and nothing else', () => {
    expect(Object.keys(BARK_FACTS).length).toBe(20);
    for (const f of Object.keys(BARK_FACTS)) expect(isKnownFact(f), f).toBe(true);
    expect(isKnownFact('flags.met-the-mayor')).toBe(true);
    expect(isKnownFact('flags.')).toBe(false);
    expect(isKnownFact('target.shoeSize')).toBe(false);
    expect(isMemoryFact('grudge.speakerTowardTarget')).toBe(true);
    expect(isMemoryFact('history.takedowns.targetOnSpeaker')).toBe(true);
    expect(isMemoryFact('flags.met-the-mayor')).toBe(true);
    expect(isMemoryFact('race.progress')).toBe(false);
  });

  it('read `when`: absent is none, malformed or unknown drops the line', () => {
    expect(conditionsFrom(undefined)).toEqual([]);
    expect(conditionsFrom([{ fact: 'race.progress', op: 'gte', value: 0.5 }])).toEqual([
      c('race.progress', 'gte', 0.5),
    ]);
    expect(conditionsFrom({ fact: 'race.progress' })).toBeNull();
    expect(conditionsFrom([{ fact: 'race.progress', op: 'approx', value: 1 }])).toBeNull();
    expect(conditionsFrom([{ fact: 'target.shoeSize', op: 'eq', value: 9 }])).toBeNull();
    expect(conditionsFrom([{ fact: 'race.progress', op: 'gte' }])).toBeNull();
    expect(conditionsFrom([{ fact: 'target.bikeClass', op: 'in', value: 'scooter' }])).toBeNull();
    expect(conditionsFrom(['race.progress'])).toBeNull();
  });

  it('evaluate every op', () => {
    expect(conditionHolds(c('x', 'eq', 3), 3)).toBe(true);
    expect(conditionHolds(c('x', 'eq', 3), 4)).toBe(false);
    expect(conditionHolds(c('x', 'neq', 3), 4)).toBe(true);
    expect(conditionHolds(c('x', 'neq', 3), 3)).toBe(false);
    expect(conditionHolds(c('x', 'gt', 3), 4)).toBe(true);
    expect(conditionHolds(c('x', 'gt', 3), 3)).toBe(false);
    expect(conditionHolds(c('x', 'gte', 3), 3)).toBe(true);
    expect(conditionHolds(c('x', 'gte', 3), 2)).toBe(false);
    expect(conditionHolds(c('x', 'lt', 3), 2)).toBe(true);
    expect(conditionHolds(c('x', 'lt', 3), 3)).toBe(false);
    expect(conditionHolds(c('x', 'lte', 3), 3)).toBe(true);
    expect(conditionHolds(c('x', 'lte', 3), 4)).toBe(false);
    expect(conditionHolds(c('x', 'in', ['scooter', 'moped']), 'moped')).toBe(true);
    expect(conditionHolds(c('x', 'in', ['scooter', 'moped']), 'rat')).toBe(false);
    expect(conditionHolds(c('x', 'has', 'smoker'), ['smoker', 'local'])).toBe(true);
    expect(conditionHolds(c('x', 'has', 'smoker'), ['local'])).toBe(false);
    expect(conditionHolds(c('x', 'has', 'smoker'), 'smoker')).toBe(false);
    // Numbers never compare with strings.
    expect(conditionHolds(c('x', 'gte', 3), '4')).toBe(false);
  });

  it('never match an unknown value, whatever the op', () => {
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'has'] as const) {
      expect(conditionHolds(c('x', op, op === 'in' ? [1] : 1), undefined), op).toBe(false);
    }
  });

  it('match a bare id against a qualified fact value in the line’s own pack only', () => {
    expect(conditionHolds(c('speaker.weapon', 'eq', 'lead-pipe'), 'base:lead-pipe', 'base')).toBe(true);
    expect(conditionHolds(c('speaker.weapon', 'eq', 'lead-pipe'), 'mod:lead-pipe', 'base')).toBe(false);
    expect(conditionHolds(c('speaker.weapon', 'eq', 'base:lead-pipe'), 'base:lead-pipe', 'mod')).toBe(true);
    expect(conditionHolds(c('speaker.weapon', 'in', ['chain', 'lead-pipe']), 'base:lead-pipe', 'base')).toBe(
      true,
    );
  });

  it('count matched and memory conditions, and fail on the first miss', () => {
    const table: Record<string, number> = { 'grudge.speakerTowardTarget': 5, 'race.progress': 0.6 };
    const resolve = (f: string) => table[f];
    expect(
      matchConditions([c('grudge.speakerTowardTarget', 'gte', 4), c('race.progress', 'gt', 0.5)], resolve),
    ).toEqual({ matched: 2, memory: 1 });
    expect(matchConditions([], undefined)).toEqual({ matched: 0, memory: 0 });
    expect(matchConditions([c('race.progress', 'gt', 0.9)], resolve)).toBeNull();
    expect(matchConditions([c('race.progress', 'gt', 0.1)], undefined)).toBeNull();
  });

  it('score specificity as the selection algorithm says', () => {
    expect(specificity({ matched: 0, memory: 0 }, false)).toBe(1);
    expect(specificity({ matched: 1, memory: 0 }, false)).toBe(1.5);
    // A memory condition counts in both terms: 1 + 0.5 + 1.0.
    expect(specificity({ matched: 1, memory: 1 }, false)).toBe(2.5);
    expect(specificity({ matched: 2, memory: 1 }, true)).toBeCloseTo(4.5, 10);
    expect(specificity({ matched: 0, memory: 0 }, true)).toBe(1.5);
  });

  it('fade heard lines by half each time, never below 0.05', () => {
    expect(novelty(0)).toBe(1);
    expect(novelty(1)).toBe(0.5);
    expect(novelty(3)).toBe(0.125);
    expect(novelty(10)).toBe(0.05);
  });
});
