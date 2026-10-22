import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { suiteJobs } from './shard-plan.mjs';
import { route } from './train.mjs';

const root = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(path.join(root, '.github', 'workflows', 'suite.yml'), 'utf8');
const coverageScript = workflow
  .match(/\n {10}node <<'NODE'\n([\s\S]*?)\n {10}NODE/)?.[1]
  ?.replace(/^ {10}/gm, '');

type Selection = {
  static: boolean;
  unit: readonly number[];
  sim: readonly number[];
  browser: readonly number[];
  totals: { unit: number; sim: number; browser: number };
};

const inventory = suiteJobs(workflow);
const totals = { unit: inventory.unit.slices, sim: inventory.sim.slices, browser: inventory.e2e.slices };
const jobBlock = (tier: string) => workflow.split(`\n  ${tier}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? '';
const field = (text: string, key: string) => text.match(new RegExp(`^ +${key}: (.+)$`, 'm'))?.[1] ?? '';

// Execute the actual checked-in expressions, rather than a copy of the intended selection rule.
function evaluateControl(
  selection: Selection | null,
  diagnostic: boolean,
  tier: keyof typeof totals,
  heads = '',
) {
  const text = jobBlock(tier);
  const context = {
    inputs: {
      'control-selection': selection === null ? '' : JSON.stringify(selection),
      'diagnostic-control': diagnostic,
      full: true,
      'upload-dist': true,
      heads,
    },
    matrix: { shard: 0 },
    strategy: { 'job-total': 0 },
    fromJSON: JSON.parse,
    join: (values: unknown[], separator: string) => values.join(separator),
  };
  const evaluate = (raw: string): unknown =>
    runInNewContext(
      raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\.([a-z]+-[a-z-]+)/g, "['$1']"),
      context,
    );
  const runs = evaluate(field(text, 'if'));
  const shards = evaluate(field(text, 'shard')) as number[];
  const parallel = field(text, 'max-parallel');
  const maxParallel = parallel ? Number(evaluate(parallel)) : Infinity;
  context.strategy['job-total'] = shards.length;
  context.matrix.shard = shards[0] ?? 0;
  const name = field(text, 'name').replace(/\$\{\{(.+?)\}\}/g, (_all, expression: string) =>
    String(evaluate(expression)),
  );
  const denominator = Number(name.match(/\/(\d+)\)/)?.[1]);
  const last =
    jobBlock('browser')
      .split('- name: Build, browser tests (the last slice), then perf on the same build')[1]
      ?.split('- name: Screenshots')[0] ?? '';
  const upload = jobBlock('browser').split('- name: Keep the tested build for the deploy')[1] ?? '';
  return {
    shards,
    runs,
    denominator,
    maxParallel,
    perf: (shard: number) => {
      context.matrix.shard = shard;
      return evaluate(field(last, 'if'));
    },
    upload: (shard: number) => {
      context.matrix.shard = shard;
      return evaluate(field(upload, 'if'));
    },
  };
}

function executeCoverage(env: { diagnostic: string; selection: string; full: string; named?: string }) {
  const writes: Array<{ path: string; value: string }> = [];
  if (!coverageScript) throw new Error('coverage step was not found');
  runInNewContext(coverageScript, {
    process: {
      env: {
        DIAGNOSTIC_CONTROL: env.diagnostic,
        CONTROL_SELECTION: env.selection,
        FULL: env.full,
        QUICK_NAMED_UNITS: env.named ?? 'false',
        GITHUB_OUTPUT: 'controlled-output',
      },
    },
    require: (name: string) => {
      if (name !== 'node:fs') throw new Error(`unexpected require ${name}`);
      return { appendFileSync: (file: string, value: string) => writes.push({ path: file, value }) };
    },
  });
  return writes;
}

function executeCoverageJob(env: { diagnostic: string; selection: string; full: string; named?: string }) {
  const runs: unknown = runInNewContext(
    field(jobBlock('static'), 'if')
      .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
      .replace(/\.([a-z]+-[a-z-]+)/g, "['$1']"),
    {
      inputs: {
        'diagnostic-control': env.diagnostic === 'true',
        'control-selection': env.selection,
        'quick-named-units': env.named === 'true',
        full: env.full === 'true',
      },
      fromJSON: JSON.parse,
    },
  );
  return runs ? executeCoverage(env) : null;
}

describe('diagnostic control workflow contract', () => {
  it('opts into named units only for the ordinary train quick caller', () => {
    const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const caller = ci.split('\n  suite:\n')[1]?.split('\n  prod-build:\n')[0] ?? '';
    const expression = field(caller, 'quick-named-units');
    for (const event of ['push', 'pull_request']) {
      for (const route of ['', 'full', 'docs', 'train']) {
        const enabled: unknown = runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '') || 'false', {
          github: { event_name: event },
          needs: { route: { outputs: { path: route } } },
        });
        expect(enabled, `${event}/${route}`).toBe(event === 'pull_request' && route === 'train');
      }
    }
    const input = workflow.split('\n      quick-named-units:\n')[1]?.split(/\n {6}[\w-]+:\n/)[0] ?? '';
    expect(field(input, 'default')).toBe('false');
    for (const file of ['train.yml']) {
      const train = readFileSync(path.join(root, '.github/workflows', file), 'utf8');
      expect(field(train, 'quick-named-units')).toBe('');
    }
    const ordinary = {
      live: true,
      fork: false,
      author: 'contributor',
      title: 'change',
      body: '',
      files: ['src/ui/sample.ts'],
    };
    for (const overrides of [
      { fork: true },
      { author: 'dependabot[bot]' },
      { title: '[full-gate] change' },
      { files: ['.github/workflows/ci.yml'] },
      { live: false },
      { files: ['docs/example.md'] },
    ]) {
      const path = route({ ...ordinary, ...overrides }).path;
      const enabled: unknown = runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), {
        github: { event_name: 'pull_request' },
        needs: { route: { outputs: { path } } },
      });
      expect(enabled, JSON.stringify(overrides)).toBe(false);
    }
  });

  it('rejects named-unit narrowing for full and diagnostic calls before reporting coverage', () => {
    expect(executeCoverage({ diagnostic: 'false', selection: '', full: 'false', named: 'true' })).toEqual([
      { path: 'controlled-output', value: 'value=quick\n' },
    ]);
    for (const env of [
      { diagnostic: 'false', selection: '', full: 'true' },
      { diagnostic: 'true', selection: '', full: 'false' },
      { diagnostic: 'false', selection: '{}', full: 'false' },
    ])
      expect(() => executeCoverage({ ...env, named: 'true' })).toThrow(
        'quick-named-units requires ordinary quick coverage',
      );
  });

  it('runs incompatible-input validation even when diagnostic selection excludes static and units', () => {
    const selection = JSON.stringify({ static: false, unit: [], sim: [1], browser: [], totals });
    for (const full of ['true', 'false']) {
      const diagnostic = { diagnostic: 'true', selection, full };
      expect(executeCoverageJob({ ...diagnostic, named: 'false' })).toBeNull();
      expect(() => executeCoverageJob({ ...diagnostic, named: 'true' })).toThrow(
        'quick-named-units requires ordinary quick coverage',
      );
    }
  });

  it('passes the opt-in CLI argument only to opted-in unit jobs', () => {
    const unit = jobBlock('unit');
    const expression = field(unit, 'QUICK_UNIT_ARGS');
    for (const named of [false, true]) {
      const result: unknown = runInNewContext(
        expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\.([a-z]+-[a-z-]+)/g, "['$1']"),
        {
          inputs: { 'quick-named-units': named },
        },
      );
      expect(result).toBe(named ? '--quick-named-units' : '');
    }
    const command = unit.split('- name: Unit tests, one slice')[1]?.split('\n      #')[0] ?? '';
    expect(field(command, 'run').replace('$QUICK_UNIT_ARGS', '').trim()).toBe(
      'npm run check -- --tier unit --shard "$SHARD/$SHARD_TOTAL"',
    );
  });

  it('limits only train browser occupancy while retaining every shard and final-slice duty', () => {
    const ordinary = evaluateControl(null, false, 'browser');
    const train = evaluateControl(null, false, 'browser', 'pr-head-a pr-head-b');
    expect(train.maxParallel).toBe(6);
    expect(ordinary.maxParallel).toBeGreaterThanOrEqual(ordinary.shards.length);
    expect(train.runs).toBe(true);
    expect(train.shards).toEqual(ordinary.shards);
    expect(train.denominator).toBe(ordinary.denominator);
    for (const result of [ordinary, train]) {
      expect(result.shards.filter((shard) => result.perf(shard))).toEqual([totals.browser]);
      expect(result.shards.filter((shard) => result.upload(shard))).toEqual([totals.browser]);
    }
    for (const tier of ['unit', 'sim'] as const)
      expect(evaluateControl(null, false, tier, 'pr-head-a').maxParallel).toBe(Infinity);
  });

  it('keeps nontrain diagnostic concurrency and canonical totals independent of the train cap', () => {
    // GitHub's documented matrix ceiling exercises the entire valid range, rather than today's
    // project shard count, so any smaller nontrain fallback fails this synthetic selection.
    const browser = Array.from({ length: 256 }, (_, i) => i + 1);
    const selection: Selection = {
      static: false,
      unit: [],
      sim: [],
      browser,
      totals: { ...totals, browser: browser.length },
    };
    const control = evaluateControl(selection, true, 'browser');
    expect(control.maxParallel).toBeGreaterThanOrEqual(browser.length);
    expect(control.runs).toBe(true);
    expect(control.shards).toEqual(browser);
    expect(control.denominator).toBe(selection.totals.browser);
    expect(control.shards.filter((shard) => control.perf(shard))).toEqual([selection.totals.browser]);
    expect(control.shards.filter((shard) => control.upload(shard))).toEqual([]);
  });

  it('declares optional control inputs and exposes coverage from static', () => {
    expect(workflow).toContain('diagnostic-control:');
    expect(workflow).toContain('control-selection:');
    expect(workflow).toContain('coverage: ${{ steps.coverage.outputs.value }}');
    expect(workflow).toContain('jobs.static.outputs.coverage');
    expect(workflow).toContain('appendFileSync(process.env.GITHUB_OUTPUT');
  });

  it('exports diagnostic coverage when the static job is excluded', () => {
    const output =
      workflow.match(
        /description: full, quick, or diagnostic coverage completed by this suite\n +value: (.+)/,
      )?.[1] ?? 'false';
    const inputs = {
      'diagnostic-control': true,
      'control-selection': JSON.stringify({
        static: false,
        unit: [],
        sim: [totals.sim],
        browser: [],
        totals,
      }),
      full: true,
    };
    const evaluate = (raw: string, staticCoverage: string): unknown =>
      runInNewContext(raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\.([a-z]+-[a-z-]+)/g, "['$1']"), {
        inputs,
        fromJSON: JSON.parse,
        jobs: { static: { outputs: { coverage: staticCoverage } } },
      });
    expect(evaluate(field(jobBlock('static'), 'if'), '')).toBe(false);
    expect(evaluate(output, '')).toBe('diagnostic');
    expect(evaluate(output, 'full')).toBe('diagnostic');
  });

  it('writes the actual reusable-workflow output for normal and diagnostic calls', () => {
    expect(executeCoverage({ diagnostic: 'false', selection: '', full: 'true' })).toEqual([
      { path: 'controlled-output', value: 'value=full\n' },
    ]);
    expect(executeCoverage({ diagnostic: 'false', selection: '', full: 'false' })).toEqual([
      { path: 'controlled-output', value: 'value=quick\n' },
    ]);
    expect(executeCoverage({ diagnostic: 'true', selection: '', full: 'true' })).toEqual([
      { path: 'controlled-output', value: 'value=diagnostic\n' },
    ]);
    const selection = JSON.stringify({
      static: false,
      unit: [],
      sim: [2],
      browser: [],
      totals: { unit: 3, sim: 8, browser: 11 },
    });
    expect(executeCoverage({ diagnostic: 'true', selection, full: 'true' })).toEqual([
      { path: 'controlled-output', value: 'value=diagnostic\n' },
    ]);
    expect(() => executeCoverage({ diagnostic: 'false', selection, full: 'true' })).toThrow(
      'requires diagnostic-control=true',
    );
  });

  it('uses selected matrices while preserving the canonical shard denominators', () => {
    expect(workflow).toContain('fromJSON(inputs.control-selection).unit');
    expect(workflow).toContain('fromJSON(inputs.control-selection).sim');
    expect(workflow).toContain('fromJSON(inputs.control-selection).browser');
    expect(workflow).toContain('fromJSON(inputs.control-selection).totals.unit');
    expect(workflow).toContain('fromJSON(inputs.control-selection).totals.sim');
    expect(workflow).toContain('fromJSON(inputs.control-selection).totals.browser');
  });

  it('fails closed for nonempty ordinary selections and blocks diagnostic uploads', () => {
    expect(workflow).toContain("inputs.control-selection != ''");
    expect(workflow).toContain('control-selection requires diagnostic-control=true');
    expect(workflow).toContain('!inputs.diagnostic-control');
    expect(workflow).toContain("inputs.upload-dist && inputs.control-selection == ''");
    expect(workflow).toContain("diagnostic ? 'diagnostic'");
  });

  it.each([
    ['normal full', null, false],
    ['empty diagnostic tier', { static: false, unit: [], sim: [totals.sim], browser: [], totals }, true],
    [
      'selected diagnostic tier',
      { static: false, unit: [totals.unit], sim: [], browser: [totals.browser], totals },
      true,
    ],
  ] as const)(
    'evaluates matrix, job-if, denominator and perf-last behavior for %s',
    (_label, selection, diagnostic) => {
      const unit = evaluateControl(selection, diagnostic, 'unit');
      const sim = evaluateControl(selection, diagnostic, 'sim');
      const browser = evaluateControl(selection, diagnostic, 'browser');
      if (selection === null) {
        for (const tier of ['unit', 'sim', 'browser'] as const)
          expect(evaluateControl(null, false, tier).shards).toEqual(
            Array.from({ length: totals[tier] }, (_, i) => i + 1),
          );
        expect(browser.perf(totals.browser)).toBe(true);
      } else {
        const selected: Selection = selection;
        expect(unit.runs).toBe(selection.unit.length > 0);
        expect(sim.runs).toBe(selection.sim.length > 0);
        expect(browser.runs).toBe(selection.browser.length > 0);
        expect(unit.denominator).toBe(selection.totals.unit);
        expect(sim.denominator).toBe(selection.totals.sim);
        expect(browser.denominator).toBe(selection.totals.browser);
        expect(browser.perf(selection.totals.browser)).toBe(true);
        expect(browser.perf(selection.browser[0] ?? 0)).toBe(
          selected.browser.includes(selection.totals.browser),
        );
      }
    },
  );

  it('keeps canonical arrays discoverable from default JSON matrix expressions', () => {
    const fixture = [
      'jobs:',
      '  unit:',
      '    timeout-minutes: 8',
      '    strategy:',
      '      matrix:',
      "        shard: ${{ inputs.control-selection != '' && fromJSON(inputs.control-selection).unit || fromJSON('[1, 2, 3]') }}",
      '  sim:',
      '    timeout-minutes: 10',
      '    strategy:',
      '      matrix:',
      "        shard: ${{ inputs.control-selection != '' && fromJSON(inputs.control-selection).sim || fromJSON('[1, 2, 3, 4]') }}",
      '  browser:',
      '    timeout-minutes: 12',
      '    strategy:',
      '      matrix:',
      "        shard: ${{ inputs.control-selection != '' && fromJSON(inputs.control-selection).browser || fromJSON('[1, 2]') }}",
      '',
    ].join('\n');
    expect(suiteJobs(fixture)).toEqual({
      unit: { slices: 3, timeout: 480 },
      sim: { slices: 4, timeout: 600 },
      e2e: { slices: 2, timeout: 720 },
    });
  });
});
