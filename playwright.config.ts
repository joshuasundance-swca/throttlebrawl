import { defineConfig } from '@playwright/test';
import { resolvePreviewPort } from './scripts/preview-port.mjs';

// Browser tiers (docs/engineering.md, "The gate"). By default the tests run against the
// production build served by `vite preview`. E2E_BASE_URL points them at a deployed build
// instead, such as the game Space.
const externalUrl = process.env.E2E_BASE_URL;
// Locally each run gets its own free port, so parallel lane worktrees never test each other's
// build; CI keeps 4173, and PREVIEW_PORT picks one by hand (scripts/preview-port.mjs). The choice
// goes into PREVIEW_PORT because Playwright's workers load this file again: they inherit the
// runner's environment, so they read the same port instead of picking a new one.
const preview = await resolvePreviewPort();
process.env.PREVIEW_PORT = String(preview.port);
const previewUrl = `http://127.0.0.1:${preview.port}/`;

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
          // --port overrides vite.config.ts's 4173; strictPort there still fails loudly if taken.
          command: `npm run preview -- --port ${preview.port}`,
          url: previewUrl,
          // Reuse only a server someone pointed us at by hand. A free port has nothing to reuse,
          // and reusing the fixed port is how lanes ended up testing another worktree's build.
          reuseExistingServer: preview.source === 'env',
          timeout: 60_000,
        },
      }),
});
