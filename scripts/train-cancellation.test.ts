import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/train.yml', import.meta.url), 'utf8');
const condition = workflow.match(/\n {2}control:\r?\n[\s\S]*?\r?\n {4}if: ([^\r\n]+)/)?.[1];
if (!condition) throw new Error('the train control condition was not found');

function controlRuns(cancelled: boolean, result = 'failure', single = 'head') {
  return runInNewContext(condition!, {
    always: () => true,
    cancelled: () => cancelled,
    needs: { plan: { outputs: { single } }, suite: { result } },
  }) as boolean;
}

describe('the real train control condition', () => {
  it('runs a lone failed branch control', () => expect(controlRuns(false)).toBe(true));
  it('skips a cancelled run even when its suite already failed', () => expect(controlRuns(true)).toBe(false));
  it('skips a successful suite', () => expect(controlRuns(false, 'success')).toBe(false));
  it('skips a timed-out suite', () => expect(controlRuns(false, 'cancelled')).toBe(false));
  it('skips bundles with more than one branch', () => expect(controlRuns(false, 'failure', '')).toBe(false));
});
