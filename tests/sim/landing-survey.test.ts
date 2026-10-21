import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { realRoutes } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
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
  it('schedules individual races before the pooled oracle instead of one whole-survey deadline', () => {
    const source = readFileSync(new URL('./riders-landings.test.ts', import.meta.url), 'utf8');
    expect(source).toContain('concurrent: false');
    expect(source).toContain('shuffle: false');
    expect(source).toContain('for (const c of survey.cases)');
    expect(source).toContain('survey.run(c)');
    expect(source).toContain('checkLandings(survey)');
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
