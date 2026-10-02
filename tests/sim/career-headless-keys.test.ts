/// <reference types="vite/client" />
// The headless career in the Keys: the dev bot plays every event and the boss (see
// career-headless.ts for what it proves).
import { it } from 'vitest';
import { headlessCareer } from './career-headless';

it('the bot plays every event of the Keys career and its boss', () => {
  headlessCareer('florida-keys');
}, 600_000);
