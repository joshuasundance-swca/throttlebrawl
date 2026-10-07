// The self-test race for the build's Node side (vite.config.ts bakes its result into
// `virtual:selftest-expected`). In the browser, boot fetches the base pack's hand-made Keys road
// data before anything reads the base pack (src/content/base-pack.ts, run W-S); here it comes from
// disk first, the same files, so the baked hash is the one `?selftest=1` computes on the phone. The
// systems' steps are a lazy chunk in the game (src/sim/late.ts): they load as this module loads, since
// Vite's module runner closes once the import returns.
import { provideBaseRoadsFromDisk } from '../src/content/base-pack-whole';
import { runSelfTestRace as run, type SelfTestRaceResult } from '../src/dev/selftest/race';
import { loadSimSteps } from '../src/sim/api';

await loadSimSteps();

export function runSelfTestRace(): SelfTestRaceResult {
  provideBaseRoadsFromDisk();
  return run();
}
