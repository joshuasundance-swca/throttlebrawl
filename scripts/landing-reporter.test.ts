import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestModule, TestProject, TestSpecification } from 'vitest/node';
import LandingReporter from '../tests/landing-reporter';
import { tally } from '../tests/sim/landing-oracle';

const root = path.resolve(import.meta.dirname, '..');
const files = ['tests/fixtures/a.ts', 'tests/fixtures/b.ts', 'tests/fixtures/c.ts'];
const cases = files.map((file, i) => ({
  event: 'fixture:event',
  route: `route:${i}`,
  seed: 1,
  thumb: i === 2,
  key: `key:${i}`,
  file,
}));
const source = { files, inventoryModule: 'fixture:inventory' };
const oldExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = oldExitCode;
  vi.restoreAllMocks();
});
function fixture() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let marker: { version: number; token: string } | null = null;
  const project = {
    name: 'sim',
    config: { root },
    import: vi.fn(() => Promise.resolve({ landingManifest: () => ({ files, cases }) })),
    provide: vi.fn((_key: string, value: { version: number; token: string } | null) => {
      marker = value;
    }),
  };
  const reporter = new LandingReporter(source);
  const specifications = (selected = files, name = 'sim') => {
    project.name = name;
    return selected.map((file) => ({
      moduleId: path.join(root, file),
      project,
    })) as unknown as TestSpecification[];
  };
  function modules(change?: (row: Record<string, unknown>, i: number) => void) {
    return files.map((file, i) => {
      const player = {
        ...tally(),
        landings: i === 0 ? 1 : 0,
        clean: i === 0 ? 1 : 0,
        airCrash: i === 2 ? 1 : 0,
      };
      const rivals =
        i === 0
          ? { ...tally(), landings: 1, crashOnLanding: 1 }
          : {
              ...tally(),
              landings: i === 1 ? 9 : 99,
              clean: i === 1 ? 9 : 0,
              crashOnLanding: i === 2 ? 99 : 0,
            };
      const row: Record<string, unknown> = { ...marker, key: cases[i]!.key, player, rivals };
      change?.(row, i);
      return {
        project: project as unknown as TestProject,
        moduleId: path.join(root, file),
        errors: () => [],
        children: {
          *allTests() {
            yield {
              name: cases[i]!.key,
              result: () => ({ state: 'passed' }),
              diagnostic: () => ({ retryCount: 0, repeatCount: 0, flaky: false }),
              meta: () => ({ landingSurvey: row }),
            };
          },
        },
      };
    }) as unknown as TestModule[];
  }
  return { reporter, project, specifications, modules, marker: () => marker };
}

