import {
  createProfileStore,
  profileKey,
  sanitiseProfile,
  type Profile,
  type ProfileStore,
  type StorageLike,
} from '../save';
import { canonicalJson, profileFromGuard, type FrozenRaceResult } from './saved-race';

export interface FrozenProfileCommit<T> {
  kind: 'saved' | 'blocked' | 'changed' | 'invalid';
  settled: T | null;
  store: ProfileStore | null;
}

/** Settlement always derives from the persisted starting record, never a failed-write memory. */
export function commitFrozenProfile<T extends { profile: Profile }>(opts: {
  storage: StorageLike | null;
  keyPrefix: string;
  profileGuard: string;
  result: FrozenRaceResult;
  settle: (starting: Profile) => T;
}): FrozenProfileCommit<T> {
  const starting = profileFromGuard(opts.profileGuard);
  if (!starting) return { kind: 'invalid', settled: null, store: null };
  const storage = opts.storage;
  if (!storage) return { kind: 'blocked', settled: null, store: null };
  const key = profileKey(opts.keyPrefix);
  try {
    if (storage.getItem(key) !== opts.profileGuard) return { kind: 'changed', settled: null, store: null };
  } catch {
    return { kind: 'blocked', settled: null, store: null };
  }
  // A failed ProfileStore permanently keeps its writes in memory. A guarded retry needs a fresh
  // instance; loading it here also carries the persisted record's unknown fields into this save.
  const store = createProfileStore({
    storage,
    keyPrefix: opts.keyPrefix,
    build: opts.result.build,
    now: () => opts.result.at,
  });
  store.load();
  const settled = opts.settle(starting);
  try {
    if (storage.getItem(key) !== opts.profileGuard) return { kind: 'changed', settled, store };
    if (!store.save(settled.profile)) return { kind: 'blocked', settled, store };
    const raw = storage.getItem(key);
    const after = raw === null ? null : profileFromGuard(raw);
    if (
      raw === opts.profileGuard ||
      !after ||
      canonicalJson(after) !== canonicalJson(sanitiseProfile(settled.profile))
    )
      return { kind: 'blocked', settled, store };
    return { kind: 'saved', settled, store };
  } catch {
    return { kind: 'blocked', settled, store };
  }
}
