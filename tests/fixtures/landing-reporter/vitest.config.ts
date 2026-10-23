import { defineConfig } from 'vitest/config';
import path from 'node:path';
import LandingReporter from '../../landing-reporter.ts';
import { files } from './inventory.ts';
import type { Reporter, Vitest } from 'vitest/node';
const root = path.resolve(import.meta.dirname, '../../..');
const cache = process.env.LANDING_FIXTURE_CACHE;
if (!cache) throw new Error('Fixture cache directory must be explicit');
const scenario = process.env.LANDING_FIXTURE_SCENARIO;
const source = {
  files,
  inventoryModule:
    scenario === 'import-failure'
      ? 'tests/fixtures/landing-reporter/NOT-PRESENT.ts'
      : 'tests/fixtures/landing-reporter/inventory.ts',
};
const reporter =
  process.env.LANDING_FIXTURE_KIND === 'sidewalk'
    ? new LandingReporter(undefined, source)
    : new LandingReporter(source);
if (scenario === 'missing-end-hook') Object.assign(reporter, { onTestRunEnd: undefined });
// Trigger native interruption through its public API after cancellation listeners are installed.
class Interrupt implements Reporter {
  private vitest: Vitest | undefined;
  onInit(vitest: Vitest) {
    this.vitest = vitest;
  }
  onTestCaseReady() {
    void this.vitest!.cancelCurrentRun('keyboard-input');
  }
}
export default defineConfig({
  root,
  cacheDir: `${cache}/vite`,
  test: {
    name: 'sim',
    include: files,
    environment: 'node',
    setupFiles: [],
    watch: false,
    maxWorkers: 2,
    fsModuleCachePath: `${cache}/modules`,
    reporters: [
      'default',
      ...(scenario === 'no-reporter' ? [] : [reporter]),
      ...(scenario === 'interrupted' ? [new Interrupt()] : []),
    ],
  },
});
