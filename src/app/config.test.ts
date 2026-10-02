import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, loadBasePack, lookup, SIGNATURE_MOVES } from '../content';
import { SIGNATURE_IDS } from '../sim/api';
import { aiController, buildSimConfig, streamForEvent } from './config';

const shove = {
  type: 'weapon',
  id: 'test-shove',
  name: 'Test Shove',
  category: 'unarmed',
  behaviour: 'melee.swing',
  unarmed: true,
  reach: { sM: 1, dM: 1.7 },
  windupS: 0.22,
  activeS: 0.1,
  recoveryS: 0.45,
  cooldownS: 0.5,
  damage: 14,
  knockback: { lateralMps: 5.5, staggerS: 0.3 },
  hitStopMs: 60,
  meta: { status: 'live' },
};

function configWith(weapon: Record<string, unknown>) {
  const reg = buildRegistry([
    ...basePackFiles(),
    { path: `weapons/${String(weapon['id'])}.json`, json: weapon },
  ]);
  return buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
}

describe('app: buildSimConfig resolves weapons', () => {
  it('carries knockback speed and stagger (in ticks) into SimWeaponDef', () => {
    const w = configWith(shove).weapons.find((x) => x.contentId === 'base:test-shove');
    expect(w).toMatchObject({
      windupTicks: 13,
      activeTicks: 6,
      recoveryTicks: 27,
      cooldownTicks: 30,
      knockbackMps: 5.5,
      staggerTicks: 18,
      hitStopMs: 60,
    });
  });

  it('defaults knockback to none when the weapon has no knockback block', () => {
    const { knockback: _drop, ...plain } = shove;
    const w = configWith(plain).weapons.find((x) => x.contentId === 'base:test-shove');
    expect(w?.knockbackMps).toBe(0);
    expect(w?.staggerTicks).toBe(0);
  });
});

describe('app: the base pack punch and kick (combat-1, M1 starting numbers)', () => {
  const reg = buildRegistry(basePackFiles());
  const config = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
  const byId = (id: string) => config.weapons.find((w) => w.contentId === id);

  it('punch: 7 / 5 / 15 ticks, reach 1.2 m × 1.4 m, 60 ms hit-stop, no cooldown', () => {
    expect(byId('base:punch')).toMatchObject({
      unarmed: true,
      reachSM: 1.2,
      reachDM: 1.4,
      windupTicks: 7,
      activeTicks: 5,
      recoveryTicks: 15,
      cooldownTicks: 0,
      hitStopMs: 60,
    });
  });

  it('kick: 13 / 6 / 27 ticks, a 30-tick cooldown, reach 1.0 m × 1.7 m, and a harder shove', () => {
    const kick = byId('base:kick');
    expect(kick).toMatchObject({
      unarmed: true,
      reachSM: 1.0,
      reachDM: 1.7,
      windupTicks: 13,
      activeTicks: 6,
      recoveryTicks: 27,
      cooldownTicks: 30,
      hitStopMs: 60,
    });
    expect(kick?.knockbackMps ?? 0).toBeGreaterThan(byId('base:punch')?.knockbackMps ?? 0);
  });

  it('starts the combat tuning scales at 1', () => {
    expect(config.tuning['combat.hitStopScale']).toBe(1);
    expect(config.tuning['combat.knockbackScale']).toBe(1);
  });
});

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

  it('passes a known signature move through and drops an unknown one (interview, 2026-10-02)', () => {
    expect(aiController({ style: 'showboat', signature: 'selfie' })).toEqual({
      kind: 'ai',
      style: 'showboat',
      personality: { signature: 'selfie' },
    });
    const odd = { style: 'racer', signature: 'moonwalk' } as unknown as Parameters<typeof aiController>[0];
    expect(aiController(odd)).toEqual({ kind: 'ai', style: 'racer', personality: {} });
  });

  it('keeps the content schema’s signature list in step with the sim contract’s', () => {
    expect([...SIGNATURE_MOVES]).toEqual([...SIGNATURE_IDS]);
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

describe('app/config: the M1 race field (four rivals and a cop)', () => {
  const reg = loadBasePack();
  const config = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });

  it('fields the four regulars ahead of the player, and the player ahead of the law', () => {
    expect(config.riders.map((r) => r.contentId)).toEqual([
      'base:deacon-vane',
      'base:dial-up',
      'base:chad-speedwell',
      'base:kevin-from-accounting',
      'base:player',
      // Playtest 2: the lot's starter, up to two on patrol and one more in the lot (release
      // content: Pruitt each time).
      'base:sgt-pruitt',
      'base:sgt-pruitt',
      'base:sgt-pruitt',
      'base:sgt-pruitt',
    ]);
    expect(config.riders.map((r) => r.controller.kind)).toEqual([
      'ai',
      'ai',
      'ai',
      'ai',
      'player',
      'cop',
      'cop',
      'cop',
      'cop',
    ]);
  });

  it('resolves Sgt. Pruitt as a cop: the law faction, his bike scaled by his pursuit speed, his law block', () => {
    const cop = config.riders.find((r) => r.role === 'cop');
    const bike = lookup(reg.bikes, 'rustbucket-400').handling;
    expect(cop).toMatchObject({
      name: 'Sgt. Pruitt',
      faction: 'law',
      controller: { kind: 'cop' },
      healthMax: 100,
      law: {
        agency: 'base:keys-county-deputies',
        bustRadiusM: 14,
        bustDwellS: 1,
        fineCash: 400,
        pursuitSpeedScale: 1.05,
      },
    });
    // No pace floor for the law: his speed comes from his bike and his pursuit scale alone.
    expect(cop?.bike.topSpeedMps).toBeCloseTo(bike.topSpeedMps * 1.05, 9);
  });

  it('fields no cop when the event says none', () => {
    const quiet = buildRegistry(
      basePackFiles().map((f) => {
        const json = f.json as { type?: string; cops?: unknown };
        return json.type === 'event' ? { ...f, json: { ...json, cops: { mode: 'none' } } } : f;
      }),
    );
    const c = buildSimConfig(quiet, streamForEvent(quiet), { seed: 1 });
    expect(c.riders.some((r) => r.faction === 'law')).toBe(false);
    expect(c.riders.filter((r) => r.controller.kind === 'ai')).toHaveLength(4);
  });
});

