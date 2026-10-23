import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestModule, TestSpecification } from 'vitest/node';
import LandingReporter from '../tests/landing-reporter';
import { SIDEWALK_FILES } from '../tests/sim/sidewalk-group.mjs';
import { sidewalkManifest } from '../tests/sim/sidewalk-inventory';
import { assertSidewalk, foldSidewalk, type SidewalkResult } from '../tests/sim/sidewalk-oracle';
import { runSidewalk } from '../tests/sim/sidewalk-survey';
import type { RideResult } from '../tests/sim/sidewalk-ride';

const root = path.resolve(import.meta.dirname, '..');
const manifest = sidewalkManifest();
const count = (n: number, dodged = n) => ({ n, dodged });
const row = (n = 0, dodged = n): SidewalkResult => ({
  ...count(n, dodged),
  types: n ? { 'fixture:thing': { ...count(n, dodged), contact: 0 } } : {},
  hits: [],
});
const good = () => manifest.cases.map((c) => row(c.mode === 'fast' ? 1 : 0));
const oldExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = oldExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sidewalk exact survey inventory and inputs', () => {
  it('retains the original six events, eight fast seeds, and separate seed-one braking rides', () => {
    const regions = {
      keys: ['base:keys-t1-last-light-duval', 'base:keys-t4-hurricane-party'],
      sf: ['region-sf:sf-t1-pier-pressure', 'region-sf:sf-t2-stair-alley'],
      pnw: ['region-pnw:pnw-t1-bridge-city', 'region-pnw:pnw-t1-ferry-line'],
    };
    const expected = (['fast', 'brake'] as const).flatMap((mode) =>
      Object.entries(regions).flatMap(([region, events]) =>
        events.flatMap((eventId) =>
          (mode === 'fast' ? [1, 2, 3, 4, 5, 6, 7, 8] : [1]).map((seed) => ({
            region,
            eventId,
            seed,
            mode,
          })),
        ),
      ),
    );
    expect(manifest.cases.map(({ key: _key, file: _file, ...c }) => c)).toEqual(expected);
    expect(new Set(manifest.cases.map((c) => c.key)).size).toBe(expected.length);
    expect(manifest.files).toEqual(SIDEWALK_FILES);
    for (const file of manifest.files) {
      const cases = manifest.cases.filter((c) => c.file === file);
      expect(new Set(cases.map((c) => c.eventId)).size).toBe(1);
      expect(cases.map((c) => [c.mode, c.seed])).toEqual([
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ['fast', seed]),
        ['brake', 1],
      ]);
    }
  });
  it('passes unchanged ride inputs and retains optional before controls only for fast rides', () => {
    const run = vi.fn(
      () => ({ things: [], thingHits: [], config: { trafficTypes: [] } }) as unknown as RideResult,
    );
    vi.stubEnv('SIDEWALK_BEFORE', '0');
    for (const c of manifest.cases) {
      runSidewalk(c, run);
      expect(run).toHaveBeenLastCalledWith({
        seed: c.seed,
        eventId: c.eventId,
        maxTicks: 4500,
        tuning: { 'riders.furniture': 0 },
        ...(c.mode === 'brake' ? { brakeAtM: 25 } : {}),
      });
    }
    expect(run).toHaveBeenCalledTimes(manifest.cases.length);
    run.mockClear();
    vi.stubEnv('SIDEWALK_BEFORE', '1');
    const fast = manifest.cases.find((c) => c.mode === 'fast')!;
    expect(runSidewalk(fast, run).before).toEqual(count(0));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({
      seed: fast.seed,
      eventId: fast.eventId,
      maxTicks: 4500,
      tuning: { 'riders.furniture': 0, 'traffic.kerbDeep': 0 },
    });
    run.mockClear();
    const brake = manifest.cases.find((c) => c.mode === 'brake')!;
    expect(runSidewalk(brake, run).before).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('retains in-path movement/jump/event dodges, contact diagnostics and the distinct contact classes', () => {
    vi.stubEnv('SIDEWALK_BEFORE', '0');
    const run = () =>
      ({
        things: [
          {
            contentId: 'fixture:dodges',
            inPath: true,
            moved: 0.6,
            jumped: false,
            evented: false,
            contact: true,
          },
          {
            contentId: 'fixture:dodges',
            inPath: true,
            moved: 0,
            jumped: true,
            evented: false,
            contact: false,
          },
          {
            contentId: 'fixture:yields',
            inPath: true,
            moved: 0,
            jumped: false,
            evented: true,
            contact: false,
          },
          {
            contentId: 'fixture:solid',
            inPath: true,
            moved: 0,
            jumped: false,
            evented: false,
            contact: false,
          },
          {
            contentId: 'fixture:solid',
            inPath: false,
            moved: 1,
            jumped: false,
            evented: false,
            contact: false,
          },
        ],
        thingHits: ['dodges', 'yields', 'solid', 'unknown'].flatMap((kind) =>
          ['crash', 'wobble'].map((type) => ({ type, tick: 1, thing: `fixture:${kind}` })),
        ),
        config: {
          trafficTypes: ['dodges', 'yields', 'solid'].map((roadside) => ({
            contentId: `fixture:${roadside}`,
            behaviour: { roadside },
          })),
        },
      }) as unknown as RideResult;
    const fast = runSidewalk(
      manifest.cases.find((c) => c.mode === 'fast')!,
      run,
    );
    expect(fast).toMatchObject({
      n: 4,
      dodged: 3,
      types: {
        'fixture:dodges': { n: 2, dodged: 2, contact: 1 },
        'fixture:yields': { n: 1, dodged: 1, contact: 0 },
        'fixture:solid': { n: 1, dodged: 0, contact: 0 },
      },
    });
    expect(fast.hits.map((h) => h.split(' ').at(-1))).toEqual(['fixture:dodges', 'fixture:dodges']);
    const brake = runSidewalk(
      manifest.cases.find((c) => c.mode === 'brake')!,
      run,
    );
    expect(brake.hits.map((h) => h.split(' ').at(-1))).toEqual([
      'fixture:dodges',
      'fixture:dodges',
      'fixture:yields',
      'fixture:yields',
    ]);
  });
});

