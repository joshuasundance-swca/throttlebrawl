import { describe, expect, it } from 'vitest';
import { createRaceWakeSync } from './race-wake';
import type { AppState } from './states';

// docs/milestones/race-wake-lifecycle.md: intent at actual lifecycle boundaries, not frame timing.
const fixture = () => {
  const calls: boolean[] = [];
  const sync = createRaceWakeSync((on) => calls.push(on));
  return { calls, sync };
};

describe('race wake-lock lifecycle', () => {
  it.each(['boot', 'tapToStart', 'menu', 'results'] as const)('does not request in %s', (state) => {
    const { calls, sync } = fixture();
    sync(state, false, false);
    expect(calls).toEqual([]);
  });

  it('requests once for a running race and releases on results', () => {
    const { calls, sync } = fixture();
    sync('race', false, false);
    sync('race', false, false);
    expect(calls).toEqual([true]);
    sync('results', false, false);
    sync('menu', false, false);
    expect(calls).toEqual([true, false]);
  });

  it('releases on pause and re-requests only after Resume', () => {
    const { calls, sync } = fixture();
    sync('race', false, false);
    sync('race', true, false);
    sync('race', true, false);
    expect(calls).toEqual([true, false]);
    sync('race', false, false);
    expect(calls).toEqual([true, false, true]);
  });

  it('stays released through overlapping holds and a visible return behind the pause screen', () => {
    const { calls, sync } = fixture();
    sync('race', false, false);
    sync('race', false, true);
    sync('race', true, true);
    sync('race', true, false);
    expect(calls).toEqual([true, false]);
    sync('race', false, false);
    expect(calls).toEqual([true, false, true]);
  });

  it('re-requests after an unpaused context hold clears', () => {
    const { calls, sync } = fixture();
    sync('race', false, false);
    sync('race', false, true);
    sync('race', false, false);
    expect(calls).toEqual([true, false, true]);
  });

  it.each(['menu', 'race'] as const)(
    'does not revive the old race when a paused action goes to %s',
    (destination: AppState) => {
      const { calls, sync } = fixture();
      sync('race', false, false);
      sync('race', true, false);
      // Quit/Restart clear the UI pause, then transition through menu before synchronizing resume.
      sync('menu', false, false);
      expect(calls).toEqual([true, false]);
      sync(destination, false, false);
      expect(calls).toEqual(destination === 'race' ? [true, false, true] : [true, false]);
    },
  );
});
