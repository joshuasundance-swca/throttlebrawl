import { describe, expect, it } from 'vitest';
import { tierHead } from './career-show';
import { applyWin, careerDefs, careerView, progressOf, startCareer } from '../career';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE } from '../save';

const reg = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const defs = careerDefs(reg);
describe('regional finale tier headings from actual career content', () => {
  for (const def of defs) {
    it(`${def.regionName}: reports boss readiness and completion`, () => {
      const node = def.nodes.find((n) => n.id === def.boss);
      if (!node) throw new Error('No finale node');
      let profile = startCareer(defs, { ...DEFAULT_PROFILE });
      for (const n of def.nodes.filter((n) => n !== node)) {
        profile = {
          ...profile,
          regions: {
            ...profile.regions,
            [def.regionId]: applyWin(def, progressOf(def, profile.regions), n).progress,
          },
        };
      }
      const tier = careerView(reg, defs, profile, def.regionId).tiers.find((t) =>
        t.nodes.some((n) => n.id === node.id),
      );
      if (!tier) throw new Error('No finale tier');
      expect(tierHead(tier).status).toBe('boss open');
      profile = {
        ...profile,
        regions: {
          ...profile.regions,
          [def.regionId]: applyWin(def, progressOf(def, profile.regions), node).progress,
        },
      };
      const done = careerView(reg, defs, profile, def.regionId).tiers.find((t) =>
        t.nodes.some((n) => n.id === node.id),
      );
      if (!done) throw new Error('No completed finale tier');
      expect(tierHead(done).status).toBe('boss beaten');
    });
  }
});
