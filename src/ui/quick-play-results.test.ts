import { describe, expect, it } from 'vitest';
import { resultText } from './format';

describe('Quick Play objective results', () => {
  const base = { place: 2, of: 4, prizeCash: 0, eventName: 'Hunt', objective: 'TAKEDOWNS 0/2' };
  it('distinguishes a missed objective from a successful one and keeps its explanation', () => {
    expect(resultText({ ...base, objectiveState: 'lost' }).headline).toBe('Objective missed');
    expect(resultText({ ...base, objectiveState: 'won', objective: 'TAKEDOWNS 2/2' }).headline).toBe(
      'Objective met',
    );
    expect(resultText({ ...base, objectiveState: 'lost' }).detail).toContain(base.objective);
    expect(resultText(base).headline).toBe('2nd of 4');
    expect(resultText({ ...base, objectiveState: 'lost', busted: true }).headline).toBe('Busted');
  });
});