describe('sidewalk original pooled oracle', () => {
  const check = (rows: SidewalkResult[]) => assertSidewalk(foldSidewalk(manifest.cases, rows));
  it('accepts a zero-exposure event file using the complete region and weighted overall pool', () => {
    const rows = good();
    manifest.cases.forEach((c, i) => {
      if (c.file === SIDEWALK_FILES[0]) rows[i] = row();
    });
    expect(() => check(rows)).not.toThrow();
  });
  it('accepts exactly the original band boundaries and exposure floors', () => {
    const rows = good().map(() => row());
    for (const [region, n, d] of [
      ['keys', 8, 6],
      ['sf', 16, 14],
      ['pnw', 16, 14],
    ] as const)
      rows[manifest.cases.findIndex((c) => c.region === region && c.mode === 'fast')] = row(n, d);
    expect(() => check(rows)).not.toThrow(); // weighted 34/40 overall and 6/8 in the Keys
    for (const [region, n] of [
      ['keys', 5],
      ['sf', 5],
      ['pnw', 20],
    ] as const)
      rows[manifest.cases.findIndex((c) => c.region === region && c.mode === 'fast')] = row(n);
    expect(() => check(rows)).not.toThrow(); // 30 overall, including regions at the floor of 5
  });
  it.each([
    'overall-band',
    'regional-band',
    'regional-exposure',
    'overall-exposure',
    'zero-exposure',
    'crash',
    'brake-punishment',
  ])('rejects %s without substituting independent event-file bands', (mode) => {
    const rows = good();
    if (mode === 'overall-band')
      manifest.cases.forEach((c, i) => {
        if (c.mode === 'fast') rows[i] = row(10, 8);
      });
    if (mode === 'regional-band')
      manifest.cases.forEach((c, i) => {
        if (c.mode === 'fast') rows[i] = c.region === 'keys' ? row(1, 0) : row(10);
      });
    if (mode === 'regional-exposure')
      manifest.cases.forEach((c, i) => {
        if (c.region === 'keys') rows[i] = row();
      });
    if (mode === 'overall-exposure' || mode === 'zero-exposure') {
      rows.fill(row());
      if (mode === 'overall-exposure')
        for (const region of ['keys', 'sf', 'pnw']) {
          const i = manifest.cases.findIndex((c) => c.region === region && c.mode === 'fast');
          rows[i] = row(5);
        }
    }
    if (mode === 'crash') rows[0]!.hits = ['keys event seed 1 crash fixture:thing'];
    if (mode === 'brake-punishment')
      rows[manifest.cases.findIndex((c) => c.mode === 'brake')]!.hits = ['event seed 1 wobble fixture:thing'];
    expect(() => check(rows)).toThrow();
  });
  it('keeps fast wobble diagnostics without adding a new punishment ceiling', () => {
    const rows = good();
    rows[0]!.hits = ['keys event seed 1 wobble fixture:thing'];
    expect(() => check(rows)).not.toThrow();
  });
  it('uses exposure weighting rather than the mean of per-file percentages', () => {
    const rows = good();
    rows[0] = row(100, 75);
    expect(() => check(rows)).toThrow(/overall.*share/i);
  });
  it.each([NaN, -1, 0.5, Infinity])('rejects malformed count %s', (n) => {
    const rows = good();
    rows[0] = row(n);
    expect(() => check(rows)).toThrow(/malformed/i);
  });
  it('rejects missing results rather than producing a partial pass', () => {
    expect(() => check(good().slice(1))).toThrow(/missing/i);
  });
});

