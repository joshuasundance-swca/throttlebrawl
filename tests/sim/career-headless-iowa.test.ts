/// <reference types="vite/client" />
// The headless career in Iowa: the dev bot plays every event and the boss (see
// career-headless.ts for what it proves).
import { it } from 'vitest';
import { headlessCareer } from './career-headless';

it('the bot plays every event of the Iowa career and its boss', () => {
  headlessCareer('clinton-iowa');
}, 600_000);
