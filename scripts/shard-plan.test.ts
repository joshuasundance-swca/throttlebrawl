// CI's slice plan (scripts/shard-plan.mjs) and its timing table refresh (scripts/timings.mjs): the
// slices must be a partition of the tier's files whatever the timings say, so a slice can never
// quietly drop a test file.
import { describe, expect, it } from 'vitest';
import { batchUsers, planSlices, planTier, readTimings, TIERS } from './shard-plan.mjs';
import { parseLog } from './timings.mjs';

const timings = readTimings() as {
  sim?: Record<string, number>;
  e2e?: Record<string, number>;
  perf?: number;
};

function expectPartition(files: string[], slices: { files: string[] }[]) {
  const seen = slices.flatMap((s) => s.files);
  expect(new Set(seen).size, 'no file in two slices').toBe(seen.length);
  expect([...seen].sort()).toEqual([...new Set(files)].sort());
}

describe('planSlices', () => {
  it('puts every file in exactly one slice, for every slice count, with real and unknown timings', () => {
    for (const tier of ['sim', 'e2e'] as const) {
      const table = timings[tier] ?? {};
      const files = [
        ...Object.keys(table),
        `tests/${tier}/brand-new-a.test.ts`,
        `tests/${tier}/brand-new-b.test.ts`,
      ];
      expect(Object.keys(table).length, `tests/timings.json has ${tier} times`).toBeGreaterThan(10);
      for (let n = 1; n <= 8; n++) {
        const plan = planTier(tier, files, n, { timings, read: () => '' });
        expect(plan).toHaveLength(n);
        expectPartition(files, plan);
        for (const s of plan) expect(s.files.length, `${tier} n=${n}: no empty slice`).toBeGreaterThan(0);
      }
    }
  });

  it('gives the same slices for the same files in any order (every runner plans alone)', () => {
    const files = Object.keys(timings.e2e ?? {});
    const a = planTier('e2e', files, 4, { timings });
    const b = planTier('e2e', [...files].reverse(), 4, { timings });
    expect(b).toEqual(a);
  });

  it('balances by seconds: two long files go to different slices', () => {
    const plan = planSlices({
      files: ['a', 'b', 'c', 'd', 'long1', 'long2'],
      seconds: { a: 1, b: 1, c: 1, d: 1, long1: 100, long2: 100 },
      n: 2,
      workers: 1,
    });
    expect(plan.map((s) => s.files.filter((f) => f.startsWith('long')).length)).toEqual([1, 1]);
    expect(plan.map((s) => s.predicted)).toEqual([102, 102]);
  });

  it('counts a file with no measured time as the median file, never as zero', () => {
    const plan = planSlices({
      files: ['a', 'b', 'c', 'new'],
      seconds: { a: 10, b: 10, c: 10 },
      n: 2,
      workers: 1,
    });
    expectPartition(['a', 'b', 'c', 'new'], plan);
    expect(plan.map((s) => s.predicted).sort()).toEqual([20, 20]);
  });

  it('keeps the batch readers in one slice, the first, ahead of the rest', () => {
    const plan = planSlices({
      files: ['r1', 'r2', 'r3', 'x', 'y', 'z'],
      seconds: { r1: 50, r2: 5, r3: 5, x: 20, y: 20, z: 20 },
      n: 2,
      workers: 2,
      together: ['r1', 'r2', 'r3'],
    });
    expect(plan[0]?.files).toEqual(expect.arrayContaining(['r1', 'r2', 'r3']));
    expect(plan[1]?.files).not.toEqual(expect.arrayContaining(['r1']));
    expectPartition(['r1', 'r2', 'r3', 'x', 'y', 'z'], plan);
  });

  it('leaves the last slice room for perf (lastExtra)', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f'];
    const seconds = Object.fromEntries(files.map((f) => [f, 10]));
    const plan = planSlices({ files, seconds, n: 2, workers: 1, lastExtra: 40 });
    expect(plan[1]?.files.length).toBeLessThan(plan[0]?.files.length ?? 0);
    expect(plan[1]?.predicted).toBeGreaterThanOrEqual(40);
  });

  it('refuses a slice count that is not a whole number of at least 1', () => {
    for (const n of [0, -1, 1.5, Number.NaN])
      expect(() => planSlices({ files: ['a'], n, workers: 1 })).toThrow(/whole number/);
  });

  it('finds the batch readers by their source, and knows both tiers', () => {
    const src: Record<string, string> = {
      'a.test.ts': 'beforeAll(async () => { batch = await simBatch(); });',
      'b.test.ts': "[easy] = await Promise.all([presetBatch('easy')]);",
      'c.test.ts': "import { runSeededRace } from './batch';",
    };
    expect(batchUsers(Object.keys(src), (f: string) => src[f] ?? '')).toEqual(['a.test.ts', 'b.test.ts']);
    expect(Object.keys(TIERS).sort()).toEqual(['e2e', 'sim']);
  });
});

describe('timings.mjs parseLog', () => {
  it('reads Vitest per-file lines and Playwright per-test lines, colour codes and all', () => {
    const log = [
      'sim (1/2)\tUNKNOWN STEP\t2026-10-01T21:07:44Z  \u001b[32m✓\u001b[39m \u001b[30m\u001b[43m sim \u001b[49m\u001b[39m tests/sim/riders-launch.test.ts \u001b[2m(\u001b[22m\u001b[2m13 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 548\u001b[2mms\u001b[22m\u001b[39m',
      'sim (1/2)\tUNKNOWN STEP\t2026-10-01T21:07:44Z  ^[[32m✓^[[39m ^[[30m^[[43m sim ^[[49m^[[39m tests/sim/dev-presets.test.ts ^[[2m(^[[22m^[[2m6 tests | 1 skipped^[[22m^[[2m)^[[22m^[[33m 287662^[[2mms^[[22m^[[39m\r',
      'browser (1/2)\tUNKNOWN STEP\t2026-10-01T20:40:00Z   ✓   18 [e2e] › tests/e2e/bot-race.spec.ts:116:1 › the bot races to results (2.4m)',
      'browser (1/2)\tUNKNOWN STEP\t2026-10-01T20:40:00Z   ✓   6 [e2e] › tests/e2e/audio-engine.spec.ts:14:1 › energy above 300 Hz (400ms)',
      'browser (1/2)\tUNKNOWN STEP\t2026-10-01T20:40:00Z   ✓   7 [e2e] › tests/e2e/audio-engine.spec.ts:30:1 › another (1.5s)',
      'browser (2/2)\tUNKNOWN STEP\t2026-10-01T20:40:00Z   ✓   1 [perf] › tests/perf/perf.spec.ts:10:1 › perf: draw calls (22.7s)',
      'browser (2/2)\tUNKNOWN STEP\t2026-10-01T20:40:00Z   -  11 [e2e] › tests/e2e/ui-radio-panel.spec.ts:204:1 › skipped, no time',
    ].join('\n');
    const got = parseLog(log);
    expect(got.sim).toEqual({
      'tests/sim/riders-launch.test.ts': 0.548,
      'tests/sim/dev-presets.test.ts': 287.662,
    });
    expect(got.e2e['tests/e2e/bot-race.spec.ts']).toBeCloseTo(144);
    expect(got.e2e['tests/e2e/audio-engine.spec.ts']).toBeCloseTo(1.9);
    expect(got.e2e['tests/e2e/ui-radio-panel.spec.ts']).toBeUndefined();
    expect(got.perf).toBeCloseTo(22.7);
  });
});
