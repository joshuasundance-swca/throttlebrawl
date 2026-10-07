import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/api';
import { createRadioedAheadCounter } from '../tests/sim/radioed-ahead';

const siren = (actor: number, on: boolean, cause = 'heat'): SimEvent => ({
  tick: 0,
  type: 'siren',
  actor,
  data: { on, cause },
});

describe('the radioed-ahead search reads an append-only race journal', () => {
  it('counts only a roadblock transition for a cop still chasing, across batches', () => {
    const count = createRadioedAheadCounter();
    const events = [siren(1, true, 'roadblock'), siren(2, true)];
    expect(count(events)).toBe(0);
    events.push(siren(2, true, 'roadblock'));
    expect(count(events)).toBe(1);
    expect(count(events)).toBe(1);
    events.push(siren(2, false), siren(2, true, 'roadblock'));
    expect(count(events)).toBe(1);
    events.push(siren(1, true), siren(1, true, 'roadblock'));
    expect(count(events)).toBe(2);
  });

  it('examines each journal entry once, including ticks with no new events', () => {
    let reads = 0;
    const event = siren(1, true);
    const observed = new Proxy(event, {
      get(target, key, receiver) {
        if (key === 'type') reads++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const count = createRadioedAheadCounter();
    const events = [observed];
    for (let tick = 0; tick < 100; tick++) expect(count(events)).toBe(0);
    expect(reads).toBe(1);
    events.push(siren(1, true, 'roadblock'));
    expect(count(events)).toBe(1);
    expect(reads).toBe(1);
  });

  it('keeps each race independent', () => {
    expect(createRadioedAheadCounter()([siren(1, true), siren(1, true, 'roadblock')])).toBe(1);
    expect(createRadioedAheadCounter()([siren(1, true, 'roadblock')])).toBe(0);
  });
});
