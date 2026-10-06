import { describe, expect, it } from 'vitest';
import { reloadLosesNothing, transition, type AppEvent, type AppState } from './states';

// A reload to the build the host serves now (platform/stale-build.ts) waits for a moment it loses
// nothing (playtest 4 run A fix check, punch item 1: the stale-build reload threw a player off a race
// to the start screen). app/ hands this to platform/'s startOffline as `canReload`.

describe('when a reload to a newer build may happen', () => {
  it('never mid-race or on a result; in the menus, the start screen and boot', () => {
    const all: AppState[] = ['boot', 'tapToStart', 'menu', 'race', 'results'];
    expect(all.filter(reloadLosesNothing)).toEqual(['boot', 'tapToStart', 'menu']);
  });

  it('comes on the way back from a race or a result, never on the way into one', () => {
    expect(reloadLosesNothing(transition('race', 'back') ?? 'race')).toBe(true);
    expect(reloadLosesNothing(transition('results', 'back') ?? 'results')).toBe(true);
    expect(reloadLosesNothing(transition('race', 'finished') ?? 'menu')).toBe(false);
    expect(reloadLosesNothing(transition('results', 'race') ?? 'menu')).toBe(false);
  });

  // The result screen's update card says when the reload comes (ui/format.ts, reloadOfferText): the
  // words are only true while this holds. From a result the only way out that loses nothing is
  // back to the menu (the career's Map is the same event); Race again, Next and Retry go into a race.
  it('from a result, the only event that reloads is the way back to the menu', () => {
    const events: AppEvent[] = ['booted', 'tapped', 'race', 'finished', 'back'];
    const out = events.flatMap((e) => {
      const next = transition('results', e);
      return next && reloadLosesNothing(next) ? [`${e} -> ${next}`] : [];
    });
    expect(out).toEqual(['back -> menu']);
  });
});