function reporterFixture() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let marker: { version: number; token: string } | null = null;
  const project = {
    name: 'sim',
    config: { root },
    import: vi.fn(() => Promise.resolve({ sidewalkManifest: () => manifest })),
    provide: vi.fn((_key: string, value: typeof marker) => {
      marker = value;
    }),
  };
  const reporter = new LandingReporter(undefined, {
    files: SIDEWALK_FILES,
    inventoryModule: 'fixture:sidewalk',
  });
  const specifications = (files: readonly string[] = SIDEWALK_FILES) =>
    files.map((file) => ({ project, moduleId: path.join(root, file) })) as unknown as TestSpecification[];
  const modules = () =>
    SIDEWALK_FILES.map((file) => ({
      project,
      moduleId: path.join(root, file),
      errors: () => [],
      children: {
        *allTests() {
          for (const c of manifest.cases.filter((c) => c.file === file)) {
            const metadata = { ...marker!, key: c.key, ...row(c.mode === 'fast' ? 1 : 0) };
            yield {
              name: c.key,
              result: () => ({ state: 'passed' }),
              diagnostic: () => ({ retryCount: 0, repeatCount: 0, flaky: false }),
              meta: () => ({ sidewalkSurvey: metadata }),
            };
          }
        },
      },
    })) as unknown as TestModule[];
  return { reporter, project, specifications, modules, marker: () => marker };
}

describe('sidewalk uses the mandatory same-process reporter', () => {
  it('accepts the complete pool once, clears its marker and remains inert for ordinary files', async () => {
    const f = reporterFixture();
    await f.reporter.onTestRunStart(f.specifications());
    expect(f.marker()?.token).toBeTruthy();
    f.reporter.onTestRunEnd(f.modules(), [], 'passed');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[sidewalk] ACCEPTED'));
    expect(f.marker()).toBeNull();
    await f.reporter.onTestRunStart(f.specifications(['tests/sim/ordinary.test.ts']));
    f.reporter.onTestRunEnd([], [], 'passed');
    expect(f.project.import).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete selection before importing the inventory', async () => {
    const f = reporterFixture();
    await expect(f.reporter.onTestRunStart(f.specifications(SIDEWALK_FILES.slice(1)))).rejects.toThrow(
      /incomplete/i,
    );
    expect(f.project.import).not.toHaveBeenCalled();
  });
  it.each([
    'missing-file',
    'duplicate-file',
    'missing',
    'duplicate',
    'stale',
    'wrong-file',
    'failed',
    'retried',
    'repeated',
    'collection',
    'zero-exposure',
    'pooled-band',
    'regional-band',
    'crash',
    'brake-punishment',
  ])('fails closed for %s', async (mode) => {
    const f = reporterFixture();
    await f.reporter.onTestRunStart(f.specifications());
    const modules = f.modules();
    if (mode === 'missing-file') modules.pop();
    if (mode === 'duplicate-file') modules.push(modules[0]!);
    for (const [i, module] of modules.entries()) {
      const tests = [...module.children.allTests()];
      for (const [j, test] of tests.entries()) {
        const meta = test.meta().sidewalkSurvey!;
        if (mode === 'zero-exposure') Object.assign(meta, row());
        if (mode === 'pooled-band') Object.assign(meta, row(10, 8));
        if (mode === 'regional-band') Object.assign(meta, i < 2 ? row(1, 0) : row(10));
        if (mode === 'wrong-file' && j === 0 && i < 2)
          meta.key = manifest.cases.find((c) => c.file === SIDEWALK_FILES[1 - i])!.key;
        if (mode === 'brake-punishment' && j === tests.length - 1) meta.hits = ['event seed 1 wobble thing'];
        if (i || j) continue;
        if (mode === 'missing') vi.spyOn(test, 'meta').mockReturnValue({});
        if (mode === 'duplicate') meta.key = tests[1]!.meta().sidewalkSurvey!.key;
        if (mode === 'stale') meta.token = 'old-run';
        if (mode === 'crash') meta.hits = ['keys event seed 1 crash thing'];
        if (mode === 'failed') vi.spyOn(test, 'result').mockReturnValue({ state: 'failed' });
        if (mode === 'retried' || mode === 'repeated')
          vi.spyOn(test, 'diagnostic').mockReturnValue({
            retryCount: mode === 'retried' ? 1 : 0,
            repeatCount: mode === 'repeated' ? 1 : 0,
          } as ReturnType<typeof test.diagnostic>);
      }
      vi.spyOn(module.children, 'allTests').mockImplementation(function* () {
        yield* tests;
        return undefined;
      });
      if (mode === 'collection' && i === 0)
        vi.spyOn(module, 'errors').mockReturnValue([new Error('collection fault')] as ReturnType<
          typeof module.errors
        >);
    }
    expect(() => f.reporter.onTestRunEnd(modules, [], 'passed')).toThrow();
    expect(process.exitCode).toBe(1);
    expect(f.marker()).toBeNull();
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('ACCEPTED'));
  });
  it('rejects previous-run rows after a successful run', async () => {
    const f = reporterFixture();
    await f.reporter.onTestRunStart(f.specifications());
    const modules = f.modules();
    // Materialize test metadata while the first run's marker is live.
    for (const module of modules) {
      const tests = [...module.children.allTests()];
      vi.spyOn(module.children, 'allTests').mockImplementation(function* () {
        yield* tests;
        return undefined;
      });
    }
    f.reporter.onTestRunEnd(modules, [], 'passed');
    await f.reporter.onTestRunStart(f.specifications());
    expect(() => f.reporter.onTestRunEnd(modules, [], 'passed')).toThrow(/stale/i);
  });
});

