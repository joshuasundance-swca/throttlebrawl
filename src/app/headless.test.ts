import { describe, expect, it } from 'vitest';
import { loadBasePack } from '../content';
import { createHeadlessRace } from './headless';

describe('app/headless: createHeadlessRace', () => {
  it('loads live content by default, like the prod build', () => {
    const live = Object.keys(loadBasePack().trafficTypes).length;
    expect(createHeadlessRace({ seed: 1 }).config.trafficTypes).toHaveLength(live);
  });

  it('loads drafts too when asked, like the dev and staging builds', () => {
    const all = Object.keys(loadBasePack({ includeDrafts: true }).trafficTypes).length;
    const race = createHeadlessRace({ seed: 1 }, { includeDrafts: true });
    expect(race.config.trafficTypes).toHaveLength(all);
    expect(race.sim.tick).toBe(0);
  });
});
