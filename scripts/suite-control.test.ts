import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { suiteJobs } from './shard-plan.mjs';

const root = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(path.join(root, '.github', 'workflows', 'suite.yml'), 'utf8');
const coverageScript = workflow
  .match(/\n {10}node <<'NODE'\n([\s\S]*?)\n {10}NODE/)?.[1]
  .replace(/^ {10}/gm, '');

type Selection = {
  static: boolean;
  unit: number[];
  sim: number[];
  browser: number[];
  totals: { unit: number; sim: number; browser: number };
};

const defaults = {
  unit: [1, 2, 3],
  sim: [1, 2, 3, 4, 5, 6, 7, 8],
  browser: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

function evaluateControl(selection: Selection | null, diagnostic: boolean, tier: keyof typeof defaults) {
  const shards = selection === null ? defaults[tier] : selection[tier];
  const runs = selection === null || !diagnostic || shards.length > 0;
  const denominator = selection === null ? defaults[tier].length : selection.totals[tier];
  return { shards, runs, denominator, perf: (shard: number) => shard === denominator };
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
    expect(workflow).toContain('value: ${{ jobs.static.outputs.coverage }}');
    expect(workflow).toContain('appendFileSync(process.env.GITHUB_OUTPUT');
  });

  it('writes the actual reusable-workflow output for normal and diagnostic calls', () => {
    expect(executeCoverage({ diagnostic: 'false', selection: '', full: 'true' })).toEqual([
      { path: 'controlled-output', value: 'value=full\n' },
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
    [
      'empty diagnostic tier',
      { static: false, unit: [], sim: [2], browser: [], totals: { unit: 3, sim: 8, browser: 11 } },
      true,
    ],
    [
      'selected diagnostic tier',
      { static: false, unit: [2], sim: [], browser: [], totals: { unit: 3, sim: 8, browser: 11 } },
      true,
    ],
  ] as const)(
    'evaluates matrix, job-if, denominator and perf-last behavior for %s',
    (_label, selection, diagnostic) => {
      const unit = evaluateControl(selection, diagnostic, 'unit');
      const sim = evaluateControl(selection, diagnostic, 'sim');
      const browser = evaluateControl(selection, diagnostic, 'browser');
      if (selection === null) {
        expect(unit.shards).toEqual(defaults.unit);
        expect(sim.shards).toEqual(defaults.sim);
        expect(browser.shards).toEqual(defaults.browser);
        expect(browser.perf(11)).toBe(true);
      } else {
        expect(unit.runs).toBe(selection.unit.length > 0);
        expect(sim.runs).toBe(selection.sim.length > 0);
        expect(browser.runs).toBe(selection.browser.length > 0);
        expect(unit.denominator).toBe(selection.totals.unit);
        expect(sim.denominator).toBe(selection.totals.sim);
        expect(browser.denominator).toBe(selection.totals.browser);
        expect(browser.perf(selection.totals.browser)).toBe(true);
        expect(browser.perf(selection.browser[0] ?? 0)).toBe(
          selection.browser.includes(selection.totals.browser),
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
