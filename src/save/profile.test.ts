import { describe, expect, it } from 'vitest';
import settingsV1 from './fixtures/settings-v1-m1.json';
import {
  createProfileStore,
  createSettingsStore,
  DEFAULT_PROFILE,
  emptyRegion,
  MAX_BACKUP_CODE_CHARS,
  MAX_CAREER_BACKUPS,
  MAX_HISTORY,
  MAX_RECEIPTS,
  MAX_SEASON,
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

  it("keeps the world's receipts (run W-T): well-formed ones, the newest MAX_RECEIPTS, an old record none", () => {
    expect(sanitiseProfile({ cash: 5 }).receipts).toEqual([]);
    const good = {
      kind: 'takedown',
      region: 'florida-keys',
      event: 'base:keys-t1-kevin-grudge',
      road: 'osm-bahia-honda-bridge',
      s: 412.7,
      rival: 'base:kevin-from-accounting',
      vehicle: 'base:rv',
      n: 1,
    };
    const p = sanitiseProfile({
      receipts: [
        good,
        { ...good, kind: 'bust', rival: null, vehicle: 'NOT AN ID', n: 0 },
        { ...good, kind: 'parade' },
        { ...good, road: 7 },
        'junk',
      ],
    });
    expect(p.receipts).toEqual([
      { ...good, s: 413 },
      { ...good, kind: 'bust', s: 413, rival: null, vehicle: null, n: 1 },
    ]);
    expect(sanitiseProfile(p)).toEqual(p);
    const many = sanitiseProfile({
      receipts: Array.from({ length: MAX_RECEIPTS + 3 }, (_v, i) => ({ ...good, n: i + 1 })),
    });
    expect(many.receipts).toHaveLength(MAX_RECEIPTS);
    expect(many.receipts[0]?.n).toBe(4);
  });
});

// Playtest 3 (round 2, "Longer + seasons": "then Season 2+ with a harder field and remixed events,
// the garage carried over"; round 3, "Both": "Season 2 on the finished save, plus a 'New career'
// button that keeps the old save as a backup code"). Additive fields with defaults, so the version
// stays 1 and every old record loads as Season 1.
describe('seasons and career backups (playtest 3)', () => {
  const backup = { code: 'EC1.p.eyJ4IjoxfQ.0123abcd', at: '2026-10-04T10:00:00.000Z', season: 1 };

  it('an old record, and the golden fixture, load as Season 1 with seed 0 and no backups', () => {
    expect(DEFAULT_PROFILE).toMatchObject({ season: 1, seasonSeed: 0, careerBackups: [] });
    expect(sanitiseProfile({ cash: 5 })).toMatchObject({ season: 1, seasonSeed: 0, careerBackups: [] });
    for (const f of fixtures()) {
      const m = migrateProfile(f.raw);
      if (m.kind !== 'ok') throw new Error(f.name);
      const p = sanitiseProfile(m.data);
      expect(p).toMatchObject({ season: 1, seasonSeed: 0, careerBackups: [] });
      // A Season 1 result carries no season field: absent means 1, so old records stay byte-identical.
      for (const h of p.history) expect(h).not.toHaveProperty('season');
    }
  });

  it('keeps the season (1 to MAX_SEASON), its uint32 seed, and each later-season result its season', () => {
    const p = sanitiseProfile({
      season: 3,
      seasonSeed: 0xdeadbeef,
      history: [
        { event: 'base:e', region: 'florida-keys', season: 2 },
        { event: 'base:e', region: 'florida-keys', season: 1 },
        { event: 'base:e', region: 'florida-keys' },
      ],
    });
    expect(p.season).toBe(3);
    expect(p.seasonSeed).toBe(0xdeadbeef);
    expect(p.history.map((h) => h.season)).toEqual([2, undefined, undefined]);
    expect(sanitiseProfile(p)).toEqual(p);
    expect(sanitiseProfile({ season: 0 }).season).toBe(1);
    expect(sanitiseProfile({ season: 500 }).season).toBe(MAX_SEASON);
    expect(sanitiseProfile({ season: 'two' }).season).toBe(1);
    for (const bad of [-1, 2 ** 32, 1.5, Number.NaN, '7'])
      expect(sanitiseProfile({ seasonSeed: bad }).seasonSeed).toBe(0);
    expect(sanitiseProfile({ seasonSeed: 2 ** 32 - 1 }).seasonSeed).toBe(2 ** 32 - 1);
  });

  it('keeps well-formed backup codes, the newest MAX_CAREER_BACKUPS, and drops the rest', () => {
    const p = sanitiseProfile({
      careerBackups: [
        backup,
        { ...backup, code: 'not a code' },
        { ...backup, code: `EC1.p.${'a'.repeat(MAX_BACKUP_CODE_CHARS)}.0123abcd` },
        { ...backup, at: 7 },
        'junk',
      ],
    });
    expect(p.careerBackups).toEqual([backup, { ...backup, at: '' }]);
    expect(sanitiseProfile(p)).toEqual(p);
    const many = sanitiseProfile({
      careerBackups: Array.from({ length: MAX_CAREER_BACKUPS + 2 }, (_v, i) => ({
        ...backup,
        season: i + 1,
      })),
    });
    expect(many.careerBackups.map((b) => b.season)).toEqual(
      Array.from({ length: MAX_CAREER_BACKUPS }, (_v, i) => i + 3),
    );
  });

  it('round-trips through the store', () => {
    const { storage } = memoryStorage();
    const store = createProfileStore({ keyPrefix: 'tb', build: 'b', storage });
    const p = sanitiseProfile({
      cash: 9,
      season: 2,
      seasonSeed: 123456789,
      careerBackups: [backup],
      history: [{ event: 'base:e', region: 'florida-keys', season: 2 }],
    });
    expect(store.save(p)).toBe(true);
    const back = createProfileStore({ keyPrefix: 'tb', build: 'b', storage }).load();
    expect(back).toEqual(p);
    console.log(
      `[examined] season ${back.season}, seed ${back.seasonSeed}, ${back.careerBackups.length} backup`,
    );
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
