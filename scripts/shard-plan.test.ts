// CI's slice plan (scripts/shard-plan.mjs) and its timing table refresh (scripts/timings.mjs): the
// slices must be a partition of the tier's files whatever the timings say, so a slice can never
// quietly drop a test file.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  batchUsers,
  collectedOnly,
  estimateSeconds,
  JOB_SHARE,
  overLine,
  planSlices,
  planTier,
  presetUsers,
  readTimings,
  spreadUsers,
  suiteJobs,
  TIERS,
  unmeasured,
} from './shard-plan.mjs';
import { timedOrder } from '../tests/sequencer';
import FileTimes from '../tests/file-times';
import { meanOverheads, parseLog, runnerSeconds, simRuns } from './timings.mjs';

const timings = readTimings() as {
  overhead?: { unit?: number; sim?: number; e2e?: number };
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

  it("keeps every other file out of the batch readers' slice", () => {
    // The readers' slice waits on the Normal batch, computed by one worker: 218 to 375 s from one
    // runner to the next on 2026-10-05, and then the readers' own work. Measured times cannot price
    // that wait well, so other files there only stretch it: on run 37270067041 the plan added 15
    // other files to it, and the slice took 535 s against a plan of 335.
    const plan = planSlices({
      files: ['r1', 'r2', 'x', 'y', 'z'],
      seconds: { r1: 100, r2: 50, x: 200, y: 200, z: 10 },
      n: 2,
      workers: 3,
      order: 'longest-first',
      together: ['r1', 'r2'],
    });
    expect(plan[0]?.files).toEqual(['r1', 'r2']);
    expect(plan[1]?.files).toEqual(['x', 'y', 'z']);
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

  it("prices each unit file's setup and import, which its measured time leaves out", () => {
    // Vitest's per-file line times the tests only. On run 37266882407 the unit slice of 320 files
    // summed 695 s of tests, but Vitest's own split says tests were 73% of its time: about 0.8 s more
    // per file. Planned without it, that slice said 203 s and took 353 s, beside a 156 s slice.
    const files = ['big', ...Array.from({ length: 400 }, (_, i) => `f${String(i).padStart(3, '0')}`)];
    const seconds = Object.fromEntries(files.map((f) => [f, f === 'big' ? 300 : 2]));
    const plan = planTier('unit', files, 2, { timings: { unit: seconds } });
    expect(TIERS.unit.perFile).toBeGreaterThan(0);
    // 400 small files at 2 s are 267 s on 3 workers, which fits beside the 300 s file; at 2.8 s each
    // they are 373 s, so some go to the big file's slice.
    const small = plan.map((s) => s.files.filter((f) => f !== 'big').length);
    expect(Math.min(...small)).toBeGreaterThan(0);
    // The job's own setup (overhead) is the same for every slice; the files' share is what is balanced.
    const files_ = (s: { predicted: number }) => s.predicted - TIERS.unit.overhead;
    for (const s of plan) expect(files_(s)).toBeLessThanOrEqual(301);
    expect(files_(plan.find((s) => s.files.includes('big')) ?? { predicted: 0 })).toBe(301);
  });

  // Vitest's per-file time leaves out a file's collection, and 8 sim files race at describe time
  // (app-cast-and-law, riders-race, ...), so the table times them at 0 s. Priced at 0 s they all went
  // to one slice: 3/6 on main took 590 to 597 s of 600; 3/7 on #601's run took 488 s against a plan
  // of 340, every other sim slice 200 to 399 s. A sim file timed at 0 s is now planned as the mean.
  it('plans a sim file timed at 0 s as the mean file, so those files no longer all ride one slice', () => {
    const zeros = [
      'tests/sim/z1.test.ts',
      'tests/sim/z2.test.ts',
      'tests/sim/z3.test.ts',
      'tests/sim/z4.test.ts',
    ];
    const sim = {
      'tests/sim/a.test.ts': 100,
      'tests/sim/b.test.ts': 50,
      ...Object.fromEntries(zeros.map((z) => [z, 0])),
    };
    const opts = { timings: { sim, overhead: { sim: 0 } }, read: () => '' };
    // Alone, a 0 s file is planned as the mean of the timed ones (75 s), not as 0.
    expect(planTier('sim', [zeros[0] ?? ''], 1, opts)[0]?.predicted).toBe(75);
    const plan = planTier('sim', Object.keys(sim), 3, opts);
    expect(Math.max(...plan.map((s) => s.files.filter((f) => zeros.includes(f)).length))).toBeLessThan(
      zeros.length,
    );
    expect(collectedOnly(sim)).toEqual({ 'tests/sim/a.test.ts': 100, 'tests/sim/b.test.ts': 50 });
    // A unit file at 0 s is a tiny file, and stays one (perFile prices its setup).
    const [unit] = planTier('unit', ['src/a.test.ts'], 1, {
      timings: { unit: { 'src/a.test.ts': 0, 'src/b.test.ts': 50 }, overhead: { unit: 0 } },
    });
    expect(unit?.predicted).toBe(Math.round(TIERS.unit.perFile));
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

  // A job's own seconds outside its runner: check.mjs's result line for each runner step (the
  // tests, and perf in the last browser slice), never the build, which belongs to the job's setup.
  it("reads the runner steps' seconds from check's result lines, leaving out the build", () => {
    const log = [
      'suite / unit (1/2)\tUNKNOWN STEP\t2026-10-06T09:39:28.1712434Z unit tests (slice 1/2, 211 files)  pass  2772 tests passed (211 files passed) (248.0s)',
      '2026-10-06T09:43:21.2092459Z sim batch (slice 3/6, 29 files)  pass  300 tests passed (29 files passed) (479.7s)',
      '2026-10-06T09:43:00.6089375Z build                      pass  672 files in dist/, 10.32 MB (6.7s)',
      '2026-10-06T09:43:00.6090401Z e2e (slice 7/7, 10 files)  pass  45 browser tests passed (316.2s)',
      '2026-10-06T09:43:00.6092889Z perf                       pass  672 dist files: first-load JavaScript 471.2 KB gzip (budget 500 KB) (110.7s)',
      '2026-10-06T09:43:00.6092889Z e2e (slice 2/7, 3 files)  FAIL  1 of 9 browser tests failed (61.5s)',
      '2026-10-06T09:43:00.6092889Z > playwright test --project=e2e tests/e2e/a.spec.ts',
    ];
    expect(runnerSeconds(log[0] ?? '')).toBeCloseTo(248);
    expect(runnerSeconds(log[1] ?? '')).toBeCloseTo(479.7);
    expect(runnerSeconds(log.slice(2, 5).join('\n'))).toBeCloseTo(426.9);
    expect(runnerSeconds(log.slice(5).join('\n'))).toBeCloseTo(61.5);
    expect(runnerSeconds('')).toBe(0);
  });

  it('averages each tier’s job-minus-runner seconds, and names a browser job e2e', () => {
    expect(
      meanOverheads([
        { tier: 'unit', seconds: 264, ran: 248.8 },
        { tier: 'unit', seconds: 227, ran: 208.2 },
        { tier: 'browser', seconds: 391, ran: 335.6 },
        { tier: 'sim', seconds: 597, ran: 579 },
        { tier: 'sim', seconds: 100, ran: 0 },
      ]),
    ).toEqual({ unit: 17, sim: 18, e2e: 55 });
    expect(meanOverheads([])).toEqual({});
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

// Vitest's per-file line times a file's tests and hooks only, not its collection (the import and
// the describe callbacks). Eight sim files race at describe time (app-cast-and-law, riders-race and
// six more), so on main run 37457079930 (2026-10-06) Vitest timed them at 4 to 30 ms, and the
// table at 0 s, while sim slice 2/7, which ran seven of them, took 280 s. tests/file-times.ts prints
// each sim file's whole time on its worker (collect + tests), and timings.mjs takes that line.
describe('whole sim file times (tests/file-times.ts)', () => {
  const vitestLine = (file: string, ms: number) =>
    `suite / sim (2/7)\tUNKNOWN STEP\t2026-10-06T11:37:41.79Z  ^[[32m✓^[[39m ^[[30m^[[43m sim ^[[49m^[[39m ${file} ^[[2m(^[[22m^[[2m9 tests^[[22m^[[2m)^[[22m^[[33m ${ms}^[[2mms^[[22m^[[39m`;
  const logged = (project: string, file: string, collectDuration: number, duration: number) => {
    const lines: string[] = [];
    const reporter = new FileTimes();
    reporter.onInit({ logger: { log: (s: string) => lines.push(s) } } as never);
    reporter.onTestModuleEnd({
      project: { name: project, config: { root: '/repo' } },
      moduleId: `/repo/${file}`,
      diagnostic: () => ({ collectDuration, duration }),
    } as never);
    return lines;
  };

  it('prints a sim file’s collect and test time, and timings.mjs reads it over Vitest’s line', () => {
    const lines = logged('sim', 'tests/sim/riders-race.test.ts', 45_260, 7);
    expect(lines).toHaveLength(1);
    const log = [
      vitestLine('tests/sim/riders-race.test.ts', 7),
      `suite / sim (2/7)\tUNKNOWN STEP\t2026-10-06T11:38:30.20Z ${lines[0]}`,
      vitestLine('tests/sim/dev-presets.test.ts', 287_662),
    ].join('\n');
    const got = parseLog(log);
    expect(got.sim['tests/sim/riders-race.test.ts']).toBeCloseTo(45.27, 1);
    // A file with no whole-file line (an old log) keeps Vitest's own time.
    expect(got.sim['tests/sim/dev-presets.test.ts']).toBeCloseTo(287.662);
    expect(got.simWhole).toBe(1);
    expect(parseLog(vitestLine('tests/sim/a.test.ts', 5)).simWhole).toBe(0);
  });

  it('prints nothing for a unit file (the unit table is not sliced by whole-file time)', () => {
    expect(logged('unit', 'src/sim/ai/ai.test.ts', 900, 3655)).toEqual([]);
  });

  it('averages sim only over runs that printed whole-file times, when any did', () => {
    const old = { sim: { 'tests/sim/a.test.ts': 0, 'tests/sim/b.test.ts': 10 }, simWhole: 0 };
    const fresh = { sim: { 'tests/sim/a.test.ts': 40, 'tests/sim/b.test.ts': 12 }, simWhole: 2 };
    expect(simRuns([old, fresh])).toEqual([fresh]);
    // Logs from before tests/file-times.ts: Vitest's lines, as before.
    expect(simRuns([old, old])).toEqual([old, old]);
  });

  it('the checked-in table times no sim file at 0 s', () => {
    const zeros = Object.entries(timings.sim ?? {})
      .filter(([, s]) => !(s > 0))
      .map(([f]) => f);
    expect(zeros).toEqual([]);
  });
});

// A job is more than its test files: a browser slice spent 40 to 70 s on checkout, npm ci, the
// browser install, the build and listing its files before its first test, and a sim or unit slice
// 11 to 25 s (main and train runs of 2026-10-06, scratch/c2/jobs.mjs's job-minus-runner seconds).
// Planning test seconds alone put browser slices at 355 s that took 410 to 533 s as jobs (run
// 37439710625), and sim slice 3/6 at 386 s that took 590 to 597 s of its 600 (runs 37435436811,
// 37439710625). So a slice is planned as its whole job, and every slice of the checked-in table must
// fit JOB_SHARE of its job's timeout-minutes in suite.yml, the rest being room for a slow runner.
describe('whole jobs against their timeouts', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const suite = readFileSync(path.join(root, '.github', 'workflows', 'suite.yml'), 'utf8');

  it("plans a slice as its whole job: the runner's files plus the job's own setup (overhead)", () => {
    const base = { files: ['a', 'b', 'c'], seconds: { a: 100, b: 100, c: 50 }, n: 2, workers: 1 };
    expect(
      planSlices(base)
        .map((s) => s.predicted)
        .sort((x, y) => x - y),
    ).toEqual([100, 150]);
    expect(
      planSlices({ ...base, overhead: 40 })
        .map((s) => s.predicted)
        .sort((x, y) => x - y),
    ).toEqual([140, 190]);
    // The overhead is the same for every slice, so it never moves a file.
    expect(planSlices({ ...base, overhead: 40 }).map((s) => s.files)).toEqual(
      planSlices(base).map((s) => s.files),
    );
  });

  it("prices each tier's setup from measured jobs, and planTier adds it", () => {
    // The smallest job-minus-runner seconds seen on 2026-10-06 (eight green runs): unit 11, sim 11.8,
    // browser 37. The table's own (written by scripts/timings.mjs) comes first; TIERS is the fallback.
    expect(TIERS.unit.overhead).toBeGreaterThanOrEqual(11);
    expect(TIERS.sim.overhead).toBeGreaterThanOrEqual(11);
    expect(TIERS.e2e.overhead).toBeGreaterThanOrEqual(37);
    expect(timings.overhead?.unit).toBeGreaterThanOrEqual(11);
    expect(timings.overhead?.sim).toBeGreaterThanOrEqual(11);
    expect(timings.overhead?.e2e).toBeGreaterThanOrEqual(37);
    const [own] = planTier('sim', ['tests/sim/a.test.ts'], 1, {
      timings: { sim: { 'tests/sim/a.test.ts': 100 }, overhead: { sim: 30 } },
      read: () => '',
    });
    expect(own?.predicted).toBe(130);
    for (const tier of ['unit', 'sim', 'e2e'] as const) {
      const file = tier === 'e2e' ? 'tests/e2e/a.spec.ts' : 'tests/sim/a.test.ts';
      const [only] = planTier(tier, [file], 1, { timings: { [tier]: { [file]: 100 } }, read: () => '' });
      const perFile = 'perFile' in TIERS[tier] ? TIERS.unit.perFile : 0;
      expect(only?.predicted, tier).toBe(Math.round(100 + perFile + TIERS[tier].overhead));
    }
  });

  // tests/e2e/ui-settings.spec.ts runs its tests in parallel (`test.describe.configure({ mode:
  // 'parallel' })`), so its 486.6 s of summed test times (train run 37442774709) ran in 258 s of
  // its slice on Playwright's two workers. Planned as one worker's file, it put its slice at 537 s.
  it("spreads a parallel-mode spec's tests over the runner's workers", () => {
    const base = { files: ['p.spec.ts'], seconds: { 'p.spec.ts': 200 }, n: 1, workers: 2 };
    expect(planSlices(base)[0]?.predicted).toBe(200);
    expect(planSlices({ ...base, spread: ['p.spec.ts'] })[0]?.predicted).toBe(100);
    // Beside a serial file it still fills both workers: 100 + 2 x 100 on two workers.
    const both = {
      ...base,
      files: ['a.spec.ts', 'p.spec.ts'],
      seconds: { 'a.spec.ts': 100, 'p.spec.ts': 200 },
    };
    expect(planSlices({ ...both, spread: ['p.spec.ts'] })[0]?.predicted).toBe(200);
    expect(planSlices({ ...both, n: 2, spread: ['p.spec.ts'] }).map((s) => s.predicted)).toEqual([100, 100]);
  });

  it('finds the parallel-mode specs by their source, and planTier spreads them', () => {
    const src: Record<string, string> = {
      'tests/e2e/p.spec.ts': "test.describe.configure({ mode: 'parallel' });",
      'tests/e2e/s.spec.ts': "test.describe.configure({ mode: 'serial' });",
      'tests/e2e/q.spec.ts': "test('one', async () => {});",
    };
    const read = (f: string) => src[f] ?? '';
    expect(spreadUsers(Object.keys(src), read)).toEqual(['tests/e2e/p.spec.ts']);
    const [only] = planTier('e2e', ['tests/e2e/p.spec.ts'], 1, {
      timings: { e2e: { 'tests/e2e/p.spec.ts': 200 } },
      read,
    });
    expect(only?.predicted).toBe(100 + TIERS.e2e.overhead);
    // The real spec that does it today.
    expect(spreadUsers(['tests/e2e/ui-settings.spec.ts'])).toEqual(['tests/e2e/ui-settings.spec.ts']);
  });
  it("reads each sliced job's slice count and timeout from suite.yml", () => {
    const fixture = [
      'jobs:',
      '  static:',
      '    timeout-minutes: ${{ inputs.full && 4 || 5 }}',
      '  unit:',
      '    timeout-minutes: 8',
      '    strategy:',
      '      matrix:',
      '        shard: [1, 2]',
      '  sim:',
      '    timeout-minutes: 10',
      '    strategy:',
      '      matrix:',
      '        shard: [1, 2, 3, 4, 5, 6, 7]',
      '  browser:',
      '    timeout-minutes: 12',
      '    strategy:',
      '      matrix:',
      '        shard: [1, 2, 3]',
      '',
    ].join('\n');
    expect(suiteJobs(fixture)).toEqual({
      unit: { slices: 2, timeout: 480 },
      sim: { slices: 7, timeout: 600 },
      e2e: { slices: 3, timeout: 720 },
    });
    expect(() => suiteJobs(fixture.replace('  sim:', '  simulation:'))).toThrow(/sim/);
    const real = suiteJobs(suite);
    for (const tier of ['unit', 'sim', 'e2e'] as const) {
      expect(real[tier].slices, tier).toBeGreaterThan(0);
      expect(real[tier].timeout, tier).toBeGreaterThanOrEqual(300);
    }
  });

  it('names every slice over its line, and only those', () => {
    const plan = [
      { files: ['a'], predicted: 420 },
      { files: ['b'], predicted: 421 },
      { files: ['c'], predicted: 100 },
    ];
    expect(JOB_SHARE).toBe(0.7);
    expect(overLine(plan, 600)).toEqual([{ slice: 2, predicted: 421, line: 420 }]);
    expect(overLine(plan, 1000)).toEqual([]);
  });

  // The checked-in table, sliced as suite.yml slices it: what CI's next run plans. The files are
  // the table's own (those still on disk), so only a refresh of the table, the slice counts or the
  // timeouts can move this, never an unrelated new test file (CI warns about those).
  it.each(['unit', 'sim', 'e2e'] as const)(
    'plans every %s slice of the checked-in table within its share of the timeout',
    (tier) => {
      const jobs = suiteJobs(suite);
      const files = Object.keys(timings[tier] ?? {}).filter((f) => existsSync(path.join(root, f)));
      expect(files.length, `tests/timings.json has ${tier} files on disk`).toBeGreaterThan(10);
      const plan = planTier(tier, files, jobs[tier].slices);
      const over = overLine(plan, jobs[tier].timeout);
      expect(
        over,
        `${tier}: planned job seconds ${plan.map((s) => s.predicted).join(' / ')} against a line of ${Math.round(jobs[tier].timeout * JOB_SHARE)} s`,
      ).toEqual([]);
    },
  );
});
