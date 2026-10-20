import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { suiteJobs } from './shard-plan.mjs';

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
function evaluateControl(selection: Selection | null, diagnostic: boolean, tier: keyof typeof totals) {
  const text = jobBlock(tier);
  const context = {
    inputs: {
      'control-selection': selection === null ? '' : JSON.stringify(selection),
      'diagnostic-control': diagnostic,
      full: true,
      'upload-dist': true,
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
  return {
    shards,
    runs,
    denominator,
    perf: (shard: number) => {
      context.matrix.shard = shard;
      return evaluate(field(last, 'if'));
    },
  };
}

function executeCoverage(env: { diagnostic: string; selection: string; full: string }) {
  const writes: Array<{ path: string; value: string }> = [];
  if (!coverageScript) throw new Error('coverage step was not found');
  runInNewContext(coverageScript, {
    process: {
      env: {
        DIAGNOSTIC_CONTROL: env.diagnostic,
        CONTROL_SELECTION: env.selection,
        FULL: env.full,
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

describe('diagnostic control workflow contract', () => {
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
