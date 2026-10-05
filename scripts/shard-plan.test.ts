// CI's slice plan (scripts/shard-plan.mjs) and its timing table refresh (scripts/timings.mjs): the
// slices must be a partition of the tier's files whatever the timings say, so a slice can never
// quietly drop a test file.
import { describe, expect, it } from 'vitest';
import {
  batchUsers,
  estimateSeconds,
  planSlices,
  planTier,
  presetUsers,
  readTimings,
  TIERS,
  unmeasured,
} from './shard-plan.mjs';
import { timedOrder } from '../tests/sequencer';
import { parseLog } from './timings.mjs';

const timings = readTimings() as {
  unit?: Record<string, number>;
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
    for (const tier of ['unit', 'sim', 'e2e'] as const) {
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

  it('counts a file with no measured time as the mean file, never as zero or the median', () => {
    // Most files are quick and a few are slow, so the median is far below what a new file costs
    // (the geometry sweeps: median 9.5 s, the new files 32 to 86 s on CI). The mean is not.
    const plan = planSlices({
      files: ['a', 'b', 'c', 'new'],
      seconds: { a: 2, b: 2, c: 56 },
      n: 2,
      workers: 1,
    });
    expectPartition(['a', 'b', 'c', 'new'], plan);
    expect(plan.map((s) => s.predicted).sort((x, y) => x - y)).toEqual([24, 56]);
    expect(estimateSeconds([2, 2, 56])).toBe(20);
    expect(estimateSeconds([])).toBe(1);
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

  it('charges every batch reader its own measured time, not only the longest one', () => {
    // A reader's measured time already includes its wait for the batch, and the readers wait side
    // by side, so the slice is the readers' makespan. Main run 37157149149 (sim 1/4): the plan said
    // 387 s, the slice took 537 s, because the other 14 readers (about 900 s of work) counted as 0.
    const plan = planSlices({
      files: ['r1', 'r2', 'r3', 'r4'],
      seconds: { r1: 300, r2: 280, r3: 240, r4: 160 },
      n: 1,
      workers: 3,
      order: 'longest-first',
      together: ['r1', 'r2', 'r3', 'r4'],
    });
    expect(plan[0]?.predicted).toBe(400);
  });

  it('starts the preset batch readers first, so the Easy and Hard batches compute beside the Normal one', () => {
    // Until 2026-10-05 the readers started longest first: the three longest all waited about 280 s
    // for the Normal batch, and only then did the Easy and Hard batches start (about 120 s each), so
    // the reader slice took 517 s on #475's run. Started first, the two preset readers compute Easy
    // and Hard while a third worker computes Normal. tests/sequencer.ts starts them in this order, and
    // the plan simulates the same order, so its prediction is the runner's. (With fixed per-file
    // times the order can only look the same or worse; the gain is the shorter waits, which the next
    // measured times carry.)
    const files = ['normal', 'easy-hard1', 'easy-hard2'];
    const seconds = { normal: 300, 'easy-hard1': 100, 'easy-hard2': 100 };
    const base = { files, seconds, n: 1, workers: 2, order: 'longest-first' as const, together: files };
    // Longest first: normal and easy-hard1 at 0, easy-hard2 at 100, ending at 300.
    expect(planSlices(base)[0]?.predicted).toBe(300);
    // Preset readers first: easy-hard1 and easy-hard2 at 0, normal at 100, ending at 400.
    expect(planSlices({ ...base, first: ['easy-hard1', 'easy-hard2'] })[0]?.predicted).toBe(400);
  });

  it('finds the preset batch readers by their source, apart from the Normal batch readers', () => {
    const src: Record<string, string> = {
      'a.test.ts': 'beforeAll(async () => { batch = await simBatch(); });',
      'b.test.ts':
        "[easy, hard, normal] = await Promise.all([presetBatch('easy'), presetBatch('hard'), simBatch()]);",
      'c.test.ts': "import { runSeededRace } from './batch';",
    };
    expect(presetUsers(Object.keys(src), (f: string) => src[f] ?? '')).toEqual(['b.test.ts']);
  });

  it('leaves the last slice room for perf (lastExtra)', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f'];
    const seconds = Object.fromEntries(files.map((f) => [f, 10]));
    const plan = planSlices({ files, seconds, n: 2, workers: 1, lastExtra: 40 });
    expect(plan[1]?.files.length).toBeLessThan(plan[0]?.files.length ?? 0);
    expect(plan[1]?.predicted).toBeGreaterThanOrEqual(40);
  });

  it('names the files the table has no time for, and what each was planned as', () => {
    const table = { sim: { 'tests/sim/a.test.ts': 10, 'tests/sim/b.test.ts': 30 } };
    const files = ['tests/sim/b.test.ts', 'tests/sim/new.test.ts', 'tests/sim/a.test.ts'];
    expect(unmeasured('sim', files, { timings: table })).toEqual({
      files: ['tests/sim/new.test.ts'],
      seconds: 20,
    });
    expect(unmeasured('e2e', ['tests/e2e/x.spec.ts'], { timings: table })).toEqual({
      files: ['tests/e2e/x.spec.ts'],
      seconds: 1,
    });
    expect(unmeasured('sim', ['tests/sim/a.test.ts'], { timings: table }).files).toEqual([]);
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
    expect(Object.keys(TIERS).sort()).toEqual(['e2e', 'sim', 'unit']);
  });
});

describe('tests/sequencer.ts timedOrder', () => {
  it('starts the preset batch readers, then each tabled project longest first, and keeps project order', () => {
    const files = [
      { project: 'unit', file: 'src/quick.test.ts' },
      { project: 'unit', file: 'tools/gis/region-routes.test.ts' },
      { project: 'unit', file: 'src/untabled.test.ts' },
      { project: 'sim', file: 'tests/sim/long.test.ts' },
      { project: 'sim', file: 'tests/sim/presets.test.ts' },
      { project: 'sim', file: 'tests/sim/mid.test.ts' },
    ];
    const table = {
      unit: { 'src/quick.test.ts': 1, 'tools/gis/region-routes.test.ts': 300 },
      sim: { 'tests/sim/long.test.ts': 300, 'tests/sim/presets.test.ts': 150, 'tests/sim/mid.test.ts': 200 },
    };
    const read = (f: string) => (f.endsWith('presets.test.ts') ? "await presetBatch('easy');" : '');
    expect(timedOrder(files, (x) => x, table, read).map((x) => x.file)).toEqual([
      // The unit table (2026-10-05): the slowest file first; an untabled one counts as the mean.
      'tools/gis/region-routes.test.ts',
      'src/untabled.test.ts',
      'src/quick.test.ts',
      // The sim project: the preset reader first, then longest first.
      'tests/sim/presets.test.ts',
      'tests/sim/long.test.ts',
      'tests/sim/mid.test.ts',
    ]);
  });

  it("keeps the runner's own order for a project with no table", () => {
    const files = [
      { project: 'other', file: 'b.test.ts' },
      { project: 'other', file: 'a.test.ts' },
    ];
    expect(
      timedOrder(
        files,
        (x) => x,
        {},
        () => '',
      ).map((x) => x.file),
    ).toEqual(['b.test.ts', 'a.test.ts']);
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

  it('reads the unit project’s per-file lines into their own table, apart from the sim batch', () => {
    // The unit job's slowest file (tools/gis/region-routes.test.ts, 337 s on #475's run) started
    // 74 s into the run in Vitest's own order; with a unit table the sequencer starts it first.
    const log = [
      'unit\tUNKNOWN STEP\t2026-10-05T01:53:01Z  ^[[32m✓^[[39m ^[[30m^[[42m unit ^[[49m^[[39m src/sim/ai/ai.test.ts ^[[2m(^[[22m^[[2m39 tests^[[22m^[[2m)^[[22m^[[33m 3655^[[2mms^[[22m^[[39m',
      'unit\tUNKNOWN STEP\t2026-10-05T01:53:02Z  \u001b[32m✓\u001b[39m \u001b[30m\u001b[42m unit \u001b[49m\u001b[39m tools/gis/region-routes.test.ts \u001b[2m(\u001b[22m\u001b[2m30 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 337100\u001b[2mms\u001b[22m\u001b[39m',
      'unit\tUNKNOWN STEP\t2026-10-05T01:53:03Z  ^[[31m×^[[39m ^[[30m^[[42m unit ^[[49m^[[39m scripts/notes.test.ts ^[[2m(^[[22m^[[2m12 tests | 1 failed^[[22m^[[2m)^[[22m^[[33m 812^[[2mms^[[22m^[[39m',
      // A test line inside a file (indented, no file path) is not a file's time.
      'unit\tUNKNOWN STEP\t2026-10-05T01:53:04Z      ^[[33m^[[2m✓^[[22m^[[39m down the shortcut: one stamp^[[33m 429^[[2mms^[[22m^[[39m',
    ].join('\n');
    const got = parseLog(log);
    expect(got.unit).toEqual({
      'src/sim/ai/ai.test.ts': 3.655,
      'tools/gis/region-routes.test.ts': 337.1,
      'scripts/notes.test.ts': 0.812,
    });
    expect(got.sim).toEqual({});
  });
});
