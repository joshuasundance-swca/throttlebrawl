import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const train = readFileSync(new URL('../.github/workflows/train.yml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const block = (text: string, id: string) => text.split(`\n  ${id}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? '';
const field = (text: string, name: string) => text.match(new RegExp(`^ +${name}: (.+)$`, 'm'))?.[1] ?? '';
function expression(raw: string, values: Record<string, unknown>): unknown {
  const code = raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\.([a-z]+-[a-z-]+)/g, "['$1']");
  return runInNewContext(code, { always: () => true, cancelled: () => false, ...values });
}
const plan = {
  result: 'success',
  outputs: { single: 'a'.repeat(40), single_same_tree: 'false', depart: 'true' },
};

describe('targeted diagnostic acceptance wiring', () => {
  it('plans controls only for a qualifying failed single-branch train', () => {
    const condition = field(block(train, 'control-plan'), 'if');
    expect(expression(condition, { needs: { plan, suite: { result: 'failure' } } })).toBe(true);
    for (const result of ['success', 'cancelled', 'skipped'])
      expect(expression(condition, { needs: { plan, suite: { result } } })).toBe(false);
    for (const outputs of [{ single: '' }, { single_same_tree: 'true' }])
      expect(
        expression(condition, {
          needs: {
            plan: { ...plan, outputs: { ...plan.outputs, ...outputs } },
            suite: { result: 'failure' },
          },
        }),
      ).toBe(false);
  });
  it('retains full diagnostic controls if planning fails', () => {
    const control = block(train, 'control');
    expect(control).toContain('diagnostic-control: true');
    const selection = field(control, 'control-selection');
    expect(
      expression(selection, {
        needs: { 'control-plan': { result: 'failure', outputs: { selection: 'partial' } } },
      }),
    ).toBe('');
    expect(
      expression(selection, {
        needs: { 'control-plan': { result: 'success', outputs: { selection: 'selected' } } },
      }),
    ).toBe('selected');
  });
  it('never records a train tree from diagnostic or missing coverage', () => {
    const record =
      block(train, 'report')
        .split('- name: Record the tree this train tested')[1]
        ?.split('- name: Upload')[0] ?? '';
    const condition = field(record, 'if');
    for (const coverage of ['diagnostic', 'quick', undefined, 'full'])
      expect(
        expression(condition, {
          needs: { suite: { result: 'success', outputs: { coverage } } },
          github: { event_name: 'workflow_run' },
          inputs: {},
        }),
      ).toBe(coverage === 'full');
  });
  it('never records a full PR proof from partial coverage', () => {
    const record =
      block(ci, 'aggregate')
        .split('- name: Record the tree this PR run tested')[1]
        ?.split('- name: Upload')[0] ?? '';
    for (const coverage of ['diagnostic', 'quick', undefined, 'full'])
      expect(
        expression(field(record, 'if'), {
          github: { event_name: 'pull_request' },
          needs: { route: { outputs: { path: 'full' } }, suite: { outputs: { coverage } } },
        }),
      ).toBe(coverage === 'full');
  });
  it('passes scope and coverage separately to the report', () => {
    const report = block(train, 'report');
    expect(field(report, 'TRAIN_COVERAGE')).toBe('${{ needs.suite.outputs.coverage }}');
    expect(field(report, 'TRAIN_CONTROL_SCOPE')).toContain('needs.control-plan.outputs.scope');
    expect(field(report, 'TRAIN_CONTROL_JOBS')).toBe('${{ needs.control-plan.outputs.jobs }}');
    expect(field(report, 'TRAIN_CONTROL')).toBe('${{ needs.control.result }}');
  });
});
