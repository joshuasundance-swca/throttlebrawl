// cops-1 acceptance over the shared 50-race seeded batch: the player-bust rate is printed and fails
// above 30% (docs/milestones/M1.md, cops-1). The base event now fields Sgt. Pruitt every race
// (app-2 resolves him in buildSimConfig), so this file reads dev-1's cached batch instead of
// running its own races. `pruitt()` is the cops lane's own resolution of him, kept as the oracle
// that buildSimConfig resolves him the same way.
//
// The reference below gives this Node-side file the Vite client types (`import.meta.glob`), which
// the base-pack loader it imports through src/app and src/content uses.
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import { loadBasePack, lookup } from '../../src/content';
import type { SimRiderDef } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, createBatchRace, simBatch, type BatchResult } from './batch';

const MAX_BUST_RATE = 0.3;

/** Sgt. Pruitt as a SimRiderDef: the base bike scaled by his pursuit speed, and his law block. */
function pruitt(): SimRiderDef {
  const reg = loadBasePack();
  const rider = lookup(reg.riders, 'sgt-pruitt');
  const law = rider.law;
  if (rider.role !== 'cop' || !law) throw new Error('sgt-pruitt must be a cop with a law block');
  const bike = lookup(reg.bikes, rider.bike);
  const h = bike.handling;
  return {
    contentId: `base:${rider.id}`,
    name: rider.name ?? rider.id,
    role: 'cop',
    faction: 'law',
    controller: { kind: 'cop' },
    bike: {
      contentId: `base:${rider.bike}`,
      topSpeedMps: h.topSpeedMps * law.pursuitSpeedScale,
      accelMps2: h.accelMps2,
      brakeMps2: h.brakeMps2,
      steerRateMps: h.steerRateMps,
      massKg: h.massKg,
      knockbackResistance: bike.combat?.knockbackResistance ?? 0,
      hitPowerScale: bike.combat?.hitPowerScale ?? 1,
    },
    massKg: rider.stats?.massKg ?? 80,
    healthMax: rider.stats?.healthMax ?? 100,
    toughness: rider.stats?.toughness ?? 1,
    power: rider.stats?.power ?? 1,
    // cops-3: his baton, live since the integration round, so every build hands it to him.
    startingWeapon: `base:${String(rider.startingWeapon)}`,
    law: {
      agency: `base:${law.agency}`,
      bustRadiusM: law.bustRadiusM,
      bustDwellS: law.bustDwellS,
      fineCash: law.fineCash,
      pursuitSpeedScale: law.pursuitSpeedScale,
    },
  };
}

let batch: BatchResult;
beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

describe('cops: Sgt. Pruitt in the race field', () => {
  // Playtest 2: the base event (baseCount 1, patrolMax 2) fields four cops: the lot's starter, up
  // to two on patrol and one more in the lot. The Keys pool, sorted, cycles Pruitt and (in dev
  // builds) Dalrymple.
  it('rides in every batch race, resolved the way the cops lane resolves him, behind the player', () => {
    const { config, playerId } = createBatchRace(1);
    const cops = config.riders.filter((r) => r.controller.kind === 'cop');
    expect(cops).toHaveLength(5); // and one for the heat meter
    expect(cops[0]).toEqual(pruitt());
    expect(cops[2]).toEqual(pruitt());
    expect(config.riders.findIndex((r) => r.controller.kind === 'cop')).toBeGreaterThan(playerId);
    for (const race of batch.races) expect(race.field.cops, `seed ${race.seed}`).toBe(5);
  });
});

describe('cops: the player-bust rate over the 50 seeded races', () => {
  it(`prints the rate and stays at or under ${MAX_BUST_RATE * 100}%`, () => {
    const races = batch.races;
    const busted = races.filter((r) => r.events.some((e) => e.type === 'bust' && e.target === r.playerId));
    const chased = races.filter((r) => r.events.some((e) => e.type === 'siren' && e.data['on'] === true));
    const rate = busted.length / races.length;
    // Straight to stdout: Vitest hides console output from passing tests, and this line must show.
    process.stdout.write(
      `cops batch: ${races.length} seeded races with the cop: player busted ${busted.length} ` +
        `(${(rate * 100).toFixed(1)}%${busted.length ? `: seeds ${busted.map((r) => r.seed).join(', ')}` : ''}), ` +
        `a cop gave chase in ${chased.length}\n`,
    );
    expect(races).toHaveLength(50);
    expect(chased).toHaveLength(races.length); // a cop lights up in every race
    expect(rate).toBeLessThanOrEqual(MAX_BUST_RATE);
  });
});
