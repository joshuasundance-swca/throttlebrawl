// Ordinary files run in one existing CI job; the mandatory reporter judges only the complete pool.
import { describe, inject, it } from 'vitest';
import { LANDING_FILES, LANDING_VERSION } from './landing-group.mjs';
import { landingKey, landingManifest } from './landing-inventory';
import { landingSurvey } from './landing-survey';

describe(
  'forgiving landings: existing three-event survey, route bucket 3',
  { concurrent: false, shuffle: false, retry: 0, repeats: 0 },
  () => {
    const required = landingManifest().cases.filter((c) => c.file === LANDING_FILES[2]);
    const survey = landingSurvey(undefined, required);
    for (const c of survey.cases)
      it(
        c.event + ' ' + c.route + ', seed ' + c.seed + ', ' + (c.thumb ? 'thumb' : 'bot'),
        ({ task }) => {
          const marker = inject('landingSurvey');
          if (!marker || marker.version !== LANDING_VERSION || !marker.token)
            throw new Error('Missing complete landing reporter');
          const result = survey.run(c);
          task.meta.landingSurvey = {
            ...marker,
            key: landingKey(c),
            ...result,
          };
        },
        900_000,
      );
  },
);
