import { describe, expect, it, vi } from 'vitest';
import {
  createProfileStore,
  DEFAULT_PROFILE,
  PROFILE_VERSION,
  type Profile,
  type StorageLike,
} from '../save';
import { commitFrozenProfile } from './frozen-result';

const result = { build: 'terminal-build', at: '2026-10-12T12:00:00.000Z' };
function fixture() {
  const base: Profile = { ...structuredClone(DEFAULT_PROFILE), cash: 100 };
  const guard = JSON.stringify({
    format: 'profile',
    version: PROFILE_VERSION,
    build: 'starting-build',
    savedAt: '2026-10-12T11:00:00.000Z',
    data: { ...base, futureField: 'keep' },
  });
  const data = new Map([['unit:profile', guard]]);
  let quota = false;
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, raw) => {
      if (quota) throw new Error('Quota');
      data.set(key, raw);
    },
  };
  const settle = vi.fn((starting: Profile) => ({
    profile: { ...starting, cash: starting.cash + 25 },
    report: { cash: 25 },
  }));
  const opts = { storage, keyPrefix: 'unit', profileGuard: guard, result, settle };
  return {
    base,
    guard,
    data,
    storage,
    settle,
    opts,
    quota: (value: boolean) => {
      quota = value;
    },
  };
}

describe('frozen career result commit', () => {
  it('retries from the same disk base after a failed profile store has kept an award in memory', () => {
    const f = fixture();
    const ordinary = createProfileStore({ storage: f.storage, keyPrefix: 'unit', build: 'ordinary' });
    ordinary.load();
    f.quota(true);
    expect(ordinary.save({ ...f.base, cash: 125 })).toBe(false);
    expect(ordinary.load().cash).toBe(125);
    expect(commitFrozenProfile(f.opts).kind).toBe('blocked');
    expect(f.data.get('unit:profile')).toBe(f.guard);
    f.quota(false);
    const retry = commitFrozenProfile(f.opts);
    expect(retry.kind).toBe('saved');
    expect(retry.settled?.profile.cash).toBe(125);
    expect(f.settle.mock.calls.map(([base]) => base.cash)).toEqual([100, 100]);
    const saved: unknown = JSON.parse(f.data.get('unit:profile')!);
    expect(saved).toMatchObject({
      build: result.build,
      savedAt: result.at,
      data: { cash: 125, futureField: 'keep' },
    });
    // The old instance remains poisoned; the successful retry must use the fresh instance.
    expect(ordinary.save(f.base)).toBe(false);
    expect(retry.store?.save(retry.settled!.profile)).toBe(true);
  });

  it('refuses a second award after success, including when the attempt could not be cleared', () => {
    const f = fixture();
    expect(commitFrozenProfile(f.opts).kind).toBe('saved');
    const persisted = f.data.get('unit:profile');
    expect(commitFrozenProfile(f.opts).kind).toBe('changed');
    expect(f.settle).toHaveBeenCalledTimes(1);
    expect(f.data.get('unit:profile')).toBe(persisted);
  });

  it('refuses changed, blocked and newer guards without settling or writing', () => {
    const f = fixture();
    f.data.set('unit:profile', f.guard + ' ');
    expect(commitFrozenProfile(f.opts).kind).toBe('changed');
    f.storage.getItem = () => {
      throw new Error('Blocked');
    };
    expect(commitFrozenProfile(f.opts).kind).toBe('blocked');
    expect(
      commitFrozenProfile({
        ...f.opts,
        profileGuard: JSON.stringify({ format: 'profile', version: PROFILE_VERSION + 1, data: f.base }),
      }).kind,
    ).toBe('invalid');
    expect(f.settle).not.toHaveBeenCalled();
  });

  it('checks the disk guard again if settlement itself changes storage', () => {
    const f = fixture();
    const replacement = f.guard + ' ';
    const settle = (base: Profile) => {
      f.data.set('unit:profile', replacement);
      return { profile: { ...base, cash: 125 } };
    };
    expect(commitFrozenProfile({ ...f.opts, settle }).kind).toBe('changed');
    expect(f.data.get('unit:profile')).toBe(replacement);
  });
});