describe('app/config: a bike’s combat block reaches the sim (the combat-3 contract wire)', () => {
  const withCombat = (combat: Record<string, unknown> | null) => {
    const reg = buildRegistry(
      basePackFiles().map((f) => {
        const json = f.json as { type?: string; combat?: unknown };
        if (json.type !== 'bike') return f;
        const { combat: _drop, ...plain } = json;
        return { ...f, json: combat ? { ...plain, combat } : plain };
      }),
    );
    const c = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
    return c.riders.find((r) => r.controller.kind === 'player')?.bike;
  };

  it('carries knockbackResistance and hitPowerScale into SimBikeDef', () => {
    const bike = withCombat({ knockbackResistance: 0.4, hitPowerScale: 0.8 });
    expect(bike?.knockbackResistance).toBe(0.4);
    expect(bike?.hitPowerScale).toBe(0.8);
  });

  it('defaults to no resistance and full hit power when the bike has no combat block', () => {
    const bike = withCombat(null);
    expect(bike?.knockbackResistance).toBe(0);
    expect(bike?.hitPowerScale).toBe(1);
  });
});

describe('app/config: a rider’s fight stats reach the sim (playtest 2: "Visible personalities")', () => {
  const withStats = (stats: Record<string, unknown>) => {
    const reg = buildRegistry(
      basePackFiles().map((f) => {
        const json = f.json as { type?: string; id?: string; stats?: Record<string, unknown> };
        if (json.type !== 'rider' || json.id !== 'deacon-vane') return f;
        return { ...f, json: { ...json, stats: { massKg: 95, healthMax: 110, ...stats } } };
      }),
    );
    const c = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
    return c.riders.find((r) => r.contentId === 'base:deacon-vane');
  };

  it('carries stats.toughness and stats.power into SimRiderDef', () => {
    const deacon = withStats({ toughness: 1.3, power: 0.8 });
    expect(deacon?.toughness).toBe(1.3);
    expect(deacon?.power).toBe(0.8);
  });

  it('defaults both to 1 when the rider file leaves them out', () => {
    const deacon = withStats({});
    expect(deacon?.toughness).toBe(1);
    expect(deacon?.power).toBe(1);
  });

  it('the schema keeps them moderate: 0.5 to 2', () => {
    expect(() => withStats({ toughness: 3 })).toThrow();
    expect(() => withStats({ power: 0.2 })).toThrow();
  });
});

