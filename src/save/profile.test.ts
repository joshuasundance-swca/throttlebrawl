import { describe, expect, it } from 'vitest';
import settingsV1 from './fixtures/settings-v1-m1.json';
import {
  createProfileStore,
  createSettingsStore,
  DEFAULT_PROFILE,
  emptyRegion,
  MAX_HISTORY,
  migrateProfile,
  MIGRATIONS,
  PROFILE_NOTICE_NEWER,
  PROFILE_VERSION,
  profileBackupKey,
  profileKey,
  sanitiseProfile,
  settingsKey,
  type Migration,
  type StorageLike,
} from './index';

// W-Q contracts (interview, 2026-10-02: the career is a tiered network map per region: claim roads,
// find secrets and shortcuts, a finale per region; grudges kept across races, cockpit answer
// 2026-09-29): the profile record, its migration runner, and the golden fixtures
// (docs/architecture.md, "Save format": every version ships one in tests/fixtures/save/, and CI
// migrates every fixture to the current version).

const FIXTURES = import.meta.glob<unknown>('/tests/fixtures/save/profile-v*.json', {
  eager: true,
  import: 'default',
});
const fixtures = () =>
  Object.keys(FIXTURES)
    .sort()
    .map((name) => ({ name, raw: FIXTURES[name] }));

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return { storage, data };
}

describe('the golden profile fixtures', () => {
  it('there is one for every version up to the current one, and each migrates and keeps its data', () => {
    const all = fixtures();
    const versions = all.map((f) => (f.raw as { version: number }).version).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: PROFILE_VERSION }, (_v, i) => i + 1));
    for (const f of all) {
      const m = migrateProfile(f.raw);
      expect(m.kind, f.name).toBe('ok');
      if (m.kind !== 'ok') continue;
      const profile = sanitiseProfile(m.data);
      // Sanitising a well-formed record changes nothing: every field it carries is kept.
      expect(sanitiseProfile(profile)).toEqual(profile);
      expect(profile).toMatchObject({
        cash: 4250,
        bikes: { current: 'base:gulfstream-750', paint: { 'base:gulfstream-750': 'flamingo-pink' } },
        failureMode: 'road-trip',
      });
      expect(profile.regions['florida-keys']).toMatchObject({
        tier: 2,
        claimedRoads: ['overseas-main'],
        foundShortcuts: ['base:m1-standard-run#m1-boat-ramp-cut'],
        secrets: ['pirate-station-keys'],
      });
      expect(profile.grudges['base:kevin-from-accounting']).toEqual({ 'base:player': 3 });
      expect(profile.history.map((h) => [h.outcome, h.cash])).toEqual([
        ['won', 1700],
        ['busted', -250],
      ]);
    }
    console.log(`[examined] ${all.length} golden profile fixtures to version ${PROFILE_VERSION}`);
  });
});

describe('sanitiseProfile', () => {
  it('defaults a missing record and keeps cash, ids and history within bounds', () => {
    expect(sanitiseProfile(undefined)).toEqual(DEFAULT_PROFILE);
    const p = sanitiseProfile({
      cash: -50,
      bikes: {
        owned: ['base:a', 'base:a', 'BAD ID', 7],
        current: 'base:b',
        paint: { 'base:a': 'red', 'base:b': 'blue' },
      },
      regions: { 'florida-keys': { tier: 0, won: ['x', 'x'], finaleBeaten: 'yes' }, 'Not A Region': {} },
      grudges: { 'base:kevin': { 'base:player': Infinity, 'base:you': 5000 } },
      history: Array.from({ length: MAX_HISTORY + 5 }, (_v, i) => ({
        event: 'base:e',
        region: 'r',
        place: i % 9,
      })),
      failureMode: 'arcade',
    });
    expect(p.cash).toBe(0);
    expect(p.bikes).toEqual({ owned: ['base:a'], current: null, paint: { 'base:a': 'red' } });
    expect(Object.keys(p.regions)).toEqual(['florida-keys']);
    expect(p.regions['florida-keys']).toEqual({ ...emptyRegion(), won: ['x'] });
    expect(p.grudges).toEqual({ 'base:kevin': { 'base:you': 1000 } });
    expect(p.history).toHaveLength(MAX_HISTORY);
    expect(p.history[0]?.outcome).toBe('lost');
    expect(p.failureMode).toBe('road-trip');
  });
});