describe('complete landing reporter', () => {
  it('pools across files once and revokes the presence marker afterward', async () => {
    const f = fixture();
    await f.reporter.onTestRunStart(f.specifications());
    expect(f.marker()?.token).toBeTruthy();
    f.reporter.onTestRunEnd(f.modules(), [], 'passed');
    expect(f.marker()).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[landings] ACCEPTED'));
    expect(f.project.import).toHaveBeenCalledTimes(1);
  });
  it('rejects pooled one-in-nine instead of using independent per-file allowances', async () => {
    const f = fixture();
    await f.reporter.onTestRunStart(f.specifications());
    expect(() =>
      f.reporter.onTestRunEnd(
        f.modules((row, i) => {
          if (i === 1) row.rivals = { ...tally(), landings: 8, clean: 8 };
        }),
        [],
        'passed',
      ),
    ).toThrow(/rival/i);
    expect(process.exitCode).toBe(1);
    expect(f.marker()).toBeNull();
  });
  it.each(['unit', 'sim'])('is inert for unrelated %s selections', async (name) => {
    const f = fixture();
    await f.reporter.onTestRunStart(f.specifications(['tests/sim/riders-landings-held-kick.test.ts'], name));
    f.reporter.onTestRunEnd([], [], 'passed');
    expect(f.project.import).not.toHaveBeenCalled();
    expect(f.project.provide).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });
  it('fails before importing or providing for a partial group', async () => {
    const f = fixture();
    await expect(f.reporter.onTestRunStart(f.specifications([files[0]!]))).rejects.toThrow(
      /complete|incomplete/i,
    );
    expect(f.project.import).not.toHaveBeenCalled();
    expect(f.marker()).toBeNull();
  });
  it.each(['missing', 'duplicate', 'unknown', 'version', 'token', 'malformed', 'wrong-file'])(
    'rejects %s result metadata',
    async (mode) => {
      const f = fixture();
      await f.reporter.onTestRunStart(f.specifications());
      const modules = f.modules((row, i) => {
        // Keep all module paths and canonical keys unique; only their file ownership is wrong.
        if (mode === 'wrong-file' && i < 2) {
          row.key = cases[1 - i]!.key;
          return;
        }
        if (i !== 0) return;
        if (mode === 'missing') delete row.key;
        if (mode === 'duplicate') row.key = cases[1]!.key;
        if (mode === 'unknown') row.key = 'unknown';
        if (mode === 'version') row.version = -1;
        if (mode === 'token') row.token = 'previous-run';
        if (mode === 'malformed') row.player = { ...tally(), airCrash: NaN };
      });
      const finish = () => f.reporter.onTestRunEnd(modules, [], 'passed');
      if (mode === 'wrong-file') expect(finish).toThrow('Unknown, duplicate or wrong-file landing key');
      else expect(finish).toThrow();
      expect(process.exitCode).toBe(1);
      expect(f.marker()).toBeNull();
    },
  );
  it('rejects interrupted runs, unhandled errors and missing result files', async () => {
    for (const mode of ['interrupted', 'error', 'missing-file'] as const) {
      const f = fixture();
      await f.reporter.onTestRunStart(f.specifications());
      const modules = f.modules();
      if (mode === 'missing-file') modules.pop();
      expect(() =>
        f.reporter.onTestRunEnd(
          modules,
          mode === 'error' ? [new Error('fixture fault')] : [],
          mode === 'interrupted' ? 'interrupted' : 'passed',
        ),
      ).toThrow();
    }
  });
  it.each(['skipped', 'failed', 'retry', 'repeat', 'flaky'])('rejects %s case state', async (mode) => {
    const f = fixture();
    await f.reporter.onTestRunStart(f.specifications());
    const modules = f.modules();
    const first = [...modules[0]!.children.allTests()][0]!;
    if (mode === 'skipped' || mode === 'failed')
      vi.spyOn(first, 'result').mockReturnValue({ state: mode } as ReturnType<typeof first.result>);
    else
      vi.spyOn(first, 'diagnostic').mockReturnValue({
        retryCount: mode === 'retry' ? 1 : 0,
        repeatCount: mode === 'repeat' ? 1 : 0,
        flaky: mode === 'flaky',
      } as ReturnType<typeof first.diagnostic>);
    vi.spyOn(modules[0]!.children, 'allTests').mockImplementation(function* () {
      yield first;
    });
    expect(() => f.reporter.onTestRunEnd(modules, [], 'passed')).toThrow();
  });
  it('does not reuse rows/tokens across full, unrelated, partial and interrupted reruns', async () => {
    const f = fixture();
    await f.reporter.onTestRunStart(f.specifications());
    const old = f.modules(),
      token = f.marker()?.token;
    f.reporter.onTestRunEnd(old, [], 'passed');
    await f.reporter.onTestRunStart(f.specifications(['tests/sim/ordinary.test.ts']));
    f.reporter.onTestRunEnd([], [], 'passed');
    await expect(f.reporter.onTestRunStart(f.specifications([files[0]!]))).rejects.toThrow();
    await f.reporter.onTestRunStart(f.specifications());
    expect(f.marker()?.token).not.toBe(token);
    expect(() => f.reporter.onTestRunEnd(old, [], 'passed')).toThrow();
    await f.reporter.onTestRunStart(f.specifications());
    expect(() => f.reporter.onTestRunEnd(f.modules(), [], 'interrupted')).toThrow();
    await f.reporter.onTestRunStart(f.specifications());
    expect(() => f.reporter.onTestRunEnd(f.modules(), [], 'passed')).not.toThrow();
    expect(process.exitCode).toBe(1);
  });
  it('rejects import errors and a missing aggregate hook before work', async () => {
    const f = fixture();
    f.project.import.mockRejectedValueOnce(new Error('fixture import failed'));
    await expect(f.reporter.onTestRunStart(f.specifications())).rejects.toThrow(/import failed/);
    expect(f.marker()).toBeNull();
    Object.assign(f.reporter, { onTestRunEnd: undefined });
    await expect(f.reporter.onTestRunStart(f.specifications())).rejects.toThrow(/end hook/i);
  });
  it('uses the production group by default', () => {
    expect(new LandingReporter().source.files).toEqual([
      'tests/sim/riders-landings.test.ts',
      'tests/sim/riders-landings-b.test.ts',
      'tests/sim/riders-landings-c.test.ts',
    ]);
    expect(readFileSync(path.join(root, 'vitest.config.ts'), 'utf8')).toContain('new LandingReporter()');
  });
  it('preserves a native nonzero interruption exit code', async () => {
    const f = fixture();
    await f.reporter.onTestRunStart(f.specifications());
    process.exitCode = 130;
    expect(() => f.reporter.onTestRunEnd(f.modules(), [], 'interrupted')).toThrow(/interrupted/);
    expect(process.exitCode).toBe(130);
  });
});

