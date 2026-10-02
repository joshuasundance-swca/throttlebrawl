/// <reference types="vite/client" />
// The headless career in the Pacific Northwest: the dev bot plays every event and the boss (see
// career-headless.ts for what it proves).
import { it } from 'vitest';
import { headlessCareer } from './career-headless';

it('the bot plays every event of the Pacific Northwest career and its boss', () => {
  headlessCareer('pacific-northwest');
}, 600_000);
