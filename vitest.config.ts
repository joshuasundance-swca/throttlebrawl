import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// `npm test` runs the unit project (tests beside the code); `npm run test:sim` runs the seeded
// race batch under tests/sim/ (docs/engineering.md, npm scripts).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tools/**/*.test.ts'],
            environment: 'node',
          },
        },
        {
          extends: true,
          test: { name: 'sim', include: ['tests/sim/**/*.test.ts'], environment: 'node' },
        },
      ],
    },
  }),
);
