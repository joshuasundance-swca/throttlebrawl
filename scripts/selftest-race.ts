// The self-test race for the build's Node side (vite.config.ts bakes its result into
// `virtual:selftest-expected`). In the browser, boot fetches the base pack's hand-made Keys road
// data before anything reads the base pack (src/content/base-pack.ts, run W-S); here it comes from
// disk first, the same files, so the baked hash is the one `?selftest=1` computes on the phone.
import { provideBaseRoadsFromDisk } from '../src/content/base-pack-whole';
import { runSelfTestRace as run, type SelfTestRaceResult } from '../src/dev/selftest/race';

export function runSelfTestRace(): SelfTestRaceResult {
  provideBaseRoadsFromDisk();
  return run();
}
