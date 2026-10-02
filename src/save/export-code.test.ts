import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  compressionSupported,
  crc32,
  createProfileStore,
  decodeExportCode,
  DEFAULT_PROFILE,
  encodeExportCode,
  PROFILE_VERSION,
  sanitiseProfile,
  type Profile,
  type StorageLike,
} from './index';

// Run W-R (docs/milestones/M4.md, save-3: "saves round-trip, export codes decode (plain always,
// compressed where supported), and every golden save fixture migrates"; "a profile with non-zero
// grudges round-trips through save, reload and the export code with the grudges intact").

const FIXTURES = import.meta.glob<unknown>('/tests/fixtures/save/profile-v*.json', {
  eager: true,
  import: 'default',
});

/** A mid-career profile with non-default values in every field. */
const CAREER: Profile = sanitiseProfile({
  ...DEFAULT_PROFILE,
  cash: 12345,
  bikes: {
    owned: ['base:rustbucket-400', 'base:streetfighter-750', 'base:golf-cart'],
    current: 'base:streetfighter-750',
    paint: { 'base:streetfighter-750': 'flamingo-pink' },
  },
  regions: {
    'florida-keys': {
      tier: 3,
      won: ['shakedown', 'sunburn-hunt', 'deputy-dash', 'chad-grudge'],
      unlockedRoads: ['m1-marina-run', 'm1-pelican-bridge'],
      claimedRoads: ['m1-marina-run'],
      foundShortcuts: ['m1-standard-run#m1-boat-ramp-cut'],
      secrets: ['boat-ramp-cut', 'tip-cooler'],
      finaleBeaten: false,
    },
  },
  grudges: {
    'base:kevin-from-accounting': { 'base:player': 7 },
    'base:chad-speedwell': { 'base:player': 2.5 },
  },
  history: [
    {
      event: 'base:keys-t1-shakedown',
      node: 'shakedown',
      region: 'florida-keys',
      place: 2,
      outcome: 'won',
      cash: 1200,
      takedowns: 1,
      build: 'abc1234',
      at: '2026-10-02T10:00:00.000Z',
    },
  ],
  paintsOwned: ['flamingo-pink', 'key-lime'],
  oncePerCareer: ['prompt:fight', 'prompt:ride'],
});

const record = (data: unknown) => ({
  format: 'profile' as const,
  version: PROFILE_VERSION,
  build: 'abc1234',
  savedAt: '2026-10-02T10:00:00.000Z',
  data,
});

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('the export code', () => {
  it('a plain code round-trips every field, grudges included', async () => {
    const code = await encodeExportCode({ profile: record(CAREER) }, { compress: false });
    expect(code).toMatch(/^EC1\.p\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    const back = await decodeExportCode(code);
    expect(back.kind).toBe('ok');
    if (back.kind !== 'ok') return;
    expect(back.profile).toEqual(CAREER);
    expect(back.profile.grudges['base:kevin-from-accounting']).toEqual({ 'base:player': 7 });
  });

  it('a compressed code round-trips too, and is shorter', async () => {
    expect(compressionSupported()).toBe(true);
    const plain = await encodeExportCode({ profile: record(CAREER) }, { compress: false });
    const zipped = await encodeExportCode({ profile: record(CAREER) });
    expect(zipped.startsWith('EC1.z.')).toBe(true);
    expect(zipped.length).toBeLessThan(plain.length);
    const back = await decodeExportCode(zipped);
    expect(back.kind === 'ok' && back.profile).toEqual(CAREER);
    console.log(`export code: ${plain.length} characters plain, ${zipped.length} compressed`);
  });

  it('carries the settings record when given, and survives being pasted across lines', async () => {
    const settings = {
      format: 'settings',
      version: 1,
      build: 'abc1234',
      savedAt: 'x',
      data: { units: 'kmh' },
    };
    const code = await encodeExportCode({ profile: record(CAREER), settings: settings as never });
    const wrapped = code.replace(/(.{40})/g, '$1\n  ');
    const back = await decodeExportCode(wrapped);
    expect(back.kind === 'ok' && back.settings).toEqual(settings);
  });

  it('refuses a typo, a wrong prefix, a broken checksum and garbage', async () => {
    const code = await encodeExportCode({ profile: record(CAREER) }, { compress: false });
    const parts = code.split('.');
    const payload = parts[2] ?? '';
    // One character changed in the payload: the checksum catches it.
    const typo = [parts[0], parts[1], (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1), parts[3]].join(
      '.',
    );
    expect((await decodeExportCode(typo)).kind).toBe('invalid');
    expect((await decodeExportCode(code.replace('EC1', 'EC2'))).kind).toBe('invalid');
    expect((await decodeExportCode(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0'))).kind).toBe(
      'invalid',
    );
    expect(await decodeExportCode('hello')).toMatchObject({ kind: 'invalid' });
    expect(await decodeExportCode('EC1.p.!!!.00000000')).toMatchObject({ kind: 'invalid' });
  });

  it('refuses a profile newer than this build, untouched', async () => {
    const code = await encodeExportCode({ profile: { ...record(CAREER), version: PROFILE_VERSION + 1 } });
    expect(await decodeExportCode(code)).toEqual({ kind: 'newer', version: PROFILE_VERSION + 1 });
  });

  it('every golden save fixture goes through a code and migrates', async () => {
    const names = Object.keys(FIXTURES);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const back = await decodeExportCode(await encodeExportCode({ profile: FIXTURES[name] as never }));
      expect(back.kind, name).toBe('ok');
      if (back.kind === 'ok') expect(back.profile.cash, name).toBe(4250);
    }
    console.log(`export code: ${names.length} golden profile fixture(s) round-tripped`);
  });

  it('a grudge saved, reloaded and carried in a code is still there (the persist path)', async () => {
    const storage = memoryStorage();
    const store = createProfileStore({ keyPrefix: 'tb', build: 'abc1234', storage, now: () => 'now' });
    expect(store.save(CAREER)).toBe(true);
    const reloaded = createProfileStore({ keyPrefix: 'tb', build: 'abc1234', storage }).load();
    expect(reloaded).toEqual(CAREER);
    const rec = store.record();
    if (!rec) throw new Error('no record');
    const back = await decodeExportCode(await encodeExportCode({ profile: rec }));
    expect(back.kind === 'ok' && back.profile.grudges).toEqual(CAREER.grudges);
  });

  it('canonical JSON sorts keys, and CRC-32 matches the standard check value', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
    expect(crc32(new TextEncoder().encode('123456789'))).toBe('cbf43926');
  });
});
