// dev: the test handle, the bot, the perf probe, the self-test and the debug report
// (docs/architecture.md, "Testing seams"). Only src/main.ts imports this module; it ships in
// production builds, but the test handle exists only behind the test flag, the perf overlay only
// with `?debug=1` and the self-test only with `?selftest=1`. dev-1, dev-2 and dev-3 own the
// sub-folders after app-1.
import type { AppHandle } from '../app';
import { installTestHandle, testFlagSet } from './handle';
import { createPerfProbe, debugRequested, mountDebugOverlay } from './perf';
import { installErrorCapture } from './report';

// createStubBot (the skeleton's lane follower) stays exported: lanes' scenario tests import it.
export { blankActions, botInput, createBot, createStubBot } from './bot';
export type { BotController, BotStats, StubBot } from './bot';
export {
  copyReport,
  debugFileText,
  gatherReport,
  installErrorCapture,
  parseDebugFile,
  reportText,
  saveDebugFile,
} from './report';
export { createPerfProbe, debugRequested, formatOverlay, percentiles } from './perf';
export type { PerfProbe, PerfReport, Percentiles } from './perf';
// The self-test is a lazy chunk (only `?selftest=1` loads it): import it from './selftest'.
export type { SelfTestResult, SelfTestStatus } from './selftest';
export { botAttackRun, installTestHandle, moverProblem, MOVER_MODES, testFlagSet } from './handle';
export type { AttackRun, AttackRunOptions, RaceChecks, TestHandle } from './handle';

/** Installs whatever the page's flags ask for. */
export function installDev(app: AppHandle): void {
  const search = window.location.search;
  installErrorCapture();
  if (testFlagSet()) installTestHandle(app);
  if (debugRequested(search)) mountDebugOverlay(document, createPerfProbe(app));
  if (search.includes('selftest'))
    void import('./selftest').then((m) => {
      if (m.selfTestRequested(search)) void m.showSelfTest(document, () => app.rendererStats().renderer);
    });
}
