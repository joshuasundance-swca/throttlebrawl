// dev: the test handle, the bot, the perf probe, the self-test and the debug report
// (docs/architecture.md, "Testing seams"). Only src/main.ts imports this module; it ships in
// production builds, but the test handle exists only behind the test flag. dev-1, dev-2 and dev-3
// own the sub-folders after app-1.
import type { AppHandle } from '../app';
import { installTestHandle, testFlagSet } from './handle';

export { createStubBot } from './bot';
export type { BotController } from './bot';
export { copyReport, reportText } from './report';
export { runSelfTest, selfTestRequested } from './selftest';
export type { SelfTestResult, SelfTestStatus } from './selftest';
export { installTestHandle, testFlagSet } from './handle';
export type { RaceChecks, TestHandle } from './handle';

/** Installs whatever the page's flags ask for. */
export function installDev(app: AppHandle): void {
  if (testFlagSet()) installTestHandle(app);
}
