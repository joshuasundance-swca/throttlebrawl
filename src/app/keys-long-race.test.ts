// The Keys race's long length (run W-Q, distinct keys; interview, 2026-10-02: "KEYS FIRST =
// DISTINCT KEYS"). The Race length setting's Long now rides the long haul, over every key to the
// party key at the end of the Last Resort Causeway; Standard stays the Causeway Sprint, and Short
// (which the event does not name) falls back to it, as before.
import { describe, expect, it } from 'vitest';
import { loadBasePack, lookup } from '../content';
import { DEFAULT_EVENT, eventKey, eventLength } from './config';

describe('the Keys race lengths', () => {
  const reg = loadBasePack();
  const event = lookup(reg.events, eventKey(DEFAULT_EVENT));

  it('rides the long haul at Long, and keeps the sprint at Standard and Short', () => {
    expect(event.region).toBe('florida-keys');
    expect(eventLength(event, 'long').route).toBe('m1-long-haul');
    expect(eventLength(event, 'standard').route).toBe('m1-skeleton-sprint');
    expect(eventLength(event, 'short').route).toBe('m1-skeleton-sprint');
    expect(eventLength(event).route).toBe('m1-skeleton-sprint');
  });

  it("names a route on the event's own network that ends at the Last Resort Causeway", () => {
    const sprint = lookup(reg.routes, 'base:m1-skeleton-sprint');
    const long = lookup(reg.routes, 'base:m1-long-haul');
    expect(long.network).toBe(sprint.network);
    expect(long.finish.road).toBe('m1-last-resort-causeway');
    expect(long.mainPath.length).toBeGreaterThan(sprint.mainPath.length);
  });
});
