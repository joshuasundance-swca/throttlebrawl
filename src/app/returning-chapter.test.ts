import { describe, expect, it } from 'vitest';
import { careerDefs, newCareer, regionOpen, startCareer, startSeason, type CareerDef } from '../career';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE, EVENT_OUTCOMES, type EventResult, type Profile } from '../save';
import { returningCareerRegion } from './returning-chapter';

// Acceptance: docs/milestones/returning-chapter.md. Chapter and node ids come from live packs.
const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const defs = careerDefs(registry);
const first = defs[0]!;
const later = defs.find((d) => d.chapter > first.chapter && d.nodes.length > 0)!;
const fresh = (): Profile => structuredClone(DEFAULT_PROFILE);
const result = (def: CareerDef, over: Partial<EventResult> = {}): EventResult => ({
  event: def.nodes[0]!.event,
  node: def.nodes[0]!.id,
  region: def.regionId,
  place: 0,
  outcome: 'lost',
  cash: 0,
  takedowns: 0,
  build: 'test',
  at: '',
  ...over,
});
const played = (history: EventResult[], season = 1): Profile => ({ ...fresh(), history, season });

describe('returning career chapter', () => {
  it('keeps the first-chapter fallback for fresh history and empty definitions', () => {
    expect(first, 'a loaded first chapter').toBeDefined();
    expect(later, 'a loaded later chapter').toBeDefined();
    expect(returningCareerRegion(defs, fresh())).toBeNull();
    expect(returningCareerRegion([], played([result(later)]))).toBeNull();
  });

  it.each(EVENT_OUTCOMES)(
    'returns a later current-season chapter after %s without prior boss flags',
    (outcome) => {
      const profile = played([result(later, { outcome })]);
      expect(profile.regions).toEqual({});
      expect(regionOpen(defs, profile, later)).toBe(true);
      expect(returningCareerRegion(defs, profile)).toBe(later.regionId);
    },
  );

  it('uses array order rather than timestamps and leaves both inputs unchanged', () => {
    const profile = played([result(first, { at: '2099-01-01T00:00:00Z' }), result(later, { at: '' })]);
    const before = structuredClone({ defs, profile });
    expect(returningCareerRegion(defs, profile)).toBe(later.regionId);
    expect({ defs, profile }).toEqual(before);
    expect(returningCareerRegion(defs, played([...profile.history].reverse()))).toBe(first.regionId);
  });

  it('treats an absent result season as Season 1 only', () => {
    const row = result(later);
    expect(returningCareerRegion(defs, played([row]))).toBe(later.regionId);
    expect(returningCareerRegion(defs, played([row], 2))).toBeNull();
    expect(returningCareerRegion(defs, played([result(later, { season: 2 })], 2))).toBe(later.regionId);
  });

  const foreignNode = first.nodes.find((n) => !later.nodes.some((l) => l.id === n.id))!;
  const unusable: [string, Partial<EventResult>][] = [
    ['old season', { season: 2 }],
    ['future season', { season: 4 }],
    ['free play', { node: null }],
    ['unknown region', { region: 'missing-region' }],
    ['qualified region', { region: later.regionKey }],
    ['removed node', { node: 'removed-node' }],
    ['node of another region', { node: foreignNode.id }],
  ];
  it.each(unusable)('skips a newer %s row, using an earlier valid row or null', (_why, over) => {
    const invalid = result(later, { season: 3, ...over });
    expect(returningCareerRegion(defs, played([result(first, { season: 3 }), invalid], 3))).toBe(
      first.regionId,
    );
    expect(returningCareerRegion(defs, played([invalid], 3))).toBeNull();
  });

  it('skips a newer result with no season after Season 1, using an earlier valid row or null', () => {
    const missing = result(later);
    expect('season' in missing).toBe(false);
    expect(returningCareerRegion(defs, played([result(first, { season: 3 }), missing], 3))).toBe(
      first.regionId,
    );
    expect(returningCareerRegion(defs, played([missing], 3))).toBeNull();
  });

  it('accepts a replaced historical event while its current chapter and node still exist', () => {
    const replacement = first.nodes.find((n) => n.event !== later.nodes[0]!.event)!;
    const row = result(later, { event: replacement.event });
    expect(row.event).not.toBe(later.nodes[0]!.event);
    expect(returningCareerRegion(defs, played([row]))).toBe(later.regionId);
  });

  it('does not restore a previous season after actual Start Season or a reset New career', () => {
    const completed = startCareer(defs, played([result(later)]));
    for (const def of defs)
      completed.regions[def.regionId] = {
        tier: def.tiers.length,
        won: def.nodes.map((n) => n.id),
        unlockedRoads: [...def.startRoads],
        claimedRoads: [],
        foundShortcuts: [],
        secrets: [],
        finaleBeaten: true,
      };
    expect(returningCareerRegion(defs, completed)).toBe(later.regionId);
    const next = startSeason(defs, completed, 1);
    expect(next.season).toBe(completed.season + 1);
    expect(next.history).toEqual(completed.history);
    expect(returningCareerRegion(defs, next)).toBeNull();
    expect(
      returningCareerRegion(defs, {
        ...next,
        history: [...next.history, result(later, { season: next.season })],
      }),
    ).toBe(later.regionId);
    const reset = newCareer(defs, completed, { code: 'test-backup', at: '' });
    expect(reset.history).toEqual([]);
    expect(reset.season).toBe(1);
    expect(returningCareerRegion(defs, reset)).toBeNull();
  });
});
