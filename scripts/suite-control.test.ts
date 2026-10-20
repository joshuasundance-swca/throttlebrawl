import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { suiteJobs } from './shard-plan.mjs';

const root = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(path.join(root, '.github', 'workflows', 'suite.yml'), 'utf8');

describe('diagnostic control workflow contract', () => {
  it('declares optional control inputs and exposes coverage from static', () => {
    expect(workflow).toContain('diagnostic-control:');
    expect(workflow).toContain('control-selection:');
    expect(workflow).toContain('coverage: ${{ steps.coverage.outputs.value }}');
    expect(workflow).toContain('value: ${{ jobs.static.outputs.coverage }}');
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
    expect(workflow).toContain('inputs.upload-dist && !inputs.diagnostic-control');
    expect(workflow).toContain("diagnostic ? 'diagnostic'");
  });

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