describe('landing reporter real CLI exit', () => {
  const artifacts = process.env.LANDING_FIXTURE_ARTIFACTS ?? path.join(root, 'scratch/landing-reporter-cli');
  const scenarios = [
    ['pass-one', 0, 'ACCEPTED'],
    ['pass-two', 0, 'ACCEPTED'],
    ['bad-pool', 1, 'rival pooled'],
    ['zero-exposure', 1, 'global player exposure'],
    ['thumb-crash', 1, 'thumb landing'],
    ['skipped', 1, 'did not pass once'],
    ['failed', 1, 'run failed'],
    ['malformed', 1, 'Malformed'],
    ['duplicate', 1, 'duplicate'],
    ['missing', 1, 'Missing required landing cases'],
    ['unknown', 1, 'Unknown'],
    ['wrong-token', 1, 'stale'],
    ['wrong-version', 1, 'stale'],
    ['missing-metadata', 1, 'Missing'],
    ['name-filter', 1, 'did not pass once'],
    ['missing-file', 1, 'Incomplete'],
    ['no-reporter', 1, 'Missing complete landing reporter'],
    ['missing-end-hook', 1, 'end hook'],
    ['import-failure', 1, 'NOT-PRESENT'],
    ['interrupted', 1, 'interrupted'],
  ] as const;
  it.each(scenarios)(
    '%s exits %i',
    (scenario, exit, diagnostic) => {
      const cache = path.join(artifacts, scenario).replaceAll('\\', '/');
      mkdirSync(`${cache}/temp`, { recursive: true });
      const args = [
        path.join(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        path.join(root, 'tests/fixtures/landing-reporter/vitest.config.ts'),
        '--configLoader',
        'native',
        '--maxWorkers',
        scenario === 'pass-one' ? '1' : '2',
        ...(scenario === 'name-filter' ? ['--testNamePattern', '^fixture bot-a$'] : []),
        ...(scenario === 'missing-file' ? ['tests/fixtures/landing-reporter/a.case.ts'] : []),
      ];
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 25_000,
        maxBuffer: 2 ** 22,
        env: {
          ...process.env,
          LANDING_FIXTURE_SCENARIO: scenario,
          LANDING_FIXTURE_CACHE: cache,
          TEMP: `${cache}/temp`,
          TMP: `${cache}/temp`,
          NODE_DISABLE_COMPILE_CACHE: '1',
          NO_COLOR: '1',
          FORCE_COLOR: '0',
        },
      });
      const out = result.stdout + result.stderr;
      writeFileSync(`${cache}/cli.log`, out);
      writeFileSync(
        `${cache}/result.json`,
        JSON.stringify(
          {
            command: [process.execPath, ...args],
            exit: result.status,
            signal: result.signal,
            error: result.error?.message,
            expected: exit,
          },
          null,
          2,
        ),
      );
      expect(result.status, out).toBe(exit);
      expect(out).toContain(diagnostic);
      if (exit === 0) {
        expect(out).toMatch(/Test Files\s+3 passed \(3\)/);
        expect(out).toMatch(/Tests\s+3 passed \(3\)/);
        expect(out).toContain('3 unique races in 3 files');
      } else expect(out).not.toContain('[landings] ACCEPTED');
    },
    35_000,
  );
});
