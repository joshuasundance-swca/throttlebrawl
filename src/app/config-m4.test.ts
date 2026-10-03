// buildSimConfig for the M4 head starts (the integration round, 2026-10-01): the cops-3 and
// weapons-2 fields (weapon behaviours, uses, stun and roadside weight; a cop's starting weapon; the
// event's tier and law mix) and the rivals-1 personality fields (authored rivals, the preferred
// weapon) now reach a real race's SimConfig. Before this, each lived only in hand-built configs.
import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, loadBasePack } from '../content';
import { tuningDefaults, SIM_TUNING } from '../sim/api';
import { aiController, buildSimConfig, copIds, eventCops, MAX_FIELDED_COPS, streamForEvent } from './config';

const prod = loadBasePack();
const staging = loadBasePack({ includeDrafts: true });
const build = (reg = prod, seed = 7) => buildSimConfig(reg, streamForEvent(reg), { seed });

/** The base pack with its one event's `cops` block replaced. */
function withCops(cops: Record<string, unknown>, includeDrafts = true) {
  const files = basePackFiles().map((f) => {
    const json = f.json as { type?: string };
    return json.type === 'event' ? { ...f, json: { ...json, cops } } : f;
  });
  return buildRegistry(files, { includeDrafts });
}

describe('buildSimConfig: weapons-2 fields reach the race', () => {
  it('maps behaviour, uses, the stun and the roadside weight from the weapon files', () => {
    const w = Object.fromEntries(build(staging).weapons.map((d) => [d.contentId, d]));
    expect(w['base:baton']).toMatchObject({
      behaviour: 'melee.swing',
      charges: null,
      durabilityHits: null,
      roadsideWeight: 0,
    });
    expect(w['base:taser']).toMatchObject({
      behaviour: 'taser.stun',
      charges: 6,
      stunTicks: 54,
      roadsideWeight: 0,
    });
    // W-T: the chain yanks (melee.yank, the wrap's drag plus a pull across your line).
    expect(w['base:bike-chain']).toMatchObject({ behaviour: 'melee.yank', roadsideWeight: 2 });
    expect(w['base:driftwood-club']).toMatchObject({ durabilityHits: 10 });
    // No stun effect: no stunTicks key at all.
    expect('stunTicks' in (w['base:baton'] ?? {})).toBe(false);
  });

  it('spawn.regions keeps a local weapon off other regions’ roads (W-T), and empty means everywhere', () => {
    const weightOf = (reg: ReturnType<typeof buildRegistry>, id: string) =>
      build(reg).weapons.find((d) => d.contentId === id)?.roadsideWeight;
    // The flamingo names the Keys, the region of the base pack's race: it lies on the road.
    expect(weightOf(prod, 'base:lawn-flamingo')).toBe(2);
    // Renamed to another region, it stays in the race (a rival could still carry it) but off the road.
    const files = basePackFiles().map((f) => {
      const json = f.json as { type?: string; id?: string; spawn?: Record<string, unknown> };
      return json.type === 'weapon' && json.id === 'lawn-flamingo'
        ? { ...f, json: { ...json, spawn: { ...json.spawn, regions: ['somewhere-else'] } } }
        : f;
    });
    expect(weightOf(buildRegistry(files, { includeDrafts: false }), 'base:lawn-flamingo')).toBe(0);
    // An empty list (the lead pipe's) is every region.
    expect(weightOf(prod, 'base:lead-pipe')).toBe(3);
  });

  it('a release build carries the live baton, kept off the road', () => {
    const baton = build(prod).weapons.find((d) => d.contentId === 'base:baton');
    expect(baton?.roadsideWeight).toBe(0);
    expect(baton?.steal).not.toBeNull();
  });
});

