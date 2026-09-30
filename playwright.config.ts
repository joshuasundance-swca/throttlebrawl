import { defineConfig } from '@playwright/test';

// Browser tiers (docs/engineering.md, "The gate"). By default the tests run against the
// production build served by `vite preview`. E2E_BASE_URL points them at a deployed build
// instead, such as the staging Space.
const externalUrl = process.env.E2E_BASE_URL;
const previewUrl = 'http://127.0.0.1:4173/';

export default defineConfig({
  outputDir: 'test-results/output',
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Every spec renders WebGL in software (SwiftShader), which is CPU-hungry and multithreaded, and
  // several specs time real presses and frames. Playwright's default (half the logical CPUs) ran
  // 12 of them at once on a 24-thread dev machine and starved them: wall-clock specs failed at
  // random while CI (4 vCPUs, so 2 workers) stayed green. Locally we cap it at 4; CI keeps its
  // default. [default] (M1 skeptic, mustFix 2)
  ...(process.env.CI ? {} : { workers: 4 }),
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    baseURL: externalUrl ?? previewUrl,
    // Phone landscape, at device pixel ratio 1 so CI numbers are comparable.
    viewport: { width: 915, height: 412 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    // CI renders WebGL in software; harmless where a GPU exists.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    { name: 'perf', testDir: 'tests/perf' },
  ],
  ...(externalUrl
    ? {}
    : {
        webServer: {
          command: 'npm run preview',
          url: previewUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
});
