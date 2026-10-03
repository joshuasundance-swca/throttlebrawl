/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// One local weapon per region (run W-T, the pitch deck's #4: "a lawn flamingo in the Keys, a canoe
// paddle in the PNW, a dead rental scooter swung whole in SF"), built the way the game builds a race
// (every carried pack combined, app/config.ts): each region's race lays its own local weapon on the
// road and nobody else's, by the weapon file's `spawn.regions`. No race is run.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { behaviourOf } from '../../src/sim/combat';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

const LOCAL = {
  keys: 'base:lawn-flamingo',
  pnw: 'region-pnw:canoe-paddle',
  sf: 'region-sf:dead-rental-scooter',
} as const;
const EVENTS = {
  keys: 'base:m1-skeleton-sprint',
  pnw: 'region-pnw:pnw-fogline-run',
  sf: 'region-sf:sf-hill-sprint',
} as const;

/** Each weapon in the race with the weight it lies on the road with (0: never). */
function roadWeights(eventId: string): Record<string, number> {
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, eventId), { seed: 7, eventId });
  return Object.fromEntries(
    config.weapons.filter((w) => !w.unarmed).map((w) => [w.contentId, w.roadsideWeight ?? 1]),
  );
}

describe('W-T: one local weapon per region', () => {
  for (const region of ['keys', 'pnw', 'sf'] as const) {
    it(`${region}: its own local weapon lies on the road, the others never do`, () => {
      const weights = roadWeights(EVENTS[region]);
      expect(weights[LOCAL[region]], LOCAL[region]).toBeGreaterThan(0);
      for (const other of Object.values(LOCAL)) {
        if (other !== LOCAL[region]) expect(weights[other] ?? 0, `${other} in ${region}`).toBe(0);
      }
      // The shared roadside weapons still lie everywhere.
      for (const shared of [
        'base:lead-pipe',
        'base:bike-chain',
        'base:kevins-briefcase',
        'base:campaign-sign',
      ]) {
        expect(weights[shared] ?? 0, `${shared} in ${region}`).toBeGreaterThan(0);
      }
    });
  }

  it('the verbs reach the race: the briefcase throws, the chain yanks, the sign and the paddle sweep', () => {
    const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENTS.pnw), { seed: 7, eventId: EVENTS.pnw });
    const by = Object.fromEntries(config.weapons.map((w) => [w.contentId, behaviourOf(w)]));
    expect(by['base:kevins-briefcase']).toBe('throw.burst');
    expect(by['base:bike-chain']).toBe('melee.yank');
    expect(by['base:campaign-sign']).toBe('melee.sweep');
    expect(by[LOCAL.pnw]).toBe('melee.sweep');
  });
});