describe('buildSimConfig: cops-3 fields reach the race', () => {
  it('hands Sgt. Pruitt his baton in a release build (the steal needs something in his hand)', () => {
    const cop = build(prod).riders.find((r) => r.faction === 'law');
    expect(cop?.contentId).toBe('base:sgt-pruitt');
    expect(cop?.startingWeapon).toBe('base:baton');
  });

  it('leaves a starting weapon the race does not carry out (a draft in a release build)', () => {
    const files = basePackFiles().map((f) => {
      const json = f.json as { type?: string; id?: string; meta?: Record<string, unknown> };
      return json.type === 'weapon' && json.id === 'baton'
        ? { ...f, json: { ...json, meta: { ...json.meta, status: 'draft' } } }
        : f;
    });
    const reg = buildRegistry(files, { includeDrafts: false });
    const cop = build(reg).riders.find((r) => r.faction === 'law');
    expect(cop).toBeDefined();
    expect(cop && 'startingWeapon' in cop).toBe(false);
  });

  it("writes the event's tier (1 until career-1) and its law mix", () => {
    const c = build(prod);
    expect(c.event.tier).toBe(1);
    expect(c.event.cops).toEqual({
      mode: 'every-race',
      baseCount: 1,
      tierScale: 0,
      chaosSummon: false,
      randomness: 0,
      patrolMax: 2, // playtest 2: one or two cops patrol every race
      heat: true, // playtest 2: the heat meter
      // Run W-T: the Keys deputies' END OF JURISDICTION sign (the first fielded cop's agency).
      jurisdiction: {
        label: 'END OF JURISDICTION. Keys County Deputies thank you for leaving.',
        agency: 'base:keys-county-deputies',
      },
    });
  });

  it('reads every field of a full cops block, clamped', () => {
    const event = {
      cops: { mode: 'tier-rising', baseCount: 2, tierScale: 1.5, chaosSummon: true, randomness: 3 },
    };
    expect(eventCops(event as never)).toEqual({
      mode: 'tier-rising',
      baseCount: 2,
      tierScale: 1.5,
      chaosSummon: true,
      randomness: 1,
    });
    expect(eventCops({ cops: { mode: 'chaos-summoned' } } as never).baseCount).toBe(0);
  });

  it('fields enough cops for the most the mix can bring out, cycling the region pool', () => {
    const ids = (cops: Record<string, unknown>, tier = 1) => copIds(withCops(cops), undefined, tier);
    expect(ids({ mode: 'none', baseCount: 3, chaosSummon: true })).toEqual([]);
    expect(ids({ mode: 'every-race' })).toEqual(['base:sgt-pruitt']);
    // Chaos can summon one more than the start brings.
    expect(ids({ mode: 'every-race', baseCount: 1, chaosSummon: true })).toEqual([
      'base:sgt-pruitt',
      'base:trooper-dalrymple',
    ]);
    expect(ids({ mode: 'chaos-summoned' })).toEqual(['base:sgt-pruitt']);
    expect(ids({ mode: 'tier-rising', baseCount: 1, tierScale: 1 }, 3)).toEqual([
      'base:sgt-pruitt',
      'base:trooper-dalrymple',
      'base:sgt-pruitt',
    ]);
    expect(ids({ mode: 'tier-rising', baseCount: 3, tierScale: 2, chaosSummon: true }, 5)).toHaveLength(
      MAX_FIELDED_COPS,
    );
    // tier-rising with no baseCount fields nobody at tier 1.
    expect(ids({ mode: 'tier-rising', tierScale: 1 })).toEqual([]);
    // Playtest 2's patrol adds its most (patrolMax), plus one in the lot.
    expect(ids({ mode: 'every-race', baseCount: 1, patrolMax: 2 })).toEqual([
      'base:sgt-pruitt',
      'base:trooper-dalrymple',
      'base:sgt-pruitt',
      'base:trooper-dalrymple',
    ]);
    expect(eventCops({ cops: { mode: 'every-race', patrolMax: 2 } } as never).patrolMax).toBe(2);
    expect('patrolMax' in eventCops({ cops: { mode: 'every-race' } } as never)).toBe(false);
    // The heat meter shares the lot's one (and reuses cops whose chase ended); on its own it fields one.
    expect(ids({ mode: 'every-race', baseCount: 1, patrolMax: 2, heat: true })).toHaveLength(4);
    expect(ids({ mode: 'every-race', baseCount: 1, heat: true })).toHaveLength(2);
    expect(eventCops({ cops: { mode: 'every-race', heat: true } } as never).heat).toBe(true);
    expect('heat' in eventCops({ cops: { mode: 'every-race', heat: 'yes' } } as never)).toBe(false);
  });

  it('races a chaos-summoned event with its cop parked, ready for the meter', () => {
    const reg = withCops({ mode: 'chaos-summoned' });
    const c = buildSimConfig(reg, streamForEvent(reg), { seed: 3 });
    expect(c.riders.filter((r) => r.faction === 'law')).toHaveLength(1);
    expect(c.event.cops?.mode).toBe('chaos-summoned');
  });
});

describe('buildSimConfig: rivals-1 fields reach the race', () => {
  it("passes each rival's authored rivals and preferred weapon to sim/ai", () => {
    const byId = Object.fromEntries(build(prod).riders.map((r) => [r.contentId, r.controller]));
    expect(byId['base:dial-up']).toEqual({
      kind: 'ai',
      style: 'weaver',
      personality: expect.objectContaining({ rivals: ['chad-speedwell'] }) as unknown,
    });
    expect(byId['base:deacon-vane']).toMatchObject({
      style: 'heavy-hitter',
      personality: { rivals: ['chad-speedwell'], preferredWeapon: 'chain' },
    });
    expect(byId['base:kevin-from-accounting']).toMatchObject({
      style: 'grudge-keeper',
      personality: { preferredWeapon: 'briefcase' },
    });
  });

  it('drops malformed rivals and weapons, and leaves both out when absent', () => {
    const c = aiController({ style: 'racer', rivals: ['a', 3], preferredWeapon: 7 } as never);
    expect(c).toEqual({ kind: 'ai', style: 'racer', personality: {} });
    expect(aiController({ style: 'racer', rivals: [] } as never)).toEqual({
      kind: 'ai',
      style: 'racer',
      personality: {},
    });
  });

  it('turns the style quirks on by default [default] (the maintainer wants variety)', () => {
    expect(tuningDefaults(SIM_TUNING)['ai.styleQuirks']).toBe(1);
    expect(build(prod).tuning['ai.styleQuirks']).toBe(1);
  });
});
