import { defineConfig, mergeConfig } from 'vitest/config';
import TimedSequencer from './tests/sequencer.ts';
import viteConfig from './vite.config.ts';

// `npm test` runs the unit project (tests beside the code); `npm run test:sim` runs the seeded
// race batch under tests/sim/ (docs/engineering.md, npm scripts).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // The sim files start longest first, by their measured CI seconds (tests/timings.json), so a
      // long file never starts last; the unit project keeps Vitest's own order. [default]
      sequence: { sequencer: TimedSequencer },
      projects: [
        {
          extends: true,
          // 20 s, not Vitest's 5 s default. The pre-push hook runs this project, often while other
          // lanes' worktrees build and test on the same dev machine. Under that load, passing tests
          // with no timeout of their own (selftest, lint-rules, peds) took 6 to 9 s and failed
          // pushes at random, while CI stayed green. 20 s leaves about twice the slowest time seen
          // (8.9 s, 2026-09-30), and a real hang still fails. Tests that are slow by design keep
          // their own larger timeouts. [default]
          test: {
            name: 'unit',
            include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tools/**/*.test.ts'],
            environment: 'node',
            testTimeout: 20_000,
          },
        },
        {
          extends: true,
          // Sim tests run whole seeded races (the full field, traffic both ways, pedestrians), which
          // take several seconds each on a CI runner: Vitest's 5 s default timed out a passing replay
          // test on main (5.8 s). Raised from 60 s to 90 s for the same machine load as the unit
          // project: with parallel lanes running, sim tests with no timeout of their own took up to
          // 26 s (2026-09-30), and they grow as the sim gains systems. Each race still has its own
          // tick cap. Tests and hooks that set their own timeout (ai-rivals' 600 s batch hook) are
          // unaffected. [default]
          test: {
            name: 'sim',
            include: ['tests/sim/**/*.test.ts'],
            environment: 'node',
            testTimeout: 90_000,
          },
        },
      ],
    },
  }),
);