describe('app/config: the region traffic mix reaches the sim (the traffic-3 contract wire)', () => {
  const withRegion = (edit: (traffic: Record<string, unknown>) => void) => {
    const reg = buildRegistry(
      basePackFiles().map((f) => {
        const json = f.json as { type?: string; traffic?: Record<string, unknown> };
        if (json.type !== 'region' || !json.traffic) return f;
        const traffic = structuredClone(json.traffic);
        edit(traffic);
        return { ...f, json: { ...json, traffic } };
      }),
    );
    const c = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
    return Object.fromEntries(c.trafficTypes.map((t) => [t.contentId, t.weight]));
  };

  it('writes each type its weight from the region file (mix, pedestrians and animals)', () => {
    const w = withRegion((t) => {
      t['mix'] = [
        { kind: 'sedan-rental', weight: 7, hazard: 'normal' },
        { kind: 'base:box-truck', weight: 0.5, hazard: 'big' },
      ];
      t['pedestrians'] = [{ kind: 'fisherman', weight: 3 }];
    });
    expect(w['base:sedan-rental']).toBe(7);
    expect(w['base:box-truck']).toBe(0.5);
    expect(w['base:fisherman']).toBe(3);
    // Listed nowhere in the region: never picked.
    expect(w['base:pickup']).toBe(0);
    expect(w['base:tourist-with-cooler']).toBe(0);
    // The animals list is untouched.
    expect(w['base:chicken']).toBe(1);
  });

  it('matches the base pack region today', () => {
    expect(withRegion(() => undefined)).toEqual({
      'base:beach-cruiser': 1.5,
      'base:box-truck': 2,
      'base:chicken': 1,
      'base:dive-bar-dog': 0.8,
      'base:dog-walker': 1,
      'base:fisherman': 1,
      'base:golf-cart': 1.5,
      'base:pickup': 5,
      'base:pickup-towing-boat': 1.5,
      'base:rental-convertible': 2,
      'base:sedan-rental': 5,
      'base:snowbird-rv': 0.5,
      'base:sunburnt-jogger': 1,
      'base:tourist-with-cooler': 1,
      // W-P road events' vehicles: placed by a set piece, never rolled by traffic.
      'base:event-stalled-car': 0,
      'base:event-tow-truck': 0,
      'base:event-work-truck': 0,
      'base:keys-parade-float': 0,
      // W-R: each key's own vehicles, in no region mix: they spawn only on their key.
      'base:cooler-on-wheels': 0,
      'base:party-van': 0,
      'base:resort-scooter-rider': 0,
      'base:salvage-key-shuttle': 0,
      'base:salvage-wrecker': 0,
      'base:shrimp-truck': 0,
    });
  });

  it("writes each type its weight in each of the region's traffic areas (W-R: each key its own traffic)", () => {
    const reg = buildRegistry(basePackFiles());
    const c = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
    const areas = Object.fromEntries(
      c.trafficTypes.filter((t) => t.areaWeights).map((t) => [t.contentId, t.areaWeights]),
    );
    expect(areas['base:shrimp-truck']).toEqual({ 'key-fishing': 3 });
    expect(areas['base:pickup-towing-boat']).toEqual({ 'key-fishing': 3 });
    expect(areas['base:resort-scooter-rider']).toEqual({ 'key-resort': 2.5 });
    expect(areas['base:golf-cart']).toEqual({ 'key-resort': 3, 'key-party': 1.5 });
    expect(areas['base:salvage-wrecker']).toEqual({ 'key-junkyard': 3 });
    expect(areas['base:salvage-key-shuttle']).toEqual({ 'key-junkyard': 1.5 });
    expect(areas['base:party-van']).toEqual({ 'key-party': 4 });
    expect(areas['base:cooler-on-wheels']).toEqual({ 'key-party': 2 });
    expect(areas['base:sedan-rental']).toEqual({
      'key-fishing': 2,
      'key-resort': 2,
      'key-junkyard': 2,
      'key-party': 2,
    });
    // A type no area lists carries no area weights; peds never do.
    expect(areas['base:runaway-mobile-home']).toBeUndefined();
    expect(areas['base:fisherman']).toBeUndefined();
    // Every area tag is a district some keys-m1 road carries.
    const tags = new Set(c.road.edges.flatMap((e) => e.tags.map((g) => g.tag)));
    for (const w of Object.values(areas))
      for (const k of Object.keys(w ?? {})) expect(tags.has(k)).toBe(true);
  });
});

describe('app/config: the event’s style cash reaches the sim (the riders-5 contract wire)', () => {
  const withRewards = (extra: Record<string, unknown>) => {
    const reg = buildRegistry(
      basePackFiles().map((f) => {
        const json = f.json as { type?: string; rewards?: Record<string, unknown> };
        if (json.type !== 'event' || !json.rewards) return f;
        const { byPlaceCash } = json.rewards;
        return { ...f, json: { ...json, rewards: { byPlaceCash, ...extra } } };
      }),
    );
    return buildSimConfig(reg, streamForEvent(reg), { seed: 1 }).event.style;
  };

  it('carries every style field from the event’s rewards', () => {
    expect(
      withRewards({
        perNearMissCash: 25,
        perAirtimeCash: 40,
        perOncomingSecondCash: 10,
        perTakedownCash: 200,
        takedownComboScale: 0.5,
        perStealCash: 60,
      }),
    ).toEqual({
      perNearMissCash: 25,
      perAirtimeCash: 40,
      perOncomingSecondCash: 10,
      perTakedownCash: 200,
      takedownComboScale: 0.5,
      perStealCash: 60,
    });
  });

  it('writes 0 for each style field the event leaves out', () => {
    expect(withRewards({ perNearMissCash: 7 })).toEqual({
      perNearMissCash: 7,
      perAirtimeCash: 0,
      perOncomingSecondCash: 0,
      perTakedownCash: 0,
      takedownComboScale: 0,
      perStealCash: 0,
    });
  });
});
