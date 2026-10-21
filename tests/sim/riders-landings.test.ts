// The complete landing survey is scheduled race by race; the pooled oracle keeps its original
// thresholds across the whole inventory. Selecting only the oracle fails on missing results.
import { describe, it } from 'vitest';
import { checkLandings, landingSurvey } from './landing-survey';

describe(
  'forgiving landings: a seeded batch on every route (playtest 2, 2026-10-02)',
  { concurrent: false, shuffle: false },
  () => {
    const survey = landingSurvey();
    for (const c of survey.cases) {
      it(
        c.event + ' ' + c.route + ', seed ' + c.seed + ', ' + (c.thumb ? 'thumb' : 'bot'),
        () => {
          survey.run(c);
        },
        900_000,
      );
    }
    it('counts landings and their outcomes for the bot, a held-thumb player and the rivals', () => {
      checkLandings(survey);
    });
  },
);