describe('sidewalk reporter real CLI metadata and exit', () => {
  it.each([
    ['pass-one', 0, 'ACCEPTED'],
    ['pass-two', 0, 'ACCEPTED'],
    ['bad-pool', 1, 'overall share'],
    ['regional-band', 1, 'fixture-region:0 share'],
    ['zero-exposure', 1, 'sample below'],
    ['crash', 1, 'costs the rider a crash'],
    ['missing-metadata', 1, 'Missing or stale'],
    ['wrong-token', 1, 'Missing or stale'],
    ['no-reporter', 1, 'Missing complete sidewalk reporter'],
    ['missing-file', 1, 'Incomplete sidewalk'],
    ['interrupted', 1, 'interrupted'],
  ] as const)(
    '%s exits %i',
    (scenario, exit, diagnostic) => {
      const cache = path.join(root, 'scratch/sidewalk-reporter-cli', scenario).replaceAll('\\', '/');
      mkdirSync(`${cache}/temp`, { recursive: true });
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, 'node_modules/vitest/vitest.mjs'),
          'run',
          '--config',
          path.join(root, 'tests/fixtures/landing-reporter/vitest.config.ts'),
          '--configLoader',
          'native',
          '--maxWorkers',
          scenario === 'pass-one' ? '1' : '2',
          ...(scenario === 'missing-file' ? ['tests/fixtures/landing-reporter/a.case.ts'] : []),
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 25_000,
          maxBuffer: 2 ** 22,
          env: {
            ...process.env,
            LANDING_FIXTURE_KIND: 'sidewalk',
            LANDING_FIXTURE_SCENARIO: scenario,
            LANDING_FIXTURE_CACHE: cache,
            TEMP: `${cache}/temp`,
            TMP: `${cache}/temp`,
            NODE_DISABLE_COMPILE_CACHE: '1',
            NO_COLOR: '1',
            FORCE_COLOR: '0',
          },
        },
      );
      const out = result.stdout + result.stderr;
      writeFileSync(`${cache}/cli.log`, out);
      expect(result.status, out).toBe(exit);
      expect(out).toContain(diagnostic);
      if (exit === 0) {
        expect(out).toMatch(/Test Files\s+3 passed \(3\)/);
        expect(out).toMatch(/Tests\s+3 passed \(3\)/);
        expect(out).toContain('3 unique races in 3 files');
      } else expect(out).not.toContain('[sidewalk] ACCEPTED');
    },
    35_000,
  );
});
