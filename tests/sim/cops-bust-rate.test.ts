// cops-1 acceptance over a 50-race seeded batch: the player-bust rate is printed and fails above
// 30% (docs/milestones/M1.md, cops-1). Until dev-1's shared batch (tests/sim/batch.ts) runs the
// cop, and until app-2 puts him in the field through buildSimConfig, this file runs its own batch:
// the base pack's race with Sgt. Pruitt appended, resolved the way buildSimConfig should resolve
// a cop, and the stub bot in the player slot. When the shared batch carries the cop, this file
// should read its cached results instead of running races.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { loadBasePack, lookup } from '../../src/content';
import { createStubBot } from '../../src/dev/bot';
import { createSim, quantizeInput, type SimConfig, type SimEvent, type SimRiderDef } from '../../src/sim/api';

const RACES = 50;
const MAX_BUST_RATE = 0.3;

/** Sgt. Pruitt as a SimRiderDef: the base bike scaled by his pursuit speed, and his law block. */
function pruitt(): SimRiderDef {
  const reg = loadBasePack();
  const rider = lookup(reg.riders, 'sgt-pruitt');
  const law = rider.law;
  if (rider.role !== 'cop' || !law) throw new Error('sgt-pruitt must be a cop with a law block');
  const h = lookup(reg.bikes, rider.bike).handling;
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
    },
    massKg: rider.stats?.massKg ?? 80,
    healthMax: rider.stats?.healthMax ?? 100,
    law: {
      agency: `base:${law.agency}`,
      bustRadiusM: law.bustRadiusM,
      bustDwellS: law.bustDwellS,
      fineCash: law.fineCash,
      pursuitSpeedScale: law.pursuitSpeedScale,
    },
  };
}

function blank(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

interface RaceResult {
  busted: boolean;
  finished: boolean;
  chased: boolean;
  closestM: number;
  ticks: number;
}

/** One race, until the player finishes or is busted (all the bust rate needs), or 10 minutes. */
function race(seed: number, cop: SimRiderDef): RaceResult {
  const base = createHeadlessRace({ seed });
  const config: SimConfig = { ...base.config, riders: [...base.config.riders, cop] };
  const copId = config.riders.length - 1;
  const sim = createSim(config);
  const bot = createStubBot();
  const events: SimEvent[] = [];
  let closestM = Infinity;
  for (;;) {
    const snap = sim.snapshot();
    const me = snap.entities[base.playerId];
    const law = snap.entities[copId];
    if (!me || !law) throw new Error('missing player or cop');
    if (law.speed > 0) closestM = Math.min(closestM, Math.abs(me.progress - law.progress));
    const busted = events.some((e) => e.type === 'bust' && e.target === base.playerId);
    if (busted || me.finished || sim.isOver() || sim.tick >= 60 * 600) {
      return {
        busted,
        finished: me.finished,
        chased: events.some((e) => e.type === 'siren'),
        closestM,
        ticks: sim.tick,
      };
    }
    const a = blank();
    bot.drive(me, base.route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    events.push(...sim.events());
  }
}

describe('cops: the player-bust rate over 50 seeded races', () => {
  it(`prints the rate and stays at or under ${MAX_BUST_RATE * 100}%`, () => {
    const cop = pruitt();
    const results = Array.from({ length: RACES }, (_, i) => race(1000 + i, cop));
    const busts = results.filter((r) => r.busted).length;
    const chased = results.filter((r) => r.chased).length;
    const finished = results.filter((r) => r.finished).length;
    const closest = Math.min(...results.map((r) => r.closestM));
    const rate = busts / RACES;
    // Straight to stdout: Vitest hides console output from passing tests, and this line must show.
    process.stdout.write(
      `cops batch: ${RACES} seeded races with the cop: player busted ${busts} (${(rate * 100).toFixed(1)}%), ` +
        `finished ${finished}, cop gave chase in ${chased}, closest moving cop-to-player gap ${closest.toFixed(1)} m\n`,
    );
    expect(results).toHaveLength(RACES);
    expect(chased).toBe(RACES); // he always spawns and gives chase
    expect(rate).toBeLessThanOrEqual(MAX_BUST_RATE);
  }, 120_000);
});
