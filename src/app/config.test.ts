import { describe, expect, it } from 'vitest';
import {
  basePackFiles,
  buildRegistry,
  LAW_HABITS,
  loadBasePack,
  lookup,
  registryFromGlob,
  SIGNATURE_MOVES,
} from '../content';
import { LAW_HABIT_IDS, SIGNATURE_IDS } from '../sim/api';
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

  it('kick: 7 / 6 / 33 ticks (playtest 4: the wind-up M1 had at 13 moved after the hit), a 30-tick cooldown, reach 1.0 m × 1.7 m, and a harder shove', () => {
    const kick = byId('base:kick');
    expect(kick).toMatchObject({
      unarmed: true,
      reachSM: 1.0,
      reachDM: 1.7,
      windupTicks: 7,
      activeTicks: 6,
      recoveryTicks: 33,
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
    // Read from the event and the riders, so a new rival or cop in the pack is not a test edit.
    const event = lookup(reg.events, 'base:m1-skeleton-sprint');
    const rivals = (event.field?.riders ?? []).map((id) => (id.includes(':') ? id : `base:${id}`));
    expect(rivals).toHaveLength(4);
    const ids = config.riders.map((r) => r.contentId);
    expect(ids.slice(0, rivals.length)).toEqual(rivals);
    expect(ids[rivals.length]).toBe('base:player');
    // Playtest 2: the lot's starter, up to patrolMax on patrol and one more in the lot.
    const law = ids.slice(rivals.length + 1);
    const cops = event.cops as { baseCount?: number; patrolMax?: number };
    expect(law).toHaveLength((cops.baseCount ?? 0) + (cops.patrolMax ?? 0) + 1);
    // The region's cops take turns (run W-T: Trooper Dalrymple joined Sgt. Pruitt): every live cop
    // of the Keys rides before any one rides twice.
    const pool = Object.entries(reg.riders)
      .filter(([, r]) => r.role === 'cop' && r.law && (!r.region || r.region === event.region))
      .map(([id]) => id);
    expect(pool.length).toBeGreaterThan(0);
    for (const id of law) expect(pool, id).toContain(id);
    expect(new Set(law.slice(0, pool.length)).size).toBe(Math.min(pool.length, law.length));
    expect(config.riders.map((r) => r.controller.kind)).toEqual([
      ...rivals.map(() => 'ai'),
      'player',
      ...law.map(() => 'cop'),
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

  it("carries a cop's law habit and his agency's END OF JURISDICTION sign into SimConfig (run W-T)", () => {
    const files = basePackFiles().map((f) => {
      const json = f.json as { type?: string; id?: string; law?: Record<string, unknown> };
      if (json.type === 'rider' && json.id === 'sgt-pruitt')
        return {
          ...f,
          json: { ...json, law: { ...json.law, habit: { kind: 'relentless', rampS: 60, maxScale: 1.2 } } },
        };
      if (json.type === 'crew' && json.id === 'keys-county-deputies')
        return { ...f, json: { ...json, jurisdiction: { sign: 'END OF JURISDICTION. Have a nice day.' } } };
      return f;
    });
    const reg2 = buildRegistry(files);
    const c = buildSimConfig(reg2, streamForEvent(reg2), { seed: 1 });
    const pruitt = c.riders.find((r) => r.contentId === 'base:sgt-pruitt');
    expect(pruitt?.law?.habit).toEqual({ kind: 'relentless', params: { rampS: 60, maxScale: 1.2 } });
    expect(c.event.cops?.jurisdiction).toEqual({
      label: 'END OF JURISDICTION. Have a nice day.',
      agency: 'base:keys-county-deputies',
    });
    // A cop with no habit, and a crew with no sign, carry nothing new.
    const bare = buildRegistry(
      files.map((f) => {
        const json = f.json as { type?: string; id?: string; law?: Record<string, unknown> };
        if (json.type === 'rider' && json.law) {
          const { habit: _h, ...law } = json.law;
          return { ...f, json: { ...json, law } };
        }
        if (json.type === 'crew') {
          const { jurisdiction: _j, ...crew } = json as Record<string, unknown>;
          return { ...f, json: crew };
        }
        return f;
      }),
    );
    const plain = buildSimConfig(bare, streamForEvent(bare), { seed: 1 });
    expect(plain.riders.find((r) => r.role === 'cop')?.law?.habit).toBeUndefined();
    expect(plain.event.cops?.jurisdiction).toBeUndefined();
  });

  it('keeps the law habits in step with the sim contract (content never imports the sim)', () => {
    expect([...LAW_HABITS]).toEqual([...LAW_HABIT_IDS]);
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

  /** The live base region file's traffic block, as the pack ships it (the oracle for the wire). */
  const keysTraffic = () => {
    const file = basePackFiles().find((f) => (f.json as { type?: string }).type === 'region');
    const traffic = (file?.json as { traffic?: KeysTraffic } | undefined)?.traffic;
    if (!traffic) throw new Error('the base pack has no region traffic block');
    return traffic;
  };
  type Listing = { kind: string; weight: number };
  type KeysTraffic = {
    mix: Listing[];
    pedestrians?: Listing[];
    animals?: Listing[];
    areas?: { tag: string; mix: Listing[] }[];
  };
  const q = (kind: string) => (kind.includes(':') ? kind : `base:${kind}`);

  it('matches the base pack region today: each type weighs what the region lists, 0 if listed nowhere', () => {
    // Read from the region file, so a retuned mix or a new traffic type is not a test edit. Types
    // the region lists nowhere (road events' vehicles, placed by a set piece; each key's own
    // vehicles, W-R, which spawn only on their key) get 0 and are never rolled by traffic.
    const t = keysTraffic();
    const listed = new Map<string, number>();
    for (const k of [...t.mix, ...(t.pedestrians ?? []), ...(t.animals ?? [])])
      listed.set(q(k.kind), (listed.get(q(k.kind)) ?? 0) + k.weight);
    const w = withRegion(() => undefined);
    expect(Object.keys(w).length).toBeGreaterThan(listed.size);
    for (const [id, weight] of Object.entries(w)) expect(weight, id).toBe(listed.get(id) ?? 0);
    for (const id of listed.keys()) expect(w[id], `${id} is listed but not a traffic type`).toBeDefined();
    // Some types are in the registry and listed nowhere (the zero-weight ones above).
    expect(Object.values(w).some((x) => x === 0)).toBe(true);
  });

  it("writes each type its weight in each of the region's traffic areas (W-R: each key its own traffic)", () => {
    const reg = buildRegistry(basePackFiles());
    const c = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
    const areas = Object.fromEntries(
      c.trafficTypes.filter((t) => t.areaWeights).map((t) => [t.contentId, t.areaWeights]),
    );
    // Each area's mix, read from the region file: a type's weight in every area that lists it.
    const want: Record<string, Record<string, number>> = {};
    for (const area of keysTraffic().areas ?? [])
      for (const k of area.mix) (want[q(k.kind)] ??= {})[area.tag] = k.weight;
    expect(Object.keys(want).length).toBeGreaterThan(0);
    expect(areas).toEqual(want);
    // A type no area lists carries no area weights; peds never do.
    for (const p of keysTraffic().pedestrians ?? []) expect(areas[q(p.kind)], p.kind).toBeUndefined();
    // Every area tag is a district some road of the region's networks carries: the race's own road is
    // keys-m1's, but the Old Town's tag is on the real Duval Street network (playtest 3, T10.4), which
    // the base pack's minimal file list leaves out, so this reads every pack the way the game loads them.
    const all = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const region = all.regions['base:florida-keys'];
    const tags = new Set(
      (region?.networks ?? []).flatMap((n) =>
        (all.networks[`base:${n}`]?.roads ?? []).flatMap((r) =>
          ((all.roads[`base:${r}`] as { tags?: { tag: string }[] } | undefined)?.tags ?? []).map(
            (g) => g.tag,
          ),
        ),
      ),
    );
    expect(tags.size).toBeGreaterThan(0);
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
      // Playtest 3's moves, from the oncoming rate when the event leaves them out (below).
      perWheelieSecondCash: 20,
      perDriftSecondCash: 30,
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
      perWheelieSecondCash: 0,
      perDriftSecondCash: 0,
    });
  });

  // Playtest 3 ("I'd love a way to do wheelies"; the drift: "we should consider that a first class
  // experience"): a clean wheelie and a banked drift pay style cash per second. An event that
  // names no rate pays 2 and 3 times its oncoming rate [default], so every existing event pays
  // them at its own tier's scale (Keys tier 3's oncoming 10 gives 20 and 30); one that names a
  // rate keeps it.
  it('pays the wheelie and the drift at 2 and 3 times the oncoming rate unless the event names its own', () => {
    expect(withRewards({ perOncomingSecondCash: 10 })).toMatchObject({
      perWheelieSecondCash: 20,
      perDriftSecondCash: 30,
    });
    expect(
      withRewards({ perOncomingSecondCash: 10, perWheelieSecondCash: 5, perDriftSecondCash: 0 }),
    ).toMatchObject({ perWheelieSecondCash: 5, perDriftSecondCash: 0 });
  });
});