describe('migrateProfile', () => {
  const v1 = { format: 'profile', version: 1, build: 'x', savedAt: 't', data: { cash: 10 } };
  // A made-up v1 -> v2 -> v3 chain, to prove the runner (the build itself has none yet).
  const chain: Migration[] = [
    (d) => ({ ...(d as object), purse: (d as { cash: number }).cash }),
    (d) => {
      const { purse, ...rest } = d as { purse: number };
      return { ...rest, cash: purse * 2 };
    },
  ];

  it("applies each step from the record's version on, in order", () => {
    expect(migrateProfile(v1, chain)).toEqual({ kind: 'ok', version: 3, data: { cash: 20 }, migrated: 2 });
    expect(migrateProfile({ ...v1, version: 2, data: { purse: 7 } }, chain)).toMatchObject({
      data: { cash: 14 },
      migrated: 1,
    });
    expect(migrateProfile(v1)).toEqual({
      kind: 'ok',
      version: PROFILE_VERSION,
      data: { cash: 10 },
      migrated: 0,
    });
    expect(MIGRATIONS).toHaveLength(PROFILE_VERSION - 1);
  });

  it('reports a newer record untouched, and refuses a broken one', () => {
    expect(migrateProfile({ ...v1, version: PROFILE_VERSION + 1 })).toEqual({
      kind: 'newer',
      version: PROFILE_VERSION + 1,
    });
    expect(migrateProfile({ ...v1, format: 'settings' }).kind).toBe('invalid');
    expect(migrateProfile('nope').kind).toBe('invalid');
  });
});

describe('the profile store', () => {
  it('a pre-career device (settings only) starts a fresh profile and never touches the settings', () => {
    const { storage, data } = memoryStorage({ [settingsKey('tb')]: JSON.stringify(settingsV1) });
    const store = createProfileStore({ keyPrefix: 'tb', build: 'b1', storage, now: () => 'now' });
    expect(store.load()).toEqual(DEFAULT_PROFILE);
    expect(store.save({ ...DEFAULT_PROFILE, cash: 500 })).toBe(true);
    expect(JSON.parse(data.get(profileKey('tb')) ?? '{}')).toMatchObject({
      format: 'profile',
      version: PROFILE_VERSION,
      build: 'b1',
      data: { cash: 500 },
    });
    expect(data.get(settingsKey('tb'))).toBe(JSON.stringify(settingsV1));
    expect(createSettingsStore({ keyPrefix: 'tb', build: 'b1', storage }).load().units).toBe('kmh');
  });

  it('loads the golden fixture, saves it back with the fields it does not know kept', () => {
    const raw = fixtures()[0]?.raw as { data: Record<string, unknown> };
    const withExtra = { ...raw, data: { ...raw.data, laterField: { keep: true } } };
    const { storage, data } = memoryStorage({ [profileKey('tb')]: JSON.stringify(withExtra) });
    const store = createProfileStore({ keyPrefix: 'tb', build: 'b2', storage, now: () => 'now' });
    const p = store.load();
    expect(p.cash).toBe(4250);
    store.save({ ...p, cash: p.cash + 100 });
    const saved = JSON.parse(data.get(profileKey('tb')) ?? '{}') as { data: Record<string, unknown> };
    expect(saved.data['cash']).toBe(4350);
    expect(saved.data['laterField']).toEqual({ keep: true });
    expect(data.has(profileBackupKey('tb'))).toBe(false);
  });

  it('keeps a backup before a migration, and refuses and keeps a record from a newer build', () => {
    const old = JSON.stringify({
      format: 'profile',
      version: 1,
      build: 'x',
      savedAt: 't',
      data: { cash: 10 },
    });
    const chain: Migration[] = [(d) => ({ ...(d as object), cash: 99 })];
    const a = memoryStorage({ [profileKey('tb')]: old });
    expect(
      createProfileStore({ keyPrefix: 'tb', build: 'b', storage: a.storage, migrations: chain }).load().cash,
    ).toBe(99);
    expect(a.data.get(profileBackupKey('tb'))).toBe(old);

    const newer = JSON.stringify({
      format: 'profile',
      version: PROFILE_VERSION + 1,
      build: 'x',
      savedAt: 't',
      data: {},
    });
    const b = memoryStorage({ [profileKey('tb')]: newer });
    const store = createProfileStore({ keyPrefix: 'tb', build: 'b', storage: b.storage });
    expect(store.load()).toEqual(DEFAULT_PROFILE);
    expect(store.notice).toBe(PROFILE_NOTICE_NEWER);
    expect(store.save({ ...DEFAULT_PROFILE, cash: 1 })).toBe(false);
    expect(b.data.get(profileKey('tb'))).toBe(newer);
  });

  it('runs on in memory when storage throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = createProfileStore({ keyPrefix: 'tb', build: 'b', storage: broken });
    expect(store.load()).toEqual(DEFAULT_PROFILE);
    expect(store.save({ ...DEFAULT_PROFILE, cash: 3 })).toBe(false);
    expect(store.load().cash).toBe(3);
    expect(store.notice).toMatch(/not be saved/);
  });
});
