// A throwaway probe for #557 (never merged): one fast unit test that fails on purpose on GitHub's
// runners only, so its PR run shows the first red job cancelling the rest of the run. It passes on
// the dev machine, so the pre-push hook runs in full and is not skipped.
import { describe, expect, it } from 'vitest';

describe('ci fail-fast probe', () => {
  it('fails on purpose in CI', () => {
    expect(process.env.GITHUB_ACTIONS ?? 'not on GitHub Actions').not.toBe('true');
  });
});
