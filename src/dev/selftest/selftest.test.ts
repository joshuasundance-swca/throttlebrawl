import { describe, expect, it } from 'vitest';
import { runSelfTest, selfTestRequested } from './index';
import { createSelfTestRace, runSelfTestRace, SELFTEST_TICKS, selfTestConfig } from './race';

describe('dev/selftest: the fixed self-test race', () => {
  it('puts every rider on the in-sim AI (never the BotController) and has no player slot', () => {
    const config = selfTestConfig();
    expect(config.riders.length).toBeGreaterThan(1);
    for (const r of config.riders) expect(r.controller.kind).not.toBe('player');
    expect(config.playerSlots).toBe(0);
  });

  it('runs a fixed number of ticks and gives the same hash every run', () => {
    const a = runSelfTestRace();
    const b = runSelfTestRace();
    console.log(`self-test race: ${JSON.stringify(a)}`);
    expect(a.ticks).toBe(SELFTEST_TICKS);
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(b).toEqual(a);
  });

  it('gives the same hash when stepped in chunks, as the browser does', () => {
    const race = createSelfTestRace();
    while (!race.step(97)) {
      // keep stepping
    }
    expect(race.result()).toEqual(runSelfTestRace());
  });

  it('reports MATCH, MISMATCH and not-built against the expected result', async () => {
    const actual = runSelfTestRace();
    expect((await runSelfTest({ expected: () => Promise.resolve(actual) })).status).toBe('MATCH');
    const wrong = { ...actual, hash: actual.hash === '00000000' ? '00000001' : '00000000' };
    const mismatch = await runSelfTest({ expected: () => Promise.resolve(wrong) });
    expect(mismatch.status).toBe('MISMATCH');
    expect(mismatch.actual).toBe(actual.hash);
    expect(mismatch.expected).toBe(wrong.hash);
    expect((await runSelfTest({ expected: () => Promise.resolve(null) })).status).toBe('not-built');
  });

  it('is requested by ?selftest=1 only', () => {
    expect(selfTestRequested('?selftest=1')).toBe(true);
    expect(selfTestRequested('?debug=1&selftest=1')).toBe(true);
    expect(selfTestRequested('?selftest=0')).toBe(false);
    expect(selfTestRequested('')).toBe(false);
  });
});
