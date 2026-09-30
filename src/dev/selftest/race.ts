// The self-test race (docs/architecture.md, "Testing seams"; M1 dev-2): one fixed seeded race with
// every rider on the in-sim AIController and no player slot, run for a fixed number of ticks. The
// build runs it in Node (vite.config.ts bakes the result into `virtual:selftest-expected`), and
// `?selftest=1` runs it again in the browser: the same hash on the phone means the sim's maths is
// bit-identical there. It never uses the BotController, whose steering maths lives outside the
// determinism rules and could differ between Node and the phone.
//
// Draft content is included, so content that lands as a draft (traffic, today) is exercised too.
import { createHeadlessRace } from '../../app';
import { createSim, hashHex, type Sim, type SimConfig } from '../../sim/api';

export const SELFTEST_SEED = 0x5e1f7e57;
/** 60 s of racing at 60 Hz. */
export const SELFTEST_TICKS = 3600;

export interface SelfTestRaceResult {
  /** Final state hash, 8 hex digits. */
  hash: string;
  ticks: number;
  seed: number;
  /** Movers alive at the end (riders, traffic, pedestrians), as a sanity number. */
  movers: number;
}

/** The self-test race's config: the base event, drafts included, every rider on the AI. */
export function selfTestConfig(): SimConfig {
  const { config } = createHeadlessRace({ seed: SELFTEST_SEED }, { includeDrafts: true });
  return {
    ...config,
    riders: config.riders.map((r) =>
      r.controller.kind === 'player' ? { ...r, controller: { kind: 'ai', style: 'racer' } } : r,
    ),
    playerSlots: 0,
  };
}

export interface SelfTestRace {
  /** Steps up to `n` more ticks; true once the race has run all its ticks (or ended). */
  step(n: number): boolean;
  result(): SelfTestRaceResult;
}

export function createSelfTestRace(): SelfTestRace {
  const sim: Sim = createSim(selfTestConfig());
  const done = () => sim.tick >= SELFTEST_TICKS || sim.isOver();
  return {
    step(n) {
      for (let i = 0; i < n && !done(); i++) sim.step([]);
      return done();
    },
    result: () => ({
      hash: hashHex(sim.hash()),
      ticks: sim.tick,
      seed: SELFTEST_SEED,
      movers: sim.snapshot().entities.length,
    }),
  };
}

/** Runs the whole self-test race at once (the build's Node side). */
export function runSelfTestRace(): SelfTestRaceResult {
  const race = createSelfTestRace();
  race.step(SELFTEST_TICKS);
  return race.result();
}
