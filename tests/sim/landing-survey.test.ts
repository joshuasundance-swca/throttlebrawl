import { describe, expect, it } from 'vitest';
import { realRoutes } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { LANDING_EVENTS, landingManifest } from './landing-inventory';
import { LANDING_FILES } from './landing-group.mjs';
import {
  checkLandings,
  landingCases,
  landingSurvey,
  tally,
  type LandingCase,
  type LandingResult,
  type LandingTally,
} from './landing-survey';

const t = (clean = 0, crashOnLanding = 0, crashAfter = 0, airCrash = 0): LandingTally => ({
  ...tally(),
  landings: clean + crashOnLanding,
  clean,
  crashOnLanding,
  crashAfter,
  airCrash,
});
const row = (player = t(), rivals = t()): LandingResult => ({ player, rivals });
const fixture = (run: (c: LandingCase, i: number) => LandingResult) => {
  let i = 0;
  const survey = landingSurvey((c) => run(c, i++));
  for (const c of survey.cases) survey.run(c);
  return survey;
};

describe('landing survey scheduling', () => {
  it('partitions the existing three-event cohort by route without changing or repeating races', () => {
    expect(LANDING_EVENTS).toEqual([
      'base:m1-skeleton-sprint',
      'region-pnw:pnw-fogline-run',
      'region-sf:sf-hill-sprint',
    ]);
    const manifest = landingManifest();
    expect(manifest.cases.map(({ key: _key, file: _file, ...c }) => c)).toEqual(landingCases());
    expect(new Set(manifest.cases.map((c) => c.key)).size).toBe(manifest.cases.length);
    const routes = [...new Set(manifest.cases.map((c) => JSON.stringify([c.event, c.route])))];
    for (const [i, route] of routes.entries()) {
      const rows = manifest.cases.filter((c) => JSON.stringify([c.event, c.route]) === route);
      expect(rows.map((c) => [c.seed, c.thumb])).toEqual([
        [1, false],
        [1, true],
        [2, false],
        [2, true],
      ]);
      expect(new Set(rows.map((c) => c.file))).toEqual(new Set([LANDING_FILES[i % LANDING_FILES.length]]));
    }
    const attempted: LandingCase[] = [];
    for (const file of LANDING_FILES) {
      const required = manifest.cases.filter((c) => c.file === file);
      expect(required.length).toBeGreaterThan(0);
      const survey = landingSurvey((c) => {
        attempted.push(c);
        return row();
      }, required);
      for (const c of required) {
        survey.run(c);
        survey.run(c);
      }
      expect(survey.results()).toHaveLength(required.length);
    }
    expect(attempted.map((c) => JSON.stringify([c.event, c.route, c.seed, c.thumb])).sort()).toEqual(
      manifest.cases.map((c) => c.key).sort(),
    );
  });
  it('retains both seeds and policies for every event-derived route in the original order', () => {
    const registry = registryFromGlob(
      import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
    );
    const planned = landingCases();
    const events = [...new Set(planned.map((c) => c.event))];
    expect(events.length).toBeGreaterThan(0);
    const expected = events.flatMap((event) => {
      const routes = [
        ...new Set(lookup(registry.events, event).lengths.map((l) => `length:${l.id}`)),
        ...realRoutes(registry, event),
      ];
      return routes.flatMap((route) =>
        [1, 2].flatMap((seed) => [false, true].map((thumb) => ({ event, route, seed, thumb }))),
      );
    });
    expect(planned).toEqual(expected);
    const attempted: LandingCase[] = [];
    const survey = landingSurvey((c) => {
      attempted.push(c);
      return row();
    });
    expect(attempted).toEqual([]);
    for (const c of survey.cases) {
      const previous = attempted.length;
      survey.run(c);
      survey.run(c);
      expect(attempted.length - previous).toBe(1);
    }
    expect(attempted).toEqual(planned);
  });
});

describe('landing survey pooled oracle fixtures', () => {
  it('allows routes with no landing and applies the rivals ceiling to the pooled bot races only', () => {
    const survey = fixture((c, i) =>
      row(i === 0 ? t(1) : t(), c.thumb ? t(0, 99) : i === 0 ? t(0, 1) : i === 2 ? t(9) : t()),
    );
    expect(() => checkLandings(survey)).not.toThrow();
    // One fewer clean rival landing takes the pooled allowance below the one crash.
    const below = fixture((c, i) =>
      row(i === 0 ? t(1) : t(), c.thumb ? t() : i === 0 ? t(0, 1) : i === 2 ? t(8) : t()),
    );
    expect(() => checkLandings(below)).toThrow();
  });

  it.each([false, true])('rejects landing and post-wobble crashes for thumb=%s', (thumb) => {
    for (const player of [t(0, 1), t(1, 0, 1)]) {
      let injected = false;
      const survey = fixture((c) => {
        if (!injected && c.thumb === thumb) {
          injected = true;
          return row(player);
        }
        return row();
      });
      expect(injected).toBe(true);
      expect(() => checkLandings(survey)).toThrow();
    }
  });

  it('retains the original global exposure floor and reports air crashes without a new ceiling', () => {
    expect(() => checkLandings(fixture(() => row()))).toThrow();
    expect(() => checkLandings(fixture((_c, i) => row(i === 0 ? t(1, 0, 0, 1) : t())))).not.toThrow();
  });

  it('cannot pass with missing or failed required work and never runs a missing race from the oracle', () => {
    let calls = 0;
    const survey = landingSurvey(() => {
      calls++;
      return row(t(1));
    });
    survey.run(survey.cases[0]!);
    expect(() => checkLandings(survey)).toThrow(/missing/i);
    expect(calls).toBe(1);
    const fault = new Error('required landing race failed');
    const failed = landingSurvey(() => {
      throw fault;
    });
    expect(() => failed.run(failed.cases[0]!)).toThrow(fault);
    expect(() => checkLandings(failed)).toThrow(fault);
    expect(() => failed.run(failed.cases[0]!)).toThrow(fault);
  });

  it.each([
    ['missing result', undefined],
    ['missing player', { rivals: t() }],
    ['missing rivals', { player: t(1) }],
    ['NaN', row({ ...t(1), crashOnLanding: NaN })],
    ['negative', row({ ...t(1), crashAfter: -1 })],
    ['fraction', row({ ...t(1), airCrash: 0.5 })],
    ['inconsistent outcomes', row({ ...t(1), landings: 2 })],
    ['missing causes', row({ ...t(1), causes: undefined } as unknown as LandingTally)],
    ['malformed cause', row({ ...t(1), causes: { barrier: NaN } })],
    ['malformed rivals', row(t(1), { ...t(), crashAfter: -1 })],
  ])('rejects %s instead of contributing partial success', (_name, bad) => {
    const survey = landingSurvey(() => bad as LandingResult);
    expect(() => survey.run(survey.cases[0]!)).toThrow(/missing|malformed/i);
    expect(() => checkLandings(survey)).toThrow(/missing|malformed/i);
  });
});
